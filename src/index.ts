import yargs from "yargs/yargs";
import { Wallet, providers, ethers } from "ethers";
import * as dotenv from "dotenv";
import { Argv } from "yargs";
import { IExchange__factory } from "./generated/factory/IExchange__factory";
import { IERC20__factory } from "./generated/factory/IERC20__factory";
import { LiquidationBotApi__factory } from "./generated/factory/LiquidationBotApi__factory";

export function checkDefined<T>(
  val: T | null | undefined,
  message = "Should be defined"
): T {
  if (val === null || val === undefined) {
    throw new Error(message);
  }
  return val;
}

const loadAccount = function (networkId: string, accountNumber: number) {
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
  ).connect(getProvider(networkId));
};

const getProvider = function (networkId: string) {
  const ucNetworkId = networkId.toUpperCase();
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

const exchangeMutatingCommandOptions = (yargs: Argv) => {
  return yargs
    .option("accountNumber", {
      alias: "x",
      describe:
        'Account number.  "0" is your first account in MetaMask. Defaults to "0", which is what' +
        ' you want if you are not using multiple accounts. "X" in an HD wallet path of' +
        " \"m/44'/60'/0'/0/X\".",
      type: "number",
      default: 0,
    })
    .option("exchangeAddress", {
      alias: "e",
      describe: "exchange address",
      type: "string",
    });
};

const getExchangeMutatingCommandParams = (argv: any) => {
  return {
    accountNumber: argv.accountNumber as number,
    networkId: (argv.networkId as string).toUpperCase(),
    exchangeAddress: (argv.exchangeAddress as string).toLowerCase(),
  };
};

const main = async () => {
  await yargs(process.argv.slice(2))
    .option("networkId", {
      alias: "n",
      describe: "network where this will be run",
      type: "string",
      default: "arbitrum_rinkeby",
    })
    .command(
      ["changePosition"],
      "change position",
      async (yargs: Argv) => {
        yargs = exchangeMutatingCommandOptions(yargs);
        return yargs
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

        const { accountNumber, networkId, exchangeAddress } =
          getExchangeMutatingCommandParams(argv);

        dotenv.config();
        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

        const tx = await exchange.changePosition(
          deltaAsset,
          deltaStable,
          stableBound
        );

        await tx.wait();

        const position = await exchange.getPosition(await wallet.getAddress());

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
        yargs = exchangeMutatingCommandOptions(yargs);
        return yargs
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

        const { accountNumber, networkId, exchangeAddress } =
          getExchangeMutatingCommandParams(argv);

        dotenv.config();
        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

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
      async (yargs: Argv) => exchangeMutatingCommandOptions(yargs),
      async (argv: any) => {
        const { accountNumber, networkId, exchangeAddress } =
          getExchangeMutatingCommandParams(argv);

        dotenv.config();
        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

        const assetTokenAddress = await exchange.assetToken();

        const assetToken = IERC20__factory.connect(assetTokenAddress, wallet);

        const tx1 = await assetToken.approve(
          exchangeAddress,
          ethers.utils.parseEther("100000")
        );
        await tx1.wait();

        const stableTokenAddress = await exchange.stableToken();

        const stableToken = IERC20__factory.connect(stableTokenAddress, wallet);

        const tx2 = await stableToken.approve(
          exchangeAddress,
          ethers.utils.parseEther("100000")
        );
        await tx2.wait();

        console.log(
          "Approved both tokens for account: " + (await wallet.getAddress())
        );
      }
    )
    .command(
      ["liquidate"],
      "liquidate",
      async (yargs: Argv) => {
        return yargs.option("trader", {
          alias: "t",
          describe: "the trader's address",
          type: "string",
          require: true,
        });
      },
      async (argv: any) => {
        const { accountNumber, networkId, exchangeAddress } =
          getExchangeMutatingCommandParams(argv);

        dotenv.config();
        const wallet = loadAccount(networkId, accountNumber);

        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

        const tx = await exchange.liquidate(argv.trader);

        const receipt = await tx.wait();

        console.log("Liquidated in tx: " + receipt.transactionHash);
      }
    )
    .command(
      ["estimateLiquidate"],
      "estimate_liquidate",
      async (yargs: Argv) => {
        return yargs.option("trader", {
          alias: "t",
          describe: "the trader's address",
          type: "string",
          require: true,
        });
      },
      async (argv: any) => {
        const { accountNumber, networkId, exchangeAddress } =
          getExchangeMutatingCommandParams(argv);

        dotenv.config();
        const wallet = loadAccount(networkId, accountNumber);

        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

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
      async (yargs: Argv) => yargs,
      async (argv: any) => {
        const { accountNumber, networkId, exchangeAddress } =
          getExchangeMutatingCommandParams(argv);

        dotenv.config();
        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);
        const liquidationBotApi = getLiquidationBotApi(networkId, wallet);

        const SLICE_SIZE = 1000;

        while (true) {
          const tradesToLiquidate = [];
          const trades = await downloadOpenTrades(exchange.address);

          for (let i = 0; i < trades.length; i += SLICE_SIZE) {
            const end = Math.min(i + SLICE_SIZE, trades.length);

            const results = await liquidationBotApi.callStatic.isLiquidatable(
              exchangeAddress,
              trades.slice(i, end).map((t) => t.trader)
            );

            for (let j = 0; j < results.length; j++) {
              if (results[j]) {
                tradesToLiquidate.push({ trader: trades[i + j].trader });
              }
            }

            console.log({ tradesToLiquidate });

            for (const trade of tradesToLiquidate) {
              try {
                const tx = await exchange.liquidate(trade.trader);
                const receipt = await tx.wait();
                console.log("Liquidated in tx: " + receipt.transactionHash);
              } catch (e) {
                console.log({ e });
                console.log("Failed to liquidate: " + trade.trader);
              }
            }

            await sleep(20000);
          }
        }
      }
    )
    .demandCommand()
    .help()
    .strict()
    .wrap(72)
    .parse();
};

const getLiquidationBotApi = (networkId: string, wallet: Wallet) => {
  switch (networkId) {
    case "ARBITRUM_RINKEBY":
      return LiquidationBotApi__factory.connect(
        "0x70E7c7F3034D5f2Ff662a5D4f2019E2117b43BD5",
        wallet
      );
    default:
      // TODO: Add addresses here
      return LiquidationBotApi__factory.connect("0x", wallet);
  }
};

const downloadOpenTrades = async (exchangeAddress: string) => {
  // TODO: Add query to graph here
  return [{ trader: "0x0000000000000000000000000000000000000000" }];
};

export const sleep = async (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
