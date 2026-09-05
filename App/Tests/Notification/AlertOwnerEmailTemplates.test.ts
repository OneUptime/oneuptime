import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * exercises the helpers the product ships rather than reimplementations of
 * them. The module also kicks off an async partial load that resolves its
 * directory from process.cwd() and swallows its own failure, so importing it
 * from a test is safe; the partials are registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * The alert emails a customer actually received, and the three rendering
 * defects visible in them.
 *
 * A single Kubernetes monitor created from a OneUptime recommendation sent
 * 39 emails in under two hours. Reading one of them:
 *
 *   Headline:            "Alert ALT-113"
 *   ALERT TITLE:         "[K8s] Pod CPU Saturating Container Limit (>90%) -
 *                         oneuptime-test - Pod CPU Saturating Container Limit"
 *   RESOURCES AFFECTED:  "oneuptime-test - Pod CPU Saturating Container Limit"
 *
 * 1. The headline lost the title. `AlertOwnerResourceCreated.hbs` asks for
 *    `(concat "Alert " alertNumber ": " alertTitle)`, but the `concat`
 *    helper took exactly two arguments and dropped the rest.
 * 2. "Resources Affected" was the MONITOR's name, not the pod that broke —
 *    see AlertOwnerEmailResourcesAffected.test.ts.
 * 3. `Header.hbs` carried quoted-printable escapes (`charset=3Dutf-8`,
 *    `width=3Ddevice-width`) that broke the charset declaration and the
 *    mobile viewport in EVERY email the product sends.
 */

const NOTIFICATION_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
);

const TEMPLATES_DIR: string = Path.resolve(NOTIFICATION_DIR, "Templates");

const HANDLEBARS_UTIL_PATH: string = Path.resolve(
  NOTIFICATION_DIR,
  "Utils",
  "Handlebars.ts",
);

const ALERT_NUMBER: string = "ALT-113";
const ALERT_TITLE: string =
  "[K8s] Pod CPU Saturating Container Limit (>90%) - oneuptime-test";

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function render(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(templateSource(name))(vars);
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("the concat helper", () => {
  test("the production module is what registered it", () => {
    /*
     * Guards the import above: if Handlebars.ts stops registering `concat`,
     * every rendering assertion in this file would silently start passing
     * against Handlebars' own missing-helper behaviour instead of failing.
     */
    expect(
      fs.readFileSync(HANDLEBARS_UTIL_PATH, { encoding: "utf8" }),
    ).toContain('registerHelper("concat"');
  });

  test("joins more than two arguments", () => {
    const template: HandlebarsTemplateDelegate = Handlebars.compile(
      '{{concat "Alert " alertNumber ": " alertTitle}}',
    );

    expect(
      template({ alertNumber: ALERT_NUMBER, alertTitle: ALERT_TITLE }),
    ).toBe(
      `Alert ${ALERT_NUMBER}: ${Handlebars.escapeExpression(ALERT_TITLE)}`,
    );
  });

  test("still joins exactly two", () => {
    expect(Handlebars.compile('{{concat "a" "b"}}')({})).toBe("ab");
  });

  test("does not leak Handlebars' own options object into the output", () => {
    const output: string = Handlebars.compile('{{concat "a" "b" "c"}}')({});

    expect(output).toBe("abc");
    expect(output).not.toContain("object Object");
  });

  test("renders a missing variable as empty rather than 'undefined'", () => {
    expect(Handlebars.compile('{{concat "Alert " missing "!"}}')({})).toBe(
      "Alert !",
    );
  });

  test("stringifies non-string arguments", () => {
    expect(Handlebars.compile("{{concat n1 n2}}")({ n1: 1, n2: 2 })).toBe("12");
  });
});

describe("AlertOwnerResourceCreated.hbs", () => {
  const VARS: Record<string, unknown> = {
    alertTitle: ALERT_TITLE,
    alertNumber: ALERT_NUMBER,
    projectName: "OneUptime Kubernetes Test Cluster",
    currentState: "Identified",
    resourcesAffected: "Pod: kubernetes-agent-logs-7t88f | Namespace: default",
    declaredBy: "OneUptime",
    declaredAt: "Sep 05 2026, 10:55 AM BST",
    alertSeverity: "Warning",
    rootCause:
      "Any value of Pod CPU vs Limit (%) is 91.53 % which is greater than 90 %.",
    alertDescription: "A pod's CPU usage has exceeded 90% of its limit.",
    remediationNotes: "",
    alertViewLink: "https://oneuptime.test/dashboard/alerts/1",
  };

  test("the headline carries the alert title, not just the number", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    /*
     * `{{title}}` escapes, as it should — the alert title is user-supplied
     * and reaches the email as HTML. Compare against the escaped form
     * rather than loosening the template.
     */
    expect(html).toContain(
      `Alert ${ALERT_NUMBER}: ${Handlebars.escapeExpression(ALERT_TITLE)}`,
    );
  });

  test("the headline is not the bare identifier customers received", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    /*
     * Pins the specific regression: the rendered headline used to be
     * "Alert ALT-113" and then the closing tag, with the title dropped by
     * the two-argument `concat`.
     */
    expect(html).not.toContain(`>Alert ${ALERT_NUMBER}</h2>`);
    expect(html).toMatch(new RegExp(`>Alert ${ALERT_NUMBER}: .+</h2>`, "u"));
  });

  test("the affected resource reaches the body", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).toContain("kubernetes-agent-logs-7t88f");
  });

  test("the root cause reaches the body", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).toContain("91.53");
  });

  test("an empty remediationNotes does not render an empty labelled row", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).not.toContain("Remediation Notes:");
  });

  test("remediationNotes renders when present", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", {
      ...VARS,
      remediationNotes: "Raise the CPU limit.",
    });

    expect(html).toContain("Remediation Notes:");
    expect(html).toContain("Raise the CPU limit.");
  });
});

describe("Header.hbs", () => {
  const source: string = fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "Partials", "Header.hbs"),
    { encoding: "utf8" },
  );

  test("declares utf-8, not the quoted-printable-mangled '3Dutf-8'", () => {
    expect(source).toContain("charset=utf-8");
    expect(source).not.toContain("charset=3Dutf-8");
  });

  test("declares a mobile viewport, not '3Ddevice-width'", () => {
    expect(source).toContain("width=device-width");
    expect(source).not.toContain("width=3Ddevice-width");
  });

  test("no quoted-printable escape survives anywhere in the email templates", () => {
    const offenders: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = Path.resolve(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        if (!entry.name.endsWith(".hbs")) {
          continue;
        }

        /*
         * `=3D` is the quoted-printable encoding of "=". Its presence in
         * source means content was pasted out of a raw email body without
         * being decoded, and it silently corrupts the attribute it lands in.
         */
        if (/=3D/u.test(fs.readFileSync(full, { encoding: "utf8" }))) {
          offenders.push(Path.relative(TEMPLATES_DIR, full));
        }
      }
    };

    walk(TEMPLATES_DIR);

    expect(offenders).toEqual([]);
  });
});
