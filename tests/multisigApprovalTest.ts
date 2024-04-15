import assert from "assert";
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram,} from "@solana/web3.js";
import {MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";

describe("Test performing signing and execution", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;

  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program, provider);
  });

  it("should perform instructions if reached multisig approval threshold", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 0);
  });

  it("should transfer partial funds", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(100_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 900_000);
  }).timeout(10000);

  it("should handle multiple transactions in parallel", async () => {
    const multisig = await dsl.createMultisig(2, 3, 2_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 2_000_000);

    const transactionAddress1: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress1);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress2);

    await dsl.executeTransaction(transactionAddress1, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.executeTransaction(transactionAddress2, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 0);
  }).timeout(20000);

  it("should not perform instructions if not reached multisig approval threshold", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: NotEnoughSigners. Error Number: 6003. Error Message: Not enough owners signed this transaction"));
    }
    await dsl.assertBalance(multisig.signer, 1_000_000);
  });

  it("should approve idempotently", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    // Approve twice with the same owner
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.assertBalance(multisig.signer, 0);
  }).timeout(10000);

  it("should not execute transaction if same user has approved multiple times to reach the threshold", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    //Approve again with the same owner meaning still only 1/3 approval
    await dsl.approveTransaction(ownerA, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: NotEnoughSigners. Error Number: 6003. Error Message: Not enough owners signed this transaction"));
    }
    await dsl.assertBalance(multisig.signer, 1_000_000);
  });

  it("should not allow non owner to approve", async () => {
    const multisig = await dsl.createMultisig(2, 3, 1_000_000);
    const [ownerA, _ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig.signer, 1_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    const notAnOwner = Keypair.generate();

    try {
      //Attempt to approve with not an owner
      await dsl.approveTransaction(
        notAnOwner,
        multisig.address,
        transactionAddress
      );
      fail("Should have failed to approve transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: InvalidOwner. Error Number: 6000. Error Message: The given owner is not part of this multisig"));
    }
    await dsl.assertBalance(multisig.signer, 1_000_000);
  });

  it("should transfer funds from two different multisig accounts", async () => {
    const [ownerA, ownerB, ownerC, ownerD] = Array.from({length: 4}, (_, _n) => Keypair.generate());
    const multisig1 = await dsl.createMultisigWithOwners(2, [ownerA, ownerB, ownerC], 1_000_000);
    const multisig2 = await dsl.createMultisigWithOwners(2, [ownerB, ownerC, ownerD], 1_100_000);

    let transactionInstruction1 = SystemProgram.transfer({
      fromPubkey: multisig1.signer,
      lamports: new BN(50_000),
      toPubkey: provider.publicKey,
    });
    let transactionInstruction2 = SystemProgram.transfer({
      fromPubkey: multisig2.signer,
      lamports: new BN(100_000),
      toPubkey: provider.publicKey,
    });

    await dsl.assertBalance(multisig1.signer, 1_000_000);
    await dsl.assertBalance(multisig2.signer, 1_100_000);

    const transactionAddress1: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction1], multisig1.address);
    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerB, [transactionInstruction2], multisig2.address);

    await dsl.approveTransaction(ownerB, multisig1.address, transactionAddress1);
    await dsl.approveTransaction(ownerC, multisig2.address, transactionAddress2);

    await dsl.executeTransaction(transactionAddress1, transactionInstruction1, multisig1.signer, multisig1.address, ownerB, ownerA.publicKey);
    await dsl.executeTransaction(transactionAddress2, transactionInstruction2, multisig2.signer, multisig2.address, ownerC, ownerA.publicKey);

    await dsl.assertBalance(multisig1.signer, 950_000);
    await dsl.assertBalance(multisig2.signer, 1_000_000);
  }).timeout(20000);
});
