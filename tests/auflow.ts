import { Program, BN } from "@coral-xyz/anchor";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Auflow } from "../target/types/auflow";
import IDL from "../target/idl/auflow.json";
import {
  METAL_AUGOLD,
  ERR,
  configPda,
  reservePda,
  mintAuthorityPda,
  cdpPda,
  vaultPda,
  poolAuthorityPda,
  setPythAccount,
  getTokenBalance,
  ensureAta,
  fund,
  expectAnchorError,
  createMintAccount,
  mintTokens,
} from "./helpers";

describe("auflow (bankrun)", () => {
  it("REQ01–REQ05: protocol integration", async function () {
    this.timeout(120_000);

    const context = await startAnchor(".", [], []);
    const provider = new BankrunProvider(context);
    const program = new Program(IDL as Auflow, provider);
    const auditor = Keypair.generate();
    const borrower = Keypair.generate();
    const liquidator = Keypair.generate();
    const reckless = Keypair.generate();
    const healthyBorrower = Keypair.generate();
    const mintPayer = context.payer;

    await fund(provider, auditor.publicKey);
    await fund(provider, borrower.publicKey);
    await fund(provider, liquidator.publicKey);
    await fund(provider, reckless.publicKey);
    await fund(provider, healthyBorrower.publicKey);

    const config = configPda(program.programId);
    const pythFeed = Keypair.generate().publicKey;
    setPythAccount(context, pythFeed, 10);

    await program.methods
      .initializeProtocol(auditor.publicKey)
      .accounts({
        admin: provider.wallet.publicKey,
        config,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.globalConfig.fetch(config);
    expect(cfg.maxLtvBps).to.eq(7500);
    expect(cfg.liquidationThresholdBps).to.eq(8500);

    const reserve = reservePda(program.programId, METAL_AUGOLD);
    const merkleRoot = Array.from({ length: 32 }, (_, i) => i);
    await program.methods
      .updateReserveOracle(METAL_AUGOLD, new BN(10_000), merkleRoot)
      .accounts({
        auditor: auditor.publicKey,
        config,
        reserve,
        systemProgram: SystemProgram.programId,
      })
      .signers([auditor])
      .rpc();

    const impostor = Keypair.generate();
    await fund(provider, impostor.publicKey);
    await expectAnchorError(
      program.methods
        .updateReserveOracle(METAL_AUGOLD, new BN(1), Array(32).fill(0))
        .accounts({
          auditor: impostor.publicKey,
          config,
          reserve,
          systemProgram: SystemProgram.programId,
        })
        .signers([impostor])
        .rpc(),
      ERR.Unauthorized,
    );

    const mintAuthority = mintAuthorityPda(program.programId, METAL_AUGOLD);
    const commodityMint = await createMintAccount(
      provider,
      mintAuthority,
      0,
      TOKEN_2022_PROGRAM_ID,
    );
    const borrowerCommodityAta = await ensureAta(
      provider,
      commodityMint,
      borrower.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );

    await program.methods
      .mintCommodityToken(METAL_AUGOLD, new BN(500))
      .accounts({
        user: borrower.publicKey,
        config,
        reserve,
        commodityMint,
        mintAuthority,
        userTokenAccount: borrowerCommodityAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([borrower])
      .rpc();

    expect(await getTokenBalance(provider, borrowerCommodityAta)).to.eq(
      BigInt(500),
    );

    await expectAnchorError(
      program.methods
        .mintCommodityToken(METAL_AUGOLD, new BN(20_000))
        .accounts({
          user: borrower.publicKey,
          config,
          reserve,
          commodityMint,
          mintAuthority,
          userTokenAccount: borrowerCommodityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([borrower])
        .rpc(),
      ERR.ExceedsVaultReserves,
    );

    const stablecoinMint = await createMintAccount(
      provider,
      mintPayer.publicKey,
      6,
      TOKEN_PROGRAM_ID,
    );
    const poolAuthority = poolAuthorityPda(program.programId);
    const liquidityPool = await ensureAta(
      provider,
      stablecoinMint,
      poolAuthority,
      TOKEN_PROGRAM_ID,
      true,
    );
    await mintTokens(
      provider,
      stablecoinMint,
      liquidityPool,
      mintPayer,
      BigInt(10_000_000_000),
    );

    const cdp = cdpPda(program.programId, borrower.publicKey, METAL_AUGOLD);
    const collateralVault = vaultPda(program.programId, cdp);
    const borrowerStableAta = await ensureAta(
      provider,
      stablecoinMint,
      borrower.publicKey,
    );

    await program.methods
      .openCdpPosition(METAL_AUGOLD, new BN(100), new BN(500_000_000))
      .accounts({
        owner: borrower.publicKey,
        config,
        cdp,
        collateralVault,
        commodityMint,
        ownerCollateralAccount: borrowerCommodityAta,
        stablecoinMint,
        pythPriceFeed: pythFeed,
        poolAuthority,
        liquidityPool,
        ownerStablecoinAccount: borrowerStableAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrower])
      .rpc();

    const recklessCollateral = await ensureAta(
      provider,
      commodityMint,
      reckless.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );
    await program.methods
      .mintCommodityToken(METAL_AUGOLD, new BN(200))
      .accounts({
        user: reckless.publicKey,
        config,
        reserve,
        commodityMint,
        mintAuthority,
        userTokenAccount: recklessCollateral,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([reckless])
      .rpc();

    const recklessCdp = cdpPda(program.programId, reckless.publicKey, METAL_AUGOLD);
    await expectAnchorError(
      program.methods
        .openCdpPosition(METAL_AUGOLD, new BN(100), new BN(800_000_000))
        .accounts({
          owner: reckless.publicKey,
          config,
          cdp: recklessCdp,
          collateralVault: vaultPda(program.programId, recklessCdp),
          commodityMint,
          ownerCollateralAccount: recklessCollateral,
          stablecoinMint,
          pythPriceFeed: pythFeed,
          poolAuthority,
          liquidityPool,
          ownerStablecoinAccount: await ensureAta(
            provider,
            stablecoinMint,
            reckless.publicKey,
          ),
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([reckless])
        .rpc(),
      ERR.ExceedsMaxLTV,
    );

    setPythAccount(context, pythFeed, 4);
    const liquidatorStable = await ensureAta(
      provider,
      stablecoinMint,
      liquidator.publicKey,
    );
    const liquidatorCollateral = await ensureAta(
      provider,
      commodityMint,
      liquidator.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );
    await mintTokens(
      provider,
      stablecoinMint,
      liquidatorStable,
      mintPayer,
      BigInt(1_000_000_000),
    );

    await program.methods
      .liquidateCdp()
      .accounts({
        liquidator: liquidator.publicKey,
        config,
        cdp,
        collateralVault,
        commodityMint,
        pythPriceFeed: pythFeed,
        stablecoinMint,
        poolAuthority,
        liquidityPool,
        liquidatorStablecoinAccount: liquidatorStable,
        liquidatorCollateralAccount: liquidatorCollateral,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([liquidator])
      .rpc();

    const liquidated = await program.account.cdpPosition.fetch(cdp);
    expect(liquidated.debtAmount.toNumber()).to.eq(0);

    setPythAccount(context, pythFeed, 10);
    const healthyCollateral = await ensureAta(
      provider,
      commodityMint,
      healthyBorrower.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );
    await program.methods
      .mintCommodityToken(METAL_AUGOLD, new BN(50))
      .accounts({
        user: healthyBorrower.publicKey,
        config,
        reserve,
        commodityMint,
        mintAuthority,
        userTokenAccount: healthyCollateral,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([healthyBorrower])
      .rpc();

    const healthyCdp = cdpPda(
      program.programId,
      healthyBorrower.publicKey,
      METAL_AUGOLD,
    );
    await program.methods
      .openCdpPosition(METAL_AUGOLD, new BN(50), new BN(300_000_000))
      .accounts({
        owner: healthyBorrower.publicKey,
        config,
        cdp: healthyCdp,
        collateralVault: vaultPda(program.programId, healthyCdp),
        commodityMint,
        ownerCollateralAccount: healthyCollateral,
        stablecoinMint,
        pythPriceFeed: pythFeed,
        poolAuthority,
        liquidityPool,
        ownerStablecoinAccount: await ensureAta(
          provider,
          stablecoinMint,
          healthyBorrower.publicKey,
        ),
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([healthyBorrower])
      .rpc();

    await expectAnchorError(
      program.methods
        .liquidateCdp()
        .accounts({
          liquidator: liquidator.publicKey,
          config,
          cdp: healthyCdp,
          collateralVault: vaultPda(program.programId, healthyCdp),
          commodityMint,
          pythPriceFeed: pythFeed,
          stablecoinMint,
          poolAuthority,
          liquidityPool,
          liquidatorStablecoinAccount: liquidatorStable,
          liquidatorCollateralAccount: liquidatorCollateral,
          tokenProgram: TOKEN_PROGRAM_ID,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .signers([liquidator])
        .rpc(),
      ERR.PositionHealthy,
    );
  });
});
