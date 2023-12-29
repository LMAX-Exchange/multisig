import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";

export interface MultisigAccount {
  address: PublicKey;
  signer: PublicKey;
  nonce: number;
  owners: Array<PublicKey>;
  threshold: BN;
  size: number;
}

export class MultisigDsl {
  readonly program: Program;

  constructor(program: Program) {
    this.program = program;
  }

  async createMultisig(
    owners: Array<PublicKey>,
    multisigSize: number,
    threshold: BN
  ) {
    const multisig = Keypair.generate();

    const [multisigSigner, nonce] = PublicKey.findProgramAddressSync(
      [multisig.publicKey.toBuffer()],
      this.program.programId
    );
    await this.program.methods
      .createMultisig(owners, threshold, nonce)
      .accounts({
        multisig: multisig.publicKey,
      })
      .preInstructions([
        await this.program.account.multisig.createInstruction(
          multisig,
          multisigSize
        ),
      ])
      .signers([multisig])
      .rpc();

    return {
      address: multisig.publicKey,
      signer: multisigSigner,
      nonce: nonce,
      owners: owners,
      threshold: threshold,
      size: multisigSize,
    };
  }

  async proposeTransaction(
    proposer: Keypair,
    ix: TransactionInstruction,
    multisig: PublicKey,
    txSize: number,
    closeAuth? : PublicKey,
  ) {
    const transactionAccount = Keypair.generate();

    await this.program.methods
      .createTransaction(ix.programId, ix.keys, ix.data, closeAuth ?? this.program.provider.publicKey)
      .accounts({
        multisig: multisig,
        transaction: transactionAccount.publicKey,
        proposer: proposer.publicKey,
      })
      .preInstructions([
        await this.program.account.transaction.createInstruction(
          transactionAccount,
          txSize
        ),
      ])
      .signers([proposer, transactionAccount])
      .rpc();

    return transactionAccount.publicKey;
  }

  async approveTransaction(
    approver: Keypair,
    multisig: PublicKey,
    tx: PublicKey
  ) {
    await this.program.methods
      .approve()
      .accounts({
        multisig: multisig,
        transaction: tx,
        owner: approver.publicKey,
      })
      .signers([approver])
      .rpc();
  }

  async executeTransaction(
    tx: PublicKey,
    ix: TransactionInstruction,
    multisigSigner: PublicKey,
    multisigAddress: PublicKey
  ) {
    await this.program.methods
      .executeTransaction()
      .accounts({
        multisig: multisigAddress,
        multisigSigner,
        transaction: tx,
      })
      .remainingAccounts(
        ix.keys
          // Change the signer status on the vendor signer since it's signed by the program, not the client.
          .map((meta) =>
            meta.pubkey.equals(multisigSigner)
              ? { ...meta, isSigner: false }
              : meta
          )
          .concat({
            pubkey: ix.programId,
            isWritable: false,
            isSigner: false,
          })
      )
      .rpc();
  }

  async closeTransaction(
      tx: PublicKey,
      successor: PublicKey,
      closeAuth? : Keypair
  ) {
    await this.program.methods
        .closeTransaction()
        .accounts({
          closeAuthority: closeAuth.publicKey ?? this.program.provider.publicKey,
          successor,
          transaction: tx,
        })
        .signers(closeAuth !== undefined ? [closeAuth] : [])
        .rpc();
  }
}
