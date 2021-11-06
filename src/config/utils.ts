export function getStringEnv(envVarName: string) {
  if (process.env[envVarName] == null)
    throw Error(`Env variable "${envVarName}" is not to be provided`);
  return process.env[envVarName] as string;
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
  opts?: Opts
): AllowedValue | (Opts["isOptional"] extends true ? undefined : never);
export function getEnumEnv<
  AllowedValue extends string,
  Opts extends { isOptional?: boolean; default?: AllowedValue }
>(
  envVarName: string,
  allowedValues: AllowedValue,
  opts: Opts = { isOptional: false } as Opts
) {
  if (process.env[envVarName] == null) {
    if (opts.isOptional || "default" in opts) {
      return opts.default;
    } else {
      throw Error(`Env variable "${envVarName}" is not provided`);
    }
  }
  // @ts-ignore - include type is broken https://github.com/microsoft/TypeScript/issues/26255
  if (!allowedValues.includes(process.env[envVarName])) {
    // @ts-ignore - TS missed adding types for ListFormat https://github.com/microsoft/TypeScript/issues/29129
    const formatter = new Intl.ListFormat();
    const allowedValuesStr: string = formatter.format(allowedValues);
    throw Error(
      `${
        opts?.isOptional ? "Optional env" : "Env"
      } variable "${envVarName}" allowed values are ${allowedValuesStr} but provided is ${
        process.env[envVarName]
      }`
    );
  }
  return process.env[envVarName] as AllowedValue;
}
