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

describe("Test transaction  execution", async () => {
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

  it("should execute transaction by proposer if multisig approval threshold reached", async () => {
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

    await dsl.executeTransaction(
      transactionAddress,
      transactionInstruction,
      multisig.signer,
      multisig.address,
        ownerA
    );

    let afterBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
  }).timeout(5000);


  it("should execute transaction by any owner if multisig approval threshold reached", async () => {
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

    await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
        multisig.signer,
        multisig.address,
        ownerB
    );

    let afterBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
  }).timeout(5000);


  it("should execute transaction by any owner (even those who have not approved) if multisig approval threshold reached", async () => {
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

    await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
        multisig.signer,
        multisig.address,
        ownerC
    );

    let afterBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
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

    await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
        multisig.signer,
        multisig.address,
        ownerB
    );

    let afterBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
    assert.strictEqual(afterBalance, 0);

    try {
      await dsl.executeTransaction(
          transactionAddress,
          transactionInstruction,
          multisig.signer,
          multisig.address,
          ownerA
      );
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
          e.message.includes(
              "Error Code: AlreadyExecuted. Error Number: 6006. Error Message: The given transaction has already been executed"
          )
      );
    }

  }).timeout(5000);


  it("should not execute transaction by non owner", async () => {
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
      await dsl.executeTransaction(
          transactionAddress,
          transactionInstruction,
          multisig.signer,
          multisig.address,
          ownerD
      );
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
