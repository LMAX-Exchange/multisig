import {Keypair, PublicKey, SystemProgram, Transaction} from "@solana/web3.js";
import {BN, Provider} from "@coral-xyz/anchor";
import assert from "assert";
import {Account, createMint, getOrCreateAssociatedTokenAccount, mintToChecked} from "@solana/spl-token";

export interface TokenMint {
  owner: Keypair;
  account: PublicKey;
  decimals: number;
}

export class SolanaDsl {
  readonly provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  async assertBalance(address: PublicKey, expectedBalance: number) {
    let actualBalance = await this.provider.connection.getBalance(address, "confirmed");
    assert.strictEqual(actualBalance, expectedBalance);
  }

  async assertAtaBalance(address: PublicKey, expectedBalance: number) {
    let actualBalance = await this.provider.connection.getTokenAccountBalance(address);
    assert.equal(actualBalance.value.amount, expectedBalance);
  }

  async createTokenMint(decimals: number = 3, initialSolBalance: number = 1_000_000_000): Promise<TokenMint> {
    const mintOwner = Keypair.generate();
    await this.provider.sendAndConfirm(  // mintOwner is also the fee payer, need to give it funds
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.provider.publicKey,
          lamports: new BN(initialSolBalance),
          toPubkey: mintOwner.publicKey,
        })
      )
    );
    let mintAccountPublicKey = await createMint(
      this.provider.connection,
      mintOwner,            // signer
      mintOwner.publicKey,  // mint authority
      mintOwner.publicKey,  // freeze authority
      decimals
    );
    return { owner: mintOwner, account: mintAccountPublicKey, decimals: decimals };
  }

  async createAta(mint: TokenMint, owner: PublicKey, initialBalance: number = 0): Promise<Account> {
    let ata = await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mint.owner,             // fee payer
      mint.account,           // mint
      owner,
      true  // allowOwnerOffCurve - needs to be true for off-curve owner address, e.g. the `multisig.signer` off-curve PDA
    );
    if (initialBalance > 0) {
      await mintToChecked(
        this.provider.connection,
        mint.owner,                 // fee payer
        mint.account,      // mint
        ata.address,  // receiver (should be a token account)
        mint.owner.publicKey,       // mint authority
        initialBalance,
        mint.decimals  // decimals
      );
    }
    return ata;
  }
}
