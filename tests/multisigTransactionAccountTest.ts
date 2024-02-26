import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram,} from "@solana/web3.js";
import {MultisigAccount, MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";

describe("Test transaction accounts", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;
  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program);
  });

  it("should automatically approve transaction with proposer on transaction proposal", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    let transactionAccount = await program.account.transaction.fetch(transactionAddress);

    //Approved by user in index 0 not by users in index 1 or 2
    assert.ok(transactionAccount.signers[0], "OwnerA should have approved");
    assert.ok(!transactionAccount.signers[1], "OwnerB should not have approved");
    assert.ok(!transactionAccount.signers[2], "OwnerC should not have approved");
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
      transactionAccount.instructions[0].programId,
      transactionInstruction.programId,
      "Transaction program should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.instructions[0].data,
      transactionInstruction.data,
      "Transaction data should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.instructions[0].accounts,
      transactionInstruction.keys,
      "Transaction keys should match instruction"
    );
  });

  it("should update signers list when an owner approves", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerC, multisig.address, transactionAddress);

    let transactionAccount = await program.account.transaction.fetch(
      transactionAddress
    );

    //Approve by owners in index 0 and 2 not by owner in index 1
    assert.ok(transactionAccount.signers[0], "OwnerA should have approved");
    assert.ok(!transactionAccount.signers[1], "OwnerB should not have approved");
    assert.ok(transactionAccount.signers[2], "OwnerC should have approved");
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
      transactionAccount.instructions[0].programId,
      transactionInstruction.programId,
      "Transaction program should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.instructions[0].data,
      transactionInstruction.data,
      "Transaction data should match instruction"
    );
    assert.deepStrictEqual(
      transactionAccount.instructions[0].accounts,
      transactionInstruction.keys,
      "Transaction keys should match instruction"
    );
  });

  it("should not be able to propose a transaction if user is not an owner", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const notAnOwner = Keypair.generate();

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000_000),
      toPubkey: provider.publicKey,
    });

    try {
      await dsl.proposeTransaction(notAnOwner, [transactionInstruction], multisig.address);
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
});
