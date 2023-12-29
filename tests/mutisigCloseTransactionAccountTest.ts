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
import { cat } from "shelljs";

describe("Test closing transaction accounts", async () => {
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

  it("should allow transaction account to be closed before executing", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const multisigSize = 200; // Big enough.
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        multisigSize,
        threshold
    );

    // Fund the multisig signer account with enough funds to perform transaction twice
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(2_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 2_000_000_000);

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const closeAuth = Keypair.generate();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
        ownerA,
        transactionInstruction,
        multisig.address,
        1000,
        closeAuth.publicKey
    );

    let beforeTransactionAccountBalance = await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    const successor = Keypair.generate();

    let beforeSuccessorBalance = await provider.connection.getBalance(
        successor.publicKey,
        "confirmed"
    );

    assert.strictEqual(beforeSuccessorBalance, 0);

    await dsl.closeTransaction(transactionAddress, successor.publicKey, closeAuth);

    let afterTransactionAccountBalance = await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    let afterSuccessorBalance = await provider.connection.getBalance(
        successor.publicKey,
        "confirmed"
    );

    assert.strictEqual(afterTransactionAccountBalance, 0, "Funds should've been removed from transaction account");
    assert.strictEqual(afterSuccessorBalance, beforeTransactionAccountBalance, "Funds should've been moved to successor account");

  });

  it("should allow transaction account to be closed after executing", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const multisigSize = 200; // Big enough.
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        multisigSize,
        threshold
    );

    // Fund the multisig signer account with enough funds to perform transaction twice
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(2_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 2_000_000_000);

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const closeAuth = Keypair.generate();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
        ownerA,
        transactionInstruction,
        multisig.address,
        1000,
        closeAuth.publicKey
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address);

    let beforeTransactionAccountBalance = await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    const successor = Keypair.generate();

    let beforeSuccessorBalance = await provider.connection.getBalance(
        successor.publicKey,
        "confirmed"
    );

    assert.strictEqual(beforeSuccessorBalance, 0);

    await dsl.closeTransaction(transactionAddress, successor.publicKey, closeAuth);

    let afterTransactionAccountBalance = await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    let afterSuccessorBalance = await provider.connection.getBalance(
        successor.publicKey,
        "confirmed"
    );

    assert.strictEqual(afterTransactionAccountBalance, 0, "Funds should've been removed from transaction account");
    assert.strictEqual(afterSuccessorBalance, beforeTransactionAccountBalance, "Funds should've been moved to successor account");

  });

  it("should not allow transaction account to be closed by non close authority", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const multisigSize = 200; // Big enough.
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        multisigSize,
        threshold
    );

    // Fund the multisig signer account with enough funds to perform transaction twice
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(2_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 2_000_000_000);

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const closeAuth = Keypair.generate();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
        ownerA,
        transactionInstruction,
        multisig.address,
        1000,
        closeAuth.publicKey
    );
    
    let beforeTransactionAccountBalance = await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    const successor = Keypair.generate();

    let beforeSuccessorBalance = await provider.connection.getBalance(
        successor.publicKey,
        "confirmed"
    );

    assert.strictEqual(beforeSuccessorBalance, 0);

    const notCloseAuth = Keypair.generate();

    try
    {
      await dsl.closeTransaction(transactionAddress, successor.publicKey, notCloseAuth);
      fail("Should not have close transaction")
    }
    catch (e) {
      assert.ok(e.message.includes("Error Code: InvalidCloseAuthority. Error Number: 6009. Error Message: The given close authority does not match the transaction close authority"))
    }

    let afterTransactionAccountBalance = await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    let afterSuccessorBalance = await provider.connection.getBalance(
        successor.publicKey,
        "confirmed"
    );

    assert.strictEqual(afterTransactionAccountBalance, beforeTransactionAccountBalance, "Funds should not have been removed from transaction account");
    assert.strictEqual(afterSuccessorBalance, 0, "Funds should should not have been moved to successor account");

  });

  it("should not allow transaction approval after closing account", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const multisigSize = 200; // Big enough.
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        multisigSize,
        threshold
    );

    // Fund the multisig signer account with enough funds to perform transaction twice
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(2_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 2_000_000_000);

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const closeAuth = Keypair.generate();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
        ownerA,
        transactionInstruction,
        multisig.address,
        1000,
        closeAuth.publicKey
    );

    const successor = Keypair.generate();

    await dsl.closeTransaction(transactionAddress, successor.publicKey, closeAuth);

    try
    {
      await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
      fail("Should not have executed transaction")
    }
    catch (e) {
      assert.ok(e.message.includes("Error Number: 3012. Error Message: The program expected this account to be already initialized"))
    }

  });

  it("should not allow transaction execution after closing account", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const multisigSize = 200; // Big enough.
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
        owners,
        multisigSize,
        threshold
    );

    // Fund the multisig signer account with enough funds to perform transaction twice
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(2_000_000_000),
              toPubkey: multisig.signer,
            })
        )
    );

    let beforeBalance = await provider.connection.getBalance(
        multisig.signer,
        "confirmed"
    );
    assert.strictEqual(beforeBalance, 2_000_000_000);

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const closeAuth = Keypair.generate();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
        ownerA,
        transactionInstruction,
        multisig.address,
        1000,
        closeAuth.publicKey
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await provider.connection.getBalance(
        transactionAddress,
        "confirmed"
    );

    const successor = Keypair.generate();

    await dsl.closeTransaction(transactionAddress, successor.publicKey, closeAuth);

    try
    {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address);
      fail("Should not have executed transaction")
    }
    catch (e) {
      assert.ok(e.message.includes("Error Number: 3012. Error Message: The program expected this account to be already initialized"))
    }

  });
});
