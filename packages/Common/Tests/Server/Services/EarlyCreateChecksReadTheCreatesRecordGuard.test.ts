import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SERVICE THAT CHECKS A CREATE'S COLUMNS BEFORE THE CREATE STARTS ASKS WHAT
 * THE CREATE ASKS (#8952).
 *
 * A create's own column checks never see who did something to the record -
 * DatabaseService takes those columns out before them, and stamps the
 * creator after them (UserAttribution) - and they hold a value in a
 * server-set column to its create list, dropping it for a caller who may
 * read the column (ColumnPermission.checkComputedColumnsSentOnCreate).
 * Since #8908, a column check handed a server-set value without being told
 * OneUptime wrote it refuses it, so a check a service makes in its own
 * create() override, on the record as it was handed in, refused what the
 * create would have taken out: OnCallDutyPolicyChildService refused every
 * escalation rule join row the rule service writes naming the person adding
 * it, and a new policy with first responders lost them.
 *
 * So every create() override in the services that calls a create column
 * check before it hands the create on first does to the record what the
 * create does before its own checks (DatabaseService
 * .takeOutWhatTheServerSetsOnCreate). Such an override is named below, so a
 * new one is looked at by whoever adds it.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

// A create's column check: CreatePermission's or ModelPermission's.
const CREATE_COLUMN_CHECK: RegExp =
  /\b(?:CreatePermission|ModelPermission)\.checkCreatePermissions\s*\(/;

const TAKE_OUT: string = "this.takeOutWhatTheServerSetsOnCreate(";

// The create() overrides that check a create's columns before handing it on.
const EARLY_CHECKS: Array<string> = ["OnCallDutyPolicyChildService.ts"];

/*
 * What a create does to the record before its own checks read it, in order:
 * it takes out who did something to the record, then what only OneUptime
 * writes (ColumnsOnlyOneUptimeWrites, #10053) - each named to the caller as
 * left out (recordFieldsLeftOut, #10136) - and then holds a value in a
 * server-set column to its create list (checkComputedColumnsRecordingLeftOut).
 */
const STEPS_BEFORE_THE_CHECKS: Array<string> = [
  "DatabaseService.recordFieldsLeftOut( createBy, this.decideUserAttributionOnCreate(createBy.data, createBy.props), );",
  "DatabaseService.recordFieldsLeftOut( createBy, ColumnsOnlyOneUptimeWrites.takeOut({",
  "this.checkComputedColumnsRecordingLeftOut(createBy)",
];

// Code with every run of whitespace as one space, so a line break is no change.
function compact(code: string): string {
  return code.replace(/\s+/g, " ");
}

// The body of every `override async create(` in `source`, up to its handing on.
function getCreateOverrides(source: string): Array<string> {
  const bodies: Array<string> = [];
  const header: RegExp = /public\s+override\s+async\s+create\s*\(/g;

  for (const match of source.matchAll(header)) {
    const open: number = source.indexOf("{", match.index! + match[0].length);
    let depth: number = 0;
    let end: number = open;

    for (let i: number = open; i < source.length; i++) {
      if (source[i] === "{") {
        depth++;
      } else if (source[i] === "}") {
        depth--;

        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    bodies.push(source.slice(open, end + 1));
  }

  return bodies;
}

// Where each create column check of a create() override's body starts.
function getColumnChecks(body: string): Array<number> {
  const checks: Array<number> = [];
  const check: RegExp = new RegExp(CREATE_COLUMN_CHECK.source, "g");

  for (const match of body.matchAll(check)) {
    checks.push(match.index!);
  }

  return checks;
}

function getServiceFiles(): Array<string> {
  return fs
    .readdirSync(SERVICES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .sort();
}

describe("a create column check a service asks before the create starts", () => {
  test("is asked only by the create() overrides named here", () => {
    const found: Array<string> = getServiceFiles().filter(
      (name: string): boolean => {
        const source: string = fs.readFileSync(
          path.join(SERVICES_DIR, name),
          "utf8",
        );

        return getCreateOverrides(source).some((body: string): boolean => {
          return getColumnChecks(body).length > 0;
        });
      },
    );

    expect(found).toEqual(EARLY_CHECKS);
  });

  test.each(EARLY_CHECKS)(
    "%s takes out what the server sets before every early column check",
    (name: string) => {
      const source: string = fs.readFileSync(
        path.join(SERVICES_DIR, name),
        "utf8",
      );

      const early: Array<string> = getCreateOverrides(source).filter(
        (body: string): boolean => {
          return getColumnChecks(body).length > 0;
        },
      );

      expect(early.length).toBeGreaterThan(0);

      for (const body of early) {
        const takeOut: number = body.indexOf(TAKE_OUT);

        expect(takeOut).toBeGreaterThan(-1);

        for (const check of getColumnChecks(body)) {
          expect(takeOut).toBeLessThan(check);
        }
      }
    },
  );

  test("the helper does to the record what the create does before its own checks", () => {
    const source: string = fs.readFileSync(
      path.join(SERVICES_DIR, "DatabaseService.ts"),
      "utf8",
    );

    const helper: RegExpMatchArray | null = source.match(
      /protected takeOutWhatTheServerSetsOnCreate\([\s\S]*?\n {2}\}\n/,
    );
    const beforeHooks: RegExpMatchArray | null = source.match(
      /private async checkCreateBeforeHooks\([\s\S]*?\n {2}\}\n/,
    );

    expect(helper).not.toBeNull();
    expect(beforeHooks).not.toBeNull();

    // Each takes the same steps, in the same order: as checkCreateBeforeHooks.
    for (const [name, body] of [
      ["takeOutWhatTheServerSetsOnCreate", helper![0]],
      ["checkCreateBeforeHooks", beforeHooks![0]],
    ] as Array<[string, string]>) {
      const steps: Array<number> = STEPS_BEFORE_THE_CHECKS.map(
        (step: string): number => {
          return compact(body).indexOf(compact(step));
        },
      );

      for (const [index, at] of steps.entries()) {
        expect({
          name,
          step: STEPS_BEFORE_THE_CHECKS[index],
          found: at > -1,
        }).toEqual({ name, step: STEPS_BEFORE_THE_CHECKS[index], found: true });
      }

      expect({ name, inOrder: steps }).toEqual({
        name,
        inOrder: [...steps].sort((a: number, b: number): number => {
          return a - b;
        }),
      });
    }

    // The server-set values are held to the create list by the column check.
    const computed: RegExpMatchArray | null = source.match(
      /private checkComputedColumnsRecordingLeftOut\([\s\S]*?\n {2}\}\n/,
    );

    expect(computed).not.toBeNull();
    expect(computed![0]).toContain(
      "ModelPermission.checkComputedColumnsSentOnCreate(",
    );
  });
});
