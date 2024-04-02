import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram,} from "@solana/web3.js";
import {MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";

describe("Test transaction cancellation", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;

  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program, provider);
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

    await dsl.assertBalance(ownerA.publicKey, 0);

    await dsl.cancelTransaction(transactionAddress, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(ownerA.publicKey, 2_115_840); // this is the rent exemption amount

    let transactionActInfo = await provider.connection.getAccountInfo(
      transactionAddress,
      "confirmed"
    );
    assert.strictEqual(transactionActInfo, null);
  }).timeout(5000);

  it("should let owner cancel transaction, even if the owner set has changed", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });
    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    // Change owner set of the multisig while the TX account at transactionAddress is still pending
    const newOwners = [ownerA.publicKey, ownerB.publicKey, Keypair.generate().publicKey];
    let changeOwnersInstruction = await program.methods
      .setOwners(newOwners)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();
    const changeOwnersAddress: PublicKey = await dsl.proposeTransaction(ownerA, [changeOwnersInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, changeOwnersAddress);
    await dsl.executeTransaction(changeOwnersAddress, changeOwnersInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    // Now cancel the original transaction instruction (the corresponding TX account owner set will be outdated at this point)
    await dsl.assertBalance(ownerB.publicKey, 0);
    await dsl.cancelTransaction(transactionAddress, multisig.address, ownerB, ownerB.publicKey);
    await dsl.assertBalance(ownerB.publicKey, 2_115_840); // this is the rent exemption amount

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
      assert.match(e.message,
          new RegExp(".*Error Code: InvalidExecutor. Error Number: 6010. Error Message: Executor is not a multisig owner."));
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
      assert.match(e.message,
          new RegExp(".*Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized"));
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
      assert.match(e.message,
          new RegExp(".*Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized"));
    }
  }).timeout(5000);

  it("should approve transaction after previous canceled", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;
    const recipient = Keypair.generate();

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

    await dsl.assertBalance(recipient.publicKey, 1_000_000_000);
  }).timeout(5000);
});
