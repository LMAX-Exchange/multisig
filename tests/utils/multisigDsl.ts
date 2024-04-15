import {Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction} from "@solana/web3.js";
import {BN, Program, Provider} from "@coral-xyz/anchor";
import assert from "assert";
import {Account, createMint, getOrCreateAssociatedTokenAccount, mintToChecked} from "@solana/spl-token";

export interface MultisigAccount {
  address: PublicKey;
  signer: PublicKey;
  nonce: number;
  owners: Array<Keypair>;
  threshold: BN
}

export interface TokenMint {
  owner: Keypair;
  account: PublicKey;
  decimals: number;
}

export class MultisigDsl {
  readonly program: Program;
  readonly provider: Provider;

  constructor(program: Program, provider: Provider) {
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

  async createMultisigWithBadNonce(threshold: number, numberOfOwners: number) {
    const owners: Array<Keypair> = Array.from({length: numberOfOwners}, (_, _n) => Keypair.generate());

    let multisig;
    let nonce = 255;
    while (nonce === 255) {
      multisig = Keypair.generate();
      nonce = PublicKey.findProgramAddressSync([multisig.publicKey.toBuffer()], this.program.programId)[1];
    }

    await this.program.methods
      .createMultisig(owners.map(owner => owner.publicKey), new BN(threshold), nonce + 1)
      .accounts({
        multisig: multisig.publicKey,
      })
      .signers([multisig])
      .rpc();
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

  async assertBalance(address: PublicKey, expectedBalance: number) {
    let actualBalance = await this.provider.connection.getBalance(address, "confirmed");
    assert.strictEqual(actualBalance, expectedBalance);
  }

  async assertAtaBalance(address: PublicKey, expectedBalance: number) {
    let actualBalance = await this.provider.connection.getTokenAccountBalance(address);
    assert.equal(actualBalance.value.amount, expectedBalance);
  }

  async createTokenMint(decimals: number = 3, initialSolBalance: number = 7_000_000): Promise<TokenMint> {
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
