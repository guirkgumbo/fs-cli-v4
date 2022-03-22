const path = require("path");

module.exports = {
  apps: [
    {
      name: "Liquidation Bot",
      script: "./src/index.ts",
      args: "liquidation-bot",
      interpreter: path.resolve("./node_modules/.bin/ts-node"),
      interpreter_args: `--project=${path.resolve("./tsconfig.json")}`,
      log_date_format: "DD.MM HH:mm:ss",
      error_file: path.resolve("./logs/err.log"),
      out_file: path.resolve("./logs/std.log"),
      combine_logs: true,
      restart_delay: 4000,
      env: {
        TS_NODE_FILES: true,
        TS_NODE_TRANSPILE_ONLY: true,
        LIQUIDATION_BOT_REPORTING: "pm2",
      },
    },
  ],
};
