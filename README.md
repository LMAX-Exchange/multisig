# LMAX Solana Multisig Contract

## Overview

A multisig contract to execute arbitrary Solana transactions.
This code is evolved from the [coral-xyz Multisig](https://github.com/coral-xyz/multisig).

This program can be used to allow a multisig to govern anything a regular Pubkey can govern. One can use the multisig 
as a BPF program upgrade authority, a mint authority, etc.

### Usage

To use, one must first create a `Multisig` account, specifying two important parameters:

1. Owners - the set of addresses that sign transactions for the multisig.
2. Threshold - the number of signers required to execute a transaction.

Once the `Multisig` account is created, one can create a `Transaction` account, specifying the parameters for a normal 
Solana transaction.

To sign, owners should invoke the `approve` instruction, and finally, the `execute_transaction`, once enough 
(i.e. `threshold`) of the owners have signed.

To alter the owners or signing threshold, a transaction to call the relevant function must be created using the 
multisig, signed by the existing owners, and executed.

To cancel a transaction only a single signer is needed (as with execute); for attack implications see below.

### Attacks

If one of the owner keys is compromised then that key could be used to propose new transactions, execute signed 
transactions, and cancel transactions.

- Proposing transactions would not really achieve anything and would cost the attacker money.
- Executing transactions would only be possible if they were signed by enough owners, in which case they are presumably 
  safe to execute, so again this would have limited negative effect.
- Cancelling transactions could be quite disruptive, so this would be a viable denial of service attack.

The solution to a compromised key would be to call the change_owners function, but this involves proposing a 
transaction, which could be cancelled with the compromised key.  The cancel is only possible if the attacker can 
arrange to get the cancel function executed between the propose and the execute functions being called.  This is 
difficult but theoretically possible.  It can be blocked if the propose, approve, and execute functions are called in 
the same transaction.

However, transactions have a maximum size (1232) so there is a limited number of approvals you can cram into a single 
transaction.  The test case `should propose, sign and execute changing owners of multisig within one transaction` in 
`multisigSetOwnerTest` demonstrates that a signing threshold of more than 4 owners prohibits the calling of propose, 
approve, and execute in a single transaction.  However, a signature regime of 4 in 9 signers is possible and this seems 
sufficient to cover most normal usages.

## Developing

[Anchor](https://github.com/coral-xyz/anchor) is used for development, and it's recommended workflow is used here. 
To get started, see the [guide](https://anchor-lang.com).

### Build

```bash
anchor build --verifiable
```

The `--verifiable` flag should be used before deploying so that your build artifacts can be deterministically generated 
with docker.

### Test against localnet

```bash
anchor test
```

### Test against devnet

- Deploy the smart contract to an address in devnet.
- Apply the below patch, replacing `<DEPLOY_ADDRESS>` with the base58-encoded address you deployed to.  The patch does the following:
  - Update the program address in the lib.rs and anchor.toml
  - Set the provider cluster to 'devnet' in anchor.toml
  - Set the validator RPC URL in before.ts 
- Ensure the address in `tests/keypairs/default_wallet.json` has at least 1 SOL available in devnet (can use https://faucet.solana.com/ to top it up).
- Run the tests via `anchor test --skip-deploy`.

```
diff --git a/Anchor.toml b/Anchor.toml
index 505be90..89dbe17 100644
--- a/Anchor.toml
+++ b/Anchor.toml
@@ -5,7 +5,7 @@ seeds = true
lmax_multisig = "LMAXm1DhfBg1YMvi79gXdPfsJpYuJb9urGkGNa12hvJ"

[programs.devnet]
-lmax_multisig = "LMAXm1DhfBg1YMvi79gXdPfsJpYuJb9urGkGNa12hvJ"
+lmax_multisig = "<DEPLOY_ADDRESS>"

[programs.localnet]
lmax_multisig = "LMAXm1DhfBg1YMvi79gXdPfsJpYuJb9urGkGNa12hvJ"
@@ -14,7 +14,7 @@ lmax_multisig = "LMAXm1DhfBg1YMvi79gXdPfsJpYuJb9urGkGNa12hvJ"
url = "https://api.apr.dev"

[provider]
-cluster = "localnet"
+cluster = "devnet"
wallet = "./tests/keypairs/default_wallet.json"
wallet_pub = "AeXDXCDe57eZq4ZLtB3RA9Cb5KRYPxYrFnQooay88Vc7"

diff --git a/programs/multisig/src/lib.rs b/programs/multisig/src/lib.rs
index a892760..76a2553 100644
--- a/programs/multisig/src/lib.rs
+++ b/programs/multisig/src/lib.rs
@@ -66,9 +66,7 @@ macro_rules! transaction_data_len {
};
}
 
-
-
-declare_id!("LMAXm1DhfBg1YMvi79gXdPfsJpYuJb9urGkGNa12hvJ");
+declare_id!("<DEPLOY_ADDRESS>");

#[program]
pub mod lmax_multisig {
diff --git a/tests/utils/before.ts b/tests/utils/before.ts
index c9a51d0..5f14127 100644
--- a/tests/utils/before.ts
+++ b/tests/utils/before.ts
@@ -44,7 +44,7 @@ export const setUpValidator = async (
const user = loadKeypair(config.provider.wallet);
const programAddress = new PublicKey(config.programs[config.provider.cluster].lmax_multisig);

-  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
+  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
   const provider = new AnchorProvider(connection, new Wallet(user), {});

   if (config.provider.cluster === "localnet") {
```

### Verify

To verify the program deployed on Solana matches your local source code, install docker, `cd programs/multisig`, and run

```bash
anchor verify <program-id | write-buffer>
```

