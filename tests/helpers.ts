import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  Connection,
  ConfirmOptions,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
} from "@solana/spl-token";
import { ProgramTestContext } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";

export const DEVNET_PROGRAM_ID = new PublicKey(
  "4oAhHznC9vvn8bgEHE1qahGx3a4etjsWCTyP6EXDpbuZ",
);
export const PYTH_MOCK_PROGRAM_ID = new PublicKey(
  "FQe9htidwUatxPXqwXEe1g1943AmjCjHnSxgNe9zVd2C",
);

export const METAL_AUGOLD = 0;
export const PYTH_ACCOUNT_SIZE = 3312;
const OFF_EXPO = 20;
const OFF_TIMESTAMP = 96;
const OFF_AGG_PRICE = 208;
const OFF_AGG_STATUS = 224;
const PRICE_STATUS_TRADING = 1;

export const ERR = {
  Unauthorized: 6000,
  ExceedsMaxLTV: 6001,
  PositionHealthy: 6002,
  ExceedsVaultReserves: 6004,
};

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function reservePda(programId: PublicKey, metalType: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), Buffer.from([metalType])],
    programId,
  )[0];
}

export function mintAuthorityPda(
  programId: PublicKey,
  metalType: number,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), Buffer.from([metalType])],
    programId,
  )[0];
}

export function cdpPda(
  programId: PublicKey,
  owner: PublicKey,
  metalType: number,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cdp"), owner.toBuffer(), Buffer.from([metalType])],
    programId,
  )[0];
}

export function vaultPda(programId: PublicKey, cdp: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), cdp.toBuffer()],
    programId,
  )[0];
}

export function poolAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool")], programId)[0];
}

export function pythMockFeedPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("feed"), authority.toBuffer()],
    PYTH_MOCK_PROGRAM_ID,
  )[0];
}

export function buildPythData(priceUsd: number, expo = -8): Buffer {
  const data = Buffer.alloc(PYTH_ACCOUNT_SIZE);
  const priceField = BigInt(Math.round(priceUsd * 10 ** -expo));
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  data.writeUInt32LE(0xa1b2c3d4, 0);
  data.writeUInt32LE(2, 4);
  data.writeUInt32LE(3, 8);
  data.writeInt32LE(expo, OFF_EXPO);
  data.writeBigInt64LE(timestamp, OFF_TIMESTAMP);
  data.writeBigInt64LE(priceField, OFF_AGG_PRICE);
  data.writeUInt8(PRICE_STATUS_TRADING, OFF_AGG_STATUS);
  return data;
}

export function setPythAccount(
  context: ProgramTestContext,
  pubkey: PublicKey,
  priceUsd: number,
): void {
  context.setAccount(pubkey, {
    lamports: LAMPORTS_PER_SOL,
    data: buildPythData(priceUsd),
    owner: SystemProgram.programId,
    executable: false,
  });
}

type SendProvider = {
  connection: Connection;
  wallet: { publicKey: PublicKey };
  send(tx: Transaction, signers?: Keypair[]): Promise<string>;
};

export async function getTokenBalance(
  provider: SendProvider,
  tokenAccount: PublicKey,
): Promise<bigint> {
  const info = await provider.connection.getAccountInfo(tokenAccount);
  if (!info) {
    throw new Error(`missing token account ${tokenAccount.toBase58()}`);
  }
  return info.data.readBigUInt64LE(64);
}

export async function ensureAta(
  provider: SendProvider,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  allowOwnerOffCurve = false,
  extraSigners: Keypair[] = [],
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    tokenProgram,
  );
  let existing: Awaited<ReturnType<typeof provider.connection.getAccountInfo>> =
    null;
  try {
    existing = await provider.connection.getAccountInfo(ata);
  } catch {
    existing = null;
  }
  if (!existing) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        ata,
        owner,
        mint,
        tokenProgram,
      ),
    );
    await provider.send(tx, extraSigners);
  }
  return ata;
}

export const DEVNET_FUND_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);

export async function fund(
  provider: SendProvider,
  to: PublicKey,
  lamports = LAMPORTS_PER_SOL,
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  await provider.send(tx);
}

export async function fundMany(
  provider: SendProvider,
  recipients: PublicKey[],
  lamports = LAMPORTS_PER_SOL,
): Promise<void> {
  if (recipients.length === 0) {
    return;
  }
  const tx = new Transaction();
  for (const to of recipients) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: to,
        lamports,
      }),
    );
  }
  await provider.send(tx);
}

export async function expectAnchorError(
  promise: Promise<unknown>,
  code: number,
): Promise<void> {
  try {
    await promise;
    expect.fail("expected transaction to fail");
  } catch (e: unknown) {
    const text = `${e}`;
    expect(
      text.includes(`Error Number: ${code}`) ||
        text.includes(`Error Code: ${code}`),
    ).to.eq(true);
  }
}

export async function createMintAccount(
  provider: SendProvider,
  authority: PublicKey,
  decimals: number,
  tokenProgram: PublicKey,
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const lamports =
    await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: tokenProgram,
    }),
    createInitializeMint2Instruction(
      mint.publicKey,
      decimals,
      authority,
      null,
      tokenProgram,
    ),
  );
  await provider.send(tx, [mint]);
  return mint.publicKey;
}

export async function mintTokens(
  provider: SendProvider,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: bigint,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): Promise<void> {
  const tx = new Transaction().add(
    createMintToInstruction(
      mint,
      destination,
      authority.publicKey,
      amount,
      [],
      tokenProgram,
    ),
  );
  await provider.send(tx, [authority]);
}

export function priceToPythField(priceUsd: number, expo = -8): BN {
  return new BN(Math.round(priceUsd * 10 ** -expo));
}

export const DEFAULT_CONFIRM: ConfirmOptions = {
  skipPreflight: false,
  commitment: "confirmed",
};
