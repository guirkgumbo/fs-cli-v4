import yargs from "yargs/yargs";
import { Wallet, providers, ethers } from "ethers";
import { config } from "dotenv";
import { Argv } from "yargs";
import { IExchange__factory } from "./generated/factory/IExchange__factory";
import { IERC20__factory } from "./generated/factory/IERC20__factory";

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
  config({ path: "../.env" });

  const mnemonic = checkDefined(
    process.env[`${networkId}_MNEMONIC`],
    `${networkId}_MNEMONIC`
  );

  return Wallet.fromMnemonic(
    mnemonic,
    `m/44'/60'/0'/0/${accountNumber}`
  ).connect(getProvider(networkId));
};

const getProvider = function (networkId: string) {
  const url = checkDefined(process.env[`${networkId}_RPC_URL`]);
  const chainId = checkDefined(process.env[`${networkId}_CHAINID`]);

  return new providers.JsonRpcProvider(url, {
    name: "test",
    chainId: Number(chainId),
  });
};

const main = async () => {
  await yargs(process.argv.slice(2))
    .option("networkId", {
      alias: "n",
      describe: "network where this will be run",
      type: "string",
      default: "localhost",
    })
    .option("accountNumber", {
      alias: "x",
      describe: "fs test account",
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

        const accountNumber = argv.accountNumber as number;
        const networkId = argv.networkId as string;
        const exchangeAddress = (argv.exchangeAddress as string).toLowerCase();

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

        const accountNumber = argv.accountNumber as number;
        const networkId = argv.networkId as string;
        const exchangeAddress = (argv.exchangeAddress as string).toLowerCase();

        const wallet = loadAccount(networkId.toUpperCase(), accountNumber);
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
      async (yargs: Argv) => yargs,
      async (argv: any) => {
        const accountNumber = argv.accountNumber as number;
        const networkId = argv.networkId as string;
        const exchangeAddress = (argv.exchangeAddress as string).toLowerCase();

        const wallet = loadAccount(networkId.toUpperCase(), accountNumber);
        const exchange = IExchange__factory.connect(exchangeAddress, wallet);

        const assetTokenAddress = await exchange.assetToken();

        const assetToken = IERC20__factory.connect(assetTokenAddress, wallet);

        const tx1 = await assetToken.approve(
          exchangeAddress,
          ethers.utils.formatUnits("100000", "ether")
        );
        await tx1.wait();

        const stableTokenAddress = await exchange.stableToken();

        const stableToken = IERC20__factory.connect(stableTokenAddress, wallet);

        const tx2 = await stableToken.approve(
          exchangeAddress,
          ethers.utils.formatUnits("100000", "ether")
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
          describe: "trader",
          type: "string",
          require: true,
        });
      },
      async (argv: any) => {
        const accountNumber = argv.accountNumber as number;
        const networkId = argv.networkId as string;
        const exchangeAddress = (argv.exchangeAddress as string).toLowerCase();

        const wallet = loadAccount(networkId.toUpperCase(), accountNumber);

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
          describe: "trader",
          type: "string",
          require: true,
        });
      },
      async (argv: any) => {
        const accountNumber = argv.accountNumber as number;
        const networkId = argv.networkId as string;
        const exchangeAddress = (argv.exchangeAddress as string).toLowerCase();

        const wallet = loadAccount(networkId.toUpperCase(), accountNumber);

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
