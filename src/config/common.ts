/**
 * Configuration parameters shared between most CLI commands.
 *
 * These are also shared with the internal liquidation bot repo.
 */

import { Signer } from "@ethersproject/abstract-signer";
import { JsonRpcProvider, Provider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { IExchangeEvents__factory } from "@generated/factories/IExchangeEvents__factory";
import { IExchange__factory } from "@generated/factories/IExchange__factory";
import { IExchange } from "@generated/IExchange";
import { IExchangeEvents } from "@generated/IExchangeEvents";
import { Arguments, Argv } from "yargs";
import { getNumberArg, getStringArg } from "./args";

export function checkDefined<T>(
  val: T | null | undefined,
  message = "Should be defined"
): T {
  if (val === null || val === undefined) {
    throw new Error(message);
  }
  return val;
}

export type WithNetworkArgs<T = {}> = T & { network: string | undefined };
export const withNetworkArgv = <T = {}>(
  yargs: Argv<T>
): Argv<WithNetworkArgs<T>> => {
  return yargs.option("network", {
    describe:
      "Network where this will be run.\n" +
      "Allowed values: RINKEBY_ARBITRUM, MAINNET_ARBITRUM\n" +
      ".env property: NETWORK\n" +
      "Required",
    type: "string",
  });
};

export type GetNetworkArgv<T> = Arguments<WithNetworkArgs<T>>;
export const getNetwork = <T = {}>(
  argv: GetNetworkArgv<T>
): {
  network: string;
} => {
  const network = getStringArg("network", "NETWORK", argv).toUpperCase();
  return { network };
};

export type WithProviderArgs<T = {}> = WithNetworkArgs<T>;
export const withProviderArgv = withNetworkArgv;

export type GetProviderArgv<T> = Arguments<WithProviderArgs<T>>;
export const getProvider = <T = {}>(
  argv: GetProviderArgv<T>
): {
  network: string;
  provider: Provider;
} => {
  const { network } = getNetwork(argv);

  const url = checkDefined(
    process.env[`${network}_RPC_URL`],
    `Missing ${network}_RPC_URL in your .env file, see README.md`
  );
  const chainId = checkDefined(
    process.env[`${network}_CHAINID`],
    `Missing ${network}_CHAINID in your .env file, see README.md`
  );

  const provider = new JsonRpcProvider(url, {
    name: "json-rpc",
    chainId: Number(chainId),
  });

  return { network, provider };
};

/**
 * Commands that update the chain state need a signer.  But a number of commands only read from the
 * change and do not need parameters that are needed to get a singer.
 *
 * TODO At the moment we require a mnemonic and an account number, but it would be more convenient
 * for our the CLI users if we would also support creating signers from a single private key.
 */
export type WithSignerArgs<T = {}> = WithProviderArgs<
  T & { "account-number": number | undefined }
>;
export const withSignerArgv = <T = {}>(
  yargs: Argv<T>
): Argv<WithSignerArgs<T>> => {
  return withProviderArgv(yargs).option("account-number", {
    describe:
      'Account number.  "0" is your first account in MetaMask. Defaults to "0", which is what' +
      ' you want if you are not using multiple accounts. "X" in an HD wallet path of' +
      " \"m/44'/60'/0'/0/X\".\n" +
      ".env property: ACCOUNT_NUMBER\n" +
      "Required",
    type: "number",
  });
};

export type GetSignerArgv<T> = Arguments<WithSignerArgs<T>>;
export const getSigner = <T = {}>(
  argv: GetSignerArgv<T>
): {
  network: string;
  signer: Signer;
} => {
  const accountNumber = getNumberArg("account-number", "ACCOUNT_NUMBER", argv, {
    isInt: true,
    isPositive: true,
    default: 0,
  });
  if (accountNumber >= 200) {
    throw new Error("Account number should be below 201: " + accountNumber);
  }

  const { network, provider } = getProvider(argv);

  const mnemonic = checkDefined(
    process.env[`${network}_MNEMONIC`],
    `Missing ${network}_MNEMONIC in your .env file, see README.md`
  );

  const signer = Wallet.fromMnemonic(
    mnemonic,
    `m/44'/60'/0'/0/${accountNumber}`
  ).connect(provider);

  return { network, signer };
};

export type ExchangeArgs<T = {}> = WithProviderArgs<
  T & { exchange: string | undefined }
>;
export const exchangeWithProviderArgv = <T = {}>(
  yargs: Argv<T>
): Argv<ExchangeArgs<T>> => {
  return withSignerArgv(yargs).option("exchange", {
    describe:
      "Address of the exchange to interact with.\n" +
      ".env property: <network>_EXCHANGE\n" +
      "Required",
    type: "string",
  });
};

export type GetExchangeWithSignerArgv<T> = Arguments<
  WithSignerArgs<ExchangeArgs<T>>
>;
export const getExchangeWithSigner = <T = {}>(
  argv: GetExchangeWithSignerArgv<T>
): {
  network: string;
  signer: Signer;
  exchangeAddress: string;
  exchange: IExchange;
  exchangeEvents: IExchangeEvents;
} => {
  const { network, signer } = getSigner(argv);
  const exchangeAddress = getStringArg("exchange", `${network}_EXCHANGE`, argv);
  const exchange = IExchange__factory.connect(exchangeAddress, signer);
  const exchangeEvents = IExchangeEvents__factory.connect(
    exchangeAddress,
    signer
  );
  return { network, signer, exchangeAddress, exchange, exchangeEvents };
};

export type GetExchangeWithProviderArgv<T> = Arguments<ExchangeArgs<T>>;
export const getExchangeWithProvider = <T = {}>(
  argv: GetExchangeWithProviderArgv<T>
): {
  network: string;
  provider: Provider;
  exchangeAddress: string;
  exchange: IExchange;
} => {
  const { network, provider } = getProvider(argv);
  const exchangeAddress = getStringArg("exchange", `${network}_EXCHANGE`, argv);
  const exchange = IExchange__factory.connect(exchangeAddress, provider);
  return { network, provider, exchangeAddress, exchange };
};
