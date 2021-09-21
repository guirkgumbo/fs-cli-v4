# fs-cli-v4

To run the project clone the reposistory and then run:

```
yarn
```

Create a .env in the top level containing these keys:

```
ARBITRUM_RINKEBY_MNEMONIC=
ARBITRUM_RINKEBY_CHAINID=421611
ARBITRUM_RINKEBY_RPC_URL=https://rinkeby.arbitrum.io/rpc
```

To approve tokens run:

```
yarn start approveTokens -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```

To trade:

```
yarn start changePosition -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 -a <deltaAsset> -s <deltaStable>
```

To estimate a trade:

```
yarn start estimateChangePosition -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 -a <deltaAsset> -s <deltaStable>
```

To liquidate:

```
yarn start liquidate -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 -t <trader_address>
```

To see if a trade can be liquidated:

```
yarn start estimateLiquidate -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2 -t <trader_address>
```

Run a liquidation bot for futureswap:

```
yarn start liquidationBot -n arbitrum_rinkeby -e 0x1B5A08020E94066a3fB91Aff8B395De2d9cfaDd2
```
