import {
  exchangeWithProviderArgv,
  getExchangeWithProvider,
  getExchangeWithSigner,
  withSignerArgv,
} from "@config/common";
import * as liquidationBot from "@liquidationBot";
import * as dotenv from "dotenv";
import { Argv, terminalWidth } from "yargs";
import yargs from "yargs/yargs";
import * as externalLiquidityIncentives from "./externalLiquidityIncentives";
import * as uniswap from "./uniswap";
import * as exchange from "./exchange";

const main = async () => {
  dotenv.config();

  await yargs(process.argv.slice(2))
    .command(
      ["exchange"],
      "Parform an operation on an exchange",
      (yargs: Argv) => exchange.cli(yargs)
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
      uniswap.cli(yargs)
    )
    .command(
      "external-liquidity",
      "Incentives for liquidity provided on Uniswap",
      (yargs) => externalLiquidityIncentives.cli(yargs)
    )
    .demandCommand()
    .help()
    .strict()
    .wrap(Math.min(100, terminalWidth()))
    .parse();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
