/**
 * Configuration parameters shared between most CLI commands.
 *
 * These are also shared with the internal liquidation bot repo.
 */

import type { Arguments, Argv } from "yargs";
import type { Signer } from "@ethersproject/abstract-signer";
import type { IExchange } from "@generated/IExchange";
import type { IExchangeEvents } from "@generated/IExchangeEvents";
import type { IExchangeLedger } from "@generated/IExchangeLedger";
import type { TradeRouter } from "@generated/TradeRouter";
import { JsonRpcProvider, Provider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { IExchangeLedger__factory } from "@generated/factories/IExchangeLedger__factory";
import { IExchangeEvents__factory } from "@generated/factories/IExchangeEvents__factory";
import { IExchange__factory } from "@generated/factories/IExchange__factory";
import { TradeRouter__factory } from "@generated/factories/TradeRouter__factory";
import { getEnumArg, getNumberArg, getStringArg } from "./args";

export function checkDefined<T>(
  val: T | null | undefined,
  message = "Should be defined"
): T {
  if (val === null || val === undefined) {
    throw new Error(message);
  }
  return val;
}

const networksAvailable = ["RINKEBY_ARBITRUM", "MAINNET_ARBITRUM"] as const;
export type Network = typeof networksAvailable[number];

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
  network: Network;
} => {
  const network = getEnumArg(
    "network",
    "NETWORK",
    Object.values(networksAvailable),
    argv,
    { ignoreCase: true }
  );
  return { network };
};

export type WithProviderArgs<T = {}> = WithNetworkArgs<T>;
export const withProviderArgv = withNetworkArgv;

export type GetProviderArgv<T> = Arguments<WithProviderArgs<T>>;
export const getProvider = <T = {}>(
  argv: GetProviderArgv<T>
): {
  network: Network;
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
 */
export type WithSignerArgs<T = {}> = WithProviderArgs<
  T & {
    "account-number": number | undefined;
  }
>;
export const withSignerArgv = <T = {}>(
  yargs: Argv<T>
): Argv<WithSignerArgs<T>> => {
  return withProviderArgv(yargs).option("account-number", {
    describe:
      'Account number.  "0" is your first account in MetaMask. Defaults to "0", which is what' +
      ' you want if you are not using multiple accounts. "X" in an HD wallet path of' +
      " \"m/44'/60'/0'/0/X\".\n" +
      ".env property: <network>_ACCOUNT_NUMBER\n" +
      'This argument is used if you specified "<network>_MNEMONIC" in your .env file.',
    type: "number",
  });
};

export type GetSignerArgv<T> = Arguments<WithSignerArgs<T>>;
export const getSigner = <T = {}>(
  argv: GetSignerArgv<T>
): {
  network: Network;
  signer: Signer;
} => {
  const { network, provider } = getProvider(argv);

  const privateKey = process.env[`${network}_PRIVATE_KEY`];

  if (privateKey !== undefined) {
    const signer = new Wallet(privateKey, provider);
    return { network, signer };
  }

  const accountNumber = getNumberArg(
    "account-number",
    `${network}_ACCOUNT_NUMBER`,
    argv,
    {
      isInt: true,
      isPositive: true,
      default: 0,
    }
  );
  if (accountNumber >= 200) {
    throw new Error("Account number should be below 201: " + accountNumber);
  }

  const mnemonic = checkDefined(
    process.env[`${network}_MNEMONIC`],
    `Missing either ${network}_PRIVATE_KEY or ${network}_MNEMONIC in your .env file, see README.md`
  );

  const signer = Wallet.fromMnemonic(
    mnemonic,
    `m/44'/60'/0'/0/${accountNumber}`
  ).connect(provider);

  return { network, signer };
};

export type ExchangeArgs<T = {}> = WithSignerArgs<
  T & { exchange: string | undefined }
>;
export const exchangeWithProviderArgv = <T = {}>(
  yargs: Argv<T>
): Argv<ExchangeArgs<T>> => {
  return withSignerArgv(yargs).option("exchange", {
    describe:
      "Address of the exchange to interact with.\n" +
      ".env property: <network>_EXCHANGE\n" +
      "Required unless deployment-version is 4.1. Ignored othervice",
    type: "string",
  });
};

export type TradeRouterArgs<T = {}> = WithSignerArgs<
  T & {
    "trader-router": string | undefined;
    "exchange-ledger-address": string | undefined;
  }
>;
export const traderRouterWithProviderArgv = <T = {}>(
  yargs: Argv<T>
): Argv<TradeRouterArgs<T>> => {
  return withSignerArgv(yargs)
    .option("trader-router", {
      describe:
        "Address of the trader router to interact with.\n" +
        ".env property: <network>_TRADER_ROUTER\n" +
        "Required if deployment-version is 4.1. Ignored othervice",
      type: "string",
    })
    .option("exchange-ledger-address", {
      describe:
        "Address of the Exchange Ledger to interact with.\n" +
        ".env property: <network>_EXCHANGE_LEDGER_ADDRESS\n" +
        "Required if deployment-version is 4.1. Ignored othervice",
      type: "string",
    });
};

export type GetExchangeWithSignerArgv<T> = Arguments<
  WithSignerArgs<ExchangeArgs<T>>
>;
export const getExchangeWithSigner = <T = {}>(
  argv: GetExchangeWithSignerArgv<T>
): {
  network: Network;
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

export type GetTradeRouterWithSignerArgv<T> = Arguments<
  WithSignerArgs<TradeRouterArgs<T>>
>;
export const getTradeRouterWithSigner = <T = {}>(
  argv: GetTradeRouterWithSignerArgv<T>
): {
  tradeRouter: TradeRouter;
  exchangeLedger: IExchangeLedger;
  tradeRouterAddress: string;
  signer: Signer;
} => {
  const { network, signer } = getSigner(argv);
  const tradeRouterAddress = getStringArg(
    "trader-router",
    `${network}_TRADE_ROUTER`,
    argv
  );
  const exchangeLedgerAddress = getStringArg(
    "exchange-ledger-address",
    `${network}_EXCHANGE_LEDGER_ADDRESS`,
    argv
  );
  const tradeRouter = TradeRouter__factory.connect(tradeRouterAddress, signer);
  const exchangeLedger = IExchangeLedger__factory.connect(
    exchangeLedgerAddress,
    signer
  );
  return { signer, tradeRouter, exchangeLedger, tradeRouterAddress };
};

export type GetExchangeWithProviderArgv<T> = Arguments<ExchangeArgs<T>>;
export const getExchangeWithProvider = <T = {}>(
  argv: GetExchangeWithProviderArgv<T>
): {
  network: Network;
  provider: Provider;
  exchangeAddress: string;
  exchange: IExchange;
} => {
  const { network, provider } = getProvider(argv);
  const exchangeAddress = getStringArg("exchange", `${network}_EXCHANGE`, argv);
  const exchange = IExchange__factory.connect(exchangeAddress, provider);
  return { network, provider, exchangeAddress, exchange };
};
