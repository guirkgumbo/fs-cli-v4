# fs-cli-v4

## Setup

### Node.js

To run the project clone the repository locally, and the from the local folder, fetch the necessary
dependencies:

```
yarn
```

### Chain interaction

In order to interact with the Arbitrum Mainnet deployment of Futureswap, you need to access a node
provider. [Infura](https://infura.io/) and [Alchemy](https://www.alchemy.com/) are two popular
choices. You would need to create a project on either of the provider websites, and obtain access
keys, in order to send transactions to the blockchain. As well as to read the current state of the
blockchain. Note that, a free account might provide enough quota for your project, unless you are
going to use the CLI very intensely.

Configuration is stored locally in a file called `.env`. Depending on the chain you are going to
access, you should put different parameters into this file as described in the following
subsections.

You can keep parameters for multiple chains in your `.env` file. You are going to select a specific
chain parameters using a `--network` argument of the CLI commands.

#### Arbitrum Mainnet

For **Arbitrum Mainnet** configuration, which is the Futureswap main deployment, you need to provide
the following parameters, in your `.env` file:

```
ARBITRUM_MAINNET_MNEMONIC=<only need it for commands that change something>
ARBITRUM_MAINNET_CHAINID=42161
ARBITRUM_MAINNET_RPC_URL=<Your Infura or Alchemy JSON-RPC endpoint URL>
```

#### Arbitrum Rinkeby

For **Arbitrum Rinkeby** configuration, which is the Futureswap testnet deployment, you need to
provide the following parameters, in your `.env` file:

```
ARBITRUM_RINKEBY_MNEMONIC=<only need it for commands that change something>
ARBITRUM_RINKEBY_CHAINID=421611
ARBITRUM_RINKEBY_RPC_URL=<Your Infura or Alchemy JSON-RPC endpoint URL>
```

## Operations

### Exchange interaction

To approve tokens run:

```
yarn start approveTokens --network arbitrum_mainnet \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```

To trade:

```
yarn start changePosition --network arbitrum_mainnet \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --deltaAsset <deltaAsset> \
    --deltaStable <deltaStable>
```

To estimate a trade:

```
yarn start estimateChangePosition --network arbitrum_mainnet \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --deltaAsset <deltaAsset> \
    --deltaStable <deltaStable>
```

To liquidate:

```
yarn start liquidate --network arbitrum_mainnet \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --trader <trader_address>
```

To see if a trade can be liquidated:

```
yarn start estimateLiquidate --network arbitrum_mainnet \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --trader <trader_address>
```

Run a liquidation bot for futureswap:

```
yarn start liquidationBot --network arbitrum_mainnet \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```
