import {
  exchangeWithProviderArgv,
  getExchangeWithProvider,
  getExchangeWithSigner,
  getNetwork,
  getProvider,
  getSigner,
  withNetworkArgv,
  withProviderArgv,
  withSignerArgv,
} from "@config/common";
import { BigNumberish } from "@ethersproject/bignumber";
import { parseEther } from "@ethersproject/units";
import { IERC20__factory } from "@generated/factories/IERC20__factory";
import * as liquidationBot from "@liquidationBot";
import * as dotenv from "dotenv";
import { Arguments, Argv, terminalWidth } from "yargs";
import yargs from "yargs/yargs";
import * as externalLiquidityIncentives from "./externalLiquidityIncentives";
import * as uniswap from "./uniswap";

const main = async () => {
  dotenv.config();

  await yargs(process.argv.slice(2))
    .command(
      ["change-position"],
      "Allows one to open a new position or modify an existing one.  Calls changePosition() on" +
        " the exchange.  See" +
        " https://docs.futureswap.com/protocol/developer/trade#change-position" +
        " for details.",
      async (yargs: Argv) => {
        return changePositionArgv(
          withSignerArgv(exchangeWithProviderArgv(yargs))
        );
      },
      async (argv) => {
        const { signer, exchange } = getExchangeWithSigner(argv);
        const { deltaAsset, deltaStable, stableBound } =
          getChangePosition(argv);

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
      ["change-position-estimate"],
      "Pretends to perform a change position operation, without performing any actions.  Prints" +
        " position update event details, if the specified change is possible at the moment.  See" +
        " https://docs.futureswap.com/protocol/developer/trade#change-position" +
        " for details.",
      async (yargs: Argv) => {
        return changePositionArgv(exchangeWithProviderArgv(yargs));
      },
      async (argv) => {
        const { exchange } = getExchangeWithProvider(argv);
        const { deltaAsset, deltaStable, stableBound } =
          getChangePosition(argv);

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
      ["approve-tokens"],
      "Approve stable and asset tokens to be taken by the exchange contract.  Required before" +
        " calling 'change-position' or 'change-position-estimate'.",
      async (yargs: Argv) => withSignerArgv(exchangeWithProviderArgv(yargs)),
      async (argv: any) => {
        const { signer, exchange, exchangeAddress } =
          getExchangeWithSigner(argv);

        const assetTokenAddress = await exchange.assetToken();

        const assetToken = IERC20__factory.connect(assetTokenAddress, signer);

        const tx1 = await assetToken.approve(
          exchangeAddress,
          parseEther("100000")
        );
        await tx1.wait();

        const stableTokenAddress = await exchange.stableToken();

        const stableToken = IERC20__factory.connect(stableTokenAddress, signer);

        const tx2 = await stableToken.approve(
          exchangeAddress,
          parseEther("100000")
        );
        await tx2.wait();

        console.log(
          "Approved both tokens for account: " + (await signer.getAddress())
        );
      }
    )
    .command(
      ["liquidate"],
      "Attemt to liquidate the specified trader, if they are outside of the limits allowed based" +
        " on the exchange configuration.",
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
      ["liquidate-estimate"],
      "Check if liquidation of the specified trader is possible, and show the payout if" +
        " 'liquidate' would have been called right now.",
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
      ["liquidation-bot"],
      "run a bot to liquidate traders",
      (yargs: Argv) =>
        liquidationBot.cli(
          (yargs) => withSignerArgv(exchangeWithProviderArgv(yargs)),
          yargs
        ),
      async (argv) => await liquidationBot.run(getExchangeWithSigner, argv)
    )
    .command("uniswap", "Interaction with Uniswap", (yargs) =>
      uniswap.cli(
        withNetworkArgv,
        withProviderArgv,
        yargs,
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

type ChangePositionArgs<T = {}> = T & {
  "delta-asset": string;
  "delta-stable": string;
  "stable-bound": string;
};
const changePositionArgv = <T = {}>(
  yargs: Argv<T>
): Argv<ChangePositionArgs<T>> => {
  return yargs
    .option("delta-asset", {
      alias: "a",
      describe: "the amount of asset to change the position by denoted in wei",
      type: "string",
      require: true,
    })
    .option("delta-stable", {
      alias: "s",
      describe: "the amount of stable to change the position by denoted in wei",
      type: "string",
      require: true,
    })
    .option("stable-bound", {
      alias: "b",
      describe: "max price trader is willing to pay denoted in wei",
      type: "string",
      default: "0",
    });
};

const getChangePosition = <T = {}>(
  argv: Arguments<ChangePositionArgs<T>>
): {
  deltaAsset: BigNumberish;
  deltaStable: BigNumberish;
  stableBound: BigNumberish;
} => {
  const {
    "delta-asset": deltaAsset,
    "delta-stable": deltaStable,
    "stable-bound": stableBound,
  } = argv;

  return {
    deltaAsset,
    deltaStable,
    stableBound,
  };
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
