import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

interface FeedImplementation {
  name: string;
  relativePath: string;
}

const DASHBOARD_COMPONENTS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
);

/*
 * These eight implementations back every activity feed in the dashboard.
 * ResourceFeed is parameterised across ten infrastructure and service-catalog
 * resources; the other seven own the richer product feeds with custom icons
 * and actions. Keep the inventory explicit so a newly added feed has to make
 * a deliberate ordering decision and join this parity sweep.
 */
const FEED_IMPLEMENTATIONS: Array<FeedImplementation> = [
  {
    name: "Monitor",
    relativePath: "Monitor/MonitorFeed.tsx",
  },
  {
    name: "Alert",
    relativePath: "Alert/AlertFeed.tsx",
  },
  {
    name: "Alert episode",
    relativePath: "AlertEpisode/AlertEpisodeFeed.tsx",
  },
  {
    name: "Incident",
    relativePath: "Incident/IncidentFeed.tsx",
  },
  {
    name: "Incident episode",
    relativePath: "IncidentEpisode/IncidentEpisodeFeed.tsx",
  },
  {
    name: "Scheduled maintenance",
    relativePath: "ScheduledMaintenance/ScheduledMaintenanceFeed.tsx",
  },
  {
    name: "On-call policy",
    relativePath: "OnCallPolicy/OnCallDutyPolicyFeed.tsx",
  },
  {
    name: "Infrastructure and service catalog",
    relativePath: "ResourceFeed/ResourceFeed.tsx",
  },
];

function readSource(implementation: FeedImplementation): string {
  return fs.readFileSync(
    path.join(DASHBOARD_COMPONENTS, implementation.relativePath),
    "utf8",
  );
}

function findFeedImplementationPaths(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const absolutePath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return findFeedImplementationPaths(absolutePath);
      }

      if (
        !entry.name.endsWith(".tsx") ||
        !fs
          .readFileSync(absolutePath, "utf8")
          .includes('import Feed from "Common/UI/Components/Feed/Feed"')
      ) {
        return [];
      }

      return [
        path
          .relative(DASHBOARD_COMPONENTS, absolutePath)
          .split(path.sep)
          .join("/"),
      ];
    });
}

describe("dashboard feed ordering parity", () => {
  test("tracks every feed implementation", () => {
    const expectedPaths: Array<string> = FEED_IMPLEMENTATIONS.map(
      (implementation: FeedImplementation): string => {
        return implementation.relativePath;
      },
    ).sort();

    expect(findFeedImplementationPaths(DASHBOARD_COMPONENTS).sort()).toEqual(
      expectedPaths,
    );
  });

  test.each(FEED_IMPLEMENTATIONS)(
    "$name requests the newest activity first",
    (implementation: FeedImplementation) => {
      const source: string = readSource(implementation);

      expect(source).toContain("postedAt: SortOrder.Descending");
      expect(source).not.toContain("postedAt: SortOrder.Ascending");
      expect(source).not.toContain(".reverse()");
      expect(source).toContain("skip: 0");
      expect(source).toContain("limit,");
      expect(source).not.toContain("LIMIT_PER_PROJECT");
    },
  );

  test.each(FEED_IMPLEMENTATIONS)(
    "$name uses the shared progressive feed UI",
    (implementation: FeedImplementation) => {
      const source: string = readSource(implementation);

      expect(source).toContain(
        'import Feed from "Common/UI/Components/Feed/Feed"',
      );
      expect(source).toContain(
        'import useFeedItems from "Common/UI/Components/Feed/useFeedItems"',
      );
      expect(source).toContain("<Feed");
      expect(source).toContain("hasMore={hasMore}");
      expect(source).toContain("isLoadingMore={isLoadingMore}");
      expect(source).toContain("onMore={loadMore}");
    },
  );

  test("the monitor feed no longer stops at a one-off 50-item window", () => {
    const monitorSource: string = readSource(FEED_IMPLEMENTATIONS[0]!);

    expect(monitorSource).not.toContain("limit: 50");
  });
});
