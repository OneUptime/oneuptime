import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Default Monitor Name" on a Monitor Template is optional (issue #3486).
 *
 * The dashboard half of that change lives entirely inside declarative form
 * definitions in two page components, and the App suite runs in a plain Node
 * environment with no renderer - so these are source invariants, in the same
 * style as the sibling MonitorTemplateSyncTenantHeader / MonitorCreateLabels
 * tests.
 *
 * Three things are pinned, and each one on its own can put the wall back:
 *
 *   - `required: false` on BOTH forms. The create wizard and the "Monitor
 *     Defaults" edit card declare the field separately; a nullable column
 *     behind a `required: true` form field is still a field nobody can leave
 *     blank.
 *   - No `minLength`. Validation.validateLength short-circuits on an empty
 *     value, so `minLength: 2` beside `required: false` is not a crash - it is
 *     worse: it accepts NO name while rejecting a one-character one, and trips
 *     on a stray space in a field labelled optional.
 *   - A readable stand-in for the criteria editor. That editor interpolates
 *     this name into seeded criteria and incident titles ("Check if <name> is
 *     online") and PERSISTS them into the template's monitorSteps, where every
 *     monitor created from the template inherits them. An empty string would
 *     bake "Check if  is online" in permanently, so the template's own name
 *     stands in.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MONITOR_TEMPLATES: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Monitor",
  "Settings",
  "MonitorTemplates.tsx",
);

const MONITOR_TEMPLATES_VIEW: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Monitor",
  "Settings",
  "MonitorTemplatesView.tsx",
);

const MONITOR_CREATE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Monitor",
  "Create.tsx",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const BLANK_NAME_DESCRIPTION: string =
  "Default name applied to monitors created from this template. Leave it blank to name each monitor after the resource it watches.";

/*
 * Comments are stripped so the prose above a field cannot satisfy an
 * assertion about the field, and whitespace is squashed so prettier
 * re-wrapping a long description cannot turn a real regression check into a
 * formatting failure.
 */
function readCode(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/*
 * Every field definition object in the file that binds `monitorName`, as
 * source text. Brace-matched outwards from the binding rather than sliced to
 * the next field, so a negative assertion ("no minLength here") cannot pass
 * or fail on a neighbouring field's validation block.
 */
function monitorNameFieldObjects(code: string): Array<string> {
  const binding: string = squash("field: { monitorName: true, },");
  const objects: Array<string> = [];

  let bindingIndex: number = code.indexOf(binding);

  while (bindingIndex >= 0) {
    let openIndex: number = -1;

    for (let i: number = bindingIndex - 1; i >= 0; i--) {
      if (code[i] === "{") {
        openIndex = i;
        break;
      }

      if (code[i] !== " ") {
        throw new Error(
          `Unexpected text before a monitorName binding: ${code.slice(i - 40, bindingIndex)}`,
        );
      }
    }

    if (openIndex === -1) {
      throw new Error("A monitorName binding has no enclosing object.");
    }

    let depth: number = 0;
    let closeIndex: number = -1;

    for (let i: number = openIndex; i < code.length; i++) {
      if (code[i] === "{") {
        depth++;
      } else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }

    if (closeIndex === -1) {
      throw new Error("Unbalanced braces around a monitorName field.");
    }

    objects.push(code.slice(openIndex, closeIndex + 1));
    bindingIndex = code.indexOf(binding, bindingIndex + binding.length);
  }

  return objects;
}

function formFieldObjects(file: string): Array<string> {
  return monitorNameFieldObjects(readCode(file)).filter((object: string) => {
    return object.includes("FormFieldSchemaType.Text");
  });
}

describe("Monitor Template default monitor name is optional", () => {
  test("the create wizard declares exactly one editable monitorName field", () => {
    expect(formFieldObjects(MONITOR_TEMPLATES)).toHaveLength(1);
  });

  test("the Monitor Defaults card declares exactly one editable monitorName field", () => {
    expect(formFieldObjects(MONITOR_TEMPLATES_VIEW)).toHaveLength(1);
  });

  test.each([
    ["the create wizard", MONITOR_TEMPLATES],
    ["the Monitor Defaults card", MONITOR_TEMPLATES_VIEW],
  ])(
    "%s does not require a default monitor name",
    (_label: string, file: string) => {
      const [field]: Array<string> = formFieldObjects(file);

      expect(field).toContain("required: false");
      expect(field).not.toContain("required: true");
    },
  );

  /*
   * `minLength: 2` is skipped for an empty value but NOT for a whitespace-only
   * one, so leaving it in place makes an optional field reject a stray space
   * with "cannot be less than 2 characters" - and reject a legitimate
   * one-character name while accepting no name at all.
   */
  test.each([
    ["the create wizard", MONITOR_TEMPLATES],
    ["the Monitor Defaults card", MONITOR_TEMPLATES_VIEW],
  ])(
    "%s does not impose a minimum length on an optional field",
    (_label: string, file: string) => {
      const [field]: Array<string> = formFieldObjects(file);

      expect(field).not.toContain("minLength");
      expect(field).not.toContain("validation");
    },
  );

  test.each([
    ["the create wizard", MONITOR_TEMPLATES],
    ["the Monitor Defaults card", MONITOR_TEMPLATES_VIEW],
  ])(
    "%s tells the operator what leaving it blank does",
    (_label: string, file: string) => {
      const [field]: Array<string> = formFieldObjects(file);

      expect(field).toContain(BLANK_NAME_DESCRIPTION);
    },
  );

  /*
   * The detail card renders the stored value. Without a placeholder an unset
   * name is a labelled blank, which reads as a failed load rather than as the
   * deliberate "name monitors after the resource" choice.
   */
  test("the read-only detail field shows a placeholder instead of a blank", () => {
    const readOnlyFields: Array<string> = monitorNameFieldObjects(
      readCode(MONITOR_TEMPLATES_VIEW),
    ).filter((object: string) => {
      return object.includes("FieldType.Text");
    });

    expect(readOnlyFields).toHaveLength(1);
    expect(readOnlyFields[0]).toContain(
      'placeholder: "Named after the resource"',
    );
  });
});

describe("Monitor Template criteria seeding survives a blank default name", () => {
  test("the create wizard falls back to the template's own name", () => {
    const code: string = readCode(MONITOR_TEMPLATES);

    expect(code).toContain(
      squash(`
        monitorName={
          value.monitorName?.trim() ||
          value.templateName?.trim() ||
          ""
        }
      `),
    );
  });

  test("the view page seeds criteria from a name that falls back to the template's", () => {
    const code: string = readCode(MONITOR_TEMPLATES_VIEW);

    expect(code).toContain(
      squash(
        "const criteriaSeedMonitorName: string = templateMonitorName || templateName;",
      ),
    );
    expect(code).toContain("monitorName={criteriaSeedMonitorName}");
    expect(code).not.toContain("monitorName={templateMonitorName}");
  });

  /*
   * The fallback is only as good as the state behind it, so the page has to
   * read the template's own name, and has to stop caching a default monitor
   * name the operator has since cleared.
   */
  test("the view page loads the template name alongside the monitor name", () => {
    const code: string = readCode(MONITOR_TEMPLATES_VIEW);

    expect(code).toContain(
      squash(`
        select: {
          monitorType: true,
          monitorName: true,
          templateName: true,
        },
      `),
    );
    expect(code).toContain(
      squash('setTemplateName(item?.templateName?.trim() || "");'),
    );
  });

  test("clearing the default monitor name clears the cached seed", () => {
    const code: string = readCode(MONITOR_TEMPLATES_VIEW);

    expect(code).toContain(
      squash('setTemplateMonitorName(item.monitorName?.trim() || "");'),
    );
    // The truthiness guard this replaced stranded the previous name in state.
    expect(code).not.toContain(
      squash(
        "if (item.monitorName) { setTemplateMonitorName(item.monitorName); }",
      ),
    );
  });
});

/*
 * The template's default name is the monitor create form's PREFILL, not its
 * value. Monitor.name is itself required and NOT NULL, so a template with no
 * default name has to leave the operator typing one rather than submitting a
 * nameless monitor.
 */
describe("Creating a monitor from a template still needs a name", () => {
  test("the monitor create form keeps Name required", () => {
    const code: string = readCode(MONITOR_CREATE);

    expect(code).toContain(
      squash(`
        field: {
          name: true,
        },
        title: "Name",
        stepId: "monitor-info",
        fieldType: FormFieldSchemaType.Text,
        required: true,
      `),
    );
  });
});

/*
 * Every user-facing string is looked up in the active locale by its English
 * text. A string that is not a key renders in English for the other fifteen
 * languages, and the parity check in CI cannot catch that - it only compares
 * the locale files to each other, never to the source.
 */
describe("the new copy is translatable", () => {
  const LOCALES: Array<string> = [
    "en",
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
  ];

  test.each([BLANK_NAME_DESCRIPTION, "Named after the resource"])(
    "%s is a key in every Dashboard locale",
    (englishText: string) => {
      for (const locale of LOCALES) {
        const messages: Record<string, unknown> = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
        );

        expect({
          locale: locale,
          hasKey: typeof messages[englishText] === "string",
        }).toEqual({ locale: locale, hasKey: true });
      }
    },
  );
});
