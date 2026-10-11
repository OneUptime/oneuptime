import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What happens to a {{placeholder}} that has no value is the same everywhere
 * a template is filled in: VMUtil.replaceValueInPlace (incident and alert
 * templates, workflow arguments) and SubscriberNotificationTemplateCompiler
 * (status page subscriber templates) leave it as written, braces and all, so
 * a mistyped name shows instead of silently vanishing.
 *
 * The template variables dialog under a monitor criteria said the opposite -
 * "Missing values render as empty strings — they will not break the
 * template." - and so did the Zabbix guide and a comment the subscriber
 * workers are held to. This guard refuses that claim in English wherever a
 * reader or a developer meets it: the Dashboard's strings, the shared UI and
 * server code, and the English docs.
 *
 * A placeholder that IS filled with empty text (an always-defined variable
 * such as {{seriesResourceSuffix}} on an ungrouped monitor, or a subscriber
 * template's custom field the incident holds no value for) renders as
 * nothing, and saying that stays fine: the claim refused here is about a
 * value that is missing.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../..");

const CLAIMS: Array<RegExp> = [
  /missing (values?|fields?|variables?|placeholders?|references?)[^.\n]{0,40}\b(render|renders|rendered|resolve|resolves|resolved|become|becomes)\b[^.\n]{0,20}\bempty\b/i,
  /\b(will not|won't|does not|doesn't|cannot|can't) break (the|your|a) template/i,
  /\b(placeholders?|variables?|references?)\b[^.\n]{0,40}\b(render|renders|rendered|resolve|resolves|resolved|replaced)\b (as|to|with|by) (an )?empty (string|text|value)/i,
  /\b(unresolved|missing) (placeholders?|variables?|references?|values?)\b[^.\n]{0,30}\b(blank|blanked|empty)\b/i,
];

const SCANNED_ROOTS: Array<string> = [
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/App/FeatureSet",
];

const ENGLISH_DOCS: string = "packages/App/FeatureSet/Docs/Content/en";
const DOCS_CONTENT: string = "packages/App/FeatureSet/Docs/Content";
const DASHBOARD_LOCALES: string = "packages/App/FeatureSet/Dashboard/src/Locales";

function isScannedFile(relative: string, name: string): boolean {
  if (name.includes(".test.") || name.endsWith(".d.ts")) {
    return false;
  }

  // Translations are the docs session's; the English page is held here.
  if (
    relative.startsWith(`${DOCS_CONTENT}/`) &&
    !relative.startsWith(`${ENGLISH_DOCS}/`)
  ) {
    return false;
  }

  // Each English string is a key of en.json, read below.
  if (relative.startsWith(`${DASHBOARD_LOCALES}/`)) {
    return false;
  }

  return (
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".md") ||
    name.endsWith(".ejs")
  );
}

function scannedFiles(): Array<string> {
  const files: Array<string> = [];
  const pending: Array<string> = SCANNED_ROOTS.map((root: string): string => {
    return path.join(REPO_ROOT, root);
  });

  while (pending.length > 0) {
    const directory: string = pending.pop()!;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!["node_modules", "build", "dist", "Tests"].includes(entry.name)) {
          pending.push(absolute);
        }
        continue;
      }

      const relative: string = path.relative(REPO_ROOT, absolute);

      if (isScannedFile(relative, entry.name)) {
        files.push(relative);
      }
    }
  }

  return files;
}

function claimsIn(text: string): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return CLAIMS.some((claim: RegExp): boolean => {
      return claim.test(line);
    });
  });
}

describe("no template help says a missing value renders empty", () => {
  const files: Array<string> = scannedFiles();

  test("the scan reads the places that made the claim, and their neighbours", () => {
    for (const file of [
      "packages/Common/UI/Components/MonitorTemplateVariables/TemplateVariablesModal.tsx",
      "packages/Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog.ts",
      "packages/Common/Types/StatusPage/SubscriberNotificationTemplateVariables.ts",
      "packages/Common/Server/Utils/VM/VMAPI.ts",
      `${ENGLISH_DOCS}/integrations/zabbix.md`,
      `${ENGLISH_DOCS}/monitor/incident-alert-templating.md`,
      `${ENGLISH_DOCS}/workflows/variables.md`,
    ]) {
      expect(files).toContain(file);
    }

    expect(
      files.some((file: string): boolean => {
        return file.startsWith(`${DOCS_CONTENT}/de/`);
      }),
    ).toBe(false);
  });

  test("recognises the claim in the words it was made in", () => {
    for (const claim of [
      "Missing values render as empty strings — they will not break the template.",
      "- A missing field resolves to an empty string rather than an error.",
      " * placeholder renders as an empty string. The worker tests hold each worker to",
      "An unresolved reference is blanked.",
    ]) {
      expect({ claim, found: claimsIn(claim).length }).toEqual({
        claim,
        found: 1,
      });
    }
  });

  test("leaves alone what is true", () => {
    for (const statement of [
      "A variable with no value is left as written, so a mistyped name shows in the text.",
      "A reference that doesn't resolve is left as-is, not blanked.",
      "A path that does not resolve is printed verbatim, braces and all, rather than left blank.",
      "Resolves to an empty string on a monitor with no Group By, so these are safe to use in any title or description.",
      "A field the incident holds no value for is an empty string, never a placeholder left as written.",
      "A value the check reported as empty text is replaced by nothing.",
    ]) {
      expect({ statement, found: claimsIn(statement) }).toEqual({
        statement,
        found: [],
      });
    }
  });

  test("no file says it", () => {
    const found: Array<string> = files.flatMap((file: string) => {
      return claimsIn(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")).map(
        (line: string): string => {
          return `${file}: ${line.trim()}`;
        },
      );
    });

    expect(found).toEqual([]);
  });

  test("no Dashboard string says it", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, DASHBOARD_LOCALES, "en.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(
      Object.keys(english).filter((key: string): boolean => {
        return claimsIn(key).length > 0;
      }),
    ).toEqual([]);
  });
});
