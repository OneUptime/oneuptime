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
 * "Feed" has one deliberate second meaning in this codebase:
 * ThreatIntelFeedService owns a long-lived TAXII subscription configuration
 * (credentials, poll cursor, enablement and alerting settings), not an
 * append-only activity timeline. Expiring that row because it happens to end
 * in "Feed" would silently turn off a working integration after three years.
 * Configuration-feed exceptions are therefore explicit and verified below;
 * every new *FeedService still defaults to being an activity feed and must
 * declare the common retention window unless somebody deliberately classifies
 * it as configuration and satisfies the configuration assertions.
 */

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

const THREAT_INTEL_FEED_MODEL_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Models",
    "DatabaseModels",
    "ThreatIntelFeed.ts",
  ),
  "utf8",
);

const RETENTION_PATTERN: RegExp =
  /hardDeleteItemsOlderThanInDays\(\s*"(\w+)"\s*,\s*([^)]+?)\s*\)/;

/*
 * Alphabetical, because it is compared with a sorted directory listing.
 *
 * The three on-call CALENDAR feeds are configuration in the same sense as the
 * threat-intel feed: each row is a long-lived capability token (the calendar
 * subscription URL) plus its settings and fetch bookkeeping. Age-expiring one
 * would silently break every calendar app subscribed to it after three years.
 * Their semantics are pinned in "calendar feeds own a subscription token"
 * below.
 */
const CONFIGURATION_FEED_SERVICE_NAMES: ReadonlyArray<string> = [
  "OnCallDutyPolicyScheduleCalendarFeedService",
  "ProjectOnCallCalendarFeedService",
  "ThreatIntelFeedService",
  "UserOnCallCalendarFeedService",
];

const CALENDAR_FEED_MODEL_NAMES: ReadonlyArray<string> = [
  "OnCallDutyPolicyScheduleCalendarFeed",
  "ProjectOnCallCalendarFeed",
  "UserOnCallCalendarFeed",
];

const readModelSource: (modelName: string) => string = (
  modelName: string,
): string => {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Models",
      "DatabaseModels",
      `${modelName}.ts`,
    ),
    "utf8",
  );
};

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

const activityFeedServiceNames: Array<string> = feedServiceNames.filter(
  (serviceName: string): boolean => {
    return !CONFIGURATION_FEED_SERVICE_NAMES.includes(serviceName);
  },
);

const configurationFeedServiceNames: Array<string> = feedServiceNames.filter(
  (serviceName: string): boolean => {
    return CONFIGURATION_FEED_SERVICE_NAMES.includes(serviceName);
  },
);

const readServiceSource: (serviceName: string) => string = (
  serviceName: string,
): string => {
  return fs.readFileSync(
    path.join(SERVICES_DIRECTORY, `${serviceName}.ts`),
    "utf8",
  );
};

const feedRetentions: Array<FeedRetention> = [];

for (const serviceName of activityFeedServiceNames) {
  const source: string = readServiceSource(serviceName);

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
  test("the activity feed services were actually found", () => {
    // Guards the assertions below against a silent pass on an empty list.
    expect(activityFeedServiceNames.length).toBeGreaterThan(0);
  });

  test("accounts for every configuration feed explicitly", () => {
    /*
     * A stale exception must fail too: filtering the files on disk and then
     * comparing with the declared list proves every exception still names a
     * real service. A newly added *FeedService is not silently exempted — it
     * lands in activityFeedServiceNames unless this list is deliberately
     * changed.
     */
    expect(configurationFeedServiceNames).toEqual(
      CONFIGURATION_FEED_SERVICE_NAMES,
    );
  });

  test.each(CONFIGURATION_FEED_SERVICE_NAMES)(
    "%s is configuration, not an activity-timeline writer",
    (serviceName: string) => {
      const source: string = readServiceSource(serviceName);

      expect(source).toContain("protected override async onBeforeCreate");
      expect(source).toContain("protected override async onBeforeUpdate");
      expect(source).not.toMatch(/public async create\w+FeedItem\s*\(/);
    },
  );

  test("ThreatIntelFeed owns a live subscription lifecycle", () => {
    /*
     * These are the facts that make the exception semantic rather than a
     * filename allow-list. The row is CRUD-managed configuration with two
     * kinds of credentials, an enable switch and polling state. An activity
     * feed item has none of that lifecycle; deleting this row for age would
     * disable the subscription and discard the poll position.
     */
    expect(THREAT_INTEL_FEED_MODEL_SOURCE).toContain(
      '@CrudApiEndpoint(new Route("/threat-intel-feed"))',
    );
    expect(THREAT_INTEL_FEED_MODEL_SOURCE).toContain("@EnableWorkflow({");

    for (const fieldName of [
      "apiToken",
      "basicAuthUsername",
      "basicAuthPassword",
      "isEnabled",
      "pollIntervalInMinutes",
      "lastPolledAt",
      "cursor",
      "nextPageToken",
    ]) {
      expect(THREAT_INTEL_FEED_MODEL_SOURCE).toMatch(
        new RegExp(`public ${fieldName}\\?`),
      );
    }
  });

  test.each(CALENDAR_FEED_MODEL_NAMES)(
    "%s owns a subscription token, not an activity timeline",
    (modelName: string) => {
      /*
       * What makes a calendar feed configuration rather than history: a
       * capability token (hashed for lookup, encrypted for re-display), an
       * enable switch, a rotation stamp and fetch bookkeeping. Deleting the
       * row for age would revoke a link that calendar apps poll forever.
       */
      const source: string = readModelSource(modelName);

      expect(source).toMatch(/@CrudApiEndpoint\(new Route\("\/[a-z-]+"\)\)/);
      expect(source).not.toContain("@EnableDocumentation");

      for (const fieldName of [
        "tokenHash",
        "token",
        "previousTokenHash",
        "previousTokenExpiresAt",
        "tokenHint",
        "isEnabled",
        "rotatedAt",
        "lastFetchedAt",
        "fetchCount",
      ]) {
        expect(source).toMatch(new RegExp(`public ${fieldName}\\?`));
      }

      // An activity feed would carry these; a token row never does.
      expect(source).not.toMatch(/public feedInfoInMarkdown\?/);
      expect(source).not.toMatch(/public postedAt\?/);
    },
  );

  test.each(CONFIGURATION_FEED_SERVICE_NAMES)(
    "%s is not age-expired while it remains an active configuration",
    (serviceName: string) => {
      expect(readServiceSource(serviceName)).not.toMatch(RETENTION_PATTERN);
    },
  );

  test("every feed service is classified exactly once", () => {
    expect(
      [...activityFeedServiceNames, ...configurationFeedServiceNames].sort(),
    ).toEqual(feedServiceNames);
  });

  test("every activity feed service declares a retention window at all", () => {
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

    expect(parsed).toEqual(activityFeedServiceNames);
  });

  test("every activity feed service expires on the same window", () => {
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

  test("every activity feed service expires on the same column", () => {
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
