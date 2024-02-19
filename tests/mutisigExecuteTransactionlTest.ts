import assert = require("assert");
import { setUpValidator } from "./utils/before";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { MultisigAccount, MultisigDsl } from "./utils/multisigDsl";
import { describe } from "mocha";
import { ChildProcess } from "node:child_process";
import { fail } from "node:assert";

describe("Test transaction execution", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let validatorProcess: ChildProcess;
  let dsl: MultisigDsl;
  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    validatorProcess = result.validatorProcess;
    dsl = new MultisigDsl(program);
  });

  it("should let proposer execute transaction if multisig approval threshold reached", async () => {
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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    let afterBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

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
    assert.strictEqual(afterBalance, 2_088_000); // this is the rent exemption amount

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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

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
    assert.strictEqual(afterBalance, 2_088_000); // this is the rent exemption amount
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
    
    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);
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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

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
