import { Provider } from "@ethersproject/providers";
import { IERC20__factory } from "@generated/factories/IERC20__factory";
import { IExchange__factory } from "@generated/factories/IExchange__factory";
import { IExchange } from "@generated/IExchange";
import * as liquidationBot from "@liquidationBot";
import * as dotenv from "dotenv";
import { ethers, providers, Signer, Wallet } from "ethers";
import { Arguments, Argv, terminalWidth } from "yargs";
import yargs from "yargs/yargs";
import { getNumberArg, getStringArg } from "./config/args";
import * as externalLiquidityIncentives from "./externalLiquidityIncentives";
import * as uniswap from "./uniswap";
import { IExchangeEvents__factory } from "@generated/factories/IExchangeEvents__factory";
import { IExchangeEvents } from "@generated/IExchangeEvents";

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
const withProviderArgv = withNetworkArgv;

export type GetProviderArgv<T> = Arguments<WithProviderArgs<T>>;
const getProvider = <T = {}>(
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

  const provider = new providers.JsonRpcProvider(url, {
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
const withSignerArgv = <T = {}>(yargs: Argv<T>): Argv<WithSignerArgs<T>> => {
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
const getSigner = <T = {}>(
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
const exchangeWithProviderArgv = <T = {}>(
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
const getExchangeWithSigner = <T = {}>(
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
const getExchangeWithProvider = <T = {}>(
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

const main = async () => {
  await yargs(process.argv.slice(2))
    .command(
      ["changePosition"],
      "change position",
      async (yargs: Argv) => {
        return withSignerArgv(exchangeWithProviderArgv(yargs))
          .option("deltaAsset", {
            alias: "a",
            describe:
              "the amount of asset to change the position by denoted in wei",
            type: "string",
            require: true,
          })
          .option("deltaStable", {
            alias: "s",
            describe:
              "the amount of stable to change the position by denoted in wei",
            type: "string",
            require: true,
          })
          .option("stableBound", {
            alias: "b",
            describe: "max price trader is willing to pay denoted in wei",
            type: "string",
            default: "0",
          });
      },
      async (argv) => {
        const { deltaAsset, deltaStable, stableBound } = argv;

        const { signer, exchange } = getExchangeWithSigner(argv);

        const tx = await exchange.changePosition(
          deltaAsset,
          deltaStable,
          stableBound
        );

        await tx.wait();

        const position = await exchange.getPosition(await signer.getAddress());

        console.log({
          asset: position[0].toString(),
          stable: position[1].toString(),
        });
      }
    )
    .command(
      ["estimateChangePosition"],
      "estimate change position",
      async (yargs: Argv) => {
        return withSignerArgv(exchangeWithProviderArgv(yargs))
          .option("deltaAsset", {
            alias: "a",
            describe: "the amount of asset to change the position by",
            type: "string",
            require: true,
          })
          .option("deltaStable", {
            alias: "s",
            describe: "the amount of stable to change the position by",
            type: "string",
            require: true,
          })
          .option("stableBound", {
            alias: "b",
            describe: "max price trader is willing to pay",
            type: "string",
            default: "0",
          });
      },
      async (argv) => {
        const { deltaAsset, deltaStable, stableBound } = argv;

        const { exchange } = getExchangeWithSigner(argv);

        try {
          const trade = await exchange.callStatic.changePosition(
            deltaAsset,
            deltaStable,
            stableBound
          );

          console.log({
            startAsset: trade.startAsset.toString(),
            startStable: trade.startStable.toString(),
            totalAsset: trade.totalAsset.toString(),
            totalStable: trade.totalStable.toString(),
            tradeFee: trade.tradeFee.toString(),
            traderPayout: trade.traderPayout.toString(),
          });
        } catch (e) {
          console.log("Can not estimate trade");
          console.log({ e });
        }
      }
    )
    .command(
      ["approveTokens"],
      "approve_tokens",
      async (yargs: Argv) => withSignerArgv(exchangeWithProviderArgv(yargs)),
      async (argv: any) => {
        const { signer, exchange, exchangeAddress } =
          getExchangeWithSigner(argv);

        const assetTokenAddress = await exchange.assetToken();

        const assetToken = IERC20__factory.connect(assetTokenAddress, signer);

        const tx1 = await assetToken.approve(
          exchangeAddress,
          ethers.utils.parseEther("100000")
        );
        await tx1.wait();

        const stableTokenAddress = await exchange.stableToken();

        const stableToken = IERC20__factory.connect(stableTokenAddress, signer);

        const tx2 = await stableToken.approve(
          exchangeAddress,
          ethers.utils.parseEther("100000")
        );
        await tx2.wait();

        console.log(
          "Approved both tokens for account: " + (await signer.getAddress())
        );
      }
    )
    .command(
      ["liquidate"],
      "liquidate",
      async (yargs: Argv) =>
        withSignerArgv(exchangeWithProviderArgv(yargs)).option("trader", {
          alias: "t",
          describe: "the trader's address",
          type: "string",
          require: true,
        }),
      async (argv: any) => {
        const { exchange } = getExchangeWithSigner(argv);

        const tx = await exchange.liquidate(argv.trader);

        const receipt = await tx.wait();

        console.log("Liquidated in tx: " + receipt.transactionHash);
      }
    )
    .command(
      ["estimateLiquidate"],
      "estimate_liquidate",
      async (yargs: Argv) =>
        exchangeWithProviderArgv(yargs).option("trader", {
          alias: "t",
          describe: "the trader's address",
          type: "string",
          require: true,
        }),
      async (argv: any) => {
        const { exchange } = getExchangeWithProvider(argv);

        try {
          const payout = await exchange.callStatic.liquidate(argv.trader);
          console.log("Payout for liquidation: " + payout.toString());
        } catch (e) {
          console.log({ e });
          console.log("trade can not be liquidated");
        }
      }
    )
    .command(
      ["liquidationBot"],
      "run a bot to liquidate traders",
      (yargs: Argv) =>
        liquidationBot.cli(
          (yargs) => withSignerArgv(exchangeWithProviderArgv(yargs)),
          yargs
        ),
      async (argv) =>
        await liquidationBot.run(
          () => dotenv.config(),
          getExchangeWithSigner,
          argv
        )
    )
    .command("uniswap", "Interaction with Uniswap", (yargs) =>
      uniswap.cli(
        withNetworkArgv,
        withProviderArgv,
        yargs,
        () => dotenv.config(),
        getNetwork,
        getProvider
      )
    )
    .command(
      "external-liquidity",
      "Incentives for liquidity provided on Uniswap",
      (yargs) =>
        externalLiquidityIncentives.cli(
          withSignerArgv,
          yargs,
          () => dotenv.config(),
          getNetwork,
          getSigner
        )
    )
    .demandCommand()
    .help()
    .strict()
    .wrap(Math.min(100, terminalWidth()))
    .parse();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
