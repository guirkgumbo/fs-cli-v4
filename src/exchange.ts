/**
 * Commands that operate on the exchange directly.
 *
 * Invoking `Exchange` API.
 */

import {
  exchangeWithProviderArgv,
  getExchangeWithProvider,
  getExchangeWithSigner,
  withSignerArgv,
} from "@config/common";
import { BigNumberish } from "@ethersproject/bignumber";
import { parseEther } from "@ethersproject/units";
import { IERC20__factory } from "@generated/factories/IERC20__factory";
import { Arguments, Argv } from "yargs";

export const cli = (yargs: Argv): Argv => {
  return yargs
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
    );
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
