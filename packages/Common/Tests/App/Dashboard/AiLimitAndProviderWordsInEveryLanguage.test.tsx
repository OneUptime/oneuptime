/** @timezone UTC */
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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import AiRunFailureNotice from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureNotice";
import { RECORD_TOKEN_LIMIT_FAILURE_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import { REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { AUTOMATIC_INVESTIGATION_CONFIRMATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import ObjectID from "../../../Types/ObjectID";
import {
  AIRunFailureKind,
  RECORD_TOKEN_LIMIT_FAILURE_KINDS,
} from "../../../Types/AI/AIRunAttempt";
import {
  getRecordAiTokenLimitRunError,
  RecordAiTokenLimitKind,
} from "../../../Types/AI/RecordAiTokenLimit";
import { RemediationRoundTryAgainRefusal } from "../../../Types/AutoRemediation/RemediationRound";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE WORDS OF #7156, #7157 AND #7158 IN EVERY LANGUAGE THE DASHBOARD
 * SPEAKS.
 *
 *   - #7156: what sends people to Project Settings → AI → LLM Providers
 *     says "LLM provider", in each language as that language names the
 *     page, never its word for "AI provider".
 *   - #7157: an incident's or alert's own daily AI token limit names that
 *     limit as the AI settings page titles it, and the More settings it is
 *     under; only a limit used up today says midnight UTC.
 *   - #7158: the Kubernetes AI agent's confirmation, turning on alerts or
 *     both, names the alerts' AI settings page (KubernetesClusterAiPage
 *     InLocale holds each language's path).
 */

const EN: Record<string, string> = readDashboardLocale("en");

// The keys #7156 reworded to "LLM provider".
const LLM_PROVIDER_KEYS: ReadonlyArray<string> = [
  "Add an LLM provider for this project, or use OneUptime AI credits.",
  "Add an LLM provider in Project Settings > AI > LLM Providers, then try again.",
  "Check that the LLM provider is up and that OneUptime can reach it, then try again.",
  "Choose LLM provider",
  "No LLM providers configured yet. Add one in Project Settings → AI → LLM Providers.",
  "The LLM provider could not be reached, or was too busy to answer.",
  "The LLM provider did not answer in time.",
  "The LLM provider did not answer within {{count}} seconds.",
  "The LLM provider refused the request: its API key or model may be wrong, or its account may lack access or credit.",
  "There is no LLM provider to use.",
  "This project has no LLM provider to work out a fix with. Add one in Project Settings > AI > LLM Providers, then try again.",
];

const SAYS_AI_PROVIDER: RegExp = /\bAI[ -]providers?\b/i;

// How the sentences #7156 replaced began.
const OLD_PROVIDER_SENTENCE: RegExp =
  /^(?:The AI provider|There is no AI provider|Choose AI provider|Add an AI provider|Check that the AI provider)/;

// The record's limit, by the kind of failure it is.
const LIMIT_NAME_KEYS: Record<RecordAiTokenLimitKind, string> = {
  incident: "Daily Incident AI Token Limit",
  alert: "Daily Alert AI Token Limit",
};

function recordOf(kind: AIRunFailureKind): RecordAiTokenLimitKind {
  return kind === AIRunFailureKind.AlertTokenLimitPaused ||
    kind === AIRunFailureKind.AlertTokenLimitUsedUp
    ? "alert"
    : "incident";
}

function isUsedUp(kind: AIRunFailureKind): boolean {
  return (
    kind === AIRunFailureKind.IncidentTokenLimitUsedUp ||
    kind === AIRunFailureKind.AlertTokenLimitUsedUp
  );
}

// A refused AI fix's Try again: the failure's cause and fix as one key.
const REFUSAL_OF: Record<string, RemediationRoundTryAgainRefusal> = {
  [AIRunFailureKind.IncidentTokenLimitPaused]:
    RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused,
  [AIRunFailureKind.IncidentTokenLimitUsedUp]:
    RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp,
  [AIRunFailureKind.AlertTokenLimitPaused]:
    RemediationRoundTryAgainRefusal.AlertTokenLimitPaused,
  [AIRunFailureKind.AlertTokenLimitUsedUp]:
    RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp,
};

// Languages that write no space between two sentences.
const NO_SPACE_BETWEEN_SENTENCES: ReadonlyArray<string> = [
  "ja",
  "zh-CN",
  "zh-TW",
];

// Every key this work added.
const ALL_KEYS: ReadonlyArray<string> = [
  ...LLM_PROVIDER_KEYS,
  "The LLM provider did not answer within {{count}} seconds._one",
  ...RECORD_TOKEN_LIMIT_FAILURE_KINDS.flatMap(
    (kind: AIRunFailureKind): Array<string> => {
      const words: { cause: string; fix: string } =
        RECORD_TOKEN_LIMIT_FAILURE_WORDS[
          kind as keyof typeof RECORD_TOKEN_LIMIT_FAILURE_WORDS
        ];

      return [
        words.cause,
        words.fix,
        REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS[REFUSAL_OF[kind]!],
      ];
    },
  ),
  AUTOMATIC_INVESTIGATION_CONFIRMATIONS.alerts,
  AUTOMATIC_INVESTIGATION_CONFIRMATIONS.incidentsAndAlerts,
];

describe("every key is English in en.json, and worded in every other language", () => {
  test("each is a key of the Dashboard's English", () => {
    expect(
      ALL_KEYS.filter((key: string): boolean => {
        return typeof EN[key] !== "string";
      }),
    ).toEqual([]);
    expect(
      EN["The LLM provider did not answer within {{count}} seconds._one"],
    ).toBe("The LLM provider did not answer within {{count}} second.");
  });

  test("the keys they replaced are gone", () => {
    expect(
      Object.keys(EN).filter((key: string): boolean => {
        return (
          SAYS_AI_PROVIDER.test(key) &&
          (key.includes("LLM Providers") || OLD_PROVIDER_SENTENCE.test(key))
        );
      }),
    ).toEqual([]);
    expect(
      Object.keys(EN).filter((key: string): boolean => {
        return key.startsWith(
          "This applies to every new alert in {{project}}, not just this cluster. Limits live under Incidents",
        );
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each its own way, and keeps its placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(
        ALL_KEYS.filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);

      for (const key of ALL_KEYS) {
        expect({ key, placeholders: placeholdersOf(words[key] || "") }).toEqual(
          { key, placeholders: placeholdersOf(EN[key]!) },
        );
      }
    },
  );
});

describe("#7156: the LLM provider, as each language names the page", () => {
  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s says LLM in every sentence about the provider",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(
        LLM_PROVIDER_KEYS.filter((key: string): boolean => {
          return !(words[key] || "").includes("LLM");
        }),
      ).toEqual([]);
    },
  );

  test("English says LLM provider, never AI provider", () => {
    for (const key of LLM_PROVIDER_KEYS) {
      expect({
        key,
        saysAiProvider: SAYS_AI_PROVIDER.test(key),
      }).toEqual({ key, saysAiProvider: false });
    }
  });
});

describe("#7157: the record's daily AI token limit, in every language", () => {
  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s names the record's limit as the settings page titles it, and More settings",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const moreSettings: string = words["More settings"]!;

      for (const kind of RECORD_TOKEN_LIMIT_FAILURE_KINDS) {
        const sentences: { cause: string; fix: string } =
          RECORD_TOKEN_LIMIT_FAILURE_WORDS[
            kind as keyof typeof RECORD_TOKEN_LIMIT_FAILURE_WORDS
          ];
        const record: RecordAiTokenLimitKind = recordOf(kind);
        const other: RecordAiTokenLimitKind =
          record === "incident" ? "alert" : "incident";
        const cause: string = words[sentences.cause]!;
        const fix: string = words[sentences.fix]!;

        expect({
          language,
          kind,
          namesLimit: cause.includes(words[LIMIT_NAME_KEYS[record]]!),
          namesOtherLimit: `${cause} ${fix}`.includes(
            words[LIMIT_NAME_KEYS[other]]!,
          ),
          namesMoreSettings: fix.includes(moreSettings),
          saysMidnight: `${cause} ${fix}`.includes("UTC"),
        }).toEqual({
          language,
          kind,
          namesLimit: true,
          namesOtherLimit: false,
          namesMoreSettings: true,
          // Only a limit used up today lifts at midnight UTC.
          saysMidnight: isUsedUp(kind),
        });
      }
    },
  );

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s: a refused AI fix says the run's cause and fix, word for word",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const between: string = NO_SPACE_BETWEEN_SENTENCES.includes(language)
        ? ""
        : " ";

      for (const kind of RECORD_TOKEN_LIMIT_FAILURE_KINDS) {
        const sentences: { cause: string; fix: string } =
          RECORD_TOKEN_LIMIT_FAILURE_WORDS[
            kind as keyof typeof RECORD_TOKEN_LIMIT_FAILURE_WORDS
          ];
        const refusalKey: string =
          REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS[REFUSAL_OF[kind]!];

        expect({ language, kind, refusal: words[refusalKey] }).toEqual({
          language,
          kind,
          refusal: `${words[sentences.cause]}${between}${words[sentences.fix]}`,
        });
      }
    },
  );
});

describe("#7157: the failure notice, in German and in Arabic", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000003",
  );
  const DE: Record<string, string> = readDashboardLocale("de");
  const AR: Record<string, string> = readDashboardLocale("ar");

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: { de: { translation: DE }, ar: { translation: AR } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test.each([
    { language: "de", record: "incident" as const, limit: 0 },
    { language: "de", record: "alert" as const, limit: 500 },
    { language: "ar", record: "alert" as const, limit: 0 },
    { language: "ar", record: "incident" as const, limit: 500 },
  ])(
    "$language: the $record limit of $limit says the cause, the fix and the link in the reader's language",
    async (data: {
      language: string;
      record: RecordAiTokenLimitKind;
      limit: number;
    }) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(data.language);
      });

      const words: Record<string, string> = data.language === "de" ? DE : AR;
      const kind: AIRunFailureKind =
        data.record === "incident"
          ? data.limit > 0
            ? AIRunFailureKind.IncidentTokenLimitUsedUp
            : AIRunFailureKind.IncidentTokenLimitPaused
          : data.limit > 0
            ? AIRunFailureKind.AlertTokenLimitUsedUp
            : AIRunFailureKind.AlertTokenLimitPaused;
      const sentences: { cause: string; fix: string } =
        RECORD_TOKEN_LIMIT_FAILURE_WORDS[
          kind as keyof typeof RECORD_TOKEN_LIMIT_FAILURE_WORDS
        ];

      render(
        <AiRunFailureNotice
          title="Investigation did not finish"
          events={[]}
          errorMessage={getRecordAiTokenLimitRunError(data.record, {
            limitInTokens: data.limit,
            usedTokensToday: data.limit + 10,
          })}
          testId="investigation-failure"
        />,
      );

      expect(
        screen.getByTestId("investigation-failure-cause"),
      ).toHaveTextContent(words[sentences.cause]!);
      expect(screen.getByTestId("investigation-failure-fix")).toHaveTextContent(
        words[sentences.fix]!,
      );

      const link: HTMLElement = screen.getByTestId(
        "investigation-failure-settings",
      );
      expect(link).toHaveTextContent(
        words[
          data.record === "incident"
            ? "Review incident AI settings"
            : "Review alert AI settings"
        ]!,
      );
      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/${data.record}s/ai/settings#DailyLimits`,
      );
    },
  );
});
