import * as assert from "assert";
import {setUpValidator} from "./utils/before";
import {AnchorProvider, BN, Program} from "@coral-xyz/anchor";
import {Keypair, PublicKey, SystemProgram, Transaction} from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  createInitializeAccountInstruction,
  createMint,
  createTransferCheckedInstruction,
  mintToChecked,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {MultisigAccount, MultisigDsl} from "./utils/multisigDsl";
import {describe} from "mocha";
import {fail} from "node:assert";
import {SolanaDsl} from "./utils/solanaDsl";

const TOKEN_ACCOUNT_SPACE = 165;
describe("Test transaction execution", async () => {
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

  it("should let proposer execute SOL transaction if multisig approval threshold reached", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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

    // Create instruction to send SOL from multisig
    const recipient = Keypair.generate().publicKey
    let solTransferInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: recipient,
    });

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);
    await solanaDsl.assertBalance(recipient, 0);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [solTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, solTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig.signer, 400_000_000);
    await solanaDsl.assertBalance(recipient, 600_000_000);
  }).timeout(5000);


  it("should let proposer execute a SPL token transaction if multisig approval threshold reached using an ata", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send SPL tokens from multisig
    let mint = await solanaDsl.createTokenMint(3);
    let multisigOwnedAta = await solanaDsl.createAta(mint, multisig.signer, 2000);
    let destinationAta = await solanaDsl.createAta(mint, Keypair.generate().publicKey);
    let tokenTransferInstruction = createTransferCheckedInstruction(
      multisigOwnedAta.address,  // from (should be a token account)
      mint.account,               // mint
      destinationAta.address,     // to (should be a token account)
      multisig.signer,           // from's owner
      1500,              // amount
      3                 // decimals
    );

    await solanaDsl.assertAtaBalance(multisigOwnedAta.address, 2000);
    await solanaDsl.assertAtaBalance(destinationAta.address, 0);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, tokenTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    await solanaDsl.assertAtaBalance(multisigOwnedAta.address, 500);
    await solanaDsl.assertAtaBalance(destinationAta.address, 1500);
  }).timeout(5000);

  it("should let proposer execute a SPL token transaction if multisig approval threshold reached using an auxilliary token account", async () => {
    const multisig: MultisigAccount = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;

    // Create instruction to send SPL tokens from multisig
    const mintOwner = Keypair.generate();
    await provider.sendAndConfirm(  // mintOwner is also the fee payer, need to give it funds
        new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: provider.publicKey,
              lamports: new BN(1_000_000_000),
              toPubkey: mintOwner.publicKey,
            })
        )
    );
    let mintAccountPublicKey = await createMint(
        provider.connection,
        mintOwner,            // signer
        mintOwner.publicKey,  // mint authority
        mintOwner.publicKey,  // freeze authority
        3  // decimals
    );

    let tokenAccount : Keypair = Keypair.generate();
    let multisigOwnedTokenAccountInstruction = SystemProgram.createAccount(
        {
          fromPubkey: provider.publicKey,
          newAccountPubkey: tokenAccount.publicKey,
          lamports: 1_000_000_000,
          space: TOKEN_ACCOUNT_SPACE, //token account size
          programId: TOKEN_PROGRAM_ID
        }
    );

     let initializeAccountInstruction = createInitializeAccountInstruction(
        tokenAccount.publicKey,
        mintAccountPublicKey,  // mint
        multisig.signer,       // owner
    );

    let blockhash = await provider.connection.getLatestBlockhash();
    let transaction = new Transaction({blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight, feePayer: provider.publicKey})
        .add(multisigOwnedTokenAccountInstruction)
        .add(initializeAccountInstruction);

    transaction.sign(tokenAccount);
    provider.wallet.signTransaction(transaction);

    await provider.sendAndConfirm(transaction)

    await mintToChecked(
        provider.connection,
        mintOwner,                 // fee payer
        mintAccountPublicKey,      // mint
        tokenAccount.publicKey,    // receiver (should be a token account)
        mintOwner.publicKey,       // mint authority
        2000,           // amount (2 tokens)
        3               // decimals
    );
    let destinationAta = await createAssociatedTokenAccount(
        provider.connection,
        mintOwner,                      // fee payer
        mintAccountPublicKey,           // mint
        Keypair.generate().publicKey    // owner (any valid Solana address)
    );
    let tokenTransferInstruction = createTransferCheckedInstruction(
        tokenAccount.publicKey,     // from (should be a token account)
        mintAccountPublicKey,       // mint
        destinationAta,             // to (should be a token account)
        multisig.signer,            // from's owner
        1500,               // amount
        3                  // decimals
    );

    let beforeTokenBalance = await provider.connection.getTokenAccountBalance(tokenAccount.publicKey);
    assert.equal(beforeTokenBalance.value.amount, 2000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransaction(transactionAddress, tokenTransferInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);

    let afterTokenBalance = await provider.connection.getTokenAccountBalance(tokenAccount.publicKey);
    assert.equal(afterTokenBalance.value.amount, 500);

    let recipientTokenBalance = await provider.connection.getTokenAccountBalance(destinationAta);
    assert.equal(recipientTokenBalance.value.amount, 1500);

  }).timeout(5000);


  it("should let proposer execute a transaction containing a SOL transfer and a SPL token transfer instruction", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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
    let solTransferInstruction = SystemProgram.transfer({
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: provider.publicKey,
    });

    // Create instruction to send SPL tokens from multisig
    let mint = await solanaDsl.createTokenMint(3);
    let multisigOwnedAta = await solanaDsl.createAta(mint, multisig.signer, 2000);
    let destinationAta = await solanaDsl.createAta(mint, Keypair.generate().publicKey);
    let tokenTransferInstruction = createTransferCheckedInstruction(
      multisigOwnedAta.address,  // from (should be a token account)
      mint.account,               // mint
      destinationAta.address,     // to (should be a token account)
      multisig.signer,           // from's owner
      1500,              // amount
      3                 // decimals
    );

    await solanaDsl.assertBalance(multisig.signer,1_000_000_000);
    await solanaDsl.assertAtaBalance(multisigOwnedAta.address, 2000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [solTransferInstruction, tokenTransferInstruction], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await dsl.executeTransactionWithMultipleInstructions(
      transactionAddress,
      [solTransferInstruction, tokenTransferInstruction],
      multisig.signer,
      multisig.address,
      ownerA,
      ownerA.publicKey
    );

    await solanaDsl.assertBalance(multisig.signer,400_000_000);
    await solanaDsl.assertAtaBalance(multisigOwnedAta.address, 500);
  }).timeout(5000);

  it("should not execute any instructions if one of the instructions fails", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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
    let instruction1 = SystemProgram.transfer({ // should work
      fromPubkey: multisig.signer,
      lamports: new BN(600_000_000),
      toPubkey: provider.publicKey,
    });
    let instruction2 = SystemProgram.transfer({ // should fail, not enough funds
      fromPubkey: multisig.signer,
      lamports: new BN(500_000_000),
      toPubkey: provider.publicKey,
    });
    let instruction3 = SystemProgram.transfer({ // would work if instruction2 wasn't present, but won't be executed
      fromPubkey: multisig.signer,
      lamports: new BN(100_000_000),
      toPubkey: provider.publicKey,
    });

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [instruction1, instruction2, instruction3], multisig.address);
    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransactionWithMultipleInstructions(transactionAddress,
        [instruction1, instruction2, instruction3],
        multisig.signer,
        multisig.address,
        ownerA,
        ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(e.logs.includes("Transfer: insufficient lamports 400000000, need 500000000"));
      assert.strictEqual(e.message, "failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1");
    }

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);
  }).timeout(5000);


  it("should let owner who has approved execute transaction if multisig approval threshold reached", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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
  }).timeout(5000);


  it("should let owner who has not approved execute transaction if multisig approval threshold reached", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, ownerC] = multisig.owners;

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
    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerC, ownerA.publicKey);

    await solanaDsl.assertBalance(multisig.signer, 0);
  }).timeout(5000);


  it("should close transaction account and refund rent exemption SOL on execute transaction", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await solanaDsl.assertBalance(ownerA.publicKey, 0);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);

    await solanaDsl.assertBalance(ownerA.publicKey, 2_115_840);  // this is the rent exemption amount

    let transactionActInfo = await provider.connection.getAccountInfo(transactionAddress, "confirmed");
    assert.strictEqual(transactionActInfo, null);
  }).timeout(5000);

  it("should refund rent exemption SOL to any nominated account", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;
    const otherAccount = Keypair.generate();

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

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    await solanaDsl.assertBalance(otherAccount.publicKey, 0);

    await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, otherAccount.publicKey);

    await solanaDsl.assertBalance(otherAccount.publicKey, 2_115_840);  // this is the rent exemption amount
  }).timeout(5000);

  it("should not clear up transaction account if execute fails", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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
      lamports: new BN(5_000_000_000),
      toPubkey: provider.publicKey,
    });

    const transactionAddress: PublicKey = await dsl.proposeTransaction(ownerA, [transactionInstruction], multisig.address);
    let transactionAccount = await program.account.transaction.fetch(transactionAddress);

    await dsl.approveTransaction(ownerB, multisig.address, transactionAddress);

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerB, ownerA.publicKey);
      fail("The executeTransaction function should have failed");
    } catch (e) {

      assert.ok(
        !transactionAccount.didExecute,
        "Transaction should not have been executed"
      );

      let transactionActInfo = await provider.connection.getAccountInfo(
        transactionAddress,
        "confirmed"
      );
      assert.notEqual(transactionActInfo, null);
    }
  }).timeout(5000);

  it("should not execute transaction twice", async () => {
    const multisig = await dsl.createMultisig(2, 3);
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

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerA, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
          e.message.includes(
              "Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized"
          )
      );
    }

  }).timeout(5000);


  it("should not let a non-owner execute transaction", async () => {
    const multisig = await dsl.createMultisig(2, 3);
    const [ownerA, ownerB, _ownerC] = multisig.owners;
    const ownerD = Keypair.generate();

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

    try {
      await dsl.executeTransaction(transactionAddress, transactionInstruction, multisig.signer, multisig.address, ownerD, ownerA.publicKey);
      fail("Should have failed to execute transaction");
    } catch (e) {
      assert.ok(
          e.message.includes(
              "Error Code: InvalidExecutor. Error Number: 6009. Error Message: Executor is not a multisig owner"
          )
      );
    }

    await solanaDsl.assertBalance(multisig.signer, 1_000_000_000);
  }).timeout(5000);
});
