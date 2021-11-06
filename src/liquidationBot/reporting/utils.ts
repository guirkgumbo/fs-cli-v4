export function logError(error: Error) {
  const causesStack = [];
  // @ts-ignore - cause is a new feature that would be typed in TS 4.5 https://github.com/microsoft/TypeScript/pull/46291
  let { cause } = error;
  while (cause) {
    causesStack.push(cause);
    ({ cause } = cause);
  }

  const causesStrStack = causesStack
    .map((cause) => cause.stack ?? cause)
    .map((causeStr, level) =>
      `^ Cause: ${causeStr}`
        .split("\n")
        .map((line) => " ".repeat((level + 1) * 2) + line)
        .join("\n")
    );

  console.error([error.stack, ...causesStrStack].join("\n"));
}
