/**
 * Commands that operate on the exchange directly.
 *
 * Invoking `Exchange` API.
 */

import { getNumberArg } from "@config/args";
import {
  checkDefined,
  exchangeWithProviderArgv,
  getExchangeWithProvider,
  getExchangeWithSigner,
  withSignerArgv,
} from "@config/common";
import { Signer } from "@ethersproject/abstract-signer";
import { BigNumberish } from "@ethersproject/bignumber";
import { parseEther } from "@ethersproject/units";
import { IERC20__factory } from "@generated/factories/IERC20__factory";
import { IExchangeEvents__factory } from "@generated/factories/IExchangeEvents__factory";
import { IExchangeInternal__factory } from "@generated/factories/IExchangeInternal__factory";
import { IExchange } from "@generated/IExchange";
import { deployments } from "config/deployments";
import { Positions } from "exchange/positions";
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

        await changePosition(
          signer,
          exchange,
          deltaAsset,
          deltaStable,
          stableBound
        );
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
          await changePositionEstimate(
            exchange,
            deltaAsset,
            deltaStable,
            stableBound
          );
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

        await approveTokens(signer, exchange, exchangeAddress);
      }
    )
    .command(
      ["update-incentives"],
      "Calls 'updateIncentives()' on the exchange, in a loop for every open position.  " +
        "This function needs to be invoked after every ADL, as ADL affects multiple traders," +
        " but does not update their incentive rates.\n" +
        "Note that every 'updateIncentives()' opreation costs gas, regardless of if the trader" +
        "balance was really updated.",
      async (yargs: Argv) =>
        launchBlockArgv(withSignerArgv(exchangeWithProviderArgv(yargs))).option(
          "skip",
          {
            describe:
              "Do not call 'updateIncentives()' for this position.\n" +
              "Can be useful to receover after an interupted update, for example",
            type: "string",
            array: true,
          }
        ),
      async (argv: any) => {
        const { network, signer, exchangeAddress } =
          getExchangeWithSigner(argv);
        const provider = checkDefined(signer.provider);
        const { launchBlock } = getLaunchBlock(network, exchangeAddress, argv);
        const { skip } = argv;

        const lastBlock = await provider.getBlockNumber();
        await updateIncentives(
          signer,
          exchangeAddress,
          launchBlock,
          lastBlock,
          skip
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

type LaunchBlockArgs<T = {}> = T & {
  "launch-block": number | undefined;
};
const launchBlockArgv = <T = {}>(yargs: Argv<T>): Argv<LaunchBlockArgs<T>> => {
  return yargs.option("launch-block", {
    describe:
      "Arbitrum block where selected exchange was launched.  Used as a stopping point" +
      " when searching for open positions.\n" +
      ".env property: <network>_LAUNCH_BLOCK\n" +
      "Default: Corresponding block for know exchanges",
    type: "number",
  });
};

const getLaunchBlock = <T = {}>(
  network: string,
  exchangeAddress: string,
  argv: Arguments<LaunchBlockArgs<T>>
): {
  launchBlock: number;
} => {
  const networkDeployments = deployments[network];
  if (networkDeployments === undefined) {
    throw new Error(
      `Unexpected network: "${network}"\n` +
        `Supported networks: ${Object.keys(deployments).join(", ")}`
    );
  }

  const deployment = networkDeployments.get(exchangeAddress);
  if (deployment === undefined) {
    throw new Error(
      `Unexpected exchange address: ${exchangeAddress}\n` +
        `Know exchange addresses on ${network}: ${networkDeployments
          .addresses()
          .join(", ")}`
    );
  }

  const launchBlock = getNumberArg(
    "launch-block",
    `${network}_LAUNCH_BLOCK`,
    argv,
    {
      default: deployment.launchBlock,
    }
  );

  return { launchBlock };
};

const changePosition = async (
  signer: Signer,
  exchange: IExchange,
  deltaAsset: BigNumberish,
  deltaStable: BigNumberish,
  stableBound: BigNumberish
): Promise<void> => {
  const tx = await exchange.changePosition(
    deltaAsset,
    deltaStable,
    stableBound
  );
  await tx.wait();

  const position = await exchange.getPosition(await signer.getAddress());

  console.log({
    transactionHash: tx.hash,
    asset: position[0].toString(),
    stable: position[1].toString(),
  });
};

const changePositionEstimate = async (
  exchange: IExchange,
  deltaAsset: BigNumberish,
  deltaStable: BigNumberish,
  stableBound: BigNumberish
): Promise<void> => {
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
};

const approveTokens = async (
  signer: Signer,
  exchange: IExchange,
  exchangeAddress: string
): Promise<void> => {
  const assetTokenAddress = await exchange.assetToken();
  const assetToken = IERC20__factory.connect(assetTokenAddress, signer);

  const tx1 = await assetToken.approve(exchangeAddress, parseEther("100000"));
  await tx1.wait();

  const stableTokenAddress = await exchange.stableToken();

  const stableToken = IERC20__factory.connect(stableTokenAddress, signer);

  const tx2 = await stableToken.approve(exchangeAddress, parseEther("100000"));
  await tx2.wait();

  console.log(
    "Approved both tokens for account: " + (await signer.getAddress())
  );
};

const updateIncentives = async (
  signer: Signer,
  exchangeAddress: string,
  fromBlock: number,
  toBlock: number,
  skipFor: string[]
): Promise<void> => {
  const positions = new Positions();

  const maxChunkSize = 100_000;

  const totalBlocks = toBlock - fromBlock + 1;
  let chunkEnd = toBlock;

  const blockNumberFormatter = new Intl.NumberFormat();
  const percentageFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const totalBlocksStr = blockNumberFormatter.format(totalBlocks);

  const exchangeEvents = IExchangeEvents__factory.connect(
    exchangeAddress,
    signer
  );

  const statsAsStr = (positions: Positions): string => {
    const { open, closed } = positions.stats;
    return `open: ${open}, total: ${open + closed}`;
  };

  while (chunkEnd > fromBlock) {
    const chunkStart = Math.max(chunkEnd - maxChunkSize + 1, fromBlock);

    const chunkStartStr = blockNumberFormatter.format(chunkStart);
    const chunkEndStr = blockNumberFormatter.format(chunkEnd);
    const leftBlocks = chunkEnd - fromBlock + 1;
    const doneBlocks = totalBlocks - leftBlocks;
    const percentage = percentageFormatter.format(
      Math.floor((doneBlocks * 100) / totalBlocks)
    );

    const blocksStr = `${chunkStartStr} - ${chunkEndStr} of ${totalBlocksStr}`;
    console.log(
      `Fetching blocks ${blocksStr}, done ${percentage}%: Positions: ${statsAsStr(
        positions
      )}`
    );

    await positions.updateFrom(exchangeEvents, chunkStart, chunkEnd);

    chunkEnd = chunkStart - 1;
  }
  console.log(`Total: ${statsAsStr(positions)}`);

  const exchangeInternal = IExchangeInternal__factory.connect(
    exchangeAddress,
    signer
  );

  const openPositions = positions.getOpen();
  const skipSet = new Set(skipFor.map((address) => address.toLowerCase()));
  for (const address of openPositions) {
    if (skipSet.has(address.toLowerCase())) {
      console.log(`Skipping ${address}`);
      continue;
    }

    console.log(`Updating for ${address}`);
    const tx = await exchangeInternal.updateIncentives(address);
    await tx.wait();
    console.log(`   ... transaction: ${tx.hash}`);
  }
};
