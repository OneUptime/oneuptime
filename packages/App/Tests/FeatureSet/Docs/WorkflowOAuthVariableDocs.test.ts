import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Create OAuth 2.0 Variable now walks Variable, Provider, Credentials and
 * Advanced, and its Identity Provider picker fills in the token URL for
 * Microsoft Entra ID, Google, Okta and Auth0. The variables guide walks the
 * same steps and lists the same token URLs. This reads the form's own source
 * and holds the English guide to it, so a provider or a step added to one is
 * not missing from the other.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

const PROVIDERS_SOURCE: string = path.join(
  DASHBOARD_SRC,
  "Utils/Workflow/OAuthIdentityProviders.ts",
);

const VARIABLE_UTIL_SOURCE: string = path.join(
  DASHBOARD_SRC,
  "Utils/Workflow/WorkflowVariableUtil.ts",
);

const GUIDE: string = fs.readFileSync(
  path.join(CONTENT_DIR, "en", "workflows", "variables.md"),
  "utf8",
);

interface PresetInSource {
  label: string;
  tokenUrl: string;
}

const PRESET_PATTERN: RegExp = /label:\s*"([^"]+)",\s*tokenUrl:\s*"([^"]*)"/g;

function presetsInSource(): Array<PresetInSource> {
  const source: string = fs.readFileSync(PROVIDERS_SOURCE, "utf8");

  return Array.from(source.matchAll(PRESET_PATTERN)).map(
    (match: RegExpMatchArray): PresetInSource => {
      return { label: match[1]!, tokenUrl: match[2]! };
    },
  );
}

// The titles of a FormStep list declared in WorkflowVariableUtil.ts.
function stepTitles(constantName: string): Array<string> {
  const source: string = fs.readFileSync(VARIABLE_UTIL_SOURCE, "utf8");
  const start: number = source.indexOf(`export const ${constantName}`);

  expect(start).toBeGreaterThan(-1);

  const end: number = source.indexOf("];", start);
  const declaration: string = source.slice(start, end);

  return Array.from(declaration.matchAll(/title:\s*"([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The guide's section on creating an OAuth 2.0 variable.
function creatingSection(): string {
  const start: number = GUIDE.indexOf("### Creating one");

  expect(start).toBeGreaterThan(-1);

  const end: number = GUIDE.indexOf("\n### ", start + 1);

  return GUIDE.slice(start, end === -1 ? undefined : end);
}

describe("the OAuth 2.0 variables guide", () => {
  test("reads the form's providers from its source", () => {
    expect(
      presetsInSource().map((preset: PresetInSource): string => {
        return preset.label;
      }),
    ).toEqual([
      "Microsoft Entra ID",
      "Google",
      "Okta",
      "Auth0",
      "Other provider",
    ]);
  });

  test("lists every token URL the Identity Provider picker fills in", () => {
    const section: string = creatingSection();

    for (const preset of presetsInSource()) {
      if (!preset.tokenUrl) {
        continue;
      }

      expect(section).toContain(`| ${preset.label} | \`${preset.tokenUrl}\` |`);
    }
  });

  test("says what to do when the provider is not listed", () => {
    expect(creatingSection()).toContain("**Other provider**");
  });

  test("walks the create form's steps, in the form's order", () => {
    const titles: Array<string> = stepTitles("OAUTH_VARIABLE_FORM_STEPS");

    expect(titles).toEqual(["Variable", "Provider", "Credentials", "Advanced"]);

    const section: string = creatingSection();
    const positions: Array<number> = titles.map((title: string): number => {
      return section.indexOf(`. **${title}**`);
    });

    for (const position of positions) {
      expect(position).toBeGreaterThan(-1);
    }

    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);
  });

  test("names the Edit Settings steps the variable page walks", () => {
    for (const title of stepTitles("OAUTH_SETTINGS_FORM_STEPS")) {
      expect(GUIDE).toContain(`**${title}**`);
    }

    expect(GUIDE).toContain(
      "**Edit Settings** walks the same **Provider** (token URL), **Credentials** (client ID) and **Advanced**",
    );
    expect(GUIDE).toContain("**Save Changes** is on every step");
  });

  // Google's OAuth clients have no Client Credentials grant.
  test("says Google picks the Refresh Token grant", () => {
    expect(creatingSection()).toContain(
      "Picking Google selects **Refresh Token**",
    );
  });

  test("says the provider is not saved", () => {
    expect(creatingSection()).toContain(
      "The provider only fills in the form; it isn't saved with the variable.",
    );
  });

  // The old one-step Settings list, with the URL templates in one sentence, is gone.
  test("no longer describes the settings as one list", () => {
    expect(GUIDE).not.toContain("### Settings\n");
  });
});
