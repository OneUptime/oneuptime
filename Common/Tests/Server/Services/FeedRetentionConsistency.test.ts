import fs from "fs";
import path from "path";

/*
 * Retention windows are declared per service via hardDeleteItemsOlderThanInDays,
 * but they only take effect once the service is listed in
 * Server/Services/Index.ts - that array is what
 * App/FeatureSet/Workers/Jobs/HardDelete/HardDeleteItemsInDatabase.ts iterates.
 * A window on an unregistered service is dead configuration, and registering
 * the service later silently arms it.
 *
 * That is not hypothetical: OnCallDutyPolicyFeedService sat unregistered
 * carrying a 90 day window while every other feed kept 3 years. Commit
 * 6bbf2f866c ("retain items for 3 years instead of 120 days") swept the feeds
 * from 120 to 3 * 365 and missed this one precisely because it held 90 rather
 * than 120, and nothing noticed because the service was not registered.
 * Registering it - which the workflow component registry fix had to do, since
 * OnCallDutyPolicyFeed is workflow-enabled - would have started hard deleting
 * on-call policy history at 90 days on billing-enabled deployments.
 *
 * Feed tables are the same kind of data as each other: a user-visible activity
 * timeline hung off a parent entity. They should expire together, whether or
 * not they happen to be registered yet.
 */

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

const RETENTION_PATTERN: RegExp =
  /hardDeleteItemsOlderThanInDays\(\s*"(\w+)"\s*,\s*([^)]+?)\s*\)/;

interface FeedRetention {
  serviceName: string;
  columnName: string;
  window: string;
}

const feedServiceNames: Array<string> = fs
  .readdirSync(SERVICES_DIRECTORY)
  .sort()
  .filter((fileName: string) => {
    return fileName.endsWith("FeedService.ts");
  })
  .map((fileName: string) => {
    return fileName.replace(/\.ts$/, "");
  });

const feedRetentions: Array<FeedRetention> = [];

for (const serviceName of feedServiceNames) {
  const source: string = fs.readFileSync(
    path.join(SERVICES_DIRECTORY, `${serviceName}.ts`),
    "utf8",
  );

  const match: RegExpMatchArray | null = source.match(RETENTION_PATTERN);

  if (!match) {
    // Deliberately not skipped - see "declares a retention window at all" below.
    continue;
  }

  feedRetentions.push({
    serviceName: serviceName,
    columnName: match[1]!,
    window: match[2]!.trim(),
  });
}

describe("Feed service retention windows", () => {
  test("the feed services were actually found", () => {
    // Guards the assertions below against a silent pass on an empty list.
    expect(feedServiceNames.length).toBeGreaterThan(0);
  });

  test("every feed service declares a retention window at all", () => {
    /*
     * The window/column assertions below can only speak for services this file
     * managed to parse. Comparing against the filenames on disk - rather than a
     * hardcoded count - is what stops a feed service that declares no retention,
     * or declares one in a shape the pattern misses, from being dropped from
     * those assertions and passing in silence.
     */
    const parsed: Array<string> = feedRetentions.map((entry: FeedRetention) => {
      return entry.serviceName;
    });

    expect(parsed).toEqual(feedServiceNames);
  });

  test("every feed service expires on the same window", () => {
    const windows: Array<string> = [
      ...new Set(
        feedRetentions.map((entry: FeedRetention) => {
          return entry.window;
        }),
      ),
    ];

    // Reported with the owning service names so a divergent one is obvious.
    expect({
      windows,
      services: feedRetentions.map((entry: FeedRetention) => {
        return `${entry.serviceName}=${entry.window}`;
      }),
    }).toEqual({
      windows: ["3 * 365"],
      services: feedRetentions.map((entry: FeedRetention) => {
        return `${entry.serviceName}=3 * 365`;
      }),
    });
  });

  test("every feed service expires on the same column", () => {
    const columns: Array<string> = [
      ...new Set(
        feedRetentions.map((entry: FeedRetention) => {
          return entry.columnName;
        }),
      ),
    ];

    expect(columns).toEqual(["createdAt"]);
  });
});
