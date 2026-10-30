import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * HOW MANY ITEMS EACH BULK ACTION WORKS ON AT ONCE, WRITTEN DOWN
 * (issue #5299).
 *
 * Every bulk action runs through runBulkAction
 * (Common/UI/Components/BulkUpdate/BulkActionRunner), which works on
 * BULK_ACTION_CONCURRENCY items at once unless it is told otherwise. Several
 * at once is what made a bulk Resolve of thousands of alerts fast. One at a
 * time is what keeps correct the writes that check or recompute something
 * the items share: a plan's count of active monitors, a network site's
 * health, the order of a status page's resources, the one incident a run
 * links alerts to, the rule that a project keeps an owner. Which of the two
 * an action needs is a decision about the server's rules, and the runner's
 * default must never make it silently.
 *
 * So this guard holds two things:
 *   - every call of runBulkAction says how many items it works on at once;
 *   - every such choice in the front ends - a call's concurrency, a list's
 *     deleteConcurrency (BaseModelTable), a shared action's config - is
 *     written in the ledger below, with why, in the order its module makes
 *     them. A new bulk action, or a changed choice, fails here until the
 *     ledger says so: the decision is read, and reviewed, in one place.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const EE_PRESENT: boolean = fs.existsSync(path.join(REPOSITORY_ROOT, "ee"));

// Where the browser's modules are: Common's UI, each front end, ee's when present.
const SCAN_ROOTS: Array<string> = [
  "packages/Common/UI",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// Where the default lives: the runner itself is not a choice.
const RUNNER: string =
  "packages/Common/UI/Components/BulkUpdate/BulkActionRunner.ts";

interface Choice {
  // The expression, as written, whitespace folded.
  expression: string;
  why: string;
}

const SEVERAL: string = "BULK_ACTION_CONCURRENCY";

/*
 * The ledger: by module, each choice in the order the module makes it.
 * "concurrency:" and "deleteConcurrency:" alike.
 */
const LEDGER: Record<string, Array<Choice>> = {
  "packages/Common/UI/Components/RuleRun/RunRulesBulkAction.ts": [
    {
      expression: "1",
      why: "Run Now: two rules run at once over the same resources would race each other's reads of what is attached, so one rule runs to completion before the next starts.",
    },
  ],
  "packages/Common/UI/Components/BulkUpdate/ValueChangeActions.tsx": [
    {
      expression: SEVERAL,
      why: "Change Severity: each record's severity, feed entry, reminders and on-call rules are its own.",
    },
  ],
  "packages/Common/UI/Components/BulkUpdate/BulkSwitchActions.tsx": [
    {
      expression: "config.concurrency ?? 1",
      why: "Enable and Disable: turning things on can count against a plan's limit or schedule work per project, so one at a time unless the list says its rows switch nothing shared.",
    },
  ],
  "packages/Common/UI/Components/BulkUpdate/BulkArchiveActions.tsx": [
    {
      expression: "config.concurrency ?? BULK_ACTION_CONCURRENCY",
      why: "Archive and Unarchive: a record's archiving is its own, unless the list says its rows roll up into something shared (network devices).",
    },
  ],
  "packages/Common/UI/Components/BulkUpdate/BulkLabelActions.tsx": [
    {
      expression: "config.concurrency ?? BULK_ACTION_CONCURRENCY",
      why: "Add and Remove Labels: a record's labels are its own, unless the list says its labels match shared rules again (network devices).",
    },
  ],
  "packages/Common/UI/Components/BulkUpdate/BulkOwnerActions.tsx": [
    {
      expression: SEVERAL,
      why: "Add Owner, Remove Owner and Assign to Me: each record's owner rows are its own.",
    },
    {
      expression: SEVERAL,
      why: "Assign to Me with nobody signed in: every row fails with why, nothing is written.",
    },
  ],
  "packages/Common/UI/Components/ModelTable/ModelTable.tsx": [
    {
      expression: SEVERAL,
      why: "Export JSON: each row is only read, and the file is written in selection order.",
    },
  ],
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx": [
    {
      expression: "props.bulkActions?.deleteConcurrency ?? 1",
      why: "Delete: a delete's hooks can check a rule over the rows left (a project keeps an owner, a list keeps its last state), so one at a time unless the list says otherwise.",
    },
  ],
  "packages/App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable.tsx": [
    {
      expression: SEVERAL,
      why: "Delete on the alerts list: an alert's delete takes its own metrics with it and checks nothing across alerts.",
    },
  ],
  "packages/App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable.tsx":
    [
      {
        expression: SEVERAL,
        why: "Delete on the incidents list: an incident's delete gives its monitors back only once no other open incident holds them, which every delete asks again after its own delete.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions.tsx":
    [
      {
        expression: "1",
        why: "Link to Incident: every link is made to the same incident, whose own follow-ons each link runs.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueListActions.tsx":
    [
      {
        expression: SEVERAL,
        why: "Mark Resolved, Accept Risk and Not an Issue on Data Security issues: each is an update of its own issue, written to that issue's own timeline, and nothing the issues share is checked or recomputed.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/EpisodeMembers/BulkAddToEpisodeActions.tsx":
    [
      {
        expression: "Math.max(1, props.items.length)",
        why: "Add to Existing Episode: one request adds them all, so every item waits on that one request.",
      },
      {
        expression: "Math.max(1, props.items.length)",
        why: "Add to New Episode: one request makes the episode with them all.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/EventView/useEventStateActions.tsx":
    [
      {
        expression: "definition.bulkConcurrency",
        why: "Change State: several incidents, alerts and episodes at once, one scheduled maintenance event at a time (EventStateKinds, pinned by EventStateBulkMoves).",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRowActions.ts":
    [
      {
        expression: SEVERAL,
        why: "Resolve, Reopen, Archive and Unarchive on exceptions: each turns one switch on its own exception, and nothing the exceptions share is checked or recomputed.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/BulkMonitorProbeChange.ts":
    [
      {
        expression: SEVERAL,
        why: "Add Probe and Remove Probe: the probes a monitor runs on are its own.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkApplyVendorTemplate.tsx":
    [
      {
        expression: "APPLY_VENDOR_TEMPLATE_CONCURRENCY",
        why: "Apply Vendor Template: a device's health-OID writes are independent of every other device's (APPLY_VENDOR_TEMPLATE_CONCURRENCY).",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkCreatePingMonitors.tsx":
    [
      {
        expression: "1",
        why: "Create Ping Monitors: every monitor created counts against the project's limit on active monitors, and each create must see the one before it.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkDeviceRelationActions.tsx":
    [
      {
        expression: "1",
        why: "Set Site and Role: a move into a site re-rolls that site's health and re-reconciles its alert-policy monitors, which each write does again.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkOidTemplateActions.tsx":
    [
      {
        expression: SEVERAL,
        why: "Set OID Collection Template: a device's template is its own polling setting.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkShortenDeviceNames.tsx":
    [
      {
        expression: "1",
        why: "Shorten Names: a name the plan frees on one device can be the one it gives the next.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSnmpCredentialProfileActions.tsx":
    [
      {
        expression: SEVERAL,
        why: "Set SNMP Credential Profile: the profile a device polls with is its own setting.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSwitchToProbePolling.tsx":
    [
      {
        expression: "1",
        why: "Switch to Probe Polling: how a device is monitored decides which of its site's alert policies watch it, and each switch matches them again.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/Postmortem/BulkPostmortemStatusAction.tsx":
    [
      {
        expression: SEVERAL,
        why: "Change Postmortem Status: an incident's postmortem status and its feed entry are its own.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityCase/useSecurityCaseListActions.tsx":
    [
      {
        expression: "1",
        why: "Security case actions: one case at a time, each as the server sees it after the one before, and the list read again after.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/useAddEventsToCase.tsx":
    [
      {
        expression: "Math.max(1, props.items.length)",
        why: "Add to Case: one request keeps every ticked event on the case, so every event waits on that one request.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourcePanel.tsx":
    [
      {
        expression: "1",
        why: "Remove from a status page: the resources of a group keep their places in one order, which every removal closes up.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/useSubscriberBulkActions.tsx":
    [
      {
        expression: SEVERAL,
        why: "Unsubscribe: one subscriber's unsubscribing touches nothing another's does.",
      },
    ],
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Archived.tsx": [
    {
      expression: "1",
      why: "Unarchive network devices: each device's write recomputes its site's health.",
    },
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices.tsx": [
    {
      expression: "1",
      why: "Labels on network devices: each device's labels match its alert policies again.",
    },
    {
      expression: "1",
      why: "Archive network devices: each device's write recomputes its site's health.",
    },
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Interfaces.tsx":
    [
      {
        expression: "1",
        why: "Mute and unmute interfaces: every interface of a device rolls up into the device's health, which each write recomputes.",
      },
    ],
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/Index.tsx": [
    {
      expression: SEVERAL,
      why: "Block and Unblock projects: each project's switch is its own.",
    },
    {
      expression: "1",
      why: "Delete projects: a project's delete removes everything it holds, a long write of its own.",
    },
  ],
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx": [
    {
      expression: SEVERAL,
      why: "Block and Unblock users: each user's switch is their own.",
    },
    {
      expression: "1",
      why: "Delete users: a project keeps at least one owner, a rule two deletes at once would each check against the other's user.",
    },
  ],
  "ee/AdminDashboard/EnterpriseLicenses/Components/useLicenseBulkActions.tsx": [
    {
      expression: "1",
      why: "Enterprise license actions: the license server reads a license's terms whenever an installation reports, and each change is its own audited write.",
    },
  ],
};

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/.*$/gm;
const CHOICE_KEY: RegExp = /\b(?:deleteConcurrency|concurrency):\s*/g;
const RUN_CALL: RegExp = /\brunBulkAction\s*(?:<[^<>()]*>)?\s*\(/g;
const CONCURRENCY_KEY: RegExp = /\bconcurrency:/;
const WHITESPACE_RUN: RegExp = /\s+/g;
const MODULE_FILE: RegExp = /\.(ts|tsx)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

/*
 * Where a module makes a bulk choice at all: it calls the runner, or hands
 * a choice to a shared bulk action or a table's bulk actions. A
 * "concurrency:" anywhere else is about something else.
 */
const BULK_MARKER: RegExp =
  /\b(?:runBulkAction|BULK_ACTION_CONCURRENCY|useBulk[A-Za-z]*|BulkSwitchActionsConfig|bulkActions)\b/;

function withoutComments(source: string): string {
  return source.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

const OPENERS: string = "([{";
const CLOSERS: string = ")]}";

/*
 * The expression that starts at `start`: up to the first comma, closing
 * bracket or semicolon outside any brackets it opens, whitespace folded.
 */
function readExpression(source: string, start: number): string {
  let depth: number = 0;
  let index: number = start;

  for (; index < source.length; index++) {
    const character: string = source[index]!;

    if (OPENERS.includes(character)) {
      depth += 1;
      continue;
    }

    if (CLOSERS.includes(character)) {
      if (depth === 0) {
        break;
      }

      depth -= 1;
      continue;
    }

    if (depth === 0 && (character === "," || character === ";")) {
      break;
    }
  }

  return source.slice(start, index).replace(WHITESPACE_RUN, " ").trim();
}

// The text between the call's own brackets.
function readCallArguments(source: string, openIndex: number): string {
  let depth: number = 0;

  for (let index: number = openIndex; index < source.length; index++) {
    const character: string = source[index]!;

    if (OPENERS.includes(character)) {
      depth += 1;
    } else if (CLOSERS.includes(character)) {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }

  return source.slice(openIndex + 1);
}

function findChoices(source: string): Array<string> {
  const code: string = withoutComments(source);

  if (!BULK_MARKER.test(code)) {
    return [];
  }

  const choices: Array<string> = [];

  for (const match of code.matchAll(CHOICE_KEY)) {
    choices.push(readExpression(code, match.index! + match[0].length));
  }

  return choices;
}

// The calls of runBulkAction that do not say how many items at once.
function countCallsWithoutConcurrency(source: string): number {
  const code: string = withoutComments(source);
  let count: number = 0;

  for (const match of code.matchAll(RUN_CALL)) {
    const openIndex: number = match.index! + match[0].length - 1;

    if (!CONCURRENCY_KEY.test(readCallArguments(code, openIndex))) {
      count += 1;
    }
  }

  return count;
}

function listModules(root: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, root);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const found: Array<string> = [];
  const stack: Array<string> = [absolute];

  while (stack.length > 0) {
    const directory: string = stack.pop()!;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        MODULE_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name)
      ) {
        found.push(
          path.relative(REPOSITORY_ROOT, full).split(path.sep).join("/"),
        );
      }
    }
  }

  return found.sort();
}

describe("the reader", () => {
  test("reads each choice's whole expression, commas inside brackets included, across lines", () => {
    const source: string = [
      "await runBulkAction<Row>({",
      "  actionProps: props,",
      "  concurrency: Math.max(1, props.items.length),",
      "  step: step,",
      "});",
      "const config = { concurrency:",
      "    config.concurrency ?? BULK_ACTION_CONCURRENCY };",
      "bulkActions={{ deleteConcurrency: BULK_ACTION_CONCURRENCY }}",
    ].join("\n");

    expect(findChoices(source)).toEqual([
      "Math.max(1, props.items.length)",
      "config.concurrency ?? BULK_ACTION_CONCURRENCY",
      SEVERAL,
    ]);
  });

  test("leaves alone a declaration, a comment and a module that makes no bulk choice", () => {
    expect(
      findChoices(
        [
          "export interface X { concurrency?: number | undefined; bulkConcurrency: number; }",
          "// concurrency: 8 in a comment",
          "/* deleteConcurrency: 8 */",
          "await runBulkAction({ actionProps: props, concurrency: 1, step: step });",
        ].join("\n"),
      ),
    ).toEqual(["1"]);

    // A worker pool, say: nothing to do with bulk actions.
    expect(findChoices("const pool = new Pool({ concurrency: 8 });")).toEqual(
      [],
    );
  });

  test("finds a call of the runner that does not say how many at once", () => {
    expect(
      countCallsWithoutConcurrency(
        [
          "await runBulkAction<Row>({ actionProps: props, concurrency: 1, step: step });",
          "await runBulkAction({ actionProps: props, step: async () => { await x({ a: 1 }); } });",
          "// runBulkAction({ actionProps: props }) in a comment",
        ].join("\n"),
      ),
    ).toBe(1);
  });
});

describe("every bulk action says how many items it works on at once", () => {
  const modules: Array<string> = SCAN_ROOTS.flatMap((root: string) => {
    return listModules(root);
  }).filter((modulePath: string) => {
    return modulePath !== RUNNER;
  });

  const read: (modulePath: string) => string = (modulePath: string): string => {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, modulePath), "utf8");
  };

  test("the walk reads the front ends", () => {
    expect(modules.length).toBeGreaterThan(1000);
    expect(modules).toContain(
      "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
    );
    expect(modules).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/EventView/useEventStateActions.tsx",
    );
  });

  test("every call of runBulkAction names its concurrency, rather than taking the runner's default", () => {
    const callsWithoutConcurrency: Record<string, number> = {};

    for (const modulePath of modules) {
      const count: number = countCallsWithoutConcurrency(read(modulePath));

      if (count > 0) {
        callsWithoutConcurrency[modulePath] = count;
      }
    }

    expect(callsWithoutConcurrency).toEqual({});
  });

  test("every choice of how many at once is in the ledger, with why, as the module makes it", () => {
    const found: Record<string, Array<string>> = {};

    for (const modulePath of modules) {
      const choices: Array<string> = findChoices(read(modulePath));

      if (choices.length > 0) {
        found[modulePath] = choices;
      }
    }

    const expected: Record<string, Array<string>> = {};

    for (const [modulePath, choices] of Object.entries(LEDGER)) {
      // ee's own modules are read only where ee/ is present.
      if (modulePath.startsWith("ee/") && !EE_PRESENT) {
        continue;
      }

      expected[modulePath] = choices.map((choice: Choice): string => {
        return choice.expression;
      });
    }

    /*
     * A module here that is not in the ledger makes a choice nobody wrote
     * down: add it, with why. A choice that changed: change it here too,
     * with the new why. A module in the ledger that is gone: take it out.
     */
    expect(found).toEqual(expected);
  });

  test("every choice in the ledger says why", () => {
    for (const choices of Object.values(LEDGER)) {
      for (const choice of choices) {
        expect(choice.why.length).toBeGreaterThan(30);
      }
    }
  });
});
