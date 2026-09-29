import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

interface FeedImplementation {
  name: string;
  relativePath: string;
}

/*
 * How one feed connects its Filter & Sort state to the request it makes. The
 * checks below compare against the name the feed itself gave the
 * useFeedOptions() result, and look inside the two hook calls rather than
 * the whole file, so they survive renames and reformatting but not a wire
 * that goes to the wrong place.
 */
interface FeedOptionsWiring {
  // What the feed called its useFeedOptions() result.
  hook: string;
  // The arguments of the useFeedOptions() call.
  optionsCall: string;
  // The arguments of the useFeedItems() call: the request the feed makes.
  itemsCall: string;
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

/*
 * Ends at the call's opening parenthesis, so the same pattern both names the
 * result and locates the call's arguments.
 */
const FEED_OPTIONS_HOOK_CALL: RegExp =
  /const\s+(\w+)\s*:\s*UseFeedOptionsResult\s*=\s*useFeedOptions\s*\(/;

const FEED_ITEMS_HOOK_CALL: RegExp = /\buseFeedItems\s*(?:<[^<>()]*>)?\s*\(/;

// A storage key written as a string literal ("incident"), not an expression.
const QUOTED_STRING_LITERAL: RegExp = /^(["'`])[^"'`]*\1$/;

const readSource: (implementation: FeedImplementation) => string = (
  implementation: FeedImplementation,
): string => {
  return fs.readFileSync(
    path.join(DASHBOARD_COMPONENTS, implementation.relativePath),
    "utf8",
  );
};

const findFeedImplementationPaths: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
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
};

/*
 * The text between the parentheses of the first call that `callee` finds (a
 * pattern ending at the opening parenthesis). Strings and comments are
 * skipped, so a bracket inside one cannot end the call early.
 */
const getCallArguments: (source: string, callee: RegExp) => string = (
  source: string,
  callee: RegExp,
): string => {
  const match: RegExpExecArray | null = callee.exec(source);

  if (!match) {
    throw new Error(`No call matching ${callee.toString()}`);
  }

  const openIndex: number = match.index + match[0].length - 1;
  let depth: number = 0;
  let index: number = openIndex;

  while (index < source.length) {
    const character: string = source[index]!;
    const nextCharacter: string | undefined = source[index + 1];

    if (character === "/" && nextCharacter === "*") {
      index = source.indexOf("*/", index + 2) + 2;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      const lineEnd: number = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      index++;

      while (index < source.length && source[index] !== character) {
        index += source[index] === "\\" ? 2 : 1;
      }

      index++;
      continue;
    }

    if ("([{".includes(character)) {
      depth++;
    } else if (")]}".includes(character)) {
      depth--;

      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }

    index++;
  }

  throw new Error(`Unbalanced call matching ${callee.toString()}`);
};

/*
 * A property's value expression inside a call's arguments, with whitespace
 * removed so that line breaks never decide whether two expressions match.
 */
const getPropertyExpression: (
  callArguments: string,
  property: string,
) => string | undefined = (
  callArguments: string,
  property: string,
): string | undefined => {
  const match: RegExpMatchArray | null = callArguments.match(
    new RegExp(String.raw`\b${property}\s*:\s*([^,}]+?)\s*[,}]`),
  );

  return match ? match[1]!.replace(/\s+/g, "") : undefined;
};

const getFeedOptionsWiring: (source: string) => FeedOptionsWiring = (
  source: string,
): FeedOptionsWiring => {
  const hookMatch: RegExpMatchArray | null = source.match(
    FEED_OPTIONS_HOOK_CALL,
  );

  if (!hookMatch) {
    throw new Error("The feed does not keep a UseFeedOptionsResult");
  }

  return {
    hook: hookMatch[1]!,
    optionsCall: getCallArguments(source, FEED_OPTIONS_HOOK_CALL),
    itemsCall: getCallArguments(source, FEED_ITEMS_HOOK_CALL),
  };
};

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

  /*
   * The order is the reader's choice from the Filter & Sort button, and it
   * is applied by the API. Reversing or re-sorting the loaded window in the
   * browser would show the newest ten upside down instead of the oldest ten.
   */
  test.each(FEED_IMPLEMENTATIONS)(
    "$name requests activity in the reader's chosen order",
    (implementation: FeedImplementation) => {
      const source: string = readSource(implementation);
      const wiring: FeedOptionsWiring = getFeedOptionsWiring(source);

      expect(wiring.itemsCall).toMatch(
        new RegExp(
          String.raw`\bpostedAt\s*:\s*${wiring.hook}\.options\.sortOrder\b`,
        ),
      );
      expect(source).not.toMatch(/\bpostedAt\s*:\s*SortOrder\./);
      expect(source).not.toContain(".reverse()");
      expect(wiring.itemsCall).toMatch(/\bskip\s*:\s*0\b/);
      expect(wiring.itemsCall).toMatch(/\blimit\s*,/);
      expect(source).not.toContain("LIMIT_PER_PROJECT");
    },
  );

  test.each(FEED_IMPLEMENTATIONS)(
    "$name offers Filter & Sort as the first header control and filters through the API",
    (implementation: FeedImplementation) => {
      const source: string = readSource(implementation);
      const wiring: FeedOptionsWiring = getFeedOptionsWiring(source);
      const hook: string = wiring.hook;

      expect(source).toMatch(
        /import\s+useFeedOptions\b[^;]*from\s+"Common\/UI\/Components\/Feed\/useFeedOptions"/,
      );
      expect(source).toMatch(
        /import\s+FeedOptionsButton\s+from\s+"Common\/UI\/Components\/Feed\/FeedOptionsButton"/,
      );
      expect(source).toMatch(/buttons=\{\[\s*<FeedOptionsButton\b/);

      /*
       * A change of options must both re-read the feed (viewKey) and change
       * what is read (the event type query). Either one alone shows stale or
       * mislabelled items.
       */
      expect(wiring.itemsCall).toMatch(
        new RegExp(String.raw`\bviewKey\s*:\s*${hook}\.optionsKey\b`),
      );
      /*
       * The first argument may carry a generic cast with a comma of its own:
       * ResourceFeed names its column `as Extract<keyof TFeedModel, string>`.
       */
      expect(wiring.itemsCall).toMatch(
        new RegExp(
          String.raw`\.\.\.getFeedEventTypeQuery<\w+>\(\s*(?:[^,()<>]|<[^<>]*>)+,\s*${hook}\.options\s*,?\s*\)`,
        ),
      );

      const button: RegExpMatchArray | null = source.match(
        /<FeedOptionsButton\b[\s\S]*?\/>/,
      );

      expect(button).not.toBeNull();
      expect(button![0]).toMatch(
        new RegExp(String.raw`\bvalue=\{\s*${hook}\.options\s*\}`),
      );
      expect(button![0]).toMatch(
        new RegExp(
          String.raw`\beventTypeOptions=\{\s*${hook}\.eventTypeOptions\s*\}`,
        ),
      );
      expect(button![0]).toMatch(
        new RegExp(String.raw`\bonChange=\{\s*${hook}\.setOptions\s*\}`),
      );

      /*
       * A filtered feed with no matches must say it is filtered, not claim
       * the resource has no activity at all.
       */
      expect(
        getCallArguments(
          source,
          /noItemsMessage=\{\s*getFeedNoItemsMessage\s*\(/,
        ),
      ).toMatch(new RegExp(String.raw`\boptions\s*:\s*${hook}\.options\b`));
    },
  );

  /*
   * The dashboard moves from one incident (cluster, monitor, ...) to the next
   * without remounting the feed. useFeedItems starts over when its
   * resourceKey changes, and useFeedOptions drops the event type filter when
   * its resetKey changes. Only when both are the same expression do the two
   * happen in the same render, so the first request for the new resource is
   * unfiltered instead of carrying the filter chosen on the previous one.
   */
  test.each(FEED_IMPLEMENTATIONS)(
    "$name drops its event type filter on the render that moves it to another resource",
    (implementation: FeedImplementation) => {
      const wiring: FeedOptionsWiring = getFeedOptionsWiring(
        readSource(implementation),
      );
      const resourceKey: string | undefined = getPropertyExpression(
        wiring.itemsCall,
        "resourceKey",
      );

      expect(resourceKey).toBeTruthy();
      expect(getPropertyExpression(wiring.optionsCall, "resetKey")).toBe(
        resourceKey,
      );
    },
  );

  /*
   * Only literal keys can be compared here. ResourceFeed keys its order by
   * props.eventTypeColumn, one per product, and
   * ResourceFeedPagesFilterSort.test.tsx checks that those are distinct.
   */
  test("each feed remembers its sort order under its own storage key", () => {
    const storageKeys: Array<[string, string | undefined]> =
      FEED_IMPLEMENTATIONS.map(
        (implementation: FeedImplementation): [string, string | undefined] => {
          return [
            implementation.name,
            getPropertyExpression(
              getFeedOptionsWiring(readSource(implementation)).optionsCall,
              "storageKey",
            ),
          ];
        },
      );

    // Without a key the order is forgotten on every page load.
    expect(
      storageKeys
        .filter((entry: [string, string | undefined]): boolean => {
          return !entry[1];
        })
        .map((entry: [string, string | undefined]): string => {
          return entry[0];
        }),
    ).toEqual([]);

    const literalKeys: Array<string> = storageKeys
      .map((entry: [string, string | undefined]): string => {
        return entry[1] || "";
      })
      .filter((key: string): boolean => {
        return QUOTED_STRING_LITERAL.test(key);
      });

    expect(literalKeys.length).toBeGreaterThan(1);
    expect(new Set(literalKeys).size).toBe(literalKeys.length);
  });

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

  /*
   * The incident and alert feeds are the two that post AI investigations.
   * Their AI items go through the shared compact helper (summary + root
   * cause, full report behind More Information) and stay in safe mode.
   */
  test.each(
    FEED_IMPLEMENTATIONS.filter((implementation: FeedImplementation) => {
      return (
        implementation.name === "Incident" || implementation.name === "Alert"
      );
    }),
  )(
    "$name feed shows AI root-cause reports through the compact helper",
    (implementation: FeedImplementation) => {
      const source: string = readSource(implementation);

      expect(source).toContain('from "../../Utils/AIRootCauseFeedItem"');
      expect(source).toContain("getFeedItemMarkdown({");
      expect(source).toContain("isAIInvestigation,");
      expect(source).toContain(
        "textInMarkdown: feedItemMarkdown.textInMarkdown,",
      );
      expect(source).toContain(
        "moreTextInMarkdown: feedItemMarkdown.moreTextInMarkdown,",
      );
      expect(source).toContain("safeMode: isAIInvestigation,");
      expect(source).toContain(
        "isAIInvestigation ? IconProp.Sparkles : IconProp.Cube",
      );
    },
  );

  test("the monitor feed no longer stops at a one-off 50-item window", () => {
    const monitorSource: string = readSource(FEED_IMPLEMENTATIONS[0]!);

    expect(monitorSource).not.toContain("limit: 50");
  });
});
