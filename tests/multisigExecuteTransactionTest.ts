import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram, Transaction} from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  createMint,
  createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount,
  mintToChecked
} from "@solana/spl-token";
import {MultisigAccount, MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";

describe("Test transaction execution", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;

  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program);
  });


  it("should let proposer execute SOL transaction if multisig approval threshold reached", async () => {
    const [ownerA, ownerB, ownerC] = [ Keypair.generate(), Keypair.generate(), Keypair.generate() ];
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);
    const multisig: MultisigAccount = await dsl.createMultisig(owners, threshold);

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: multisig.signer,
        })
      )
    );

    // Create instruction to send SOL from multisig
    const recipient = Keypair.generate().publicKey
    let solTransferInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: recipient,
    });

    let beforeBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(beforeBalance, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [solTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, solTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    let afterBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(afterBalance, 400_000_000);

    let recipientBalance = await provider.connection.getBalance(recipient, "confirmed");
    assert.strictEqual(recipientBalance, 600_000_000);
  }).timeout(5000);


  it("should let proposer execute a SPL token transaction if multisig approval threshold reached", async () => {
    const [ownerA, ownerB, ownerC] = [ Keypair.generate(), Keypair.generate(), Keypair.generate() ];
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);
    const multisig: MultisigAccount = await dsl.createMultisig(owners, threshold);

    // Create instruction to send SPL tokens from multisig
    const mintOwner = Keypair.generate();
    await provider.sendAndConfirm(  // mintOwner is also the fee payer, need to give it funds
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: mintOwner.publicKey,
        })
      )
    );
    let mintAccountPublicKey = await createMint(
      provider.connection,
      mintOwner,            // signer
      mintOwner.publicKey,  // mint authority
      mintOwner.publicKey,  // freeze authority
      3  // decimals
    );
    let multisigOwnedAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      mintOwner,             // fee payer
      mintAccountPublicKey,  // mint
      multisig.signer,       // owner
      true  // allowOwnerOffCurve - needs to be true because `multisig.signer` is an off-curve PDA
    );
    await mintToChecked(
      provider.connection,
      mintOwner,                 // fee payer
      mintAccountPublicKey,      // mint
      multisigOwnedAta.address,  // receiver (should be a token account)
      mintOwner.publicKey,       // mint authority
      2000,  // amount (2 tokens)
      3  // decimals
    );
    let destinationAta = await createAssociatedTokenAccount(
      provider.connection,
      mintOwner,             // fee payer
      mintAccountPublicKey,  // mint
      Keypair.generate().publicKey       // owner (any valid Solana address)
    );
    let tokenTransferInstruction = createTransferCheckedInstruction(
      multisigOwnedAta.address,  // from (should be a token account)
      mintAccountPublicKey,      // mint
      destinationAta,            // to (should be a token account)
      multisig.signer,           // from's owner
      1500,              // amount
      3                 // decimals
    );

    let beforeTokenBalance = await provider.connection.getTokenAccountBalance(multisigOwnedAta.address);
    assert.equal(beforeTokenBalance.value.amount, 2000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, tokenTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    let afterTokenBalance = await provider.connection.getTokenAccountBalance(multisigOwnedAta.address);
    assert.equal(afterTokenBalance.value.amount, 500);

    let recipientTokenBalance = await provider.connection.getTokenAccountBalance(destinationAta);
    assert.equal(recipientTokenBalance.value.amount, 1500);
  }).timeout(5000);


  it("should let proposer execute a transaction containing a SOL transfer and a SPL token transfer instruction", async () => {
    const [ownerA, ownerB, ownerC] = [ Keypair.generate(), Keypair.generate(), Keypair.generate() ];
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);
    const multisig: MultisigAccount = await dsl.createMultisig(owners, threshold);

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: multisig.signer,
        })
      )
    );
    // Create instruction to send funds from multisig
    let solTransferInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: provider.publicKey,
    });

    // Create instruction to send SPL tokens from multisig
    const mintOwner = Keypair.generate();
    await provider.sendAndConfirm(  // mintOwner is also the fee payer, need to give it funds
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: mintOwner.publicKey,
        })
      )
    );
    let mintAccountPublicKey = await createMint(
      provider.connection,
      mintOwner,            // signer
      mintOwner.publicKey,  // mint authority
      mintOwner.publicKey,  // freeze authority
      3  // decimals
    );
    let multisigOwnedAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      mintOwner,             // fee payer
      mintAccountPublicKey,  // mint
      multisig.signer,       // owner
      true  // allowOwnerOffCurve
    );
    await mintToChecked(
      provider.connection,
      mintOwner,                 // fee payer
      mintAccountPublicKey,      // mint
      multisigOwnedAta.address,  // receiver (should be a token account)
      mintOwner.publicKey,       // mint authority
      2000,  // amount (2 tokens)
      3  // decimals
    );
    let destinationAta = await createAssociatedTokenAccount(
      provider.connection,
      mintOwner,             // fee payer
      mintAccountPublicKey,  // mint
      ownerB.publicKey       // owner
    );
    let tokenTransferInstruction = createTransferCheckedInstruction(
      multisigOwnedAta.address,  // from (should be a token account)
      mintAccountPublicKey,      // mint
      destinationAta,            // to (should be a token account)
      multisig.signer,           // from's owner
      1500,              // amount
      3                 // decimals
    );

    let beforeSolBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(beforeSolBalance, 1_000_000_000);

    let beforeTokenBalance = await provider.connection.getTokenAccountBalance(multisigOwnedAta.address);
    assert.equal(beforeTokenBalance.value.amount, 2000);

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

    let afterSolBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(afterSolBalance, 400_000_000);

    let afterTokenBalance = await provider.connection.getTokenAccountBalance(multisigOwnedAta.address);
    assert.equal(afterTokenBalance.value.amount, 500);
  }).timeout(5000);

  it("should not execute any instructions if one of the instructions fails", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(owners, threshold);

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: multisig.signer,
        })
      )
    );
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

    let beforeBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(beforeBalance, 1_000_000_000);

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

    let afterBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(afterBalance, 1_000_000_000);
  }).timeout(5000);


  it("should let owner who has approved execute transaction if multisig approval threshold reached", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let afterBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
  }).timeout(5000);


  it("should let owner who has not approved execute transaction if multisig approval threshold reached", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerC, ownerA.publicKey);

    let afterBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
  }).timeout(5000);


  it("should close transaction account and refund rent exemption SOL on execute transaction", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: multisig.signer,
        })
      )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    let beforeBalance = await provider.connection.getBalance(
      ownerA.publicKey,
      "confirmed"
    );
    assert.strictEqual(beforeBalance, 0);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let afterBalance = await provider.connection.getBalance(
      ownerA.publicKey,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 2_115_840); // this is the rent exemption amount

    let transactionActInfo = await provider.connection.getAccountInfo(
      transactionAddress,
      "confirmed"
    );
    assert.strictEqual(transactionActInfo, null);
  }).timeout(5000);

  it("should refund rent exemption SOL to any nominated account", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const otherAccount = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: multisig.signer,
        })
      )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    let beforeBalance = await provider.connection.getBalance(
      otherAccount.publicKey,
      "confirmed"
    );
    assert.strictEqual(beforeBalance, 0);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, otherAccount.publicKey);

    let afterBalance = await provider.connection.getBalance(
      otherAccount.publicKey,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 2_115_840); // this is the rent exemption amount
  }).timeout(5000);

  it("should not clear up transaction account if execute fails", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(1_000_000_000),
          toPubkey: multisig.signer,
        })
      )
    );

    // Create instruction to send funds from multisig
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

      assert.ok(
        !transactionAccount.didExecute,
        "Transaction should not have been executed"
      );

      let transactionActInfo = await provider.connection.getAccountInfo(
        transactionAddress,
        "confirmed"
      );
      assert.notEqual(transactionActInfo, null);
    }
  }).timeout(5000);

  it("should not execute transaction twice", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let afterBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(afterBalance, 0);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
          e.message.includes(
              "Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized"
          )
      );
    }

  }).timeout(5000);


  it("should not let a non-owner execute transaction", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const ownerD = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        threshold
    );

    // Fund the multisig signer account
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerD, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
          e.message.includes(
              "Error Code: InvalidExecutor. Error Number: 6009. Error Message: Executor is not a multisig owner"
          )
      );
    }

    let afterBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(afterBalance, 1_000_000_000);
  }).timeout(5000);
});
