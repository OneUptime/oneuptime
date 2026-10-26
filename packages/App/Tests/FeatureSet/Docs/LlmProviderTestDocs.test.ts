import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmProviderTestAccess from "Common/Server/API/LlmProviderTestAccess";
import LLMProviderHTTPException from "Common/Server/Utils/LLM/LLMProviderHTTPException";
import LlmProviderTestFailure from "Common/Server/Utils/LLM/LlmProviderTestFailure";
import LlmType from "Common/Types/LLM/LlmType";
import { PermissionHelper } from "Common/Types/Permission";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { writtenPermissionTitle } from "./DocsRoleNames";
import { boldSpans, strayMarkers } from "./DocsTranslationChecks";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Testing a provider", on the LLM provider guide, in every docs language,
 * against the product.
 *
 * A customer pressed Test on their own provider and was refused: every
 * project member was, since the button shipped. The guide now says who may
 * test a provider - whoever may change it, the provider's update list - and
 * what a test says. This holds every language's paragraph to that: the
 * permissions the server asks (LlmProviderTestAccess, the model's update
 * list) and no others, a built-in role named as that language's Dashboard
 * names it, the Test button and the fields under the names that
 * language's Dashboard draws them (Persian included: the AI pages name the
 * Dashboard as each language's Dashboard draws it), a failure that says what
 * to check before what the provider answered, and markers that close in
 * every script.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const PAGE: string = "ai/llm-provider.md";

// The fields a test sends, as the provider form titles them.
const FIELDS: Array<string> = [
  "API Key",
  "Model Name",
  "Base URL",
  "Additional Parameters",
];

function readPage(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
}

// Who may test a provider: its update list, by title.
const TESTERS: Array<string> = PermissionHelper.getPermissionTitles(
  new LlmProvider().getUpdatePermissions(),
);

/*
 * The paragraph on testing: the one that names the Test button and every
 * tester.
 */
function testingParagraph(language: string): string {
  const test: string = drawnDashboardLabel(language, "Test");

  const found: Array<string> = readPage(language)
    .split("\n")
    .filter((line: string): boolean => {
      const spans: Array<string> = boldSpans(line);

      return (
        spans.includes(test) &&
        TESTERS.every((title: string): boolean => {
          return spans.includes(writtenPermissionTitle(language, title));
        })
      );
    });

  expect({ language, paragraphs: found.length }).toEqual({
    language,
    paragraphs: 1,
  });

  return found[0]!;
}

describe("who may test an LLM provider, as the server asks it", () => {
  test("the testers are the provider's update list", () => {
    expect(TESTERS).toEqual([
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Settings Admin",
      "Settings Member",
      "Edit LLM",
    ]);
    expect(LlmProviderTestAccess.getRefusalMessage()).toBe(
      `You do not have permission to test this LLM provider. You need one of these permissions: ${TESTERS.join(", ")}.`,
    );
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names every tester, and nobody who may only read providers",
    (language: string) => {
      const spans: Array<string> = boldSpans(testingParagraph(language));

      for (const title of TESTERS) {
        const written: string = writtenPermissionTitle(language, title);

        expect({ title, written, named: spans.includes(written) }).toEqual({
          title,
          written,
          named: true,
        });
      }

      for (const reader of PermissionHelper.getPermissionTitles(
        new LlmProvider().getReadPermissions(),
      ).filter((title: string): boolean => {
        return !TESTERS.includes(title);
      })) {
        expect({
          reader,
          named: spans.includes(writtenPermissionTitle(language, reader)),
        }).toEqual({
          reader,
          named: false,
        });
      }
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names the Test button and the fields a test sends as its Dashboard draws them",
    (language: string) => {
      const spans: Array<string> = boldSpans(testingParagraph(language));

      for (const field of FIELDS) {
        const drawn: string = drawnDashboardLabel(language, field);

        expect({ field, drawn, named: spans.includes(drawn) }).toEqual({
          field,
          drawn,
          named: true,
        });
      }
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s closes every marker it opens",
    async (language: string) => {
      expect(await strayMarkers(testingParagraph(language), language)).toEqual(
        [],
      );
    },
  );

  test("the English paragraph sits with who can see a provider, before the provider-specific steps", () => {
    const lines: Array<string> = readPage("en").split("\n");
    const whoCanSee: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("**Who can see a provider.**");
    });
    const testing: number = lines.indexOf(testingParagraph("en"));
    const nextSection: number = lines.indexOf(
      "## Provider-Specific Configuration",
    );

    expect(whoCanSee).toBeGreaterThan(-1);
    expect(testing).toBeGreaterThan(whoCanSee);
    expect(testing).toBeLessThan(nextSection);
  });
});

describe("what the English paragraph says a test does is what it does", () => {
  test("a failed test says what to check first, then what the provider answered", () => {
    expect(testingParagraph("en")).toContain(
      "A failed test says what to check first, then what the provider answered.",
    );

    const said: string = LlmProviderTestFailure.describe(
      new LLMProviderHTTPException({
        message: "OpenAI API error: {}",
        statusCode: 401,
        llmType: LlmType.OpenAI,
        providerMessage: "Incorrect API key provided.",
      }),
      LlmType.OpenAI,
    );

    const check: number = said.indexOf("Check the provider's API Key.");
    const answered: number = said.indexOf(
      "OpenAI answered: Incorrect API key provided.",
    );

    expect(check).toBeGreaterThan(-1);
    expect(answered).toBeGreaterThan(check);
  });

  test("a global provider is tested by a server administrator alone", () => {
    expect(testingParagraph("en")).toContain(
      "A Global LLM Provider is tested by a server administrator, in the Admin Dashboard under **Settings → Global LLM Providers**.",
    );
    expect(LlmProviderTestAccess.GLOBAL_PROVIDER_MESSAGE).toBe(
      "Only server administrators can test a global LLM provider, from the Admin Dashboard.",
    );
  });

  test("Test is on the provider's page and in its row's menu, and on the Admin Dashboard's global providers", () => {
    const sourceOf: (relative: string) => string = (
      relative: string,
    ): string => {
      return fs.readFileSync(path.join(PACKAGES_ROOT, relative), "utf8");
    };

    for (const page of [
      "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView.tsx",
      "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx",
      "App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index.tsx",
    ]) {
      const source: string = sourceOf(page);

      expect({ page, offersTest: source.includes('title: "Test"') }).toEqual({
        page,
        offersTest: true,
      });
      expect({
        page,
        opensTheDialog: source.includes("<TestLlmProviderModal"),
      }).toEqual({ page, opensTheDialog: true });
    }

    // Locked for whoever may not test: the Dashboard asks the server's list.
    for (const page of [
      "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView.tsx",
      "App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders.tsx",
    ]) {
      expect({
        page,
        gated: sourceOf(page).includes("TestLLMProvider.getTestGate()"),
      }).toEqual({ page, gated: true });
    }
  });
});
