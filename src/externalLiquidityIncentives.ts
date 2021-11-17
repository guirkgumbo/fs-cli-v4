/**
 * Commands for interacting with the `ExternalLiquidityIncentives` contract.
 */

import { Arguments, Argv } from "yargs";
import { Signer } from "@ethersproject/abstract-signer";
import { getUnixTime } from "date-fns";

import { IERC677Token } from "./generated/IERC677Token";
import { IERC677Token__factory } from "./generated/factory/IERC677Token__factory";
import { IExternalLiquidityIncentives } from "./generated/IExternalLiquidityIncentives";
import { IExternalLiquidityIncentives__factory } from "./generated/factory/IExternalLiquidityIncentives__factory";

import { CommandWithSignerOptionsArgv, GetSignerArgv } from "..";

import * as uniswap from "./uniswap";
import { IncentivesDistribution } from "./uniswap/incentives";
import { BigNumber, BigNumberish, utils } from "ethers";

export const cli = (
  commandWithSignerOptions: <T = {}>(
    yargs: Argv<T>
  ) => CommandWithSignerOptionsArgv<T>,
  yargs: Argv,
  initConfig: () => void,
  getSigner: (argv: GetSignerArgv) => Signer
): Argv => {
  return yargs
    .command(
      "add-accountant",
      'Registers address as an "accountant".  Only accountants may add new external liquidity' +
        " incentives, or adjust existing liquidity incentive balances.",
      (yargs) =>
        externalLiquidityIncentivesOptions(commandWithSignerOptions(yargs))
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
        initConfig();

        const signer = getSigner(argv);
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
        externalLiquidityIncentivesOptions(
          commandWithSignerOptions(yargs)
        ).option("accountant", {
          alias: "a",
          describe: "Address of the accountant to be removed",
          type: "string",
          require: true,
        }),
      async (argv) => {
        initConfig();

        const signer = getSigner(argv);
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
        scriptShaOption(
          externalLiquidityIncentivesOptions(
            uniswap.reportCommandOptions(commandWithSignerOptions(yargs))
          )
        ).option("rewards-token", {
          describe:
            "Rewards token that will be transfered to the external liquidity incentives" +
            " balances contract.  Note that the you need to own the necessary amount of" +
            " rewards tokens in order to distribute them.",
          type: "string",
          require: true,
        }),
      async (argv) => {
        initConfig();

        const { networkId } = argv;
        const {
          priceStore,
          liquidityBalanceStore,
          rangeStart,
          rangeEnd,
          priceRange,
          incentives,
          dustLevel,
        } = uniswap.getReportOptions(argv);
        const signer = getSigner(argv);
        const rewardsToken = getRewardsToken(signer, argv);
        const incentivesContract = getExternalLiquidityIncentives(signer, argv);
        const scriptSha = getScriptSha(argv);

        const config = uniswap.configForNetwork(networkId);

        const distributions = await uniswap.getIncentiveBalances(
          config,
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
          distributions,
          dustLevel
        );
      }
    )
    .help("help")
    .demandCommand();
};

type ExternalLiquidityIncentivesArgv<T = {}> = Argv<
  T & {
    contract: string;
  }
>;
const externalLiquidityIncentivesOptions = <T = {}>(
  yargs: Argv<T>
): ExternalLiquidityIncentivesArgv<T> => {
  return yargs.option("contract", {
    alias: "c",
    describe: "Address of the external liquidity incentives contract",
    type: "string",
    require: true,
  });
};

const getRewardsToken = (
  signer: Signer,
  argv: Arguments<{
    "rewards-token": string;
  }>
): IERC677Token => {
  const { "rewards-token": rewardsTokenAddress } = argv;
  return IERC677Token__factory.connect(rewardsTokenAddress, signer);
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

const addIncentives = async (
  signer: Signer,
  scriptSha: string,
  rewardsToken: IERC677Token,
  incentives: IExternalLiquidityIncentives,
  distributions: IncentivesDistribution,
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

  const { from, to, incentivesTotal, providers } = distributions;

  const numberFormat = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 10,
  });
  const formatter = (value: number) => numberFormat.format(value);

  console.log(`Incentives interval start time: ${from}`);
  console.log(`Incentives interval end time  : ${to}`);
  console.log(`Total incentives: ${formatter(incentivesTotal)}`);

  // TODO Conversion here is a hack.  We should instead check the `rewardsToken` details and use
  // those to convert `incentivesTotal` to the token value.
  const toIncentiveTokens = (v: number): BigNumber =>
    BigNumber.from(
      BigNumber.from(Math.ceil(v * 100_000)).toBigInt() * 10n ** (18n - 5n)
    );

  const incentivesBalance = await rewardsToken.balanceOf(
    await signer.getAddress()
  );
  if (toIncentiveTokens(incentivesTotal) > incentivesBalance) {
    console.log("ERROR:");
    console.log(
      "Current incentives balance is below the required amount for the distribution."
    );
    // TODO Extract token details and format using the token specifics.
    // See `tokenFormatter` in `uniswap/liquidity.ts`.
    console.log(`  Balance: ${incentivesBalance.toString()}`);
    return;
  }

  let dustIncentives = 0;

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

  const additions = [];

  for (const address of providerAddresses) {
    const { incentives } = providers[address];

    if (incentives <= dustLevel) {
      if (incentives > 0) {
        dustIncentives += incentives;
      }
      continue;
    }

    additions.push(
      new ProviderAddition(address, toIncentiveTokens(incentives))
    );
  }

  console.log(`Total addresses: ${additions.length}`);
  /*
   * Not using a `formatter` here, as we expect the number to be very small and it is better shown
   * in the scientific notation.
   */
  console.log(
    "Sum of incentives beyond dust level: " +
      (dustIncentives == 0 ? "none" : dustIncentives)
  );

  while (additions.length > 0) {
    const transactionAdditions = additions.splice(
      0,
      maxAddressesPerTransaction
    );

    const data = encodeAddIncentives(
      from,
      to,
      additions.length == 0,
      scriptSha,
      transactionAdditions
    );

    const sumUp = (sum: bigint, { amount }: { amount: BigNumberish }) =>
      sum + BigNumber.from(amount).toBigInt();
    const transactionIncentives = transactionAdditions.reduce(sumUp, 0n);

    console.log(
      `Sending transaction for ${transactionAdditions.length} addresses`
    );

    const addTx = await rewardsToken.transferAndCall(
      incentives.address,
      transactionIncentives,
      data
    );
    await addTx.wait();
  }

  console.log("Done sending incentive updates");
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

const encodeAddIncentives = (
  intervalStart: Date,
  intervalEnd: Date,
  intervalLast: boolean,
  scriptSha: string,
  additions: ProviderAddition[]
) => {
  return new utils.AbiCoder().encode(
    [
      `tuple(
        uint64 intervalStart,
        uint64 intervalEnd,
        bool intervalLast,
        bytes20 scriptSha,
        tuple(address provider, uint256 amount)[] additions
      )`,
    ],
    [
      {
        intervalStart: getUnixTime(intervalStart),
        intervalEnd: getUnixTime(intervalEnd),
        intervalLast,
        scriptSha,
        additions,
      },
    ]
  );
};
