/**
 * Contains known information about Futureswap deployments.
 *
 * Mostly to provide reasonable default values for command line arguments.
 */

/**
 * Described properties of a single deployment.
 */
export class DeploymentInfo {
  constructor(
    /// Address of the exchange contract in this deployment.  Used to identify a specific
    /// deployment.
    public exchangeAddress: string,
    /// Block number when this deployment was initially created.
    public launchBlock: number
  ) {}
}

/**
 * Known deployments.
 */
export class Deployments {
  constructor(
    /// Maps exchange addresses to corresponding deployment information.
    public deployments: {
      [address: string]: DeploymentInfo;
    }
  ) {}

  static from(deployments: DeploymentInfo[]): Deployments {
    const asMap = Object.fromEntries(
      deployments.map((info) => [info.exchangeAddress.toLowerCase(), info])
    );
    return new Deployments(asMap);
  }

  public get(exchangeAddress: string): DeploymentInfo | undefined {
    return this.deployments[exchangeAddress.toLowerCase()];
  }

  public addresses(): string[] {
    return Object.keys(this.deployments);
  }
}

export const deployments: {
  [network: string]: Deployments;
} = {
  RINKEBY_ARBITRUM: Deployments.from([
    // ETH/USDC
    new DeploymentInfo(
      /* exchangeAddress */ "0xfcD6da3Ea74309905Baa5F3BAbDdE630FccCcBD1",
      /* launchBlock */ 5280847
    ),
    // WBTC/ETH
    new DeploymentInfo(
      /* exchangeAddress */ "0xEF68C2ae2783dC4d7eab94d15dE96717155C3fB5",
      /* launchBlock */ 7608236
    ),
  ]),
  MAINNET_ARBITRUM: Deployments.from([
    // ETH/USDC
    new DeploymentInfo(
      /* exchangeAddress */ "0xF7CA7384cc6619866749955065f17beDD3ED80bC",
      /* launchBlock */ 2194550
    ),
    // WBTC/ETH
    new DeploymentInfo(
      /* exchangeAddress */ "0x85DDE4A11cF366Fb56e05cafE2579E7119D5bC2f",
      /* launchBlock */ 4377849
    ),
  ]),
};
