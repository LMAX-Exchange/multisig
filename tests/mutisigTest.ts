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

describe("Test multisig", async () => {
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

  it("should create multisig account", async () => {
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

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(multisig.threshold.eq(actualMultisig.threshold));
    assert.deepStrictEqual(actualMultisig.owners, multisig.owners);
    assert.ok(actualMultisig.ownerSetSeqno === 0);
  });

  it("should perform instructions if reached multisig threshold", async () => {
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
      multisig.address
    );

    let afterBalance = await provider.connection.getBalance(
      multisig.signer,
      "confirmed"
    );
    assert.strictEqual(afterBalance, 0);
  });
});
