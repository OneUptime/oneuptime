import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import IssueAiAnalysisCard from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueAiAnalysisCard";
import {
  ANALYSIS_CARD_TITLE,
  ANALYZE_AGAIN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueAiAnalysisCopy";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import {
  DATA_SECURITY_AI_VERDICT_TITLES,
  DATA_SECURITY_ANALYSIS_PART_TITLES,
  DATA_SECURITY_ANALYSIS_QUESTIONS,
  DataSecurityAiVerdict,
  DataSecurityAnalysisFactKind,
  DataSecurityAnalysisPart,
  DataSecurityIssueAnalysisView,
  DataSecurityRecency,
} from "../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * ONEUPTIME AI'S ANALYSIS ON AN ISSUE'S PAGE, IN EVERY LANGUAGE THE
 * DASHBOARD SPEAKS (#10369). The card's own words - its title, the
 * verdict, the three questions, Analyze Again - are the reader's language,
 * read from the Dashboard's own locale files through the global i18next the
 * Dashboard sets up; OneUptime AI's words stay as it wrote them, in the
 * project's language. Who reads what is DataSecurityIssuePageThroughTheServer
 * .test's, role by role.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

const ISSUE_ID: ObjectID = new ObjectID("10369300-0000-4000-8000-0000000000a1");
const STORE_ID: string = "10369300-0000-4000-8000-0000000000b1";

const REASON: string =
  "Anyone on the internet can read the card numbers in acme-card-exports.";
const RISK: string = "About 12,000 card numbers, to anyone who finds it.";
const BREAKS: string =
  "Blocking public access takes away Everyone's read; nothing seen uses it.";
const PATH: string = "Block public access from this page now.";

const VIEW: DataSecurityIssueAnalysisView = {
  verdict: DataSecurityAiVerdict.Real,
  language: "en",
  analyzedAt: new Date().toISOString(),
  lines: {
    [DataSecurityAnalysisPart.Reason]: { text: REASON, facts: ["S1"] },
    [DataSecurityAnalysisPart.Risk]: { text: RISK, facts: ["S1", "R1"] },
    [DataSecurityAnalysisPart.Breaks]: { text: BREAKS, facts: ["R1"] },
    [DataSecurityAnalysisPart.Path]: { text: PATH, facts: ["R1"] },
  },
  hiddenLines: {},
  facts: [
    {
      id: "S1",
      kind: DataSecurityAnalysisFactKind.StoreHolds,
      recordIds: [STORE_ID],
      dataTypeIds: ["credit-card-number"],
      dataTypeNames: ["Card number"],
      sensitivity: "Restricted",
      records: 12000,
    },
    {
      id: "R1",
      kind: DataSecurityAnalysisFactKind.Grant,
      recordIds: [],
      principal: "Everyone",
      principalType: "Public",
      accessLevel: "Read",
      grantedVia: "Bucket policy",
      isPublic: true,
      isExternal: true,
      lastUsed: DataSecurityRecency.Unknown,
      isRemovedByFix: true,
    },
  ],
};

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function issue(): DataSecurityIssue {
  return Object.assign(new DataSecurityIssue(), {
    _id: ISSUE_ID.toString(),
    title: "Anyone on the internet can read it",
    checkId: "public-read",
    status: DataSecurityIssueStatus.Open,
    dataStoreId: new ObjectID(STORE_ID),
    dataStore: {
      _id: STORE_ID,
      name: "acme-card-exports",
      kind: DataStoreKind.AwsS3Bucket,
    },
  });
}

function textOf(element: Element): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderCard(): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <IssueAiAnalysisCard
        issue={issue()}
        issueId={ISSUE_ID}
        namer={(dataTypeId: string, knownName?: string): string => {
          return knownName || dataTypeId;
        }}
        onAcceptRisk={() => {}}
        onNotAnIssue={() => {}}
        onFixWithAi={() => {}}
        onChanged={() => {}}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("data-security-issue-ai-analysis-verdict");

  return screen.getByTestId("data-security-issue-ai-analysis");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest
    .spyOn(DataSecurityApi, "getIssueAnalysis")
    .mockResolvedValue({ analysis: VIEW });
  // What Block Public Access would need is the response panel's own tests'.
  jest
    .spyOn(DataSecurityApi, "getResponseActions")
    .mockResolvedValue({ actions: [] });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("OneUptime AI's analysis on an issue's page, in every language", () => {
  test.each(LANGUAGES)(
    "%s: the card's own words are the reader's, and OneUptime AI's are as it wrote them",
    async (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      const analysis: HTMLElement = await renderCard();
      const page: string = textOf(document.body);

      // Every word of the card's is translated, in every language it is offered in.
      for (const key of [
        ANALYSIS_CARD_TITLE,
        ANALYZE_AGAIN,
        DATA_SECURITY_AI_VERDICT_TITLES[DataSecurityAiVerdict.Real],
        ...DATA_SECURITY_ANALYSIS_QUESTIONS.map(
          (part: DataSecurityAnalysisPart): string => {
            return DATA_SECURITY_ANALYSIS_PART_TITLES[part];
          },
        ),
      ]) {
        expect(locale[key]).toBeTruthy();
        expect(page).toContain(locale[key]);
      }

      expect(
        textOf(
          within(analysis).getByTestId(
            "data-security-issue-ai-analysis-verdict",
          ),
        ),
      ).toContain(
        locale[DATA_SECURITY_AI_VERDICT_TITLES[DataSecurityAiVerdict.Real]],
      );

      for (const part of DATA_SECURITY_ANALYSIS_QUESTIONS) {
        expect(
          textOf(
            within(analysis).getByTestId(
              `data-security-issue-ai-analysis-${part}`,
            ),
          ),
        ).toContain(locale[DATA_SECURITY_ANALYSIS_PART_TITLES[part]]);
      }

      // OneUptime AI's words, in the language it wrote them in.
      for (const line of [REASON, RISK, BREAKS, PATH]) {
        expect(page).toContain(line);
      }

      // No English left of the card's own, where the language has words of its own.
      if (language !== "en") {
        for (const english of [
          "What it puts at risk",
          "What the fix would break",
          "The shortest path to fixed",
          "Show the",
        ]) {
          expect(textOf(analysis)).not.toContain(english);
        }
      }
    },
  );
});
