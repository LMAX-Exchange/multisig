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

describe("Test changing multisig threshold", async () => {
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

  it("should change threshold of multisig", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Create instruction to change multisig threshold
    let newThreshold = new BN(3);
    let transactionInstruction = await program.methods
      .changeThreshold(newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(
      transactionAddress,
      transactionInstruction,
      multisig.signer,
      multisig.address,
      ownerB
    );

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(
      newThreshold.eq(actualMultisig.threshold),
      "Should have updated threshold"
    );
    assert.deepStrictEqual(
      actualMultisig.owners,
      owners,
      "Should not have updated owners"
    );
    assert.ok(
      actualMultisig.ownerSetSeqno === 0,
      "Should not have incremented owner set seq number"
    );
  });

  it("should require new threshold to be met", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    let newThreshold = new BN(3);
    let transactionInstruction = await program.methods
      .changeThreshold(newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(
      transactionAddress,
      transactionInstruction,
      multisig.signer,
      multisig.address,
      ownerB
    );

    let transactionInstruction2 = await program.methods
      .changeThreshold(threshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction2,
      multisig.address,
      1000
    );
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress2);

    // Fail when trying to execute with the old threshold
    try {
      await dsl.executeTransaction(
        transactionAddress2,
        transactionInstruction2,
        multisig.signer,
        multisig.address,
        ownerB
      );
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: NotEnoughSigners. Error Number: 6002. Error Message: Not enough owners signed this transaction"
        )
      );
    }

    await dsl.approveTransaction(ownerC, multisig.address, transactionAddress2);
    //Succeed when reaching the new threshold
    await dsl.executeTransaction(
      transactionAddress2,
      transactionInstruction2,
      multisig.signer,
      multisig.address,
      ownerB
    );

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.ok(
      threshold.eq(actualMultisig.threshold),
      "Should have updated threshold"
    );
  });

  it("should use new threshold on an already existing transaction", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    let newThreshold = new BN(1);
    let evenNewerThreshold = new BN(1);
    let transactionInstruction = await program.methods
      .changeThreshold(newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    let transactionInstruction2 = await program.methods
      .changeThreshold(evenNewerThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction2,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    await dsl.executeTransaction(
      transactionAddress,
      transactionInstruction,
      multisig.signer,
      multisig.address,
      ownerB
    );

    //Threshold should now be set to 1 meaning that transaction 2 has met the 1/3 approval required for execution
    await dsl.executeTransaction(
      transactionAddress2,
      transactionInstruction2,
      multisig.signer,
      multisig.address,
      ownerB
    );

    //The already existing transaction has now been executed and should update the threshold to 3

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.ok(
      evenNewerThreshold.eq(actualMultisig.threshold),
      "Should have updated threshold"
    );
  });

  it("should not allow 0 threshold", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Create instruction to change multisig threshold
    let newThreshold = new BN(0);
    let transactionInstruction = await program.methods
      .changeThreshold(newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    try {
      await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
        multisig.signer,
        multisig.address,
        ownerB
      );
      fail("should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidThreshold. Error Number: 6007. Error Message: Threshold must be less than or equal to the number of owners and greater than 0"
        )
      );
    }

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(
      threshold.eq(actualMultisig.threshold),
      "Should not have updated threshold"
    );
    assert.deepStrictEqual(
      actualMultisig.owners,
      owners,
      "Should not have updated owners"
    );
    assert.ok(
      actualMultisig.ownerSetSeqno === 0,
      "Should not have incremented owner set seq number"
    );
  });

  it("should not allow threshold greater than number of owners", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Create instruction to change multisig threshold
    let newThreshold = new BN(4);
    let transactionInstruction = await program.methods
      .changeThreshold(newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
    try {
      await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
        multisig.signer,
        multisig.address,
        ownerB
      );
      fail("should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidThreshold. Error Number: 6007. Error Message: Threshold must be less than or equal to the number of owners and greater than 0"
        )
      );
    }

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(
      threshold.eq(actualMultisig.threshold),
      "Should not have updated threshold"
    );
    assert.deepStrictEqual(
      actualMultisig.owners,
      owners,
      "Should not have updated owners"
    );
    assert.ok(
      actualMultisig.ownerSetSeqno === 0,
      "Should not have incremented owner set seq number"
    );
  });

  it("should not allow threshold to be changed by non multisig signer", async () => {
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

    try {
      // Attempt to change the multisig threshold
      await program.methods
        .changeThreshold(new BN(1))
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
      // Attempt to change the multisig threshold with provider key as signer
      await program.methods
        .changeThreshold(new BN(1))
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

    try {
      // Attempt to change the multisig threshold with an owner key as signer
      await program.methods
        .changeThreshold(new BN(1))
        .accounts({
          multisig: multisig.address,
          multisigSigner: ownerA.publicKey,
        })
        .signers([ownerA])
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

  // Threshold is of type u64, BN(-1) will actually be interpreted as 1
  it("ignores negatives on updated threshold", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    // Create instruction to change multisig threshold
    let newThreshold = new BN(-1);
    let transactionInstruction = await program.methods
      .changeThreshold(newThreshold)
      .accounts({
        multisig: multisig.address,
        multisigSigner: multisig.signer,
      })
      .instruction();

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(
      transactionAddress,
      transactionInstruction,
      multisig.signer,
      multisig.address,
      ownerB
    );

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(
      new BN(1).eq(actualMultisig.threshold),
      "Should have updated threshold"
    );
    assert.deepStrictEqual(
      actualMultisig.owners,
      owners,
      "Should not have updated owners"
    );
    assert.ok(
      actualMultisig.ownerSetSeqno === 0,
      "Should not have incremented owner set seq number"
    );
  });
});
