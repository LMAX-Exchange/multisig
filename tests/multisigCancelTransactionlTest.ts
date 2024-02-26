import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram, Transaction,} from "@solana/web3.js";
import {MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";
import {SolanaDsl} from "./utils/solanaDsl";

describe("Test transaction cancellation", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;
  let solanaDsl: SolanaDsl;

  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program);
    solanaDsl = new SolanaDsl(provider);
  });

  it("should let owner cancel transaction", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await solanaDsl.assertBalance(ownerA.publicKey, 0);

    await dsl.cancelTransaction(transactionAddress, multisig.address, ownerB, ownerA.publicKey);

    await solanaDsl.assertBalance(ownerA.publicKey, 2_115_840); // this is the rent exemption amount

    let transactionActInfo = await provider.connection.getAccountInfo(
      transactionAddress,
      "confirmed"
    );
    assert.strictEqual(transactionActInfo, null);
  }).timeout(5000);

  it("should not let a non-owner cancel transaction", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, _ownerC] = multisig.owners;
    const ownerD = Keypair.generate();

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    try {
      await dsl.cancelTransaction(transactionAddress, multisig.address, ownerD, ownerA.publicKey);
      fail("Should have failed to cancel transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidExecutor. Error Number: 6009. Error Message: Executor is not a multisig owner"
        )
      );
    }

    let transactionActInfo = await provider.connection.getAccountInfo(
      transactionAddress,
      "confirmed"
    );
    assert.notEqual(transactionActInfo, null);
  }).timeout(5000);

  it("should not execute transaction after cancel", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.cancelTransaction(transactionAddress, multisig.address, ownerB, ownerA.publicKey);

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

  it("should not approve transaction after cancel", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.cancelTransaction(transactionAddress, multisig.address, ownerB, ownerA.publicKey);

    try {
      await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
      fail("Should have failed to approve transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized"
        )
      );
    }
  }).timeout(5000);

  it("should approve transaction after previous canceled", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;
    const recipient = Keypair.generate();

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
      toPubkey: recipient.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.cancelTransaction(transactionAddress, multisig.address, ownerB, ownerA.publicKey);

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress2);

    await dsl.executeTransaction(transactionAddress2, transactionInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    await solanaDsl.assertBalance(recipient.publicKey, 1_000_000_000);
  }).timeout(5000);
});
