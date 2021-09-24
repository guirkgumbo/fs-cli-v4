import yargs from "yargs/yargs";
import { Wallet, providers, ethers } from "ethers";
import { config } from "dotenv";
import { Argv } from "yargs";
import { IExchange__factory } from "./generated/factory/IExchange__factory";
import { IERC20__factory } from "./generated/factory/IERC20__factory";
import { LiquidationBotApi__factory } from "./generated/factory/LiquidationBotApi__factory";

const SLICE_SIZE = 1000;

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
  config();

  const mnemonic = checkDefined(
    process.env[`${networkId}_MNEMONIC`],
    `Missing ${networkId}_MNEMONIC in your .env file, see README.md`
  );

  return Wallet.fromMnemonic(
    mnemonic,
    `m/44'/60'/0'/0/${accountNumber}`
  ).connect(getProvider(networkId));
};

const getProvider = function (networkId: string) {
  const url = checkDefined(
    process.env[`${networkId}_RPC_URL`],
    `Missing ${networkId}_RPC_URL in your .env file, see README.md`
  );
  const chainId = checkDefined(
    process.env[`${networkId}_CHAINID`],
    `Missing ${networkId}_CHAINID in your .env file, see README.md`
  );

  return new providers.JsonRpcProvider(url, {
    name: "json-rpc",
    chainId: Number(chainId),
  });
};

const getStandardParams = (argv: any) => {
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
    .option("accountNumber", {
      alias: "x",
      describe:
        'Account number.  "0" is your first account in MetaMask. Defaults to "0", which is what you want if you are not using multiple accounts. "X" in an HD wallet path of "m/44\'/60\'/0\'/0/X".',
      type: "number",
      default: 0,
    })
    .option("exchangeAddress", {
      alias: "e",
      describe: "exchange address",
      type: "string",
    })
    .command(
      ["changePosition"],
      "change position",
      async (yargs: Argv) => {
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
          getStandardParams(argv);

        const wallet = loadAccount(networkId.toUpperCase(), accountNumber);
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
          getStandardParams(argv);

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
      "approve tokens to be used by the exchange",
      async (yargs: Argv) => {
        return yargs
          .option("asset", {
            alias: "a",
            describe:
              "the amount of asset you want to be accessible to the exchange",
            type: "string",
            default: ethers.utils.formatUnits("100000"),
          })
          .option("assetUnits", {
            alias: "A",
            describe: "units to use when parsing and showing the asset amounts",
            type: "string",
            default: "ether",
          })
          .option("stable", {
            alias: "s",
            describe:
              "the amount of stable you want to be accessible to the exchange",
            type: "string",
            default: ethers.utils.formatUnits("100000"),
          })
          .option("stableUnits", {
            alias: "S",
            describe:
              "units to use when parsing and showing the stable amounts",
            type: "string",
            default: "6",
          });
      },
      async (argv: any) => {
        const {
          asset: assetAmountRaw,
          assetUnits,
          stable: stableAmountRaw,
          stableUnits,
        } = argv;

        const { formatUnits, parseUnits } = ethers.utils;

        const assetAmount = parseUnits(assetAmountRaw, assetUnits);
        const stableAmount = parseUnits(stableAmountRaw, stableUnits);

        const { accountNumber, networkId, exchangeAddress } =
          getStandardParams(argv);

        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

        const approve = async (address, tokenName, amount, unit) => {
          const token = IERC20__factory.connect(address, wallet);
          const tx = await token.approve(exchangeAddress, amount);
          await tx.wait();
          const amountStr = formatUnits(amount, unit);
          console.log(
            `Approved ${amountStr} ${tokenName} tokens to be used by ${exchangeAddress}`
          );
        };

        await approve(
          await exchange.assetToken(),
          "asset",
          assetAmount,
          assetUnits
        );
        await approve(
          await exchange.stableToken(),
          "stable",
          stableAmount,
          stableUnits
        );
      }
    )
    .command(
      ["showAllowance"],
      "show token approved to be used by the exchange",
      async (yargs: Argv) => {
        return yargs
          .option("assetUnits", {
            alias: "A",
            describe: "units to use when showing the asset amounts",
            type: "string",
            default: "ether",
          })
          .option("stableUnits", {
            alias: "S",
            describe: "units to use when showing the stable amounts",
            type: "string",
            default: "6",
          });
      },
      async (argv: any) => {
        const { formatUnits } = ethers.utils;

        const { assetUnits, stableUnits } = argv;

        const { accountNumber, networkId, exchangeAddress } =
          getStandardParams(argv);

        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

        const allowance = async (address, tokenName, unit) => {
          const token = IERC20__factory.connect(address, wallet);
          const amount = await token.allowance(wallet.address, exchangeAddress);
          const amountStr = formatUnits(amount, unit);
          console.log(
            `Allowance for ${exchangeAddress} for ${tokenName}: ${amountStr}`
          );
        };

        await allowance(await exchange.assetToken(), "asset", assetUnits);
        await allowance(await exchange.stableToken(), "stable", stableUnits);
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
          getStandardParams(argv);

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
          getStandardParams(argv);

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
          getStandardParams(argv);

        const wallet = loadAccount(networkId, accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);
        const liquidationBotApi = getLiquidationBotApi(networkId, wallet);

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
