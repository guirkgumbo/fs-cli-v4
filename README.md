# fs-cli-v4

To run the project clone the reposistory and then run:

```
yarn
```

Create a .env in the top level containing these keys:

```
ARBITRUM_RINKEBY_MNEMONIC=
ARBITRUM_TESTNET_RINKEBY_CHAINID=421611
ARBITRUM_TESTNET_RINKEBY_RPC_URL=https://rinkeby.arbitrum.io/rpc
```

To approve tokens run:

```
yarn start approveTokens -n arbitrum_rinkey -e 0x....
```

To trade:

```
yarn start changePosition -n arbitrum_rinkey -e 0x.... -a <deltaAsset> -s <deltaStable>
```

To estimate a trade:

```
yarn start estimateChangePosition -n arbitrum_rinkey -e 0x.... -a <deltaAsset> -s <deltaStable>
```

To liquidate:

```
yarn start liquidate -n arbitrum_rinkey -e 0x.... -t <trader_address>
```

To see if a trade can be liquidated:

```
yarn start estimateLiquidate -n arbitrum_rinkey -e 0x.... -t <trader_address>
```
