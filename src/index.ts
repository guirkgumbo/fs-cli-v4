import yargs from "yargs/yargs";
import { Wallet, providers, ethers, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import { config } from "@config";
import * as dotenv from "dotenv";
import { Arguments, Argv } from "yargs";
import { IExchange__factory } from "@generated/factory/IExchange__factory";
import { IERC20__factory } from "@generated/factory/IERC20__factory";
import { liquidationBot, liquidationBotReporting } from "@liquidationBot/index";
import * as uniswap from "./uniswap";
import * as externalLiquidityIncentives from "./externalLiquidityIncentives";

export function checkDefined<T>(
  val: T | null | undefined,
  message = "Should be defined"
): T {
  if (val === null || val === undefined) {
    throw new Error(message);
  }
  return val;
}

export type CommandWithProviderOptionsArgv<T = {}> = Argv<
  T & { networkId: string }
>;
const commandWithProviderOptions = <T = {}>(
  yargs: Argv<T>
): CommandWithProviderOptionsArgv<T> => {
  return yargs.option("networkId", {
    alias: "n",
    describe: "network where this will be run",
    type: "string",
    default: "arbitrum_rinkeby",
  });
};

/**
 * Commands that update the chain state need a signer.  But a number of commands only read from the
 * change and do not need parameters that are needed to get a singer.
 *
 * TODO At the moment we require a mnemonic and an account number, but it would be more convenient
 * for our the CLI users if we would also support creating signers from a single private key.
 */
export type CommandWithSignerOptionsArgv<T = {}> = Argv<
  T & {
    networkId: string;
    accountNumber: number;
  }
>;
const commandWithSignerOptions = <T = {}>(
  yargs: Argv<T>
): CommandWithSignerOptionsArgv<T> => {
  return commandWithProviderOptions(yargs).option("accountNumber", {
    alias: "x",
    describe:
      'Account number.  "0" is your first account in MetaMask. Defaults to "0", which is what' +
      ' you want if you are not using multiple accounts. "X" in an HD wallet path of' +
      " \"m/44'/60'/0'/0/X\".",
    type: "number",
    default: 0,
  });
};

type ExchangeWithSignerCommandOptionsArgv<T = {}> = Argv<
  T & {
    networkId: string;
    accountNumber: number;
    exchangeAddress: string;
  }
>;
const exchangeWithSignerCommandOptions = <T = {}>(
  yargs: Argv<T>
): ExchangeWithSignerCommandOptionsArgv<T> => {
  return commandWithSignerOptions(yargs).option("exchangeAddress", {
    alias: "e",
    describe: "exchange address",
    type: "string",
    require: true,
  });
};

type ExchangeWithProviderCommandOptionsArgv<T = {}> = Argv<
  T & {
    networkId: string;
    exchangeAddress: string;
  }
>;
const exchangeWithProviderCommandOptions = <T = {}>(
  yargs: Argv<T>
): ExchangeWithProviderCommandOptionsArgv<T> => {
  return commandWithProviderOptions(yargs).option("exchangeAddress", {
    alias: "e",
    describe: "exchange address",
    type: "string",
    require: true,
  });
};

export type GetProviderArgv<T = {}> = Arguments<T & { networkId: string }>;
const getProvider = (argv: GetProviderArgv): Provider => {
  const ucNetworkId = argv.networkId.toUpperCase();
  const url = checkDefined(
    process.env[`${ucNetworkId}_RPC_URL`],
    `Missing ${ucNetworkId}_RPC_URL in your .env file, see README.md`
  );
  const chainId = checkDefined(
    process.env[`${ucNetworkId}_CHAINID`],
    `Missing ${ucNetworkId}_CHAINID in your .env file, see README.md`
  );

  return new providers.JsonRpcProvider(url, {
    name: "json-rpc",
    chainId: Number(chainId),
  });
};

export type GetSignerArgv<T = {}> = Arguments<
  T & { accountNumber: number; networkId: string }
>;
const getSigner = (argv: GetSignerArgv): Signer => {
  const { accountNumber, networkId } = argv;
  if (accountNumber < 0 || accountNumber >= 200) {
    throw new Error("Invalid account number: " + accountNumber);
  }

  const mnemonic = checkDefined(
    process.env[`${networkId.toUpperCase()}_MNEMONIC`],
    `Missing ${networkId}_MNEMONIC in your .env file, see README.md`
  );

  return Wallet.fromMnemonic(
    mnemonic,
    `m/44'/60'/0'/0/${accountNumber}`
  ).connect(getProvider(argv));
};

const getExchangeWithSigner = (
  argv: Arguments<{
    accountNumber: number;
    networkId: string;
    exchangeAddress: string;
  }>
) => {
  const signer = getSigner(argv);
  const exchangeAddress = argv.exchangeAddress.toLowerCase();
  const exchange = IExchange__factory.connect(exchangeAddress, signer);
  return { signer, exchangeAddress, exchange };
};

const getExchangeWithProvider = (
  argv: Arguments<{ networkId: string; exchangeAddress: string }>
) => {
  const provider = getProvider(argv);
  const exchangeAddress = argv.exchangeAddress.toLowerCase();
  const exchange = IExchange__factory.connect(exchangeAddress, provider);
  return { provider, exchangeAddress, exchange };
};

const main = async () => {
  await yargs(process.argv.slice(2))
    .command(
      ["changePosition"],
      "change position",
      async (yargs: Argv) => {
        return exchangeWithSignerCommandOptions(yargs)
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
        return exchangeWithSignerCommandOptions(yargs)
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
      async (yargs: Argv) => exchangeWithSignerCommandOptions(yargs),
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
        exchangeWithSignerCommandOptions(yargs).option("trader", {
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
        exchangeWithProviderCommandOptions(yargs).option("trader", {
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
    .command(["liquidationBot"], "run a bot to liquidate traders", async () => {
      await Promise.race([
        liquidationBot.start(),
        config.reporting == "pm2"
          ? liquidationBotReporting.pm2.start(liquidationBot)
          : liquidationBotReporting.console.start(liquidationBot),
      ]);
    })
    .command("uniswap", "Interaction with Uniswap", (yargs) =>
      uniswap.cli(
        commandWithProviderOptions,
        yargs,
        () => dotenv.config(),
        getProvider
      )
    )
    .command(
      "external-liquidity",
      "Incentives for liquidity provided on Uniswap",
      (yargs) =>
        externalLiquidityIncentives.cli(
          commandWithSignerOptions,
          yargs,
          () => dotenv.config(),
          getSigner
        )
    )
    .demandCommand()
    .help()
    .strict()
    .wrap(72)
    .parse();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
