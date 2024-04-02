import * as assert from "assert";
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram, Transaction} from "@solana/web3.js";
import {
  createInitializeAccountInstruction,
  createTransferCheckedInstruction,
  mintToChecked,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {MultisigAccount, MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";

const TOKEN_ACCOUNT_SPACE = 165;
describe("Test transaction execution", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;

  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program, provider);
  });

  it("should let proposer execute SOL transaction if multisig approval threshold reached", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send SOL from multisig
    const recipient = Keypair.generate().publicKey
    let solTransferInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: recipient,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000_000);
    await dsl.assertBalance(recipient, 0);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [solTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, solTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 400_000_000);
    await dsl.assertBalance(recipient, 600_000_000);
  }).timeout(5000);


  it("should let proposer execute a SPL token transaction if multisig approval threshold reached using an ata", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send SPL tokens from multisig
    let mint = await dsl.createTokenMint(3);
    let multisigOwnedAta = await dsl.createAta(mint, multisig.signer, 2000);
    let destinationAta = await dsl.createAta(mint, Keypair.generate().publicKey);
    let tokenTransferInstruction = createTransferCheckedInstruction(
      multisigOwnedAta.address,  // from (should be a token account)
      mint.account,               // mint
      destinationAta.address,     // to (should be a token account)
      multisig.signer,           // from's owner
      1500,              // amount
      3                 // decimals
    );

    await dsl.assertAtaBalance(multisigOwnedAta.address, 2000);
    await dsl.assertAtaBalance(destinationAta.address, 0);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, tokenTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    await dsl.assertAtaBalance(multisigOwnedAta.address, 500);
    await dsl.assertAtaBalance(destinationAta.address, 1500);
  }).timeout(5000);

  it("should let proposer execute a SPL token transaction if multisig approval threshold reached using an auxilliary token account", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let mint = await dsl.createTokenMint(3);

    let tokenAccount : Keypair = Keypair.generate();
    let multisigOwnedTokenAccountInstruction = SystemProgram.createAccount(
        {
          fromPubkey: provider.publicKey,
          newAccountPubkey: tokenAccount.publicKey,
          lamports: 1_000_000_000,
          space: TOKEN_ACCOUNT_SPACE, //token account size
          programId: TOKEN_PROGRAM_ID
        }
    );

    let initializeAccountInstruction = createInitializeAccountInstruction(tokenAccount.publicKey, mint.account, multisig.signer);

    let blockhash = await provider.connection.getLatestBlockhash();
    let transaction = new Transaction({blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight, feePayer: provider.publicKey})
        .add(multisigOwnedTokenAccountInstruction)
        .add(initializeAccountInstruction);

    transaction.sign(tokenAccount);
    await provider.wallet.signTransaction(transaction);

    await provider.sendAndConfirm(transaction)

    await mintToChecked(
        provider.connection,
        mint.owner,                 // fee payer
        mint.account,      // mint
        tokenAccount.publicKey,    // receiver (should be a token account)
        mint.owner.publicKey,       // mint authority
        2000,           // amount (2 tokens)
        3               // decimals
    );
    let destinationAta = await dsl.createAta(mint, Keypair.generate().publicKey);
    let tokenTransferInstruction = createTransferCheckedInstruction(
        tokenAccount.publicKey,     // from (should be a token account)
        mint.account,       // mint
        destinationAta.address,      // to (should be a token account)
        multisig.signer,            // from's owner
        1500,               // amount
        3                  // decimals
    );

    await dsl.assertAtaBalance(tokenAccount.publicKey, 2000);
    await dsl.assertAtaBalance(destinationAta.address, 0);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, tokenTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    await dsl.assertAtaBalance(tokenAccount.publicKey, 500);
    await dsl.assertAtaBalance(destinationAta.address, 1500);
  }).timeout(5000);


  it("should let proposer execute a transaction containing a SOL transfer and a SPL token transfer instruction", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let solTransferInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: provider.publicKey,
    });

    // Create instruction to send SPL tokens from multisig
    let mint = await dsl.createTokenMint(3);
    let multisigOwnedAta = await dsl.createAta(mint, multisig.signer, 2000);
    let destinationAta = await dsl.createAta(mint, Keypair.generate().publicKey);
    let tokenTransferInstruction = createTransferCheckedInstruction(
      multisigOwnedAta.address,  // from (should be a token account)
      mint.account,               // mint
      destinationAta.address,     // to (should be a token account)
      multisig.signer,           // from's owner
      1500,              // amount
      3                 // decimals
    );

    await dsl.assertBalance(multisig.signer,1_000_000_000);
    await dsl.assertAtaBalance(multisigOwnedAta.address, 2000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [solTransferInstruction, tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransactionWithMultipleInstructions(
      transactionAddress,
      [solTransferInstruction, tokenTransferInstruction],
      multisig.signer,
      multisig.address,
      ownerA,
      ownerA.publicKey
    );

    await dsl.assertBalance(multisig.signer,400_000_000);
    await dsl.assertAtaBalance(multisigOwnedAta.address, 500);
  }).timeout(5000);

  it("should not execute any instructions if one of the instructions fails", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let instruction1 = SystemProgram.transfer({ // should work
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: provider.publicKey,
    });
    let instruction2 = SystemProgram.transfer({ // should fail, not enough funds
      fromPubkey: multisig.signer,
      lamports: new BN(500_000_000),
      toPubkey: provider.publicKey,
    });
    let instruction3 = SystemProgram.transfer({ // would work if instruction2 wasn't present, but won't be executed
      fromPubkey: multisig.signer,
      lamports: new BN(100_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [instruction1, instruction2, instruction3], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransactionWithMultipleInstructions(transactionAddress,
        [instruction1, instruction2, instruction3],
        multisig.signer,
        multisig.address,
        ownerA,
        ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(e.logs.includes("Transfer: insufficient lamports 400000000, need 500000000"));
      assert.strictEqual(e.message, "failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1");
    }

    await dsl.assertBalance(multisig.signer, 1_000_000_000);
  }).timeout(5000);


  it("should let owner who has approved execute transaction if multisig approval threshold reached", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 0);
  }).timeout(5000);


  it("should let owner who has not approved execute transaction if multisig approval threshold reached", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, ownerC] = multisig.owners;

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerC, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 0);
  }).timeout(5000);


  it("should close transaction account and refund rent exemption SOL on execute transaction", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.assertBalance(ownerA.publicKey, 0);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(ownerA.publicKey, 2_108_880);  // this is the rent exemption amount

    let transactionActInfo = await provider.connection.getAccountInfo(transactionAddress, "confirmed");
    assert.strictEqual(transactionActInfo, null);
  }).timeout(5000);

  it("should refund rent exemption SOL to any nominated account", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;
    const otherAccount = Keypair.generate();

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.assertBalance(otherAccount.publicKey, 0);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, otherAccount.publicKey);

    await dsl.assertBalance(otherAccount.publicKey, 2_108_880);  // this is the rent exemption amount
  }).timeout(5000);

  it("should not clear up transaction account if execute fails", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(5_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    let transactionAccount = await program.account.transaction.fetch(transactionAddress);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("The executeTransaction function should have failed");
    } catch (e) {
      assert.ok(!transactionAccount.didExecute, "Transaction should not have been executed");
      let transactionActInfo = await provider.connection.getAccountInfo(transactionAddress, "confirmed");
      assert.notEqual(transactionActInfo, null);
    }
  }).timeout(5000);

  it("should not execute transaction twice", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 0);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized"));
    }

  }).timeout(5000);


  it("should not let a non-owner execute transaction", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;
    const ownerD = Keypair.generate();

    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerD, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: InvalidExecutor. Error Number: 6010. Error Message: Executor is not a multisig owner"));
    }

    await dsl.assertBalance(multisig.signer, 1_000_000_000);
  }).timeout(5000);
});
