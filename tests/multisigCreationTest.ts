import assert = require("assert");
import { setUpValidator } from "./utils/before";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { MultisigAccount, MultisigDsl } from "./utils/multisigDsl";
import { describe } from "mocha";
import { ChildProcess } from "node:child_process";
import { fail } from "node:assert";

describe("Test creation of multisig account", async () => {
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
    const threshold = new BN(2);

    const multisig: MultisigAccount = await dsl.createMultisig(
      owners,
      threshold
    );

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(multisig.threshold.eq(actualMultisig.threshold));
    assert.deepStrictEqual(actualMultisig.owners, multisig.owners);
    assert.ok(actualMultisig.ownerSetSeqno === 0);
  });

  it("should fail to create if provided threshold is greater than number of owners", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(4);

    try {
      await dsl.createMultisig(owners, threshold);
      fail("Multisig should not have been created");
    } catch (e: any) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidThreshold. Error Number: 6007. Error Message: Threshold must be less than or equal to the number of owners and greater than 0"
        )
      );
    }
  });

  it("should not create multisig with 0 threshold", async () => {
    const ownerA = Keypair.generate();
    const ownerB = Keypair.generate();
    const ownerC = Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = new BN(0);

    try {
      await dsl.createMultisig(owners, threshold);
      fail("Multisig should not have been created");
    } catch (e: any) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidThreshold. Error Number: 6007. Error Message: Threshold must be less than or equal to the number of owners and greater than 0"
        )
      );
    }
  });

  it("should not create multisig with 0 threshold and no owners", async () => {
    const owners = [];
    const threshold = new BN(0);

    try {
      await dsl.createMultisig(owners, threshold);
      fail("Multisig should not have been created");
    } catch (e: any) {
      assert.ok(
        e.message.includes(
          "Error Code: InvalidThreshold. Error Number: 6007. Error Message: Threshold must be less than or equal to the number of owners and greater than 0"
        )
      );
    }
  });
});
