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

describe("Test transaction accounts", async () => {
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

  it("should approve transaction with proposer", async () => {
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

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    let transactionAccount = await program.account.transaction.fetch(
      transactionAddress
    );

    //Signed by user in index 0 not by users in index 1 or 2
    assert.ok(transactionAccount.signers[0], "OwnerA should have signed");
    assert.ok(!transactionAccount.signers[1], "OwnerB should not have signed");
    assert.ok(!transactionAccount.signers[2], "OwnerC should not have signed");
    assert.deepStrictEqual(
      transactionAccount.multisig,
      multisig.address,
      "Transaction account should be linked to multisig"
    );
    assert.ok(
      !transactionAccount.didExecute,
      "Transaction should not have been executed"
    );
    assert.deepStrictEqual(
      transactionAccount.programId,
      transactionInstruction.programId,
      "Transaction program should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.data,
      transactionInstruction.data,
      "Transaction data should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.accounts,
      transactionInstruction.keys,
      "Transaction keys should match instruction"
    );
  });

  it("should update signers list when a owner signs", async () => {
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

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerC, multisig.address, transactionAddress);

    let transactionAccount = await program.account.transaction.fetch(
      transactionAddress
    );

    //Signed by owners in index 0 and 2 not by owner in index 1
    assert.ok(transactionAccount.signers[0], "OwnerA should have signed");
    assert.ok(!transactionAccount.signers[1], "OwnerB should not have signed");
    assert.ok(transactionAccount.signers[2], "OwnerC should have signed");
    assert.deepStrictEqual(
      transactionAccount.multisig,
      multisig.address,
      "Transaction account should be linked to multisig"
    );
    assert.ok(
      !transactionAccount.didExecute,
      "Transaction should not have been executed"
    );
    assert.deepStrictEqual(
      transactionAccount.programId,
      transactionInstruction.programId,
      "Transaction program should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.data,
      transactionInstruction.data,
      "Transaction data should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.accounts,
      transactionInstruction.keys,
      "Transaction keys should match instruction"
    );
  });

  it("should not update able to propose a transaction if user is not an owner", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const notAnOwner = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const multisigSize = 200; // Big enough.
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      multisigSize,
      threshold
    );

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    try {
      await dsl.proposeTransaction(
        notAnOwner,
        transactionInstruction,
        multisig.address,
        1000
      );
      fail("Should have failed to propose transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidOwner. Error Number: 6000. Error Message: The given owner is not part of this multisig"
        ),
        "Did not get expected error message"
      );
    }
  });

  it("should not allow transaction submission twice", async () => {
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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(
      ownerA,
      transactionInstruction,
      multisig.address,
      1000
    );

    await dsl.approveTransaction(ownerC, multisig.address, transactionAddress);

    await dsl.executeTransaction(
      transactionAddress,
      transactionInstruction,
      multisig.signer,
      multisig.address
    );

    let transactionAccount = await program.account.transaction.fetch(
      transactionAddress
    );

    assert.ok(
      transactionAccount.didExecute,
      "Transaction should have been executed"
    );

    try {
      await dsl.executeTransaction(
        transactionAddress,
        transactionInstruction,
        multisig.signer,
        multisig.address
      );
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
        e.message.includes(
          "Error Code: AlreadyExecuted. Error Number: 6006. Error Message: The given transaction has already been executed"
        )
      );
    }
  });
});
