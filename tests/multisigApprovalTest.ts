import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram, Transaction,} from "@solana/web3.js";
import {MultisigAccount, MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";
import {SolanaDsl} from "./utils/solanaDsl";

describe("Test performing signing and execution", async () => {
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

  it("should perform instructions if reached multisig approval threshold", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

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

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig.signer, 0);
  });

  it("should transfer partial funds", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

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
      lamports: new BN(500_000_000),
      toPubkey: provider.publicKey,
    });

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig.signer, 500_000_000);
  }).timeout(5000);

  it("should handle multiple transactions in parallel", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Fund the multisig signer account
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          lamports: new BN(2_000_000_000),
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

    await solanaDsl.assertBalance(multisig.signer, 2_000_000_000);

    const transactionAddress1: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress1);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress2);

    await dsl.executeTransaction(transactionAddress1, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await dsl.executeTransaction(transactionAddress2, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig.signer, 0);
  }).timeout(5000);

  it("should not perform instructions if not reached multisig approval threshold", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

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

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: NotEnoughSigners. Error Number: 6002. Error Message: Not enough owners signed this transaction"
        )
      );
    }
    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);
  });

  it("should approve idempotently", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

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

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    // Approve twice with the same owner
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig.signer, 0);
  }).timeout(5000);

  it("should not execute transaction if same user has approved multiple times to reach the threshold", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

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

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    //Approve again with the same owner meaning still only 1/3 approval
    await dsl.approveTransaction(ownerA, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: NotEnoughSigners. Error Number: 6002. Error Message: Not enough owners signed this transaction"
        )
      );
    }
    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);
  });

  it("should not allow non owner to approve", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, _ownerC] = multisig.owners;

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

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

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
      assert.ok(
        e.message.includes(
          "Error Code: InvalidOwner. Error Number: 6000. Error Message: The given owner is not part of this multisig"
        )
      );
    }
    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);
  });

  it("should transfer funds from two different multisig accounts", async () => {
    const [ownerA, ownerB, ownerC, ownerD] = Array.from({length: 4}, (_, _n) => Keypair.generate());
    const multisig1: MultisigAccount = await dsl.createMultisigWithOwners(2, [ownerA, ownerB, ownerC]);
    const multisig2: MultisigAccount = await dsl.createMultisigWithOwners(2, [ownerB, ownerC, ownerD]);

    // Fund the multisig signer account
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000_000),
              toPubkey: multisig1.signer,
            })
        )
    );
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(500_000_000),
              toPubkey: multisig2.signer,
            })
        )
    );

    // Create instruction to send funds from multisig
    let transactionInstruction1 = SystemProgram.transfer({
      fromPubkey: multisig1.signer,
      lamports: new BN(500_000_000),
      toPubkey: provider.publicKey,
    });
    let transactionInstruction2 = SystemProgram.transfer({
      fromPubkey: multisig2.signer,
      lamports: new BN(250_000_000),
      toPubkey: provider.publicKey,
    });

    await solanaDsl.assertBalance(multisig1.signer, 1_000_000_000);
    await solanaDsl.assertBalance(multisig2.signer, 500_000_000);

    const transactionAddress1: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction1], multisig1.address);
    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerB, [transactionInstruction2], multisig2.address);

    await dsl.approveTransaction(ownerB, multisig1.address, transactionAddress1);
    await dsl.approveTransaction(ownerC, multisig2.address, transactionAddress2);

    await dsl.executeTransaction(transactionAddress1, transactionInstruction1, multisig1.signer, multisig1.address, ownerB, ownerA.publicKey);
    await dsl.executeTransaction(transactionAddress2, transactionInstruction2, multisig2.signer, multisig2.address, ownerC, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig1.signer, 500_000_000);
    await solanaDsl.assertBalance(multisig2.signer, 250_000_000);
  }).timeout(5000);
});
