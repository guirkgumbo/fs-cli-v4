// JSON-RPC provider requests may fail occasionally due to a timeout.  The simplest solution is to
// just always try a few times before failing.
export const tryNTimes = async <Res>(
  maxRetries: number,
  what: () => Promise<Res>
): Promise<Res> => {
  let retryCount = 0;
  while (true) {
    try {
      let res = await what();
      return res;
    } catch (e) {
      if (retryCount < maxRetries) {
        retryCount += 1;
        continue;
      }
      throw e;
    }
  }
};

export const ensureIsNumber = (
  context: string,
  name: string,
  v: any
): number => {
  if (typeof v !== "number") {
    if (isNaN(v)) {
      throw new Error(
        `${context}\n` + `"${name}" is not an number, observed value: "${v}"`
      );
    }

    v = Number(v);
  }

  return v;
};

export const ensureIsBigint = (
  context: string,
  name: string,
  v: any
): bigint => {
  try {
    return BigInt(v);
  } catch (e) {
    throw new Error(
      `${context}\n` + `${name} could not be parsed as BigInt: "${v}"\n` + e
    );
  }
};
