import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";

/*
 * The Runbook pages keep three `Record<RunbookStepType, ...>` maps — the
 * execution timeline's icon and label, and the editor's step metadata. A
 * member added to the enum without an entry in each map is a compile error
 * for the Dashboard, which is exactly how RunbookStepType.Kubectl broke the
 * build: the enum grew for AI-composed kubectl steps and the maps did not.
 *
 * Both pages pull in editors and routers that do not load under jsdom, so
 * the maps are read from source, the way SloNavigationWiring reads the SLO
 * route tree. Each map is cut out of the file at its declaration and closed
 * at the first `};` on a line of its own, which only the top-level object
 * literal produces.
 */

const RUNBOOK_VIEW_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Runbook",
  "View",
);

const STEP_TYPES: Array<RunbookStepType> = Object.values(RunbookStepType);

interface MapUnderTest {
  file: string;
  declaration: string;
}

const MAPS: Array<MapUnderTest> = [
  {
    file: "ExecutionView.tsx",
    declaration: "const STEP_TYPE_ICON: Record<RunbookStepType, IconProp> = {",
  },
  {
    file: "ExecutionView.tsx",
    declaration: "const STEP_TYPE_LABEL: Record<RunbookStepType, string> = {",
  },
  {
    file: "Steps.tsx",
    declaration:
      "const STEP_TYPE_META: Record<RunbookStepType, StepTypeMeta> = {",
  },
];

function readSource(file: string): string {
  return fs.readFileSync(path.join(RUNBOOK_VIEW_DIR, file), "utf8");
}

function cutBlock(source: string, declaration: string): string {
  const start: number = source.indexOf(declaration);

  if (start === -1) {
    throw new Error(`Declaration not found: ${declaration}`);
  }

  const end: number = source.indexOf("\n};", start);

  if (end === -1) {
    throw new Error(`Unterminated object literal for: ${declaration}`);
  }

  return source.slice(start, end);
}

// The enum members used as computed keys inside one object literal.
function keysIn(block: string): Array<string> {
  const keys: Array<string> = [];
  const pattern: RegExp = /\[RunbookStepType\.([A-Za-z]+)\]:/g;
  let match: RegExpExecArray | null = pattern.exec(block);

  while (match) {
    keys.push(match[1] as string);
    match = pattern.exec(block);
  }

  return keys;
}

describe("Runbook step-type maps", () => {
  test("the enum has the kubectl member the maps must cover", () => {
    expect(STEP_TYPES).toContain(RunbookStepType.Kubectl);
  });

  for (const map of MAPS) {
    test(`${map.file} ${map.declaration.split(":")[0]} has one entry per RunbookStepType`, () => {
      const keys: Array<string> = keysIn(
        cutBlock(readSource(map.file), map.declaration),
      );

      expect([...keys].sort()).toEqual([...STEP_TYPES].sort());
      expect(new Set(keys).size).toBe(keys.length);
    });
  }

  test("the kubectl entries name the tool the way the rest of the product does", () => {
    const executionView: string = readSource("ExecutionView.tsx");
    const steps: string = readSource("Steps.tsx");

    expect(
      cutBlock(
        executionView,
        "const STEP_TYPE_LABEL: Record<RunbookStepType, string> = {",
      ),
    ).toContain('[RunbookStepType.Kubectl]: "kubectl"');

    const meta: string = cutBlock(
      steps,
      "const STEP_TYPE_META: Record<RunbookStepType, StepTypeMeta> = {",
    );
    const kubectlEntry: string = meta.slice(
      meta.indexOf("[RunbookStepType.Kubectl]"),
    );

    expect(kubectlEntry).toContain('shortLabel: "kubectl"');
    expect(kubectlEntry).toContain("icon: IconProp.");
    expect(kubectlEntry).toMatch(/description:\s*\n?\s*"[^"]+"/);
  });

  /*
   * Kubectl steps are composed by OneUptime AI only (RunbookStepType says
   * so): the editor must render one that exists but must not offer it as
   * something to add. Every other type stays offered, so a new authored
   * type cannot be forgotten by the picker.
   */
  test("the step picker offers every step type except Kubectl", () => {
    const picker: string = cutBlock(
      readSource("Steps.tsx"),
      "const ALL_STEP_TYPES: RunbookStepType[] = [",
    );
    const offered: Array<string> = keysInList(picker);

    expect(offered).not.toContain(RunbookStepType.Kubectl);
    expect([...offered].sort()).toEqual(
      STEP_TYPES.filter((type: RunbookStepType): boolean => {
        return type !== RunbookStepType.Kubectl;
      }).sort(),
    );
  });
});

// The enum members listed inside an array literal.
function keysInList(block: string): Array<string> {
  const keys: Array<string> = [];
  const pattern: RegExp = /RunbookStepType\.([A-Za-z]+),/g;
  let match: RegExpExecArray | null = pattern.exec(block);

  while (match) {
    keys.push(match[1] as string);
    match = pattern.exec(block);
  }

  return keys;
}
