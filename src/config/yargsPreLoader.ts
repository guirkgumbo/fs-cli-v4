// DON'T import this file
// It's getting preloaded in tsconfig:ts-node.require

/* Yargs initialization has been moved out of the main application process
 * in order to have environment variables initialized right from the start
 * of the process.
 * This allows to have ready for import config with no additional initialization
 */

import yargs from "yargs";
import { getNumberEnv, getStringEnv } from "./utils";

const argv = yargs(process.argv.slice(2))
  .option("networkId", {
    alias: "n",
    describe: "network where this will be run",
    type: "string",
  })
  .option("accountNumber", {
    alias: "x",
    describe:
      'Account number. "0" is your first account in MetaMask. ' +
      'Defaults to "0", which is what you want if you are not using multiple ' +
      'accounts. "X" in an HD wallet path of "m/44\'/60\'/0\'/0/X".',
    type: "number",
  })
  .option("exchangeAddress", {
    alias: "e",
    describe: "exchange address",
    type: "string",
  })
  .parseSync();

const accountNumber =
  argv.accountNumber ??
  getNumberEnv("ACCOUNT_NUMBER", {
    isInt: true,
    isPositive: true,
    isOptional: true,
  }) ??
  0;

if (
  accountNumber < 0 ||
  accountNumber >= 200 ||
  accountNumber != Math.trunc(accountNumber)
) {
  throw Error(
    `Invalid account number ${accountNumber} it must be an integer in range of 0..199`
  );
}

process.env.ACCOUNT_NUMBER = `${accountNumber}`;

if (argv.networkId) {
  process.env.NETWORK_ID = argv.networkId;
} else if (!process.env.NETWORK_ID) {
  throw Error("NetworkId must be provided");
}

if (argv.exchangeAddress) {
  process.env.EXCHANGE_ADDRESS = argv.exchangeAddress;
} else if (!process.env.EXCHANGE_ADDRESS) {
  throw Error(
    "Exchange address is not provided. Please, specify it over the command line parameter as exchangeAddress or add to .env as EXCHANGE_ADDRESS"
  );
}
