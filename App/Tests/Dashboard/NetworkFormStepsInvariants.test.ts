import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The Network Device and Network Site forms are multi-step wizards: the page
 * declares its steps in `formSteps={[...]}` and every form field names the
 * step it belongs on with `stepId`. BasicForm renders a field on a step only
 * when the two match, and both ways of getting that wrong fail SILENTLY —
 * nothing throws, nothing warns, the form just renders wrong:
 *
 *   - A field with NO stepId matches every step, so it renders on ALL of
 *     them. The operator sees "Name" repeated on "Device Details", on
 *     "Probe & Site" and again on "SNMP Credentials", editing what looks like
 *     three inputs but is one value.
 *
 *   - A field whose stepId matches no declared step renders on NONE of them.
 *     The input disappears from the wizard entirely — the value can never be
 *     entered, and on an edit form it can never be corrected. A one-character
 *     typo ("snmp-credentials" for a step declared as "snmp"), or deleting a
 *     step from formSteps while leaving its fields behind, is enough.
 *
 * The second failure is the dangerous one, because the form still submits: a
 * required field that renders nowhere blocks the save with no visible reason,
 * and an optional one silently keeps its old value forever.
 *
 * There is no renderer in the App suite (testEnvironment is plain node), and
 * these pages are JSX with no extractable logic, so this reads the sources and
 * checks the two sets against each other — the same fs/path approach
 * SnmpConfigFormFields.test.ts uses to pin that every SNMP form routes through
 * the shared field helper.
 *
 * The check is deliberately per-FILE, not per-form: a page can render more
 * than one stepped form (Device Settings has two — device details/SNMP, and
 * polling/health OIDs), and matching a field back to the specific form it sits
 * in would need a real parser. The union of a file's declared step ids
 * compared against the union of its used ones catches every typo and every
 * orphan while staying regex-simple.
 *
 * That leaves one hole a regex cannot close: a single field that declares no
 * stepId at all while its siblings do. Finding it needs field-object
 * boundaries, which means parsing JSX. The shared helpers cover the bulk of
 * that risk from the other side — SnmpConfigFormFields.test.ts and
 * DevicePollingFormFields.test.ts assert that EVERY field a helper returns
 * carries the step it was handed.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Every Network form that is stepped. Paths are relative to the Dashboard's
 * `src/` and use "/" regardless of platform — they are split before joining.
 *
 * Components as well as Pages: the topology map's "Add to Monitoring" dialog
 * (issue #3435) is a stepped NetworkDevice create form that happens not to
 * live on a page of its own, and it is exposed to both failures below in
 * exactly the same way.
 */
const STEPPED_FORM_PAGES: Array<string> = [
  "Pages/NetworkDevice/Devices.tsx",
  "Pages/NetworkDevice/Discovery.tsx",
  "Pages/NetworkDevice/View/Settings.tsx",
  "Pages/NetworkSite/Sites.tsx",
  "Pages/NetworkSite/View/Settings.tsx",
  "Pages/NetworkSite/View/Index.tsx",
  "Pages/NetworkSite/View/ChildSites.tsx",
  "Components/Topology/AddNeighborToMonitoringModal.tsx",
];

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readPage(page: string): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...page.split("/")), "utf8"),
  );
}

function matchAll(pattern: RegExp, text: string): Array<string> {
  const values: Array<string> = [];
  // Cloned so a shared /g regex cannot carry lastIndex between calls.
  const scanner: RegExp = new RegExp(pattern.source, "g");

  let match: RegExpExecArray | null = scanner.exec(text);

  while (match !== null) {
    values.push(match[1]!);
    match = scanner.exec(text);
  }

  return values;
}

/*
 * The bodies of every step list on the page.
 *
 * Three spellings. The two hosts of a stepped form name the prop differently
 * — ModelTable takes `formSteps={[ ... ]}` and ModelFormModal takes
 * `steps: [ ... ]` inside its formProps — and a page that renders the same
 * steps twice hoists them into a module-level
 * `const X: Array<FormStep<Model>> = [ ... ];` and passes that instead, which
 * is the shape Discovery.tsx uses to keep its create wizard and its edit
 * dialog describing one set of groups. All three hold only string literals
 * and predicate names, so the first terminator after the opening always
 * closes the list.
 */
function formStepBlocks(source: string): Array<string> {
  return [
    ...matchAll(/formSteps=\{\[(.*?)\]\}/, source),
    ...matchAll(/\bsteps:\s*\[(.*?)\],\s*fields:/, source),
    ...matchAll(/\bArray<FormStep<[^>]*>> = \[(.*?)\];/, source),
  ];
}

// `id: "..."` inside a formSteps block — the steps the wizard actually has.
function declaredStepIds(source: string): Array<string> {
  const ids: Array<string> = [];

  for (const block of formStepBlocks(source)) {
    ids.push(...matchAll(/\bid:\s*"([^"]+)"/, block));
  }

  return ids;
}

/*
 * `stepId: "..."` anywhere on the page — both the literal fields declare and
 * the value passed into a shared helper, e.g.
 * `...getSnmpConfigFormFields({ stepId: "snmp" })`.
 */
function usedStepIds(source: string): Array<string> {
  return matchAll(/\bstepId:\s*"([^"]+)"/, source);
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set(values)).sort();
}

describe.each(STEPPED_FORM_PAGES)("%s form steps", (page: string) => {
  const source: string = readPage(page);

  test("renders its form as a wizard", () => {
    expect(formStepBlocks(source).length).toBeGreaterThan(0);
  });

  /*
   * Also proves the regexes above actually matched something — every
   * assertion below would pass vacuously against an empty parse.
   */
  test("declares at least two steps in every formSteps block", () => {
    const blocks: Array<string> = formStepBlocks(source);

    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      expect(
        matchAll(/\bid:\s*"([^"]+)"/, block).length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // An orphan step: declared, walked through, and empty of fields.
  test("every declared step is claimed by at least one field", () => {
    const used: Array<string> = usedStepIds(source);

    expect(used.length).toBeGreaterThan(0);

    const unclaimed: Array<string> = unique(declaredStepIds(source)).filter(
      (id: string) => {
        return !used.includes(id);
      },
    );

    expect(unclaimed).toEqual([]);
  });

  // A stray stepId: the field names a step that does not exist, so it renders nowhere.
  test("every stepId used names a declared step", () => {
    const declared: Array<string> = declaredStepIds(source);

    expect(declared.length).toBeGreaterThan(0);

    const undeclared: Array<string> = unique(usedStepIds(source)).filter(
      (id: string) => {
        return !declared.includes(id);
      },
    );

    expect(undeclared).toEqual([]);
  });
});
