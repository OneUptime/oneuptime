import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DASHBOARD MOVES A NUMBERED LIST'S ROWS; IT NEVER WRITES THEIR ORDER
 * (issue #9573).
 *
 * Five lists are numbered by `order`: the escalation rules of an on-call
 * policy, the layers of a schedule and the people in them, the groups of a
 * status page and its resources. A write of a row's `order` places that row
 * alone and moves no other - what Terraform needs, numbering a whole list
 * one write per row, all at once. So the Dashboard's drag, and its Move up
 * and Move down, are moves: POST <list>/:id/move, through
 * ModelAPI.moveInList, naming the row whose place the moved one takes. A
 * control that wrote `order` instead would put the row beside its
 * neighbour - two rows at one number - rather than past it.
 *
 * These read the Dashboard's source: each of the three controls that
 * reorder these lists one row at a time moves, and nothing in the Dashboard
 * writes `order` on one of the five lists through an update. (A schedule's
 * Layers page saves its layers' and people's order all at once, through
 * save-layers, and creates a layer at the end of the schedule.)
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// A file of the Dashboard's source.
const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

// An update's data naming the order column.
const ORDER_WRITTEN: RegExp = /\border:/;

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

// The source with its comments removed and its white space squashed.
function readCode(file: string): string {
  return squash(
    fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " "),
  );
}

function between(code: string, start: string, end: string): string {
  const afterStart: string | undefined = code.split(start)[1];

  if (afterStart === undefined) {
    throw new Error(`The source no longer contains ${start}`);
  }

  const block: string | undefined = afterStart.split(end)[0];

  if (block === undefined) {
    throw new Error(`The source no longer contains ${end} after ${start}`);
  }

  return block;
}

function everySourceFile(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...everySourceFile(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// The models of the five lists, as the Dashboard names them.
const NUMBERED_LIST_MODELS: Array<string> = [
  "StatusPageGroup",
  "StatusPageResource",
  "OnCallDutyEscalationRule",
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyScheduleLayer",
  "OnCallDutyPolicyScheduleLayerUser",
];

describe("the controls that reorder a numbered list one row at a time", () => {
  test("Move up and Move down of a status page group move it to its sibling's place", () => {
    const code: string = readCode(
      path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", "Resources.tsx"),
    );
    const move: string = between(
      code,
      "const moveGroup: MoveGroupFunction",
      "const deleteGroup:",
    );

    expect(move).toContain("await ModelAPI.moveInList<StatusPageGroup>({");
    expect(move).toContain(
      "StatusPageGroupHierarchyViewUtil.getReorderTargetId(",
    );
    expect(move).not.toContain("updateById");
  });

  test("a drag of a status page resource moves it to the place of the resource where it was dropped", () => {
    const code: string = readCode(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "StatusPageResourcePanel.tsx",
      ),
    );
    const reorder: string = between(
      code,
      "const onReorder: OnReorderFunction",
      "const deleteResource:",
    );

    expect(reorder).toContain("ModelAPI.moveInList<StatusPageResource>({");
    expect(reorder).toContain(
      "StatusPageResourceExplorerUtil.getReorderTargetId(",
    );
    expect(reorder).toContain("placeOfId: new ObjectID(placeOfId),");
    expect(reorder).not.toContain("updateById");
    expect(reorder).not.toContain("order:");
  });

  test("Move up and Move down of an escalation rule move it to its neighbour's place, by id", () => {
    const code: string = readCode(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "OnCallPolicy",
        "EscalationRule",
        "EscalationRules.tsx",
      ),
    );
    const moveRule: string = between(
      code,
      "const moveRule:",
      "const confirmDelete:",
    );
    const moveTo: string = between(
      code,
      "const moveTo: MoveToFunction",
      "return [",
    );

    expect(moveRule).toContain("await ModelAPI.moveInList({");
    expect(moveRule).toContain("modelType: OnCallDutyEscalationRule,");
    expect(moveRule).toContain("placeOfId: placeOfId,");
    expect(moveRule).not.toContain("updateById");
    expect(moveTo).toContain("neighbour.id,");
    expect(moveTo).not.toContain("neighbour.order");
  });
});

describe("nothing in the Dashboard", () => {
  test("writes a numbered list row's order through an update", () => {
    const offenders: Array<string> = [];

    for (const file of everySourceFile(DASHBOARD_SRC)) {
      const code: string = readCode(file);

      for (const call of code.split("ModelAPI.updateById").slice(1)) {
        // The call's own arguments: up to the first "})" closing them.
        const args: string = call.split("})")[0] || "";

        const model: string | undefined = NUMBERED_LIST_MODELS.find(
          (name: string): boolean => {
            return (
              args.includes(`modelType: ${name},`) ||
              args.startsWith(`<${name}>`)
            );
          },
        );

        if (model && ORDER_WRITTEN.test(args)) {
          offenders.push(`${path.relative(DASHBOARD_SRC, file)} (${model})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
