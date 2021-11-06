import { Reportable, Reporter } from "@liquidationBot/reporting/types";

export async function runReporter(
  reporter: Reporter,
  reportable: Reportable
): Promise<void> {
  try {
    // potentially reporters may also export async init() function.
    // Run it here and in catch below, above the reportEvent call
    for await (const event of reportable.getEventsIterator()) {
      await reporter.reportEvent(event);
    }
  } catch (error) {
    // @ts-ignore - cause is a new feature that would be typed in TS 4.5 https://github.com/microsoft/TypeScript/pull/46291
    const reporterCrashError = Error("Reporter will be restarted after crash", {
      cause: error,
    });
    await reporter.reportEvent({ type: "error", error: reporterCrashError });

    return runReporter(reporter, reportable);
  }
}
