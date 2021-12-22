// JSON-RPC provider requests may fail occasionally due to a timeout.  The simplest solution is to
// just always try a few times before failing.
export const tryNTimes = async <R>(
  maxRetries: number,
  what: () => Promise<R>
) => {
  let retryCount = 0;
  while (true) {
    try {
      return await what();
    } catch (e) {
      retryCount += 1;
      if (retryCount < maxRetries) {
        continue;
      }
      throw e;
    }
  }
};
