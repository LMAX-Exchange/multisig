import assert = require("assert");
import { setUpValidator } from "./utils/before";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { MultisigAccount, MultisigDsl } from "./utils/multisigDsl";
import { describe } from "mocha";
import { ChildProcess } from "node:child_process";
import { fail } from "node:assert";

describe("Test changing multisig owner and threshold atomically", async () => {
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

  it("should change owners of multisig and threshold", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwnerC = Keypair.generate();
    const newOwners = [
      newOwnerA.publicKey,
      newOwnerB.publicKey,
      newOwnerC.publicKey,
    ];
    const newThreshold = new BN(1);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(
      newThreshold.eq(actualMultisig.threshold),
      "Should have updated threshold"
    );
    assert.deepStrictEqual(
      actualMultisig.owners,
      newOwners,
      "Should have updated to new owners"
    );
    assert.ok(
      actualMultisig.ownerSetSeqno === 1,
      "Should have incremented owner set seq number"
    );
  });

  it("should not allow old owners to propose new transaction after ownership and threshold change", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwnerC = Keypair.generate();
    const newOwners = [
      newOwnerA.publicKey,
      newOwnerB.publicKey,
      newOwnerC.publicKey,
    ];
    const newThreshold = new BN(1);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let transactionInstruction2 = await program.methods
      .setOwners(owners)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    try {
      await dsl.proposeTransaction(ownerA, transactionInstruction2, multisig.address);
      fail("Should have failed to propose transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidOwner. Error Number: 6000. Error Message: The given owner is not part of this multisig"
        )
      );
    }
  });

  it("should not allow old owners to approve new transaction after ownership change", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwnerC = Keypair.generate();
    const newOwners = [
      newOwnerA.publicKey,
      newOwnerB.publicKey,
      newOwnerC.publicKey,
    ];
    const newThreshold = new BN(1);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let transactionInstruction2 = await program.methods
      .setOwners(owners)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(newOwnerA, transactionInstruction2, multisig.address);

    try {
      await dsl.approveTransaction(
        ownerB,
        multisig.address,
        transactionAddress2
      );
      fail("Should have failed to approve transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidOwner. Error Number: 6000. Error Message: The given owner is not part of this multisig"
        )
      );
    }
  });

  it("should not allow any more approvals on a transaction if owners and threshold change", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwnerC = Keypair.generate();
    const newOwners = [
      newOwnerA.publicKey,
      newOwnerB.publicKey,
      newOwnerC.publicKey,
    ];

    const newThreshold = new BN(1);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    let transactionInstruction2 = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction2, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let transactionAccount = await program.account.transaction.fetch(
      transactionAddress2
    );
    let actualMultisig = await program.account.multisig.fetch(multisig.address);

    assert.strictEqual(
      actualMultisig.ownerSetSeqno,
      1,
      "Should have incremented owner set seq number"
    );
    assert.strictEqual(
      transactionAccount.ownerSetSeqno,
      0,
      "Owner set sequence number should not have updated"
    );

    try {
      await dsl.approveTransaction(
        newOwnerB,
        multisig.address,
        transactionAddress2
      );
      fail("Should have failed to approve transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
        )
      );
    }
  });

  it("should not allow transaction execution if owners and threshold change", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwnerC = Keypair.generate();
    const newOwners = [
      newOwnerA.publicKey,
      newOwnerB.publicKey,
      newOwnerC.publicKey,
    ];

    const newThreshold = new BN(1);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    let transactionInstruction2 = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction2, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    let transactionAccount = await program.account.transaction.fetch(
      transactionAddress2
    );
    let actualMultisig = await program.account.multisig.fetch(multisig.address);

    assert.strictEqual(
      actualMultisig.ownerSetSeqno,
      1,
      "Should have incremented owner set seq number"
    );
    assert.strictEqual(
      transactionAccount.ownerSetSeqno,
      0,
      "Owner set sequence number should not have updated"
    );

    try {
      await dsl.executeTransaction(transactionAddress2, transactionInstruction2, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
        )
      );
    }
  });

  it("should not allow owners and threshold to be changed by non multisig signer", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwnerC = Keypair.generate();
    const newOwners = [
      newOwnerA.publicKey,
      newOwnerB.publicKey,
      newOwnerC.publicKey,
    ];

    const newThreshold = new BN(1);

    try {
      // Attempt to change the multisig owners
      await program.methods
        .setOwnersAndChangeThreshold(newOwners, newThreshold)
        .accounts({
          multisig: multisig.address,
          multisigSigner: multisig.signer,
        })
        .rpc();
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(e.message.includes("Signature verification failed"));
    }

    try {
      // Attempt to change the multisig owners with provider key as signer
      await program.methods
        .setOwnersAndChangeThreshold(newOwners, newThreshold)
        .accounts({
          multisig: multisig.address,
          multisigSigner: provider.publicKey,
        })
        .rpc();
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated"
        )
      );
    }
  });

  it("should not allow owners to be changed to empty list", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwners = [];
    const newThreshold = new BN(1);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have not executed transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidOwnersLen. Error Number: 6001. Error Message: Owners length must be non zero"
        )
      );
    }
  });

  it("should not allow threshold larger than owners list length", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    const newOwnerA = Keypair.generate();
    const newOwnerB = Keypair.generate();
    const newOwners = [newOwnerA.publicKey, newOwnerB.publicKey];
    const newThreshold = new BN(3);

    // Create instruction to change multisig owners
    let transactionInstruction = await program.methods
      .setOwnersAndChangeThreshold(newOwners, newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("Should have not executed transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidThreshold. Error Number: 6007. Error Message: Threshold must be less than or equal to the number of owners and greater than 0"
        )
      );
    }
  });
});
