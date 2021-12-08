export function getStringEnv(envVarName: string): string {
  const value = process.env[envVarName];
  if (value === undefined)
    throw Error(`Env variable "${envVarName}" is not provided`);
  return value;
}

export function getNumberEnv<IsOptional>(
  envVarName: string,
  opts?: { isInt?: true; isPositive?: true; isOptional?: IsOptional }
): number | (IsOptional extends true ? undefined : never);
export function getNumberEnv<IsOptional>(
  envVarName: string,
  opts: { isInt?: true; isPositive?: true; isOptional?: IsOptional } = {}
) {
  if (process.env[envVarName] == null) {
    if (opts.isOptional) {
      return undefined;
    } else {
      throw Error(`Env variable "${envVarName}" is not to be provided`);
    }
  }
  const value = Number(process.env[envVarName]) as number;

  if (isNaN(value)) {
    throw Error(
      `Env variable "${envVarName}" must be number, while provided is "${value}"`
    );
  }
  if (opts.isInt && value != Math.trunc(value)) {
    throw Error(
      `Env variable "${envVarName}" must be integer, while provided is "${value}"`
    );
  }
  if (opts.isPositive && value < 0) {
    throw Error(
      `Env variable "${envVarName}" must be positive, while provided is "${value}"`
    );
  }

  return value;
}

export function getEnumEnv<
  AllowedValue extends string,
  Opts extends { isOptional?: boolean; default?: AllowedValue }
>(
  envVarName: string,
  allowedValues: AllowedValue[],
  opts: Opts = { isOptional: false } as Opts
): AllowedValue | (Opts extends { isOptional: true } ? undefined : never) {
  const { isOptional } = opts;
  const value = process.env[envVarName];

  if (value === undefined) {
    if (opts.default !== undefined) {
      return opts.default;
    } else if (isOptional === true) {
      /*
       * TS seems to be trying to unify this value type with the return type regardless of the
       * `isOptional` type.  Not sure what is the right name for this kind of type check, so I can
       * not even google for a relevant explanation.  Checked that the produced function types are
       * correct, so the only solution is to just disable TS here.
       */
      // @ts-ignore
      return undefined;
    } else {
      throw Error(`Env variable "${envVarName}" is not provided`);
    }
  }

  if (!allowedValues.includes(value as AllowedValue)) {
    // @ts-ignore - TS missed adding types for ListFormat https://github.com/microsoft/TypeScript/issues/29129
    const formatter = new Intl.ListFormat();
    const allowedValuesStr: string = formatter.format(allowedValues);
    throw Error(
      `${
        isOptional ? "Optional env" : "Env"
      } variable "${envVarName}" allowed values are ${allowedValuesStr}.\n` +
        `Got: "${value}"`
    );
  }

  return value as AllowedValue;
}
