import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ISSUE #3548 — a monitor template's custom fields are the DEFAULTS the
 * monitors made from it are born with.
 *
 * The server half of that is covered by unit tests
 * (MonitorTemplateServiceCustomFieldSync, MonitorTemplateCustomFieldUtil). What
 * those cannot see is the dashboard, and the dashboard is where the feature is
 * easiest to lose silently:
 *
 *   - the template read on the monitor CREATE page has an explicit `select`.
 *     Drop `customFields` from it and the page still renders, still creates
 *     monitors, and quietly stops carrying the defaults — the create form has
 *     no custom field input to make the loss visible;
 *   - `customFields` is not a form field, so it is not submitted with the rest
 *     of the form. It reaches the new monitor only through `onBeforeCreate`;
 *   - the template view's sync button must scope its push BY NAME. An
 *     unscoped sync deliberately leaves custom fields alone (see
 *     DEFAULT_SYNCABLE_FIELDS in MonitorTemplateService), so a call that
 *     forgets `fields` would silently do nothing at all.
 *
 * Both files are React pages with no extractable logic and the App suite runs
 * in a plain Node environment with no renderer, so this reads the source the
 * same way the sibling MonitorTemplateSyncTenantHeader test does.
 */

const DASHBOARD_PAGES: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Monitor",
);

const MONITOR_CREATE: string = path.join(DASHBOARD_PAGES, "Create.tsx");
const MONITOR_TEMPLATES_VIEW: string = path.join(
  DASHBOARD_PAGES,
  "Settings",
  "MonitorTemplatesView.tsx",
);

/*
 * Comments are stripped so the prose above a call (which names both
 * `customFields` and the endpoint) cannot satisfy an assertion about the code,
 * and whitespace is squashed so prettier re-wrapping a call cannot turn a real
 * regression check into a red herring.
 */
function readCode(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

/*
 * The argument object of every call to `name(`, as source text. Brace-matched
 * rather than regex-matched so a nested object does not truncate the capture.
 */
function getCallArguments(code: string, name: string): Array<string> {
  const calls: Array<string> = [];
  const marker: RegExp = new RegExp(
    `(?<![A-Za-z])${name}(?:<[^>]*>)?\\(\\s*\\{`,
    "g",
  );

  let match: RegExpExecArray | null = marker.exec(code);

  while (match !== null) {
    const openIndex: number = code.indexOf("{", match.index);
    let depth: number = 0;
    let end: number = -1;

    for (let i: number = openIndex; i < code.length; i++) {
      if (code[i] === "{") {
        depth++;
      } else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) {
      break;
    }

    calls.push(code.substring(openIndex, end + 1));
    marker.lastIndex = end;
    match = marker.exec(code);
  }

  return calls;
}

describe("Monitor template custom field defaults reach the monitor create page", () => {
  const code: string = readCode(MONITOR_CREATE);

  test("the template read selects customFields", () => {
    const templateReads: Array<string> = getCallArguments(
      code,
      "ModelAPI.getItem",
    ).filter((call: string): boolean => {
      return call.includes("modelType: MonitorTemplate");
    });

    expect(templateReads).toHaveLength(1);
    expect(templateReads[0]).toContain("customFields: true");
  });

  /*
   * ModelForm submits only the keys of its declared form fields, so a value
   * merely seeded into initialValues is dropped. onBeforeCreate is the one
   * hook that reaches the model actually sent to the API.
   */
  test("the defaults are applied in onBeforeCreate, not left to the form", () => {
    expect(code).toMatch(
      /onBeforeCreate=\{async \(item: Monitor\)[\s\S]*?item\.customFields =/,
    );
    expect(code).toContain("MonitorTemplateCustomFieldUtil.clone(");
  });
});

describe("The monitor template view syncs custom fields by name", () => {
  const code: string = readCode(MONITOR_TEMPLATES_VIEW);

  const syncCalls: Array<string> = getCallArguments(code, "API.post").filter(
    (call: string): boolean => {
      return call.includes("sync-to-linked-monitors");
    },
  );

  test("every sync from this page scopes itself to named fields", () => {
    expect(syncCalls.length).toBeGreaterThan(0);

    for (const call of syncCalls) {
      expect(call).toMatch(/data: \{ fields: \[/);
    }
  });

  test("one of them pushes exactly customFields", () => {
    const customFieldSyncs: Array<string> = syncCalls.filter(
      (call: string): boolean => {
        return call.includes('fields: ["customFields"]');
      },
    );

    expect(customFieldSyncs).toHaveLength(1);
  });

  /*
   * The card is what makes the defaults settable at all — the column has
   * existed on MonitorTemplate since the model was written and was reachable
   * from nothing, which is the whole of issue #3548. It has to point at the
   * Monitor custom field schema (not the template's own, which does not
   * exist), or the operator is offered the wrong list of fields.
   */
  test("the Custom Field Defaults card edits MonitorTemplate against the Monitor schema", () => {
    expect(code).toContain("<CustomFieldsDetail");
    expect(code).toContain("modelType={MonitorTemplate}");
    expect(code).toContain("customFieldType={MonitorCustomField}");
  });
});
