import {
  ALL_ACTIVATION_MILESTONES,
  getActivationMilestoneEventName,
} from "../../../Types/Analytics/ActivationMilestone";
import {
  PRODUCT_EVENTS,
  ProductEventDefinition,
  ProductEventName,
} from "../../../Types/Analytics/ProductEvent";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs/analytics/activation.md is the funnel anyone can rebuild the
 * dashboard from (issue #6830), so it must name the events the code sends -
 * every one, and nothing that is not:
 *
 *  - every activation milestone's event and every catalog event is on the
 *    page, and every event on the page is one of those or a name the code
 *    still spells out (the events sent before the rule);
 *  - every catalog event a page sends is sent from somewhere in the
 *    product - directly, or through its helper - and one reserved for a
 *    later issue is not, until that issue lifts the mark.
 */

const REPOSITORY_ROOT: string = path.join(__dirname, "../../../../..");
const DOC_PATH: string = path.join(
  REPOSITORY_ROOT,
  "Docs/analytics/activation.md",
);

// A backticked event name: lower case, with at least one slash, nothing else.
const EVENT_NAME: RegExp = /^[a-z][a-z0-9_-]*(\/[a-z0-9_-]+)+$/;

// The rule's own pattern, which the page spells out as an example.
const NOT_EVENTS: Set<string> = new Set<string>(["area/thing_happened"]);

const documentedEvents: () => Set<string> = (): Set<string> => {
  const doc: string = fs.readFileSync(DOC_PATH, "utf8");
  const names: Set<string> = new Set<string>();

  for (const match of doc.matchAll(/`([^`\n]+)`/g)) {
    const token: string = match[1]!;

    if (EVENT_NAME.test(token) && !NOT_EVENTS.has(token)) {
      names.add(token);
    }
  }

  return names;
};

const SOURCE_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages/Common/Server"),
  path.join(REPOSITORY_ROOT, "packages/Common/UI"),
  path.join(REPOSITORY_ROOT, "packages/Common/Utils"),
  path.join(REPOSITORY_ROOT, "packages/App/FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee/Server"),
];

const TYPESCRIPT_FILE: RegExp = /\.(ts|tsx)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "public",
]);

const sourceFiles: (root: string) => Array<string> = (
  root: string,
): Array<string> => {
  const files: Array<string> = [];

  if (!fs.existsSync(root)) {
    return files;
  }

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(directory, entry.name));
        }
      } else if (
        TYPESCRIPT_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name)
      ) {
        files.push(path.join(directory, entry.name));
      }
    }
  };

  walk(root);

  return files;
};

let allSources: Array<{ file: string; text: string }> | null = null;

const sources: () => Array<{ file: string; text: string }> = (): Array<{
  file: string;
  text: string;
}> => {
  if (!allSources) {
    allSources = SOURCE_ROOTS.flatMap((root: string) => {
      return sourceFiles(root);
    }).map((file: string) => {
      return { file, text: fs.readFileSync(file, "utf8") };
    });
  }

  return allSources;
};

const CATALOG_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Types/Analytics/ProductEvent.ts",
);

const memberOf: (name: ProductEventName) => string = (
  name: ProductEventName,
): string => {
  return Object.entries(ProductEventName).find(
    (entry: [string, string]): boolean => {
      return entry[1] === name;
    },
  )![0];
};

/*
 * Events sent through a helper, and the names a page calls the helper by:
 * the helper itself is not "a page sending it".
 */
const HELPERS: Array<{
  file: string;
  entryPoints: Array<string>;
  events: Array<ProductEventName>;
}> = [
  {
    file: "packages/Common/UI/Utils/GuidedSetupEvents.ts",
    entryPoints: ["useGuidedSetupEvents", "new GuidedSetupEvents("],
    events: [
      ProductEventName.GuidedSetupStarted,
      ProductEventName.GuidedSetupStepReached,
      ProductEventName.GuidedSetupFinished,
      ProductEventName.GuidedSetupLeft,
    ],
  },
  {
    file: "packages/Common/UI/Utils/ChecklistEvents.ts",
    entryPoints: ["ChecklistEvents.noteProgress("],
    events: [
      ProductEventName.ChecklistStepCompleted,
      ProductEventName.ChecklistFinished,
    ],
  },
  // Every answer a person gives (#6832) is kept, then sent as feedback/given.
  {
    file: "packages/Common/UI/Utils/ProductFeedback.ts",
    entryPoints: ["ProductFeedback.submit("],
    events: [ProductEventName.FeedbackGiven],
  },
];

// Where a page of the product sends the event, if anywhere.
const pagesSending: (name: ProductEventName) => Array<string> = (
  name: ProductEventName,
): Array<string> => {
  const member: string = `ProductEventName.${memberOf(name)}`;
  const helper: (typeof HELPERS)[number] | undefined = HELPERS.find(
    (candidate: (typeof HELPERS)[number]): boolean => {
      return candidate.events.includes(name);
    },
  );

  return sources()
    .filter((source: { file: string; text: string }): boolean => {
      if (source.file === CATALOG_FILE) {
        return false;
      }

      if (helper && source.file.endsWith(helper.file)) {
        return false;
      }

      const isPage: boolean = source.file.includes(
        `${path.sep}packages${path.sep}App${path.sep}`,
      );

      if (!isPage) {
        return false;
      }

      return (
        source.text.includes(member) ||
        Boolean(
          helper &&
            helper.entryPoints.some((entryPoint: string): boolean => {
              return source.text.includes(entryPoint);
            }),
        )
      );
    })
    .map((source: { file: string }): string => {
      return path.relative(REPOSITORY_ROOT, source.file);
    });
};

describe("Docs/analytics/activation.md and the code", () => {
  test("the page names every milestone's event and every catalog event", () => {
    const documented: Set<string> = documentedEvents();
    const missing: Array<string> = [];

    for (const milestone of ALL_ACTIVATION_MILESTONES) {
      const name: string = getActivationMilestoneEventName(milestone);

      if (!documented.has(name)) {
        missing.push(name);
      }
    }

    for (const event of PRODUCT_EVENTS) {
      if (!documented.has(event.name)) {
        missing.push(event.name);
      }
    }

    expect(missing).toEqual([]);
  });

  test("every event the page names exists in the code", () => {
    const known: Set<string> = new Set<string>([
      ...ALL_ACTIVATION_MILESTONES.map(getActivationMilestoneEventName),
      ...PRODUCT_EVENTS.map((event: ProductEventDefinition): string => {
        return event.name;
      }),
    ]);

    const notInCode: Array<string> = [];

    for (const name of documentedEvents()) {
      if (known.has(name)) {
        continue;
      }

      // An event sent before the rule: the code spells it out.
      const isSpelledOut: boolean = sources().some(
        (source: { text: string }): boolean => {
          return (
            source.text.includes(`"${name}"`) ||
            source.text.includes(`'${name}'`) ||
            source.text.includes(`\`${name}\``)
          );
        },
      );

      if (!isSpelledOut) {
        notInCode.push(name);
      }
    }

    expect(notInCode).toEqual([]);
  });

  test("the page lists the events sent before the rule that the code still sends", () => {
    const documented: Set<string> = documentedEvents();

    for (const name of [
      "server/user_created",
      "server/project_created",
      "server/monitor_created",
      "server/status_page_created",
      "server/on_call_policy_created",
      "server/incident_created",
      "server/team_member_invited",
      "server/subscription_started",
      "server/subscription_plan_changed",
    ]) {
      expect(documented.has(name)).toBe(true);
    }
  });

  test("every catalog event not reserved is sent from a page, and a reserved one from none yet", () => {
    const unsent: Array<string> = [];
    const sentButReserved: Array<string> = [];

    for (const event of PRODUCT_EVENTS) {
      const pages: Array<string> = pagesSending(event.name);

      if (event.reservedFor && pages.length > 0) {
        sentButReserved.push(`${event.name} (${pages.join(", ")})`);
      }

      if (!event.reservedFor && pages.length === 0) {
        unsent.push(event.name);
      }
    }

    expect(unsent).toEqual([]);
    // Sent now: take its reservedFor off in PRODUCT_EVENTS.
    expect(sentButReserved).toEqual([]);
  });

  test("the scan reads the product's code: it finds the pages that send today's events", () => {
    expect(pagesSending(ProductEventName.SearchFoundNothing)).toEqual([
      path.join(
        "packages/App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette.tsx",
      ),
    ]);
    expect(pagesSending(ProductEventName.ChecklistFinished)).toEqual([
      path.join(
        "packages/App/FeatureSet/Dashboard/src/Components/Home/GettingStarted.tsx",
      ),
    ]);
  });
});
