import yargs from "yargs/yargs";
import { Wallet, providers, ethers } from "ethers";
import * as dotenv from "dotenv";
import { Argv } from "yargs";
import { IExchange__factory } from "./generated/factory/IExchange__factory";
import { IERC20__factory } from "./generated/factory/IERC20__factory";
import { LiquidationBotApi__factory } from "./generated/factory/LiquidationBotApi__factory";

import * as uniswap from "./uniswap";

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
    .command("uniswap", "Interaction with Uniswap", (yargs) => {
      return yargs
        .command(
          "updatePrices",
          "Fetches prices from Binance and saves them into a local file.",
          (yargs) => {
            return yargs.option("priceStore", {
              alias: "p",
              describe: "File that holds a local cache of Binance prices.",
              type: "string",
              default: "binancePrices.json",
            });
          },
          async (argv) => {
            const { networkId, priceStore } = argv;

            dotenv.config();
            // TODO For some reason, the compiler does not understand that `argv` here must also
            // have a `networkId` property.  Even though it works in the commands above.  And it
            // works with exactly the same code in a different project.  It would be nice to figure
            // out what is the problem and remove `as string`.
            const config = uniswap.configForNetwork(networkId as string);

            await uniswap.updateBinancePrices(config, priceStore);
          }
        )
        .command(
          "printLiquidityEvents",
          "Shows `Mint` and `Burn` events for a Uniswap pool.",
          (yargs) => {
            return yargs
              .option("fromBlock", {
                alias: "f",
                describe:
                  "First block to print events for." +
                  "  Defaults to some value before the exchange launch.",
                type: "number",
              })
              .option("toBlock", {
                alias: "t",
                describe:
                  "Last block to print events for." +
                  "  Defaults to the last confirmed block on the chain.",
                type: "number",
              });
          },
          async (argv) => {
            const { networkId, fromBlock, toBlock } = argv;

            dotenv.config();
            // TODO See comment in the command above as to why `as string` is needed here.
            const provider = getProvider(networkId as string);
            // TODO See comment in the command above as to why `as string` is needed here.
            const config = uniswap.configForNetwork(networkId as string);

            await uniswap.printPoolLiquidityEvents(
              provider,
              config,
              fromBlock ?? null,
              toBlock ?? null
            );
          }
        )
        .command(
          "updateLiquidityBalances",
          "Fetches balances from a Uniswap pool and saves them into a local file.",
          (yargs) => {
            return yargs.option("liquidityBalanceStore", {
              alias: "l",
              describe: "File that holds a local cache of the uniswap balances",
              type: "string",
              default: "uniswapLiquidityBalances.json",
            });
          },
          async (argv) => {
            const { networkId, liquidityBalanceStore } = argv;

            dotenv.config();
            // TODO See comment in the command above as to why `as string` is needed here.
            const provider = getProvider(networkId as string);
            // TODO See comment in the command above as to why `as string` is needed here.
            const config = uniswap.configForNetwork(networkId as string);

            await uniswap.updateLiquidityBalances(
              provider,
              config,
              liquidityBalanceStore
            );
          }
        )
        .command(
          "liquidityIncentivesReport",
          "Computes incentives distribution for the specified range based on the Binance prices" +
            " and Uniswap liquidity balances.",
          (yargs) => {
            return yargs
              .option("priceStore", {
                alias: "p",
                describe: "File that holds a local cache of Binance prices",
                type: "string",
                default: "binancePrices.json",
              })
              .option("liquidityBalanceStore", {
                alias: "l",
                describe:
                  "File that holds a local cache of the uniswap balances",
                type: "string",
                default: "uniswapLiquidityBalances.json",
              })
              .option("rangeStart", {
                alias: "f",
                describe: "Start time for the report",
                type: "string",
              })
              .option("rangeEnd", {
                alias: "t",
                describe: "End time for the report",
                type: "string",
              })
              .option("priceRange", {
                alias: "r",
                describe:
                  "Specifies price range for liquidity incentives." +
                  "  Incentives are distributed for liquidity in the range between" +
                  " `1 - priceRange` and `1 + priceRange`. ",
                type: "number",
                default: "0.025",
              })
              .option("incentives", {
                alias: "i",
                describe:
                  "Total number of incentives to be distributed in the specified range.",
                type: "number",
              })
              .option("dustLevel", {
                alias: "d",
                describe:
                  "If an account did not accumulate more incentives than this much, it is not" +
                  " included in the report.",
                type: "number",
                default: "0.01",
              })
              .demandOption(["rangeStart", "rangeEnd", "incentives"]);
          },
          async (argv) => {
            const {
              networkId,
              priceStore,
              liquidityBalanceStore,
              rangeStart: rangeStartStr,
              rangeEnd: rangeEndStr,
              priceRange: priceRangeStr,
              incentives,
              dustLevel: dustLevelStr,
            } = argv;
            const rangeStart = (() => {
              const ms = Date.parse(rangeStartStr);
              if (isNaN(ms)) {
                throw new Error(
                  `Failed to parse "rangeStart" as a date: ${rangeStartStr}`
                );
              }
              return new Date(ms);
            })();
            const rangeEnd = (() => {
              const ms = Date.parse(rangeEndStr);
              if (isNaN(ms)) {
                throw new Error(
                  `Failed to parse "rangeEnd" as a date: ${rangeEndStr}`
                );
              }
              return new Date(ms);
            })();

            const priceRange = (() => {
              const v = Number(priceRangeStr);

              if (Number.isNaN(v)) {
                throw new Error(
                  `Failed to parse "priceRange" as a number: ${priceRangeStr}`
                );
              }

              if (v < 0) {
                throw new Error(
                  `"priceRange" should not be negative: ${priceRangeStr}`
                );
              }

              if (v > 1) {
                throw new Error(
                  `"priceRange" is a fraction of the price.  A value of 0.5 means 50% price"` +
                    ` variation.  Values above 1 are most likely a mistake.  Got: ${priceRangeStr}`
                );
              }

              return v;
            })();

            const dustLevel = (() => {
              const v = Number(dustLevelStr);
              if (Number.isNaN(v)) {
                throw new Error(
                  `Failed to parse "dustLevel" as a number: ${dustLevelStr}`
                );
              }

              return v;
            })();

            // TODO See comment in the command above as to why `as string` is needed here.
            const config = uniswap.configForNetwork(networkId as string);

            await uniswap.incentivesDistributionReport(
              config,
              priceStore,
              liquidityBalanceStore,
              rangeStart,
              rangeEnd,
              priceRange,
              incentives,
              dustLevel
            );
          }
        )
        .help("help")
        .demandCommand();
    })
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
