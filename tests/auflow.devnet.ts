import * as anchor from "@coral-xyz/anchor";
import { Program, BN, Wallet } from "@coral-xyz/anchor";
import { expect } from "chai";
import fs from "fs";
import os from "os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Auflow } from "../target/types/auflow";
import { PythMock } from "../target/types/pyth_mock";
import AuflowIdl from "../target/idl/auflow.json";
import PythMockIdl from "../target/idl/pyth_mock.json";
import {
  METAL_AUGOLD,
  ERR,
  DEVNET_PROGRAM_ID,
  PYTH_MOCK_PROGRAM_ID,
  configPda,
  reservePda,
  mintAuthorityPda,
  cdpPda,
  vaultPda,
  poolAuthorityPda,
  pythMockFeedPda,
  priceToPythField,
  getTokenBalance,
  ensureAta,
  fundMany,
  expectAnchorError,
  createMintAccount,
  mintTokens,
  DEFAULT_CONFIRM,
  DEVNET_FUND_LAMPORTS,
} from "./helpers";

const DEVNET_RPC =
  process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const isDevnet =
  DEVNET_RPC.includes("devnet") || process.env.ANCHOR_CLUSTER === "devnet";

function loadDevnetProvider(): anchor.AnchorProvider {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const keypairPath =
    process.env.ANCHOR_WALLET ??
    `${os.homedir()}/.config/solana/id.json`;
  const secret = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[],
  );
  const wallet = new Wallet(Keypair.fromSecretKey(secret));
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

function anchorSendProvider(
  provider: anchor.AnchorProvider,
): anchor.AnchorProvider & {
  send: (tx: anchor.web3.Transaction, signers?: Keypair[]) => Promise<string>;
} {
  const wrapped = provider as anchor.AnchorProvider & {
    send: (tx: anchor.web3.Transaction, signers?: Keypair[]) => Promise<string>;
  };
  wrapped.send = async (tx, signers = []) =>
    provider.sendAndConfirm(tx, signers, DEFAULT_CONFIRM);
  return wrapped;
}

function walletKeypair(provider: anchor.AnchorProvider): Keypair {
  return (provider.wallet as Wallet).payer;
}

async function ensurePythFeed(
  pythMock: Program<PythMock>,
  authority: Keypair,
): Promise<PublicKey> {
  const feed = pythMockFeedPda(authority.publicKey);
  const info = await pythMock.provider.connection.getAccountInfo(feed);
  if (!info) {
    await pythMock.methods
      .initFeed()
      .accounts({
        payer: authority.publicKey,
        feed,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }
  return feed;
}

async function setPythPrice(
  pythMock: Program<PythMock>,
  authority: Keypair,
  feed: PublicKey,
  priceUsd: number,
): Promise<void> {
  await pythMock.methods
    .setPrice(new BN(priceToPythField(priceUsd)), -8)
    .accounts({
      authority: authority.publicKey,
      feed,
    })
    .signers([authority])
    .rpc();
}

(isDevnet ? describe : describe.skip)("auflow (devnet)", () => {
  let program: Program<Auflow>;
  let pythMock: Program<PythMock>;
  let sendProvider: ReturnType<typeof anchorSendProvider>;

  before(async function () {
    this.timeout(60_000);
    if (!isDevnet) {
      return;
    }
    const provider = loadDevnetProvider();
    anchor.setProvider(provider);
    sendProvider = anchorSendProvider(provider);

    const auflowInfo = await provider.connection.getAccountInfo(
      DEVNET_PROGRAM_ID,
    );
    expect(auflowInfo?.executable).to.eq(true);

    const mockInfo = await provider.connection.getAccountInfo(
      PYTH_MOCK_PROGRAM_ID,
    );
    expect(mockInfo?.executable).to.eq(true);

    program = new Program(AuflowIdl as Auflow, provider);
    pythMock = new Program(PythMockIdl as PythMock, provider);
    expect(program.programId.equals(DEVNET_PROGRAM_ID)).to.eq(true);
  });

  it("REQ01–REQ05: protocol integration on devnet", async function () {
    this.timeout(300_000);

    const borrower = Keypair.generate();
    const liquidator = Keypair.generate();
    const reckless = Keypair.generate();
    const healthyBorrower = Keypair.generate();
    const mintPayer = Keypair.generate();

    const tip = DEVNET_FUND_LAMPORTS;
    await fundMany(
      sendProvider,
      [
        borrower.publicKey,
        liquidator.publicKey,
        reckless.publicKey,
        healthyBorrower.publicKey,
        mintPayer.publicKey,
      ],
      tip,
    );

    const auditor = sendProvider.wallet.publicKey;
    const config = configPda(program.programId);
    const configInfo = await sendProvider.connection.getAccountInfo(config);
    if (!configInfo) {
      await program.methods
        .initializeProtocol(auditor)
        .accounts({
          admin: sendProvider.wallet.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .rpc(DEFAULT_CONFIRM);
    }
    const cfg = await program.account.globalConfig.fetch(config);
    expect(cfg.maxLtvBps).to.eq(7500);
    if (!cfg.auditorPubkey.equals(auditor)) {
      throw new Error(
        `Global config auditor is ${cfg.auditorPubkey.toBase58()} but the test wallet is ${auditor.toBase58()}. Re-initialize protocol with this wallet as auditor, or use the original admin wallet.`,
      );
    }

    const pythAuthority = walletKeypair(sendProvider);
    const pythFeed = await ensurePythFeed(pythMock, pythAuthority);
    await setPythPrice(pythMock, pythAuthority, pythFeed, 10);

    const reserve = reservePda(program.programId, METAL_AUGOLD);
    const merkleRoot = Array.from({ length: 32 }, (_, i) => i);
    await program.methods
      .updateReserveOracle(METAL_AUGOLD, new BN(10_000), merkleRoot)
      .accounts({
        auditor,
        config,
        reserve,
        systemProgram: SystemProgram.programId,
      })
      .rpc(DEFAULT_CONFIRM);

    const impostor = Keypair.generate();
    await fundMany(sendProvider, [impostor.publicKey], tip);
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
      sendProvider,
      mintAuthority,
      0,
      TOKEN_2022_PROGRAM_ID,
    );
    const borrowerCommodityAta = await ensureAta(
      sendProvider,
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
      .rpc(DEFAULT_CONFIRM);

    expect(await getTokenBalance(sendProvider, borrowerCommodityAta)).to.eq(
      BigInt(500),
    );

    const stablecoinMint = await createMintAccount(
      sendProvider,
      mintPayer.publicKey,
      6,
      TOKEN_PROGRAM_ID,
    );
    const poolAuthority = poolAuthorityPda(program.programId);
    const liquidityPool = await ensureAta(
      sendProvider,
      stablecoinMint,
      poolAuthority,
      TOKEN_PROGRAM_ID,
      true,
    );
    await mintTokens(
      sendProvider,
      stablecoinMint,
      liquidityPool,
      mintPayer,
      BigInt(10_000_000_000),
    );

    const cdp = cdpPda(program.programId, borrower.publicKey, METAL_AUGOLD);
    const collateralVault = vaultPda(program.programId, cdp);
    const borrowerStableAta = await ensureAta(
      sendProvider,
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
      .rpc(DEFAULT_CONFIRM);

    const recklessCollateral = await ensureAta(
      sendProvider,
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
      .rpc(DEFAULT_CONFIRM);

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
            sendProvider,
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

    await setPythPrice(pythMock, pythAuthority, pythFeed, 4);
    const liquidatorStable = await ensureAta(
      sendProvider,
      stablecoinMint,
      liquidator.publicKey,
    );
    const liquidatorCollateral = await ensureAta(
      sendProvider,
      commodityMint,
      liquidator.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );
    await mintTokens(
      sendProvider,
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
      .rpc(DEFAULT_CONFIRM);

    const liquidated = await program.account.cdpPosition.fetch(cdp);
    expect(liquidated.debtAmount.toNumber()).to.eq(0);

    await setPythPrice(pythMock, pythAuthority, pythFeed, 10);
    const healthyCollateral = await ensureAta(
      sendProvider,
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
      .rpc(DEFAULT_CONFIRM);

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
          sendProvider,
          stablecoinMint,
          healthyBorrower.publicKey,
        ),
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([healthyBorrower])
      .rpc(DEFAULT_CONFIRM);

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
