import {Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction} from "@solana/web3.js";
import {BN, Program, Provider} from "@coral-xyz/anchor";

export interface MultisigAccount {
  address: PublicKey;
  signer: PublicKey;
  nonce: number;
  owners: Array<Keypair>;
  threshold: BN
}

export class MultisigDsl {
  readonly program: Program;
  readonly provider: Provider;

  constructor(program: Program, provider?: Provider) {
    this.program = program;
    this.provider = provider;
  }

  async createMultisigWithOwners(threshold: number, owners: Array<Keypair>, initialBalance: number = 0): Promise<MultisigAccount> {
    const multisig = Keypair.generate();
    const [multisigSigner, nonce] = PublicKey.findProgramAddressSync(
      [multisig.publicKey.toBuffer()],
      this.program.programId
    );
    await this.program.methods
      .createMultisig(owners.map(owner => owner.publicKey), new BN(threshold), nonce)
      .accounts({
        multisig: multisig.publicKey,
      })
      .signers([multisig])
      .rpc();
    if (initialBalance > 0) {
      await this.provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: this.provider.publicKey,
            lamports: new BN(initialBalance),
            toPubkey: multisigSigner,
          })
        )
      );
    }

    return {
      address: multisig.publicKey,
      signer: multisigSigner,
      nonce: nonce,
      owners: owners,
      threshold: new BN(threshold)
    };

  }

  async createMultisig(threshold: number, numberOfOwners: number, initialBalance: number = 0): Promise<MultisigAccount> {
    const owners: Array<Keypair> = Array.from({length: numberOfOwners}, (_, _n) => Keypair.generate());
    return await this.createMultisigWithOwners(threshold, owners, initialBalance);
  }

  async proposeTransaction(
    proposer: Keypair,
    instructions: Array<TransactionInstruction>,
    multisig: PublicKey,
    transactionAddress?: Keypair
  ) {

    let transactionAccount = transactionAddress ? transactionAddress : Keypair.generate();
    let smartContractInstructions = instructions.map(ix => {
      return { programId: ix.programId, accounts: ix.keys, data: ix.data };
    });
    await this.program.methods
      .createTransaction(smartContractInstructions)
      .accounts({
          multisig: multisig,
          transaction: transactionAccount.publicKey,
          proposer: proposer.publicKey,
      })
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

  async executeTransactionWithMultipleInstructions(
    tx: PublicKey,
    ixs: Array<TransactionInstruction>,
    multisigSigner: PublicKey,
    multisigAddress: PublicKey,
    executor: Keypair,
    refundee: PublicKey) {
    const accounts = ixs.flatMap(ix =>
      ix.keys
        .map((meta) => meta.pubkey.equals(multisigSigner)? {...meta, isSigner: false} : meta)
        .concat({
          pubkey: ix.programId,
          isWritable: false,
          isSigner: false,
        })
    );
    const dedupedAccounts = accounts.filter((value, index) => {
      const _value = JSON.stringify(value);
      return index === accounts.findIndex(obj => {
        return JSON.stringify(obj) === _value;
      });
    });
    await this.program.methods
      .executeTransaction()
      .accounts({
        multisig: multisigAddress,
        multisigSigner,
        transaction: tx,
        executor: executor.publicKey,
        refundee: refundee
      })
      .remainingAccounts(dedupedAccounts)
      .signers([executor])
      .rpc();
  }

  async executeTransaction(
    tx: PublicKey,
    ix: TransactionInstruction,
    multisigSigner: PublicKey,
    multisigAddress: PublicKey,
    executor: Keypair,
    refundee: PublicKey) {
    await this.executeTransactionWithMultipleInstructions(tx, [ix], multisigSigner, multisigAddress, executor, refundee);
  }

  async cancelTransaction(
    tx: PublicKey,
    multisigAddress: PublicKey,
    executor: Keypair,
    refundee: PublicKey) {
    await this.program.methods
      .cancelTransaction()
      .accounts({
        multisig: multisigAddress,
        transaction: tx,
        executor: executor.publicKey,
        refundee: refundee
      })
      .signers([executor])
      .rpc();
  }

  async proposeSignAndExecuteTransaction(
    proposer: Keypair,
    signers: Array<Keypair>,
    instructions: Array<TransactionInstruction>,
    multisigSigner: PublicKey,
    multisigAddress: PublicKey,
    executor: Keypair,
    refundee: PublicKey
  ) {

    const transactionAccount = Keypair.generate();
    const smartContractInstructions = instructions.map(ix => {
      return { programId: ix.programId, accounts: ix.keys, data: ix.data };
    });
    const proposeInstruction = await this.program.methods
      .createTransaction(smartContractInstructions)
      .accounts({
        multisig: multisigAddress,
        transaction: transactionAccount.publicKey,
        proposer: proposer.publicKey,
      })
      .signers([proposer, transactionAccount])
      .instruction();

    const approveInstructions = await Promise.all(signers.map(async signer =>
    await this.program.methods
      .approve()
      .accounts({
        multisig: multisigAddress,
        transaction: transactionAccount.publicKey,
        owner: signer.publicKey,
      })
      .signers([signer])
      .instruction()
    ));

    const accounts = instructions.flatMap(ix =>
      ix.keys
        .map((meta) => meta.pubkey.equals(multisigSigner)? {...meta, isSigner: false} : meta)
        .concat({
          pubkey: ix.programId,
          isWritable: false,
          isSigner: false,
        })
    );
    const dedupedAccounts = accounts.filter((value, index) => {
      const _value = JSON.stringify(value);
      return index === accounts.findIndex(obj => {
        return JSON.stringify(obj) === _value;
      });
    });
    const executeInstruction = await this.program.methods
      .executeTransaction()
      .accounts({
        multisig: multisigAddress,
        multisigSigner,
        transaction: transactionAccount.publicKey,
        executor: executor.publicKey,
        refundee: refundee
      })
      .remainingAccounts(dedupedAccounts)
      .signers([executor])
      .instruction();

    const blockhash = await this.provider.connection.getLatestBlockhash();
    const transaction = new Transaction({blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight, feePayer: this.provider.publicKey})
      .add(proposeInstruction)
      .add(...approveInstructions)
      .add(executeInstruction);
    transaction.sign(transactionAccount, proposer, ...signers);
    console.log("Transaction size " + transaction.serialize({verifySignatures: false}).byteLength);
    await this.provider.sendAndConfirm(transaction);
  }
}
