import fs from "fs";
import path from "path";
import ts from "typescript";
import { REPOSITORY_ROOT, findStateOrderComparisons } from "../StateFlagReads";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE RULE DECIDES WHERE AN INCIDENT, AN ALERT, AN EPISODE OR A SCHEDULED
 * MAINTENANCE EVENT MAY MOVE NEXT (Common/Utils/StateMove).
 *
 * Each state timeline used to write its own checks. Incidents, alerts and
 * maintenance events refused a move back up the list; the two episode
 * timelines did not, so a resolved episode could be moved back to an earlier
 * state - and the move cascaded to its incidents or alerts as OneUptime.
 * Three copies of one rule had drifted.
 *
 * So the rule is written once, and every reader asks it:
 *
 *   - every state timeline holds a new row to it through
 *     StateMoveCheck.assertTimelineRowAllowed, in its own record's name, and
 *     writes no refusal and compares no states' places of its own;
 *   - the episode timelines' only move back up the list is OneUptime's
 *     grouping-rule reopen, which only their createReopen asks for;
 *   - every record service holds an update that writes the record's current
 *     state to it (StateMoveCheck.assertUpdateMovesAllowed), before anything
 *     is written;
 *   - each episode moves its members only where their own rule lets them.
 *
 * The monitor status timeline is not one of them: monitor statuses are not a
 * path a monitor walks down - a monitor goes back to Operational - and it
 * keeps its own checks.
 */

const SERVICES: string = "packages/Common/Server/Services";

function read(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// The source without its comments, so a comment naming a call is no call.
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function count(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, "g")) || []).length;
}

interface Timeline {
  file: string;
  record: string;
  isEpisode: boolean;
}

const TIMELINES: Array<Timeline> = [
  {
    file: `${SERVICES}/IncidentStateTimelineService.ts`,
    record: "Incident",
    isEpisode: false,
  },
  {
    file: `${SERVICES}/AlertStateTimelineService.ts`,
    record: "Alert",
    isEpisode: false,
  },
  {
    file: `${SERVICES}/IncidentEpisodeStateTimelineService.ts`,
    record: "IncidentEpisode",
    isEpisode: true,
  },
  {
    file: `${SERVICES}/AlertEpisodeStateTimelineService.ts`,
    record: "AlertEpisode",
    isEpisode: true,
  },
  {
    file: `${SERVICES}/ScheduledMaintenanceStateTimelineService.ts`,
    record: "ScheduledMaintenance",
    isEpisode: false,
  },
];

interface RecordService {
  file: string;
  record: string;
  stateKeys: string;
}

const RECORD_SERVICES: Array<RecordService> = [
  {
    file: `${SERVICES}/IncidentService.ts`,
    record: "Incident",
    stateKeys: "CURRENT_STATE_KEYS",
  },
  {
    file: `${SERVICES}/AlertService.ts`,
    record: "Alert",
    stateKeys: "ALERT_STATE_KEYS",
  },
  {
    file: `${SERVICES}/IncidentEpisodeService.ts`,
    record: "IncidentEpisode",
    stateKeys: "INCIDENT_STATE_KEYS",
  },
  {
    file: `${SERVICES}/AlertEpisodeService.ts`,
    record: "AlertEpisode",
    stateKeys: "ALERT_STATE_KEYS",
  },
  {
    file: `${SERVICES}/ScheduledMaintenanceService.ts`,
    record: "ScheduledMaintenance",
    stateKeys: "STATE_KEYS",
  },
];

// A TypeScript source file, and a call of an episode timeline's reopen.
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const CREATE_REOPEN_CALL: RegExp = /createReopen\(/;

// The rule's own sentences: written only by Common/Utils/StateMove.
const REFUSALS: RegExp =
  /cannot be same as previous state|cannot be same as next state|cannot transition to/;

/*
 * Whether `file` writes one of the rule's sentences: a string or template
 * holding one, anywhere but in a comparison - callers that leave a record
 * where it is compare the message they were refused with
 * (`err.message === "Incident state cannot be same as previous state."`).
 */
function writesRefusal(file: string): boolean {
  const text: string = read(file);

  if (!REFUSALS.test(text)) {
    return false;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let writes: boolean = false;

  const isComparison: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
    const parent: ts.Node = node.parent;

    return (
      ts.isBinaryExpression(parent) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(parent.operatorToken.kind)
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      REFUSALS.test(node.getText(source)) &&
      !isComparison(node)
    ) {
      writes = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return writes;
}

describe("every state timeline asks the one state move rule", () => {
  test.each(TIMELINES)(
    "$record's timeline holds each new row to it, in its own name",
    (timeline: Timeline) => {
      const source: string = code(timeline.file);

      expect(count(source, /StateMoveCheck\.assertTimelineRowAllowed\(/)).toBe(
        1,
      );
      expect(source).toContain(`record: StateMoveRecord.${timeline.record},`);
    },
  );

  test.each(TIMELINES)(
    "$record's timeline writes no refusal of its own",
    (timeline: Timeline) => {
      expect(code(timeline.file)).not.toMatch(REFUSALS);
    },
  );

  test.each(TIMELINES)(
    "$record's timeline compares no states' places of its own",
    (timeline: Timeline) => {
      expect(
        findStateOrderComparisons(timeline.file, read(timeline.file)),
      ).toEqual([]);
    },
  );

  test.each(TIMELINES)(
    "$record's timeline reads the place of the state before the new row",
    (timeline: Timeline) => {
      const source: string = code(timeline.file);
      const relation: string = timeline.record.includes("Incident")
        ? "incidentState"
        : timeline.record.includes("Alert")
          ? "alertState"
          : "scheduledMaintenanceState";

      // The row before it is read with its state's place and name.
      expect(source).toMatch(
        new RegExp(`${relation}: \\{[^}]*order: true,[^}]*name: true,[^}]*\\}`),
      );
      expect(source).toMatch(
        new RegExp(`order: stateBeforeThis\\.${relation}\\?\\.order,`),
      );
    },
  );

  test("nothing but the rule writes its sentences", () => {
    const writers: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(
        path.join(REPOSITORY_ROOT, directory),
        {
          withFileTypes: true,
        },
      )) {
        const relative: string = `${directory}/${entry.name}`;

        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "build") {
            walk(relative);
          }
          continue;
        }

        if (TYPESCRIPT_FILE.test(entry.name) && writesRefusal(relative)) {
          writers.push(relative);
        }
      }
    };

    walk("packages/Common/Server");
    walk("packages/Common/Utils");

    expect(writers).toEqual(["packages/Common/Utils/StateMove.ts"]);
  });
});

describe("an episode is moved back up its list only by its grouping rule's reopen", () => {
  const EPISODE_TIMELINES: Array<Timeline> = TIMELINES.filter(
    (timeline: Timeline): boolean => {
      return timeline.isEpisode;
    },
  );

  test.each(EPISODE_TIMELINES)(
    "$record's timeline lets the reopen through only for the create createReopen asked for",
    (timeline: Timeline) => {
      const source: string = code(timeline.file);

      expect(source).toContain(
        "isGroupingRuleReopen: this.groupingRuleReopens.has(createBy),",
      );
      // Added in one place - createReopen - and taken away when it ends.
      expect(count(source, /this\.groupingRuleReopens\.add\(/)).toBe(1);
      expect(count(source, /this\.groupingRuleReopens\.delete\(/)).toBe(1);
      expect(source).toMatch(
        /public async createReopen\([\s\S]*?this\.groupingRuleReopens\.add\(createBy\);[\s\S]*?finally \{[\s\S]*?this\.groupingRuleReopens\.delete\(createBy\);/,
      );
    },
  );

  test("nothing a person sends can ask for it: only the episode services' reopen does", () => {
    const callers: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(
        path.join(REPOSITORY_ROOT, directory),
        {
          withFileTypes: true,
        },
      )) {
        const relative: string = `${directory}/${entry.name}`;

        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "build") {
            walk(relative);
          }
          continue;
        }

        if (
          TYPESCRIPT_FILE.test(entry.name) &&
          CREATE_REOPEN_CALL.test(code(relative))
        ) {
          callers.push(relative);
        }
      }
    };

    walk("packages/Common/Server");
    walk("packages/App/FeatureSet");

    expect(callers.sort()).toEqual(
      [
        `${SERVICES}/AlertEpisodeService.ts`,
        `${SERVICES}/AlertEpisodeStateTimelineService.ts`,
        `${SERVICES}/IncidentEpisodeService.ts`,
        `${SERVICES}/IncidentEpisodeStateTimelineService.ts`,
      ].sort(),
    );
  });

  test.each([
    `${SERVICES}/IncidentEpisodeService.ts`,
    `${SERVICES}/AlertEpisodeService.ts`,
  ])("%s asks for the reopen only from reopenEpisode", (file: string) => {
    const source: string = code(file);

    expect(count(source, /isGroupingRuleReopen: true/)).toBe(1);
    expect(source).toMatch(
      /public async reopenEpisode\([\s\S]*?isGroupingRuleReopen: true/,
    );
  });

  test.each([
    {
      file: `${SERVICES}/IncidentEpisodeService.ts`,
      member: "Incident",
    },
    {
      file: `${SERVICES}/AlertEpisodeService.ts`,
      member: "Alert",
    },
  ])(
    "$file moves each member only where the member's own rule lets it",
    ({ file, member }: { file: string; member: string }) => {
      const source: string = code(file);

      expect(source).toMatch(
        new RegExp(
          `StateMoveUtil\\.isMoveAllowed\\(\\{\\s*list: StateMoveUtil\\.getList\\(StateMoveRecord\\.${member}\\),`,
        ),
      );
    },
  );
});

describe("an update that writes a record's state asks the rule before anything is written", () => {
  test.each(RECORD_SERVICES)(
    "$record's service holds its updates to it",
    (service: RecordService) => {
      const source: string = code(service.file);

      expect(count(source, /StateMoveCheck\.assertUpdateMovesAllowed\(/)).toBe(
        1,
      );
      expect(source).toMatch(
        new RegExp(
          `StateMoveCheck\\.assertUpdateMovesAllowed\\(\\{\\s*record: StateMoveRecord\\.${service.record},\\s*updateBy: updateBy,\\s*stateKeys: ${service.stateKeys},`,
        ),
      );
      // Read as the update's own rows, held to them (UpdateChecksReadHeldRows).
      expect(source).toContain(
        "return this.findRowsAndHoldUpdateToThem(updateBy, select);",
      );
    },
  );

  test.each(RECORD_SERVICES)(
    "$record's service asks it in onBeforeUpdate",
    (service: RecordService) => {
      const source: string = code(service.file);
      const hook: number = source.indexOf(
        "protected override async onBeforeUpdate(",
      );
      const ask: number = source.indexOf(
        "StateMoveCheck.assertUpdateMovesAllowed(",
      );
      const nextMethod: number = source.indexOf(
        "  protected override async ",
        hook + 1,
      );

      expect(hook).toBeGreaterThan(-1);
      expect(ask).toBeGreaterThan(hook);
      expect(nextMethod === -1 || ask < nextMethod).toBe(true);
    },
  );
});
