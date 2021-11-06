import { providers, Wallet } from "ethers";
import { config } from "@config";

const { network, walletPath } = config;
const { mnemonic, chainId, rpcUrl } = network;

const providerConfig = { name: "json-rpc", chainId };
const provider = new providers.JsonRpcProvider(rpcUrl, providerConfig);

export default Wallet.fromMnemonic(mnemonic, walletPath).connect(provider);
