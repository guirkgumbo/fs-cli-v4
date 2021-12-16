# fs-cli-v4

## Setup

### Node.js

Be sure that you have [NodeJS](https://nodejs.org/en/) and
[yarn](https://yarnpkg.com/getting-started/install) installed.

To run the project clone the repository locally, and from the local folder,
fetch the necessary dependencies:

```bash
yarn
```

### Chain interaction

In order to interact with the Arbitrum Mainnet deployment of Futureswap, you
need to access a node provider. [Infura](https://infura.io/) and
[Alchemy](https://www.alchemy.com/) are two popular choices. You would need to
create a project on either of the provider websites, and obtain access keys, in
order to send transactions to the blockchain. As well as to read the current
state of the blockchain. Note that, a free account might provide enough quota
for your project, unless you are going to use the CLI very intensely.

Configuration is stored locally in a file called `.env`. Depending on the chain
you are going to access, you should put different parameters into this file as
described in the following subsections.

You can keep parameters for multiple chains in your `.env` file. You are going
to select a specific chain parameters using a `--network` argument of the CLI
commands.

#### Arbitrum Mainnet

For **Arbitrum Mainnet** configuration, which is the Futureswap main deployment,
you need to provide the following parameters, in your `.env` file:

```bash
MAINNET_ARBITRUM_MNEMONIC=<only need it for commands that change something>
MAINNET_ARBITRUM_CHAINID=42161
MAINNET_ARBITRUM_RPC_URL=<Your Infura or Alchemy JSON-RPC endpoint URL>
```

#### Arbitrum Rinkeby

For **Arbitrum Rinkeby** configuration, which is the Futureswap testnet
deployment, you need to provide the following parameters, in your `.env` file:

```bash
RINKEBY_ARBITRUM_MNEMONIC=<only need it for commands that change something>
RINKEBY_ARBITRUM_CHAINID=421611
RINKEBY_ARBITRUM_RPC_URL=<Your Infura or Alchemy JSON-RPC endpoint URL>
```

#### Additional parameters

Many of the operations below are requiring some additional parameters. You can
set default values for them over the `.env` file so usually there would be no
need to provide them again

For example adding to `.env`

```bash
NETWORK=mainnet_arbitrum
EXCHANGE_ADDRESS=0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```

would allow to approve tokens with only

```bash
yarn start approveTokens
```

## Operations

### Exchange interaction

#### To approve tokens run:

```bash
yarn start approveTokens --network mainnet_arbitrum \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```

#### To trade:

```bash
yarn start changePosition --network mainnet_arbitrum \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --deltaAsset <deltaAsset> \
    --deltaStable <deltaStable>
```

#### To estimate a trade:

```bash
yarn start estimateChangePosition --network mainnet_arbitrum \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --deltaAsset <deltaAsset> \
    --deltaStable <deltaStable>
```

#### To liquidate:

```bash
yarn start liquidate --network mainnet_arbitrum \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --trader <trader_address>
```

#### To see if a trade can be liquidated:

```bash
yarn start estimateLiquidate --network mainnet_arbitrum \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --trader <trader_address>
```

#### Run the liquidation bot for futureswap as console script:

```bash
yarn start liquidationBot --network mainnet_arbitrum \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```

#### Run the liquidation bot under PM2 process manager

It would restart the bot in case of crashed, provides a basic dashboard with
metrics, save logs into files and ensure that bot will not stop after you will
close the terminal

Unfortunately, passing parameters to the commands below like it has been done
in the command above will not work. The easiest way would be to add `NETWORK`
and `EXCHANGE_ADDRESS` to your `.env` file like it explained in
[Additional parameters](#additional-parameters) section above or to add them to
`pm2.config.js` file to `env` field e.g. replacing

```javascript
env: {
  TS_NODE_FILES: true,
  TS_NODE_TRANSPILE_ONLY: true,
  REPORTING: "pm2",
},
```

with

```javascript
env: {
  TS_NODE_FILES: true,
  TS_NODE_TRANSPILE_ONLY: true,
  REPORTING: "pm2",
  NETWORK "mainnet_arbitrum",
  EXCHANGE_ADDRESS" "0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2"
},
```

Start the liquidation bot:

```bash
yarn liquidationBot:pm2:start
```

Stop already running bot:

```bash
yarn liquidationBot:pm2:stop
```

Open the dashboard for the running bot:

```bash
yarn pm2:monit
```

Note that with current configuration, after system restart the liquidation bot
will not start automatically. Setting it up would require installing pm2
globally. More details can be found in the
[PM2 official documentation](https://pm2.keymetrics.io/docs/usage/startup/)
