import * as toml from "toml";
import * as fs from "fs";
import { mkdtemp } from "fs/promises";
import { ChildProcess, exec } from "node:child_process";
import * as os from "os";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import path = require("node:path");
import shell from "shelljs";

export interface AnchorConfig {
  path: {
    idl_path: string;
    binary_path: string;
    key_path: string;
  };
  provider: {
    cluster: string;
    wallet: string;
  };
  programs: {
    localnet: {
      lmax_multisig: string;
    };
    devnet: {
      lmax_multisig: string;
    };
  };
  validator: {
    ledger_dir: string;
  };
}

const PATH_TO_ANCHOR_CONFIG: string = "./Anchor.toml";

export const setUpValidator = async (
  deployIdl: Boolean
): Promise<{
  provider: AnchorProvider;
  program: Program;
}> => {
  const config = readAnchorConfig(PATH_TO_ANCHOR_CONFIG);
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "ledger-"));
  const user = loadKeypair(config.provider.wallet);
  const programAddress = new PublicKey(config.programs[config.provider.cluster].lmax_multisig);

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(user), {});

  if (config.provider.cluster === "localnet") {
    const internalController: AbortController = new AbortController();
    const {signal} = internalController;

    exec(
      `solana-test-validator --ledger ${ledgerDir} --mint ${user.publicKey} --bpf-program ${config.programs.localnet.lmax_multisig} ${config.path.binary_path}`,
      {signal}
    );

    let attempts = 0;
    while (true) {
      attempts += 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        let program = await connection.getAccountInfo(programAddress);
        if (program !== null && program.executable) {
          break;
        }
      } catch (e) {
        // Bound the number of retries so the tests don't hang if there's some problem blocking
        // the connection to the validator.
        if (attempts == 30) {
          console.log(
            `Failed to start validator or connect to running validator. Caught exception: ${e}`
          );
          throw e;
        }
      }
    }
    if (deployIdl) {
      console.log("Deploying IDL");
      shell.exec(
        `anchor idl init -f ${
          config.path.idl_path
        } ${programAddress.toBase58()}  --provider.cluster ${
          connection.rpcEndpoint
        }`
      );
    }
  }

  const program = new Program(
    JSON.parse(fs.readFileSync(config.path.idl_path).toString()),
    programAddress,
    provider
  );

  return { provider, program };
};

export function readAnchorConfig(pathToAnchorToml: string): AnchorConfig {
  return toml.parse(fs.readFileSync(pathToAnchorToml).toString());
}

export function loadKeypair(path: string) {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(path, "utf-8")))
  );
}
