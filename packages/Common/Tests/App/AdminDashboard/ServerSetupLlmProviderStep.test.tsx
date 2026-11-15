import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import ServerSetupChecklist, {
  getServerSetupRows,
  SERVER_SETUP_COPY,
  ServerSetupAction,
  ServerSetupRow,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerSetupChecklist";
import Protocol from "../../../Types/API/Protocol";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  SERVER_SETUP_ADMIN_PATHS,
  SERVER_SETUP_CHECKS,
  SERVER_SETUP_STATUS_WORDS,
  ServerSetupCheckDefinition,
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupStatus,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE SERVER SETUP CHECKLIST NAMES THE LLM PROVIDERS SETTING BY ITS NAME
 * (#7356).
 *
 * The checklist's optional step for OneUptime AI opens Settings → Global
 * LLM Providers. It was titled "AI provider", said "Not set up: add an AI
 * provider so projects can use OneUptime AI." and offered "Add an AI
 * provider": words for a setting that does not exist. Now it says "LLM
 * provider" in all three places, in every language the Admin Dashboard
 * speaks, with the word each language's Global LLM Providers page already
 * uses - and the step's id (ai-provider, stored in admins' choices) and the
 * page its button opens are unchanged.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src/Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

const TITLE: string = "LLM provider";
const NOT_SET_UP: string =
  "Not set up: add an LLM provider so projects can use OneUptime AI.";
const ACTION: string = "Add an LLM provider";

// What the step said before (#7356), in any of its forms.
const AI_PROVIDER_IN_ENGLISH: RegExp = /\bAI[ -]providers?\b/i;
const STEP_WORDS: ReadonlyArray<string> = [TITLE, NOT_SET_UP, ACTION];

// The page the button opens, as the Admin Dashboard's side menu names it.
const PAGE_NAME: string = "Global LLM Providers";

/*
 * Each language's word for an LLM provider, as its Global LLM Providers
 * page has it (lower case; Persian without the optional hamza): every one
 * of the step's three words says it. Japanese spells it プロバイダー, with
 * its long vowel, on the page as on the button that opens it and in the
 * docs (the page said プロバイダ until #7356's UI review).
 */
const LLM_PROVIDER_WORD: Readonly<Record<string, string>> = {
  ar: "موفّر",
  da: "llm-udbyder",
  de: "llm-anbieter",
  es: "proveedor",
  fa: "ارائه‌دهند",
  fr: "fournisseur",
  hi: "llm प्रदाता",
  it: "provider llm",
  ja: "llm プロバイダー",
  ko: "llm 공급자",
  nl: "llm-provider",
  no: "llm-leverandør",
  pt: "provedor",
  ru: "провайдер",
  sv: "llm-leverantör",
  "zh-CN": "llm 提供商",
  "zh-TW": "llm 供應商",
};

// What each language called it before: an "AI provider", no setting's name.
const AI_PROVIDER_WORD: Readonly<Record<string, string>> = {
  ar: "مزوّد",
  da: "ai-udbyder",
  de: "ki-anbieter",
  es: "proveedor de ia",
  fa: "هوش مصنوعی",
  fr: "fournisseur d'ia",
  hi: "ai प्रदाता",
  it: "fornitore di ia",
  ja: "ai プロバイダー",
  ko: "ai 제공자",
  nl: "ai-provider",
  no: "ai-leverandør",
  pt: "provedor de ia",
  ru: "ии-провайдер",
  sv: "ai-leverantör",
  "zh-CN": "ai 提供商",
  "zh-TW": "ai 供應商",
};

// Lower case, and Persian's optional hamza above a final he left out.
function normalized(text: string): string {
  return text.toLowerCase().replace(/ٔ/g, "");
}

function channel(name: ServerSendingChannel): ServerChannelStatus {
  return {
    channel: name,
    state: ServerSendingState.Working,
    hasWorked: true,
    lastWorkedAt: "2026-11-10T09:30:00.000Z",
    failingSince: null,
    lastFailure: null,
    setUpProblem: null,
  };
}

// A server with everything but OneUptime AI's models set up.
function answerWithoutLlmProvider(): ServerSetupChecklistAnswer {
  return ServerSetupChecklistUtil.getAnswer({
    facts: {
      isHttpsSetUp: false,
      areSignupsClosed: true,
      email: channel(ServerSendingChannel.Email),
      sms: channel(ServerSendingChannel.SMS),
      call: channel(ServerSendingChannel.Call),
      emailSentThrough: "smtp.example.com",
      smsSentThrough: "Twilio",
      callSentThrough: "Twilio",
      globalProbes: { total: 1, reporting: 1 },
      updateChecks: {
        isDisabled: false,
        lastCheckedAt: "2026-11-10T09:30:00.000Z",
        lastFailure: null,
      },
      lastBackup: null,
      hasScheduledBackups: false,
      isBrowserPushSetUp: true,
      hasAiProvider: false,
      hasSingleSignOn: true,
      choices: { choices: {}, hiddenBy: {} },
    },
    readerUserId: null,
  });
}

function llmProviderRow(): ServerSetupRow {
  return getServerSetupRows({
    answer: answerWithoutLlmProvider(),
    page: {
      httpProtocol: Protocol.HTTP,
      pageProtocol: "http:",
      httpsAddress: "https://oneuptime.example.com/admin/setup",
    },
    formatTime: (iso: string | null): string => {
      return iso || "";
    },
  }).find((row: ServerSetupRow): boolean => {
    return row.id === ServerSetupCheckId.AiProvider;
  })!;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

// The checklist, with its folded optional section opened.
async function renderOpened(locale: string): Promise<HTMLElement> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter>
        <ServerSetupChecklist
          answer={answerWithoutLlmProvider()}
          onAnswer={() => {}}
          pageProtocol="http:"
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });

  fireEvent.click(screen.getByTestId("server-setup-optional-toggle"));

  return screen.getByTestId("server-setup-ai-provider");
}

afterEach(() => {
  cleanup();
});

describe("the step's words", () => {
  test("titled LLM provider, keeping its id", () => {
    const step: ServerSetupCheckDefinition = SERVER_SETUP_CHECKS.find(
      (definition: ServerSetupCheckDefinition): boolean => {
        return definition.id === ServerSetupCheckId.AiProvider;
      },
    )!;

    expect(step.id).toBe("ai-provider");
    expect(step.title).toBe(TITLE);
    expect(step.adminPath).toBe(SERVER_SETUP_ADMIN_PATHS.llmProviders);
    expect(SERVER_SETUP_ADMIN_PATHS.llmProviders).toBe(
      "/admin/settings/llm-providers",
    );
  });

  test("not set up: add an LLM provider; set up: unchanged", () => {
    expect(SERVER_SETUP_STATUS_WORDS[ServerSetupCheckId.AiProvider]).toEqual({
      [ServerSetupStatus.NotSetUp]: NOT_SET_UP,
      [ServerSetupStatus.Done]: "Set up: projects can use OneUptime AI.",
    });
  });

  test("its one action, Add an LLM provider, opens Global LLM Providers", () => {
    expect(SERVER_SETUP_COPY.actions.addLlmProvider).toBe(ACTION);
    expect(
      llmProviderRow().actions.map((action: ServerSetupAction): string => {
        return `${action.kind} | ${action.title} | ${action.route?.toString()}`;
      }),
    ).toEqual([`route | ${ACTION} | /admin/settings/llm-providers`]);
  });

  test("the row reads the step's words", () => {
    const row: ServerSetupRow = llmProviderRow();

    expect(row.title).toBe(TITLE);
    expect(row.status.template).toBe(NOT_SET_UP);
  });

  test("no word of the checklist says AI provider", () => {
    const everyWord: Array<string> = [
      ...SERVER_SETUP_CHECKS.map((definition: ServerSetupCheckDefinition) => {
        return definition.title;
      }),
      ...Object.values(SERVER_SETUP_STATUS_WORDS).flatMap(
        (lines: Partial<Record<string, string>>): Array<string> => {
          return Object.values(lines) as Array<string>;
        },
      ),
      ...Object.values(SERVER_SETUP_COPY.actions),
    ];

    expect(
      everyWord.filter((word: string): boolean => {
        return AI_PROVIDER_IN_ENGLISH.test(word);
      }),
    ).toEqual([]);
  });
});

describe("in every language the Admin Dashboard speaks", () => {
  test("every language has a word for an LLM provider here", () => {
    expect(Object.keys(LLM_PROVIDER_WORD).sort()).toEqual(
      [...ADMIN_DASHBOARD_LANGUAGES].sort(),
    );
    expect(Object.keys(AI_PROVIDER_WORD).sort()).toEqual(
      [...ADMIN_DASHBOARD_LANGUAGES].sort(),
    );
  });

  test("English has the three words as their own values, and not the old ones", () => {
    const english: Locale = readLocale("en");

    for (const word of STEP_WORDS) {
      expect({ word, value: english[word] }).toEqual({ word, value: word });
    }

    for (const old of [
      "AI provider",
      "Add an AI provider",
      "Not set up: add an AI provider so projects can use OneUptime AI.",
    ]) {
      expect({ old, value: english[old] }).toEqual({ old, value: undefined });
    }
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s: the three words say LLM provider as its Global LLM Providers page does",
    (locale: string) => {
      const words: Locale = readLocale(locale);
      const llmProvider: string = LLM_PROVIDER_WORD[locale]!;
      const aiProvider: string = AI_PROVIDER_WORD[locale]!;

      // The page the button opens says the language's word.
      expect(normalized(words[PAGE_NAME] as string)).toContain(llmProvider);

      for (const word of STEP_WORDS) {
        const value: unknown = words[word];

        expect({ word, type: typeof value }).toEqual({ word, type: "string" });
        expect({ word, translated: value !== word }).toEqual({
          word,
          translated: true,
        });
        expect({ word, saysLlm: (value as string).includes("LLM") }).toEqual({
          word,
          saysLlm: true,
        });
        expect(normalized(value as string)).toContain(llmProvider);
        expect(
          normalized(value as string).replace(/oneuptime ai/g, ""),
        ).not.toContain(aiProvider);
      }

      expect((words[NOT_SET_UP] as string).includes("OneUptime AI")).toBe(true);

      // The old words are gone from every language.
      for (const old of [
        "AI provider",
        "Add an AI provider",
        "Not set up: add an AI provider so projects can use OneUptime AI.",
      ]) {
        expect({ old, value: words[old] }).toEqual({ old, value: undefined });
      }
    },
  );
});

describe("on the Server setup page", () => {
  test("in English: LLM provider, the line and Add an LLM provider, opening Global LLM Providers", async () => {
    const row: HTMLElement = await renderOpened("en");

    expect(row).toHaveTextContent(TITLE);
    expect(
      within(row).getByTestId("server-setup-ai-provider-status"),
    ).toHaveTextContent(NOT_SET_UP);

    const action: HTMLElement = within(row).getByTestId(
      "server-setup-ai-provider-route",
    );

    expect(action).toHaveTextContent(ACTION);
    expect(action).toHaveAttribute("href", "/admin/settings/llm-providers");
    expect(row.textContent).not.toMatch(/AI provider/i);
  });

  test.each(["de", "ar", "fa"])(
    "%s: the step reads in the reader's language, with no English left",
    async (locale: string) => {
      const words: Locale = readLocale(locale);
      const row: HTMLElement = await renderOpened(locale);
      const text: string = withoutIsolateMarks(row.textContent || "");

      expect(text).toContain(words[TITLE] as string);
      expect(
        withoutIsolateMarks(
          within(row).getByTestId("server-setup-ai-provider-status")
            .textContent || "",
        ),
      ).toBe(words[NOT_SET_UP] as string);

      const action: HTMLElement = within(row).getByTestId(
        "server-setup-ai-provider-route",
      );

      expect(withoutIsolateMarks(action.textContent || "")).toBe(
        words[ACTION] as string,
      );
      expect(action).toHaveAttribute("href", "/admin/settings/llm-providers");

      for (const english of STEP_WORDS) {
        expect(text).not.toContain(english);
      }

      expect(text).not.toMatch(/provider/i);
    },
  );
});
