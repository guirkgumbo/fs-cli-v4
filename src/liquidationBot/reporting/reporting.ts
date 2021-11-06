import type { Reportable } from "@liquidationBot/reporting/types";
import { runReporter } from "./reporterRunner";
import * as consoleReporter from "./reporters/console";
import * as pm2Reporter from "./reporters/pm2";

export const console = {
  start: (bot: Reportable): Promise<void> => runReporter(consoleReporter, bot),
};

export const pm2 = {
  start: (bot: Reportable): Promise<void> => runReporter(pm2Reporter, bot),
};
