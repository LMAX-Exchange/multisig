import assert = require("assert");
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair} from "@solana/web3.js";
import {MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";

describe("Test creation of multisig account", async () => {
  let provider: AnchorProvider;
  let program: Program;
  let dsl: MultisigDsl;
  before(async () => {
    let result = await setUpValidator(false);
    program = result.program;
    provider = result.provider;
    dsl = new MultisigDsl(program);
  });

  it("should create multisig account", async () => {
    const multisig = await dsl.createMultisig(2, 3);

    let actualMultisig = await program.account.multisig.fetch(multisig.address);
    assert.strictEqual(actualMultisig.nonce, multisig.nonce);
    assert.ok(multisig.threshold.eq(actualMultisig.threshold));
    assert.deepStrictEqual(actualMultisig.owners, multisig.owners.map(owner => owner.publicKey));
    assert.ok(actualMultisig.ownerSetSeqno === 0);
  });

  it("should create multiple multisig accounts", async () => {
    const [ownerA, ownerB, ownerC, ownerD, ownerE] = Array.from({length: 5}, (_, _n) => Keypair.generate());
    const multisig1 = await dsl.createMultisigWithOwners(2, [ownerA, ownerB, ownerC]);
    const multisig2 = await dsl.createMultisigWithOwners(2, [ownerC, ownerD, ownerE]);

    let actualMultisig1 = await program.account.multisig.fetch(multisig1.address);
    let actualMultisig2 = await program.account.multisig.fetch(multisig2.address);

    assert.strictEqual(actualMultisig1.nonce, multisig1.nonce);
    assert.ok(multisig1.threshold.eq(actualMultisig1.threshold));
    assert.deepStrictEqual(actualMultisig1.owners, multisig1.owners.map(owner => owner.publicKey));
    assert.ok(actualMultisig1.ownerSetSeqno === 0);

    assert.strictEqual(actualMultisig2.nonce, multisig2.nonce);
    assert.ok(multisig2.threshold.eq(actualMultisig2.threshold));
    assert.deepStrictEqual(actualMultisig2.owners, multisig2.owners.map(owner => owner.publicKey));
    assert.ok(actualMultisig2.ownerSetSeqno === 0);
  });

  it("should fail to create if provided threshold is greater than number of owners", async () => {
    try {
      await dsl.createMultisig(4, 3);
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
    try {
      await dsl.createMultisig(0, 3);
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
    try {
      await dsl.createMultisigWithOwners(0, []);
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
