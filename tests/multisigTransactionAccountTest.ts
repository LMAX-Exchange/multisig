import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram, Transaction,} from "@solana/web3.js";
import {MultisigDsl} from "./utils/multisigDsl";
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
    dsl = new MultisigDsl(program, provider);
  });

  it("should automatically approve transaction with proposer on transaction proposal", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, _ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
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
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, ownerC] = multisig.owners;

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
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
    const multisig = await dsl.createMultisig(2, 3);
    const notAnOwner = Keypair.generate();

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    try {
      await dsl.proposeTransaction(notAnOwner, [transactionInstruction], multisig.address);
      fail("Should have failed to propose transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: InvalidOwner. Error Number: 6000. Error Message: The given owner is not part of this multisig"));
    }
  });

  it("should not be able to propose a transaction with empty instructions", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, _ownerB, ownerC] = multisig.owners;

    try {
      await dsl.proposeTransaction(ownerA, [], multisig.address);
      fail("Should have failed to propose transaction");
    } catch (e) {
      assert.match(e.message,
        new RegExp(".*Error Code: MissingInstructions. Error Number: 6012. Error Message: The number of instructions must be greater than zero."));
    }
  });

  it("should not be able to edit transaction account with transaction account private key after initialisation", async () => {
    const multisig = await dsl.createMultisig(2, 3);


    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionKeypair: Keypair = Keypair.generate();
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000),
              toPubkey: transactionKeypair.publicKey,
            })
        )
    );

    await dsl.proposeTransaction(multisig.owners[0], [transactionInstruction], multisig.address, transactionKeypair);

    let blockhash = await provider.connection.getLatestBlockhash();
    let transaction = new Transaction({blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight, feePayer: provider.publicKey})
        .add(SystemProgram.transfer(
            {
              fromPubkey: transactionKeypair.publicKey,
              toPubkey: provider.publicKey,
              lamports: 1
            }
        ));
    transaction.sign(transactionKeypair)
    await provider.wallet.signTransaction(transaction);


    //Try to transfer funds from the transaction account
    try
    {
      await provider.sendAndConfirm(transaction);
    }
    catch (e)
    {
      assert.ok(
          e.logs.includes(
              "Transfer: `from` must not carry data"
          ),
          "Did not get expected error message"
      );
    }
  });

  it("should not be able propose 2 transactions to the same transaction address", async () => {
    const multisig = await dsl.createMultisig(2, 3);

    // Create instruction to send funds from multisig
    let transactionInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(1_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionKeypair: Keypair = Keypair.generate();
    await provider.sendAndConfirm(
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000),
              toPubkey: transactionKeypair.publicKey,
            })
        )
    );

    await dsl.proposeTransaction(multisig.owners[0], [transactionInstruction], multisig.address, transactionKeypair);

    //Try to use the same transaction account again in a new transaction (hence overwriting the data)
    try
    {
      await dsl.proposeTransaction(multisig.owners[0], [transactionInstruction], multisig.address, transactionKeypair);
    }
    catch (e)
    {
      assert.ok(
          e.logs.join(",").includes("already in use"),
          "Did not get expected error message"
      );
    }
  });

});
