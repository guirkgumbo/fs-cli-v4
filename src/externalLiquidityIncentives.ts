/**
 * Commands for interacting with the `ExternalLiquidityIncentives` contract.
 */

import {
  getNetwork,
  getSigner,
  WithNetworkArgs,
  withNetworkArgv,
  withSignerArgv,
} from "@config/common";
import { Signer } from "@ethersproject/abstract-signer";
import { formatUnits, parseUnits } from "@ethersproject/units";
import { ERC20 } from "@generated/ERC20";
import { ERC20__factory } from "@generated/factories/ERC20__factory";
import { IERC677Token__factory } from "@generated/factories/IERC677Token__factory";
import { IExternalLiquidityIncentives__factory } from "@generated/factories/IExternalLiquidityIncentives__factory";
import { Ownable__factory } from "@generated/factories/Ownable__factory";
import { IERC677Token } from "@generated/IERC677Token";
import { IExternalLiquidityIncentives } from "@generated/IExternalLiquidityIncentives";
import { getStringArg } from "config/args";
import { getUnixTime } from "date-fns";
import { BigNumber, BigNumberish } from "ethers";
import fs from "fs";
import { tryNTimes } from "utils";
import { Arguments, Argv } from "yargs";
import * as uniswap from "./uniswap";
import {
  asIncentivesPrecisionBigInt,
  fromIncentivesPrecisionToNum,
  fromIncentivesPrecisionToToken,
  IncentivesDistribution,
  IncentivesDistributionReport,
  ProviderLiquidity,
} from "./uniswap/incentives";

export const cli = (yargs: Argv): Argv => {
  return yargs
    .command(
      "add-accountant",
      'Registers address as an "accountant".  Only accountants may add new external liquidity' +
        " incentives, or adjust existing liquidity incentive balances.",
      (yargs) =>
        externalLiquidityIncentivesArgv(withSignerArgv(yargs))
          .option("accountant", {
            alias: "a",
            describe: "Address of the accountant to be added",
            type: "string",
            require: true,
          })
          .option("permissions", {
            alias: "p",
            describe:
              'Permissions for the added accountant.  "add" or "adjust".',
            choises: ["add", "adjust"],
            default: "add",
            require: true,
          }),
      async (argv) => {
        const { signer } = getSigner(argv);
        const incentives = getExternalLiquidityIncentives(signer, argv);
        const { accountant, permissions: permissionsStr } = argv;
        const permissions = parseAccountantPermissions(permissionsStr);

        await addAccountant(incentives, accountant, permissions);
      }
    )
    .command(
      "remove-accountant",
      'Removes an address from the list of "accountants".  Only accountants may add new' +
        " external liquidity incentives, or adjust existing liquidity incentive balances.",
      (yargs) =>
        externalLiquidityIncentivesArgv(withSignerArgv(yargs)).option(
          "accountant",
          {
            alias: "a",
            describe: "Address of the accountant to be removed",
            type: "string",
            require: true,
          }
        ),
      async (argv) => {
        const { signer } = getSigner(argv);
        const incentives = getExternalLiquidityIncentives(signer, argv);
        const { accountant } = argv;

        await removeAccountant(incentives, accountant);
      }
    )
    .command(
      "add-incentives",
      "Adds incentives based on the liquidity provided on Uniswap during the specified perion." +
        "  'uniswap liquidityIncentivesReport' shows the accumulated balances.  This commend also" +
        " updates balances stored in 'contract' and transfers the necessary amount of the" +
        " incentive tokens, so that the balances contract owns all the incentive tokens.",
      (yargs) =>
        rewardsTokenArgv(
          scriptShaOption(
            externalLiquidityIncentivesArgv(
              uniswap.reportCommandOptions(
                withSignerArgv(
                  uniswap.networkAndPairArgv(withNetworkArgv, yargs)
                )
              )
            )
          )
        ),
      async (argv) => {
        const { network, pair } = uniswap.getNetworkAndPair(getNetwork, argv);
        const {
          priceStore,
          liquidityBalanceStore,
          rangeStart,
          rangeEnd,
          priceRange,
          incentives,
          dustLevel,
        } = uniswap.getReportOptions(argv);
        const { signer } = getSigner(argv);
        const rewardsToken = getRewardsToken(signer, argv);
        const incentivesContract = getExternalLiquidityIncentives(signer, argv);
        const scriptSha = getScriptSha(argv);

        const config = uniswap.configForNetworkAndPair(network, pair);

        const distribution = await uniswap.getIncentiveBalances(
          config,
          pair,
          priceStore,
          liquidityBalanceStore,
          rangeStart,
          rangeEnd,
          priceRange,
          incentives
        );
        await addIncentives(
          signer,
          scriptSha,
          rewardsToken,
          incentivesContract,
          distribution,
          dustLevel
        );
      }
    )
    .command(
      "add-incentives-for",
      "Adds incentives to a certain liquidity provider.",
      (yargs) =>
        rewardsTokenArgv(externalLiquidityIncentivesArgv(withSignerArgv(yargs)))
          .option("liquidity-provider", {
            describe: "Liquidity provider to send all the incentives to.",
            type: "string",
            require: true,
          })
          .option("amount", {
            describe: "Total amount of incentive tokens to send.",
            type: "number",
            require: true,
          }),
      async (argv) => {
        const { "liquidity-provider": liquidityProviderAddress, amount } = argv;
        const { signer } = getSigner(argv);
        const rewardsToken = getRewardsToken(signer, argv);
        const incentivesContract = getExternalLiquidityIncentives(signer, argv);
        const scriptSha = getScriptSha(argv);

        const amountAsFixedPoint = asIncentivesPrecisionBigInt(amount);

        const distribution = new IncentivesDistribution(
          new Date("Wed Nov 09 2021 23:54:08 GMT-0800 (Pacific Standard Time)"),
          new Date("Wed Nov 10 2021 01:54:08 GMT-0800 (Pacific Standard Time)"),
          amountAsFixedPoint,
          0n,
          10n,
          {
            [liquidityProviderAddress]: new ProviderLiquidity(
              amountAsFixedPoint,
              0n,
              0n
            ),
          }
        );

        await addIncentives(
          signer,
          scriptSha,
          rewardsToken,
          incentivesContract,
          distribution,
          0
        );
      }
    )
    .command(
      "add-incentives-from-file",
      "Adds incentives to a certain liquidity provider.",
      (yargs) =>
        rewardsTokenArgv(
          scriptShaOption(
            externalLiquidityIncentivesArgv(withSignerArgv(yargs))
          )
        ).option("file", {
          describe:
            "A JSON file containing incentive updates that need to be applied.",
          type: "string",
          required: true,
        }),
      async (argv) => {
        const { signer } = getSigner(argv);
        const rewardsToken = getRewardsToken(signer, argv);
        const incentivesContract = getExternalLiquidityIncentives(signer, argv);
        const scriptSha = getScriptSha(argv);
        const { file: filePath } = argv;

        const distributionReport = await IncentivesDistributionReport.fromJson(
          JSON.parse(fs.readFileSync(filePath, "utf8"))
        );

        const rewardsTokenDecimals = await rewardsToken.erc20.decimals();
        const toIncentiveTokens = (v: bigint): BigNumber =>
          fromIncentivesPrecisionToToken(v, rewardsTokenDecimals);

        const totalTokens = toIncentiveTokens(
          distributionReport.incentives.reduce(
            (sum, [_provider, amount]) => sum + amount,
            0n
          )
        ).toBigInt();

        describeDistribution(distributionReport);

        if (
          !(await hasEnoughAllowance(
            signer,
            incentivesContract,
            rewardsToken,
            totalTokens
          ))
        ) {
          return;
        }

        const additions = distributionReport.incentives.map(
          ([lpAddress, amount]) =>
            new ProviderAddition(lpAddress, toIncentiveTokens(amount))
        );

        await sendOneAddIncentivesTransaction(
          incentivesContract,
          distributionReport.from,
          distributionReport.to,
          true /* rangeLast */,
          scriptSha,
          additions
        );
      }
    )
    .command(
      "correct-incentives",
      "Adjusts incentive balances after an invalid distribution",
      (yargs) =>
        timeRangeArgv(
          rewardsTokenArgv(
            externalLiquidityIncentivesArgv(withSignerArgv(yargs))
          )
        )
          .option("incorrect", {
            describe:
              "A input JSON file containing incorrect incentive values for the specified range.",
            type: "string",
            required: true,
          })
          .option("correct", {
            describe:
              "A input JSON file containing correct incentive values for the specified range.",
            type: "string",
            required: true,
          }),
      async (argv) => {
        const { signer } = getSigner(argv);
        const rewardsToken = getRewardsToken(signer, argv);
        const incentivesContract = getExternalLiquidityIncentives(signer, argv);
        const { rangeStart, rangeEnd, rangeLast } = getTimeRange(argv);
        const { incorrect: incorrectFilePath, correct: correctFilePath } = argv;

        const rewardsTokenDecimals = await rewardsToken.erc20.decimals();
        const toTokens = (v: number): BigNumber =>
          parseUnits(v.toString(), rewardsTokenDecimals);
        const formatTokens = (v: bigint): string =>
          formatUnits(v, rewardsTokenDecimals);

        const subtractions: Map<string, bigint> = new Map(
          JSON.parse(fs.readFileSync(incorrectFilePath, "utf8")).map(
            ([provider, value]: [string, number]) => [
              provider,
              toTokens(value).toBigInt(),
            ]
          )
        );
        const additions: Map<string, bigint> = new Map(
          JSON.parse(fs.readFileSync(correctFilePath, "utf8")).map(
            ([provider, value]: [string, number]) => [
              provider,
              toTokens(value).toBigInt(),
            ]
          )
        );
        let subtractedTotal = 0n;
        let addedTotal = 0n;
        const adjustments: Map<string, bigint> = new Map();
        for (const [provider, value] of subtractions) {
          adjustments.set(provider, -value);
          subtractedTotal += value;
        }
        for (const [provider, value] of additions) {
          const prev = adjustments.get(provider);
          adjustments.set(provider, prev === undefined ? value : value + prev);
          addedTotal += value;
        }

        let addressIndex = 0;
        let totalCount = adjustments.size;
        let accountantBalance = 0n;
        let alreadyClaimed = 0n;
        for (const [provider, value] of adjustments) {
          ++addressIndex;

          const unclaimedBalance = (
            await tryNTimes(3, () =>
              incentivesContract.callStatic.claimableTokens(provider)
            )
          ).toBigInt();

          const prefix = `[${addressIndex}/${totalCount}] ${provider}`;

          if (value < 0) {
            if (unclaimedBalance >= -value) {
              const before = formatTokens(unclaimedBalance);
              const after = formatTokens(unclaimedBalance + value);
              accountantBalance += -value;

              console.log(
                `${prefix}: -${formatTokens(-value).padEnd(20)}` +
                  ` ${before} => ${after}`
              );
            } else {
              const difference = -value - unclaimedBalance;
              const before = formatTokens(unclaimedBalance);
              accountantBalance += -unclaimedBalance;
              alreadyClaimed += difference;

              console.log(
                `${prefix}: -${formatTokens(unclaimedBalance).padEnd(20)}` +
                  ` ${before} => 0, claimed: ${formatTokens(difference)}`
              );
            }
          } else {
            const before = formatTokens(unclaimedBalance);
            const after = formatTokens(unclaimedBalance + value);
            accountantBalance -= value;

            console.log(
              `${prefix}: +${formatTokens(value).padEnd(20)}` +
                ` ${before} => ${after}`
            );
          }
        }

        console.log(`Subtract total: ${formatTokens(subtractedTotal)}`);
        console.log(`Added total: ${formatTokens(addedTotal)}`);
        console.log(`Accountant balance: ${formatTokens(accountantBalance)}`);
        console.log(`Already claimed: ${formatTokens(alreadyClaimed)}`);

        if (accountantBalance < 0n) {
          console.log(
            "TODO: Corrections that require additional incentives are not supported yet."
          );
          console.log(
            "This includes cases when some people have already claimed the tokens, or" +
              "even case when the dust level requires more tokens to be distributed."
          );
          console.log("No action taken");
          return;
        }

        await sendOneAdjustIncentivesTransaction(
          rangeStart,
          rangeEnd,
          rangeLast,
          incentivesContract,
          adjustments
        );
      }
    )
    .help("help")
    .demandCommand();
};

// Makes sure that the external liquidity incentives contract has enough incentives tokens allocated
// for transfer, so that the subsequent allocation does not fail.
const hasEnoughAllowance = async (
  signer: Signer,
  incentivesContract: IExternalLiquidityIncentives,
  rewardsToken: { erc677: IERC677Token; erc20: ERC20 },
  requiredAllowance: bigint
): Promise<boolean> => {
  const rewardsTokenDecimals = await rewardsToken.erc20.decimals();

  const incentivesContractAsOwnable = Ownable__factory.connect(
    incentivesContract.address,
    signer
  );

  const owner = await incentivesContractAsOwnable.owner();
  const allowance = await rewardsToken.erc677.allowance(
    owner,
    incentivesContract.address
  );

  console.log(
    `Total tokens to be distributed: ${formatUnits(
      requiredAllowance,
      rewardsTokenDecimals
    )}`
  );
  console.log(
    `Incentives contract allowance from the owner: ${formatUnits(
      allowance,
      rewardsTokenDecimals
    )}`
  );

  if (allowance.toBigInt() < requiredAllowance) {
    console.log("ERROR: Incentives contract allowance is too low.");
    return false;
  }

  return true;
};

type ExternalLiquidityIncentivesArgv<T = {}> = Argv<
  T & {
    contract: string;
  }
>;
const externalLiquidityIncentivesArgv = <T = {}>(
  yargs: Argv<T>
): ExternalLiquidityIncentivesArgv<T> => {
  return yargs.option("contract", {
    alias: "c",
    describe: "Address of the external liquidity incentives contract",
    type: "string",
    require: true,
  });
};

type RewardsTokenArgs<T = {}> = WithNetworkArgs<
  T & { "rewards-token": string | undefined }
>;
const rewardsTokenArgv = <T = {}>(
  yargs: Argv<T>
): Argv<RewardsTokenArgs<T>> => {
  return withNetworkArgv(yargs).option("rewards-token", {
    describe:
      "Rewards token that will be transfered to the external liquidity incentives" +
      " balances contract.  Note that the owner of the external liquidity incentives contract" +
      " needs to own the necessary amount of reward tokens and approve their transfer for the" +
      " external liquidity incentives contract.\n" +
      ".env property: <network>_REWARDS_TOKEN\n" +
      "Default is the FST token on the matching network.",
    type: "string",
  });
};

const REWARDS_TOKEN: { [network: string]: string } = {
  MAINNET_ARBITRUM: "0x488cc08935458403a0458e45e20c0159c8ab2c92",
  RINKEBY_ARBITRUM: "0x91087f75c2c94cda6fbae1b4589efabbd11ddf6e",
};

const getRewardsToken = <T = {}>(
  signer: Signer,
  argv: Arguments<RewardsTokenArgs<T>>
): {
  erc677: IERC677Token;
  erc20: ERC20;
} => {
  const { network } = getNetwork(argv);
  const rewardsTokenAddress = getStringArg(
    "rewards-token",
    `${network}_REWARDS_TOKEN`,
    argv,
    {
      default: REWARDS_TOKEN[network],
    }
  );
  const erc677 = IERC677Token__factory.connect(rewardsTokenAddress, signer);
  const erc20 = ERC20__factory.connect(rewardsTokenAddress, signer);
  return { erc677, erc20 };
};

const getExternalLiquidityIncentives = (
  signer: Signer,
  argv: Arguments<{
    contract: string;
  }>
): IExternalLiquidityIncentives => {
  return IExternalLiquidityIncentives__factory.connect(argv.contract, signer);
};

type ScriptShaArgv<T = {}> = Argv<
  T & {
    "script-sha": string;
  }
>;
const scriptShaOption = <T = {}>(yargs: Argv<T>): ScriptShaArgv<T> => {
  return yargs.option("script-sha", {
    describe:
      "SHA of the commit containing this script.  Recorded as part of the accounting" +
      " information.",
    type: "string",
    require: true,
  });
};

const getScriptSha = (argv: Arguments<{ "script-sha": string }>): string => {
  let scriptSha = argv["script-sha"];

  if (!scriptSha.match(/^(?:0x)?[0-9a-f]{40}$/)) {
    throw new Error(
      '"script-sha" should be a 40 character SHA value, optionally prefixed with "0x".' +
        `Got: "${scriptSha}"`
    );
  }

  if (!scriptSha.match(/^0x/)) {
    scriptSha = "0x" + scriptSha;
  }

  return scriptSha;
};

type TimeRangeArgs<T = {}> = T & {
  "range-start": string;
  "range-end": string;
  "range-last": boolean;
};
const timeRangeArgv = <T = {}>(yargs: Argv<T>): Argv<TimeRangeArgs<T>> => {
  return yargs
    .option("range-start", {
      describe: "Start time for the incentives block.",
      type: "string",
      require: true,
    })
    .option("range-end", {
      describe: "End time for the incentives block.",
      type: "string",
      require: true,
    })
    .option("range-last", {
      describe: "Is this the last update for this time range.",
      type: "boolean",
      required: true,
    });
};

type GetTimeRangeArgv<T> = Arguments<TimeRangeArgs<T>>;
const getTimeRange = <T = {}>(
  argv: GetTimeRangeArgv<T>
): {
  rangeStart: Date;
  rangeEnd: Date;
  rangeLast: boolean;
} => {
  const {
    "range-start": rangeStartStr,
    "range-end": rangeEndStr,
    "range-last": rangeLast,
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
      throw new Error(`Failed to parse "rangeEnd" as a date: ${rangeEndStr}`);
    }
    return new Date(ms);
  })();

  return { rangeStart, rangeEnd, rangeLast };
};

const addAccountant = async (
  incentives: IExternalLiquidityIncentives,
  accountant: string,
  permissions: AccountantPermissions
) => {
  const tx = await incentives.addAccountant({ accountant, permissions });
  await tx.wait();
};

const removeAccountant = async (
  incentives: IExternalLiquidityIncentives,
  accountant: string
) => {
  const tx = await incentives.removeAccountant(accountant);
  await tx.wait();
};

const describeDistribution = (distribution: {
  from: Date;
  to: Date;
  incentivesTotal: bigint;
  noLiquidityIncentives: bigint;
}) => {
  const { from, to, incentivesTotal, noLiquidityIncentives } = distribution;

  const numberFormat = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 10,
  });
  const format = (value: bigint) => {
    const precision = 10n;
    return numberFormat.format(fromIncentivesPrecisionToNum(value, precision));
  };

  console.log(`Incentives interval start time: ${from}`);
  console.log(`Incentives interval end time  : ${to}`);
  console.log(`Total incentives: ${format(incentivesTotal)}`);
  console.log(
    `Not distrubted due to no liquidity: ${format(noLiquidityIncentives)}`
  );
};

const addIncentives = async (
  signer: Signer,
  scriptSha: string,
  rewardsToken: { erc677: IERC677Token; erc20: ERC20 },
  incentives: IExternalLiquidityIncentives,
  distribution: IncentivesDistribution,
  dustLevel: number
) => {
  /*
   * According to https://ethstats.net/ current block gas limit is ~30m gas.
   *
   * Looking at
   *
   *     https://ethereum.stackexchange.com/questions/1106/is-there-a-limit-for-transaction-size
   *
   * and
   *
   *     http://gavwood.com/paper.pdf
   *
   * We get the following:
   *
   * Gtxdatazero       `4` Paid for every zero byte of data or code for a transaction.
   * Gtxdatanonzero   `68` Paid for every non-zero byte of data or code for a transaction.
   * Gtransaction  `21000` Paid for every transaction
   *
   * So we should be able to put around (30,000,000 - 21,000) / 68 = 440,867 bytes of data.
   *
   * A single address update is 256 bits, or 32 bytes of data.  Meaning that we should be able to
   * include up to 10,000 address updates in a single transaction.  Considering, this limit is
   * applied to the transaction data size.
   *
   * TODO Ideally, we should look at the last block gas limit and calculate expected gas usage based
   * on the produces input.  Use binary search to find the maximum possible size that still fits
   * into the allowed limits.  Need to make sure that Arbitrum gas estimation works correctly.
   *
   * Considering we have under 700 active liquidity providers at the moment, we can use an even
   * lower bound.
   */
  const maxAddressesPerTransaction = 1000;

  const { from, to, providers } = distribution;

  describeDistribution(distribution);

  const rewardsTokenDecimals = await rewardsToken.erc20.decimals();
  const toIncentiveTokens = (v: bigint): BigNumber =>
    fromIncentivesPrecisionToToken(v, rewardsTokenDecimals);
  const numberFormat = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 10,
  });
  const format = (value: bigint) => {
    const precision = 10n;
    return numberFormat.format(fromIncentivesPrecisionToNum(value, precision));
  };

  let dustIncentives = 0n;

  const providerAddresses = Object.keys(providers);
  providerAddresses.sort((addr1, addr2) => {
    const lcAddr1 = addr1.toLowerCase();
    const lcAddr2 = addr2.toLowerCase();

    if (lcAddr1 < lcAddr2) {
      return -1;
    } else if (lcAddr1 > lcAddr2) {
      return 1;
    } else {
      return 0;
    }
  });

  const additions: ProviderAddition[] = [];
  let totalTokens = 0n;

  for (const address of providerAddresses) {
    const { incentives } = providers[address];

    if (incentives <= dustLevel) {
      if (incentives > 0) {
        dustIncentives += incentives;
      }
      continue;
    }

    const tokens = toIncentiveTokens(incentives);
    totalTokens += tokens.toBigInt();
    additions.push(new ProviderAddition(address, tokens));
  }

  if (
    !(await hasEnoughAllowance(signer, incentives, rewardsToken, totalTokens))
  ) {
    return;
  }

  console.log(`Total addresses: ${additions.length}`);
  console.log(
    "Sum of incentives beyond dust level: " +
      (dustIncentives == 0n ? "none" : format(dustIncentives))
  );

  while (additions.length > 0) {
    const transactionAdditions = additions.splice(
      0,
      maxAddressesPerTransaction
    );

    const intervalLast = additions.length == 0;
    await sendOneAddIncentivesTransaction(
      incentives,
      from,
      to,
      intervalLast,
      scriptSha,
      transactionAdditions
    );
  }

  console.log("Done sending incentive updates");
};

const sendOneAddIncentivesTransaction = async (
  incentives: IExternalLiquidityIncentives,
  intervalStart: Date,
  intervalEnd: Date,
  intervalLast: boolean,
  scriptSha: string,
  additions: ProviderAddition[]
) => {
  console.log(`Sending a transaction for ${additions.length} addresses`);

  const packedAdditions = additions.map(
    ({ provider, amount }) =>
      BigInt(provider) + (BigNumber.from(amount).toBigInt() << 160n)
  );

  const addTx = await incentives.addIncentives(
    getUnixTime(intervalStart),
    getUnixTime(intervalEnd),
    intervalLast,
    scriptSha,
    packedAdditions
  );
  await addTx.wait();

  console.log(`Transaction hash: ${addTx.hash}`);
};

const sendOneAdjustIncentivesTransaction = async (
  intervalStart: Date,
  intervalEnd: Date,
  intervalLast: boolean,
  incentives: IExternalLiquidityIncentives,
  adjustments: Map<string, bigint>
) => {
  console.log(`Sending a transaction for ${adjustments.size} addresses`);

  const adjustmentsArg = Array.from(
    adjustments.entries(),
    ([provider, amount]) => new ProviderAdjustment(provider, amount)
  );

  const adjustmentTx = await incentives.adjustIncentives(
    getUnixTime(intervalStart),
    getUnixTime(intervalEnd),
    intervalLast,
    adjustmentsArg
  );
  await adjustmentTx.wait();

  console.log(`Transaction hash: ${adjustmentTx.hash}`);
};

/*
 * === Helpers wrapping the `ExternalLiquidityIncentives` API.
 *
 * TODO These should be moved into a common location and shared between the
 * `ExternalLiquidityIncentives` tests, Web UI, and the CLI.
 */

enum AccountantPermissions {
  None = 0,
  Add = 1,
  Adjust = 2,
}

const parseAccountantPermissions = (v: string): AccountantPermissions => {
  if (v == "add") {
    return AccountantPermissions.Add;
  } else if (v == "adjust") {
    return AccountantPermissions.Adjust;
  } else {
    throw new Error(`Unexpected "AccountantPermissions" value: "${v}"`);
  }
};

class ProviderAddition {
  constructor(readonly provider: string, readonly amount: BigNumberish) {}
}

class ProviderAdjustment {
  constructor(readonly provider: string, readonly amount: BigNumberish) {}
}
