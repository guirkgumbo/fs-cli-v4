import { config } from "@config";
import { LiquidationBotApi__factory } from "@generated/factory/LiquidationBotApi__factory";
import wallet from "../wallet";

const { network } = config;

export default LiquidationBotApi__factory.connect(network.address, wallet);
