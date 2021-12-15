import { Arguments } from "yargs";

export function getStringArg<
  CliArgName extends string,
  Opts extends { isOptional?: boolean; default?: string },
  OtherArguments = {}
>(
  cliArgName: CliArgName,
  envPropName: string,
  argv: Arguments<
    Omit<OtherArguments, CliArgName> & Record<CliArgName, string | undefined>
  >,
  opts: Opts = { isOptional: false } as Opts
):
  | string
  | (Opts extends { isOptional: true }
      ? Opts extends { default: string }
        ? never
        : undefined
      : never) {
  const argvValue = argv[cliArgName];
  if (argvValue !== undefined) {
    /*
     * TS fails to infer the type here correctly.  Or I fail to express the types correctly.
     * TS says, in the end of the reduction chain:
     *
     *  Type 'OtherArguments[string] & undefined' is not assignable to type 'string'.
     *
     * But `argvValue` has been checked for `undefined` just a bit above.
     */
    // @ts-ignore
    return argvValue;
  }

  const envValue = process.env[envPropName];
  if (envValue !== undefined) {
    return envValue;
  }

  const { isOptional, default: def } = opts;

  if (def !== undefined) {
    return def;
  }

  if (isOptional) {
    /*
     * TS seems to be trying to unify this value type with the return type regardless of the
     * `isOptional` type.  Not sure what is the right name for this kind of type check, so I can not
     * even google for a relevant explanation.  Checked that the produced function types are
     * correct, so the only solution I was able to find is to just disable TS.
     */
    // @ts-ignore
    return undefined;
  }

  throw Error(
    `You need to provide the "--${cliArgName}" command line argument ` +
      `or specify the "${envPropName}" property in the .env file.`
  );
}

export function getNumberArg<
  CliArgName extends string,
  Opts extends {
    isInt?: boolean;
    isPositive?: boolean;
    isOptional?: boolean;
    default?: number;
  },
  OtherArguments = {}
>(
  cliArgName: CliArgName,
  envPropName: string,
  argv: Arguments<
    Omit<OtherArguments, CliArgName> & Record<CliArgName, number | undefined>
  >,
  opts: Opts = { isInt: false, isPositive: false, isOptional: false } as Opts
):
  | number
  | (Opts extends { isOptional: true }
      ? Opts extends { default: number }
        ? never
        : undefined
      : never) {
  const { isInt, isPositive, isOptional, default: def } = opts;

  const validate = (context: string, value: number): number => {
    if (isInt && value != Math.trunc(value)) {
      throw Error(`${context}: must be an integer. Value provided: "${value}"`);
    }
    if (isPositive && value < 0) {
      throw Error(`${context}: must be positive. Value provided: "${value}"`);
    }

    return value;
  };

  const argvValue = argv[cliArgName];
  if (argvValue !== undefined) {
    return validate(`"--${cliArgName}" argument`, argvValue);
  }

  const envValue = process.env[envPropName];
  if (envValue !== undefined) {
    const value = Number(envValue);

    const context = `"${envPropName}" .env property`;

    if (isNaN(value)) {
      throw Error(
        `${context}: must be a number. Value provided: "${envValue}"`
      );
    }

    return validate(context, value);
  }

  if (def !== undefined) {
    return def;
  }

  if (isOptional) {
    /*
     * TS seems to be trying to unify this value type with the return type regardless of the
     * `isOptional` type.  Not sure what is the right name for this kind of type check, so I can
     * not even google for a relevant explanation.  Checked that the produced function types are
     * correct, so the only solution is to just disable TS here.
     */
    // @ts-ignore
    return undefined;
  }

  throw Error(
    `You need to provide the "--${cliArgName}" argument in the command line ` +
      `or specify the "${envPropName}" property in the .env file.`
  );
}

export function getEnumArg<
  AllowedValue extends string,
  CliArgName extends string,
  Opts extends { isOptional?: boolean; default?: AllowedValue },
  OtherArguments = {}
>(
  cliArgName: CliArgName,
  envPropName: string,
  allowedValues: AllowedValue[],
  argv: Arguments<
    Omit<OtherArguments, CliArgName> &
      Record<CliArgName, AllowedValue | undefined>
  >,
  opts: Opts = { isOptional: false } as Opts
): AllowedValue | (Opts extends { isOptional: true } ? undefined : never) {
  const { isOptional, default: def } = opts;

  const validate = (context: string, value: string): AllowedValue => {
    if (!allowedValues.includes(value as AllowedValue)) {
      // TS missed adding types for ListFormat https://github.com/microsoft/TypeScript/issues/29129.
      // @ts-ignore
      const formatter = new Intl.ListFormat();
      const allowedValuesStr: string = formatter.format(allowedValues);
      throw Error(
        `${context}: Must be one of: ${allowedValuesStr}.\n` +
          `Value provided: "${value}"`
      );
    }

    return value as AllowedValue;
  };

  const argvValue = argv[cliArgName];
  if (argvValue !== undefined) {
    return validate(`"--${cliArgName}" argument`, argvValue);
  }

  const envValue = process.env[envPropName];
  if (envValue !== undefined) {
    return validate(`"${envPropName}" .env property`, envValue);
  }

  if (def !== undefined) {
    return def;
  }

  if (isOptional) {
    /*
     * TS seems to be trying to unify this value type with the return type regardless of the
     * `isOptional` type.  Not sure what is the right name for this kind of type check, so I can
     * not even google for a relevant explanation.  Checked that the produced function types are
     * correct, so the only solution is to just disable TS here.
     */
    // @ts-ignore
    return undefined;
  }

  throw Error(
    `You need to provide the "--${cliArgName}" argument in the command line ` +
      `or specify the "${envPropName}" property in the .env file.`
  );
}
