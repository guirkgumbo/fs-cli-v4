import { config } from "@config";
import { IExchange__factory } from "@generated/factory/IExchange__factory";
import wallet from "../wallet";

const { exchangeAddress } = config;

export default IExchange__factory.connect(exchangeAddress, wallet);
