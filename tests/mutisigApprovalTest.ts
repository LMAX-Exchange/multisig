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

describe("Test performing signing and execution", async () => {
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

  it("should transfer partial funds", async () => {
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

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(500_000_000),
      toPubkey: provider.publicKey,
    });

    let beforeBalance = await provider.connection.getBalance(multisig.signer, "confirmed");
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
    assert.strictEqual(afterBalance, 500_000_000);
  }).timeout(5000);

  it("should handle multiple transactions in parallel", async () => {
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

    let beforeBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(beforeBalance, 2_000_000_000);

    const transactionAddress1: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction, multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress1);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress2);

    await dsl.executeTransaction(
      transactionAddress1,
      transactionInstruction,
      multisig.signer,
      multisig.address,
      ownerB
    );

    await dsl.executeTransaction(
      transactionAddress2,
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

  it("should not perform instructions if not reached multisig approval threshold", async () => {
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

    try {
      await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
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
    let afterBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 1_000_000_000);
  });

  it("should approve idempotently", async () => {
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

    // Approve twice with the same owner
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);
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

  it("should not execute transaction if same user has approved multiple times to reach the threshold", async () => {
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

    //Approve again with the same owner meaning still only 1/3 approval
    await dsl.approveTransaction(ownerA, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
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
    let afterBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 1_000_000_000);
  });

  it("should not allow non owner to approve", async () => {
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
    let afterBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 1_000_000_000);
  });

  it("should transfer funds from two different multisig accounts", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const ownerD = Keypair.generate();
    const owners1 = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const owners2 = [ownerB.publicKey, ownerC.publicKey, ownerD.publicKey];
    const threshold = new BN(2);

    const multisig1: MultisigAccount = await dsl.createMultisig(owners1, threshold);
    const multisig2: MultisigAccount = await dsl.createMultisig(owners2, threshold);

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

    let beforeBalance1 = await provider.connection.getBalance(multisig1.signer, "confirmed");
    assert.strictEqual(beforeBalance1, 1_000_000_000);

    let beforeBalance2 = await provider.connection.getBalance(multisig2.signer, "confirmed");
    assert.strictEqual(beforeBalance2, 500_000_000);

    const transactionAddress1: PublicKey = await dsl.proposeTransaction(ownerA, transactionInstruction1, multisig1.address);
    const transactionAddress2: PublicKey = await dsl.proposeTransaction(ownerB, transactionInstruction2, multisig2.address);

    await dsl.approveTransaction(ownerB, multisig1.address, transactionAddress1);
    await dsl.approveTransaction(ownerC, multisig2.address, transactionAddress2);

    await dsl.executeTransaction(
        transactionAddress1,
        transactionInstruction1,
        multisig1.signer,
        multisig1.address,
        ownerB);
    await dsl.executeTransaction(
        transactionAddress2,
        transactionInstruction2,
        multisig2.signer,
        multisig2.address,
        ownerC);

    let afterBalance = await provider.connection.getBalance(multisig1.signer, "confirmed");
    assert.strictEqual(afterBalance, 500_000_000);
    let afterBalance2 = await provider.connection.getBalance(multisig2.signer, "confirmed");
    assert.strictEqual(afterBalance2, 250_000_000);
  }).timeout(5000);
});
