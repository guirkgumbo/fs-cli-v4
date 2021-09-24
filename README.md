# fs-cli-v4

To run the project clone the repository and then run:

```
yarn
```

## Setup

Create a .env in the top level containing these keys:

```
ARBITRUM_RINKEBY_MNEMONIC=
ARBITRUM_RINKEBY_CHAINID=421611
ARBITRUM_RINKEBY_RPC_URL=https://rinkeby.arbitrum.io/rpc
```

You'll need to allow exchange to take the tokens from you:

```
yarn start approveTokens -n arbitrum_rinkeby \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 \
    --asset 100000 --stable 100000
```

Default unit for `asset` is `ether`, that is 18 digits after the dot.
Default unit for `stable` is `6`, meaning 6 digits after the dot.  This
matches the `USDC` format.

You can see currently approved limits:

```
yarn start showAllowance -n arbitrum_rinkeby \
    --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```

Use `approveTokens` to update the exchange allowance.

## Trade

To trade:

```
yarn start changePosition -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 -a <deltaAsset> -s <deltaStable>
```

To estimate a trade:

```
yarn start estimateChangePosition -n arbitrum_rinkeby --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 --deltaAsset <deltaAsset> --deltaStable <deltaStable>
```

## Liquidations
To liquidate:

```
yarn start liquidate -n arbitrum_rinkeby --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 --trader <trader_address>
```

To see if a trade can be liquidated:

```
yarn start estimateLiquidate -n arbitrum_rinkeby --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 --trader <trader_address>
```

Run a liquidation bot for futureswap:

```
yarn start liquidationBot -n arbitrum_rinkeby --exchangeAddress 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```
