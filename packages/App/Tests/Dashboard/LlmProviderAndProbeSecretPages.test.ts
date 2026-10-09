import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the LLM provider and probe pages ask for, and show, by who may read
 * the secrets on them.
 *
 * An LLM provider's API key and Additional Parameters, and a probe's key,
 * are read by the project's owners and admins alone. The API refuses a whole
 * request that selects one column its caller may not read, so these pages
 * ask for those columns only of the people who may read them (the tables
 * and forms they use leave out what the viewer may not read), and show the
 * other members what they may know instead: whether parameters are saved.
 *
 * The App suite runs in a plain Node environment with no renderer, so these
 * read the sources and assert the expressions, the way
 * MonitorProbeSelectionPages.test.ts does. Sources are whitespace-squashed
 * first so prettier re-wrapping a line cannot hide a regression.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

const CREDENTIALS_WARNING: string =
  "Everyone who can see this project's settings can read it, so never put a key, a token or a password in it: use the API Key.";

describe("Settings → AI → LLM Providers", () => {
  const source: string = readSource("Pages", "Settings", "LlmProviders.tsx");

  test("the providers table does not ask for the API key", () => {
    expect(source).not.toContain(squash("selectMoreFields={{ apiKey: true"));
    expect(source).not.toMatch(/selectMoreFields=\{\{[^}]*apiKey/);
  });

  test("the Base URL help says not to put credentials in it", () => {
    expect(source).toContain(CREDENTIALS_WARNING);
  });
});

describe("an LLM provider's page", () => {
  const source: string = readSource("Pages", "Settings", "LlmProviderView.tsx");

  test("decides by the rule every select follows whether the parameters may be read", () => {
    expect(source).toContain(
      squash(
        'PermissionGate.canReadColumn( new LlmProvider(), "additionalParams", )',
      ),
    );
  });

  test("shows the parameters to those who may read them", () => {
    expect(source).toContain(
      squash(
        'canReadAdditionalParams ? { field: { additionalParams: true, }, title: "Additional Parameters", fieldType: FieldType.JSON,',
      ),
    );
  });

  test("shows everyone else whether any are saved, and who can see them", () => {
    expect(source).toContain(squash("field: { hasAdditionalParams: true, },"));
    expect(source).toContain(
      '"Only project owners and admins can read them, like the API key."',
    );
    expect(source).toContain(
      squash(
        'item.hasAdditionalParams ? translator.translateText("Saved") : translator.translateText("None")',
      ),
    );
  });

  test("the Base URL help in the edit form says not to put credentials in it", () => {
    expect(source).toContain(CREDENTIALS_WARNING);
  });
});

describe("Monitors → Settings → Probes", () => {
  const source: string = readSource(
    "Pages",
    "Monitor",
    "Settings",
    "MonitorProbes.tsx",
  );

  test("decides by the rule every select follows whether a probe's key may be read", () => {
    expect(source).toContain(
      squash('PermissionGate.canReadColumn( new Probe(), "key", )'),
    );
  });

  test("offers the action that shows a probe's key only to those who may read it", () => {
    expect(source).toContain(
      squash('actionButtons={ canReadProbeKey ? [ { title: "Show ID and Key",'),
    );
    expect(source).toContain(squash("] : [] }"));
  });
});
