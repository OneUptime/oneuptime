import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The exception page's "Watch what the user saw" card in the reader's
 * language (#5389's follow-up). Its dates and its Show all / Show fewer
 * already followed the reader; its title, the facts line, the frustration
 * signals, the masking and moment notes, the watch button, the other
 * sessions' count and their Watch links, and its refusals were English in
 * every language. Every one of them reads in all sixteen languages now: the
 * device's names and the page's address as the recorder wrote them, the
 * duration as the language writes one, the masking by the policy's own
 * choice names.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import ReplayCard, {
  describeReplayCardFailure,
  describeReplayDevice,
  describeReplayDuration,
  describeReplayMasking,
  describeReplaySignals,
  REPLAY_CARD_ERROR_COPY,
  REPLAY_CARD_PERMISSION_COPY,
  REPLAY_CARD_PLAN_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCard";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
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
  "fa",
];

// Every sentence and word the card draws, as its English keys.
const CARD_WORDS: ReadonlyArray<string> = [
  REPLAY_CARD_PERMISSION_COPY,
  REPLAY_CARD_PLAN_COPY,
  REPLAY_CARD_ERROR_COPY,
  "Could not check for a recording: {{error}}",
  "Watch what the user saw",
  "Unknown page",
  "Unknown device",
  "unknown start",
  "not reported",
  "{{browser}} on {{os}}",
  "Before the error: {{signals}}",
  "Masking when recorded: {{mode}}",
  "Mask sensitive inputs only",
  "Mask inputs only",
  "Mask all text",
  "The occurrence's timestamp falls outside this recording, so playback starts at the beginning.",
  "The latest occurrence was in a session that was not recorded; this is the newest recording that hit the same error, from the beginning.",
  "The latest occurrence carries no session id; this is the newest recording that hit the same error, from the beginning.",
  "Watch {{seconds}}s before the error",
  "Watch session",
  "{{count}} more recorded sessions hit this error",
  "Watch",
  "Only the first applications your role can access were searched; recordings of this error in other applications may be missing.",
  "{{count}} rage clicks",
  "{{count}} dead clicks",
  "{{count}} error clicks",
  "{{count}} refresh rage",
];

// The plurals' "one" forms, which a language with a "one" form reads.
const ONE_FORMS: ReadonlyArray<string> = [
  "{{count}} more recorded sessions hit this error_one",
  "{{count}} rage clicks_one",
  "{{count}} dead clicks_one",
  "{{count}} error clicks_one",
];

const WITHOUT_ONE_FORM: ReadonlyArray<string> = ["ja", "ko", "zh-CN", "zh-TW"];

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_START: Date = new Date("2026-08-14T10:00:00.000Z");
const SESSION_END: Date = new Date("2026-08-14T10:10:00.000Z");
const ERROR_UNIX_MS: number = SESSION_START.getTime() + 5 * 60 * 1000;

const locales: Record<string, Record<string, unknown>> = {};
const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function drawn(language: string, english: string): string {
  const value: unknown = locales[language]?.[english];

  return typeof value === "string" && value.length > 0 ? value : english;
}

function translatorFor(language: string): Translator {
  return createTranslator((text: string): string | undefined => {
    const value: unknown = locales[language]?.[text];

    return typeof value === "string" ? value : undefined;
  }, language);
}

function sessionRow(overrides?: Partial<JSONObject>): JSONObject {
  return {
    sessionId: SESSION_ID,
    rumApplicationId: APP_ID,
    startTime: SESSION_START.toISOString(),
    endTime: SESSION_END.toISOString(),
    durationMs: 10 * 60 * 1000,
    entryUrl: "https://shop.example.com/checkout",
    browserName: "Chrome",
    osName: "macOS",
    maskingMode: "MaskInputsOnly",
    rageClickCount: 2,
    deadClickCount: 1,
    errorClickCount: 0,
    refreshRageCount: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  locales["en"] = readLocale("en");

  for (const language of ["en", ...LANGUAGES]) {
    const locale: Record<string, unknown> =
      locales[language] || readLocale(language);
    locales[language] = locale;

    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"] },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });
    instances[language] = instance;
  }
});

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
});

async function renderCardIn(
  language: string,
  sessions: Array<JSONObject>,
): Promise<void> {
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      { sessions: sessions, isApplicationScopeTruncated: true },
      {},
    ),
  );

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <ReplayCard
          fingerprint="fp-0123456789abcdef"
          sessionId={SESSION_ID}
          exceptionInstanceId="0193c0de-5555-4aaa-8bbb-000000000005"
          errorTimeUnixMs={ERROR_UNIX_MS}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await screen.findByTestId("replay-card");
}

describe("the card's words", () => {
  it.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const english: Array<string> = [
      ...CARD_WORDS,
      ...(WITHOUT_ONE_FORM.includes(language) ? [] : ONE_FORMS),
    ].filter((key: string): boolean => {
      return drawn(language, key) === (locales["en"]?.[key] as string);
    });

    expect({ language, english }).toEqual({ language, english: [] });
  });

  it("are keys of the Dashboard's English locale", () => {
    for (const key of CARD_WORDS) {
      expect({ key, english: locales["en"]?.[key] }).toEqual({
        key,
        english: key,
      });
    }
  });
});

describe("the card in the reader's language", () => {
  it.each(LANGUAGES)(
    "%s: the title, the watch button, the notes and the other sessions",
    async (language: string) => {
      await renderCardIn(language, [
        sessionRow(),
        sessionRow({ sessionId: "b1b2c3d4e5f60718293a4b5c6d7e8f90" }),
        sessionRow({ sessionId: "c1b2c3d4e5f60718293a4b5c6d7e8f90" }),
      ]);

      const card: HTMLElement = screen.getByTestId("replay-card");
      const text: string = withoutIsolateMarks(card.textContent || "");

      expect(text).toContain(drawn(language, "Watch what the user saw"));
      expect(text).not.toContain("Watch what the user saw");

      // The moment is the occurrence's own session: 10 seconds before it.
      expect(
        withoutIsolateMarks(
          screen.getByTestId("replay-card-watch").textContent || "",
        ),
      ).toBe(
        translatorFor(language).translateTemplate(
          "Watch {{seconds}}s before the error",
          { seconds: translatorFor(language).formatNumber(10) },
        ),
      );

      expect(
        withoutIsolateMarks(
          screen.getByTestId("replay-card-masking").textContent || "",
        ),
      ).toBe(
        drawn(language, "Masking when recorded: {{mode}}").replace(
          "{{mode}}",
          drawn(language, "Mask inputs only"),
        ),
      );

      expect(
        withoutIsolateMarks(
          screen.getByTestId("replay-card-more-sessions").textContent || "",
        ),
      ).toContain(
        translatorFor(language).translatePlural(
          {
            one: "{{count}} more recorded session hit this error",
            other: "{{count}} more recorded sessions hit this error",
          },
          2,
        ),
      );

      expect(
        withoutIsolateMarks(
          screen.getByTestId("replay-card-truncated").textContent || "",
        ),
      ).toBe(
        drawn(
          language,
          "Only the first applications your role can access were searched; recordings of this error in other applications may be missing.",
        ),
      );

      for (const english of [
        "more recorded",
        "masking",
        "Before the error",
        "Watch session",
      ]) {
        expect({ language, english, shown: text.includes(english) }).toEqual({
          language,
          english,
          shown: false,
        });
      }
    },
  );

  it("German: the device in a German sentence, the duration as German writes it", async () => {
    await renderCardIn("de", [sessionRow()]);

    const facts: string = withoutIsolateMarks(
      screen.getByTestId("replay-card-facts").textContent || "",
    );

    expect(facts).toContain("https://shop.example.com/checkout");
    expect(facts).toContain("Chrome unter macOS");
    expect(facts).toContain(
      describeReplayDuration(600000, translatorFor("de")),
    );
    expect(facts).not.toContain("10m 00s");

    expect(
      withoutIsolateMarks(
        screen.getByTestId("replay-card-signals").textContent || "",
      ),
    ).toBe("Vor dem Fehler: 2 Rage-Klicks, 1 Dead-Klick");
  });

  it("Persian: the page's address reads as written, and the device is a Persian sentence with its names set apart", async () => {
    await renderCardIn("fa", [sessionRow()]);

    const facts: HTMLElement = screen.getByTestId("replay-card-facts");
    const isolates: Array<{ text: string; dir: string | null }> = Array.from(
      facts.querySelectorAll("bdi"),
    ).map((element: Element): { text: string; dir: string | null } => {
      return {
        text: element.textContent || "",
        dir: element.getAttribute("dir"),
      };
    });

    /*
     * The address alone is an isolate of its own direction. The device's
     * sentence is not: drawn as one left-to-right isolate (its letters are
     * mostly Latin), "Chrome روی macOS" read "macOS on Chrome" from the
     * right. It follows the page, each name set apart in it.
     */
    expect(isolates).toEqual([
      { text: "https://shop.example.com/checkout", dir: "ltr" },
    ]);

    const device: HTMLElement = within(facts).getByTestId("replay-card-device");

    expect(device.tagName).toBe("SPAN");
    expect(device.closest("bdi")).toBeNull();
    expect(device.textContent).toBe(
      drawn("fa", "{{browser}} on {{os}}")
        .replace("{{browser}}", isolated("Chrome"))
        .replace("{{os}}", isolated("macOS")),
    );
    expect(withoutIsolateMarks(device.textContent || "")).toBe(
      "Chrome روی macOS",
    );
  });

  it("Persian: a lone name reads as written, in an isolate of its own, in the facts and the other sessions", async () => {
    await renderCardIn("fa", [
      sessionRow({ osName: "" }),
      sessionRow({
        sessionId: "b1b2c3d4e5f60718293a4b5c6d7e8f90",
        browserName: "",
        osName: "",
      }),
    ]);

    const device: HTMLElement = within(
      screen.getByTestId("replay-card-facts"),
    ).getByTestId("replay-card-device");

    expect(device.tagName).toBe("BDI");
    expect(device).toHaveAttribute("dir", "ltr");
    expect(device.textContent).toBe("Chrome");

    // Neither name: the reader's words, in the sentence's own direction.
    const row: HTMLElement = screen.getByTestId("replay-card-session-row");
    const unknown: HTMLElement = within(row).getByTestId("replay-card-device");

    expect(unknown.tagName).toBe("SPAN");
    expect(unknown.textContent).toBe(drawn("fa", "Unknown device"));
  });

  it("Persian: the other sessions' devices are sentences of the page, too", async () => {
    await renderCardIn("fa", [
      sessionRow(),
      sessionRow({
        sessionId: "b1b2c3d4e5f60718293a4b5c6d7e8f90",
        browserName: "Firefox",
        osName: "Windows",
      }),
    ]);

    const row: HTMLElement = screen.getByTestId("replay-card-session-row");
    const device: HTMLElement = within(row).getByTestId("replay-card-device");

    expect(device.closest("bdi")).toBeNull();
    expect(device.textContent).toBe(
      drawn("fa", "{{browser}} on {{os}}")
        .replace("{{browser}}", isolated("Firefox"))
        .replace("{{os}}", isolated("Windows")),
    );
  });

  it("Persian: a server's English answer is set apart in the refusal's sentence, its full stop at its end", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "ClickHouse is down." }, {}),
    );

    render(
      <I18nextProvider i18n={instances["fa"]!}>
        <MemoryRouter>
          <ReplayCard
            fingerprint="fp-0123456789abcdef"
            sessionId={SESSION_ID}
            errorTimeUnixMs={ERROR_UNIX_MS}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    const hint: HTMLElement = await screen.findByTestId("replay-card-hint");

    expect(hint.textContent).toContain(
      drawn("fa", "Could not check for a recording: {{error}}").replace(
        "{{error}}",
        isolated("ClickHouse is down."),
      ),
    );
  });

  it("keeps the hint's icon beside the first line of a message that wraps", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "ClickHouse is down." }, {}),
    );

    render(
      <I18nextProvider i18n={instances["de"]!}>
        <MemoryRouter>
          <ReplayCard
            fingerprint="fp-0123456789abcdef"
            sessionId={SESSION_ID}
            errorTimeUnixMs={ERROR_UNIX_MS}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    const hint: HTMLElement = await screen.findByTestId("replay-card-hint");

    /*
     * The row does not wrap: the icon is its first item, the message and
     * Retry wrap inside the second, so the icon never stands alone above
     * the words.
     */
    expect(hint.className).toContain("items-start");
    expect(hint.className).not.toContain("flex-wrap");
    expect(hint.children).toHaveLength(2);

    const icon: Element | null = hint.children[0]!.querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("class")).toContain("shrink-0");

    const words: HTMLElement = hint.children[1] as HTMLElement;

    expect(words.className).toContain("flex-wrap");
    expect(words.className).toContain("min-w-0");
    expect(withoutIsolateMarks(words.textContent || "")).toContain(
      "ClickHouse is down.",
    );
    expect(within(words).getByTestId("replay-card-retry")).toBeInTheDocument();
  });

  it("English reads as it always did", async () => {
    await renderCardIn("en", [sessionRow()]);

    expect(screen.getByTestId("replay-card-facts")).toHaveTextContent(
      "https://shop.example.com/checkout · 10m 00s · Chrome on macOS",
    );
    expect(screen.getByTestId("replay-card-watch")).toHaveTextContent(
      "Watch 10s before the error",
    );
  });
});

describe("the card's helpers", () => {
  it("names a device by both names, either name, or neither", () => {
    const de: Translator = translatorFor("de");

    expect(
      describeReplayDevice({ browserName: "Firefox", osName: "Linux" }, de),
    ).toBe("Firefox unter Linux");
    expect(
      describeReplayDevice({ browserName: "Firefox", osName: "" }, de),
    ).toBe("Firefox");
    expect(describeReplayDevice({ browserName: "", osName: "Linux" }, de)).toBe(
      "Linux",
    );
    expect(describeReplayDevice({ browserName: "", osName: "" }, de)).toBe(
      drawn("de", "Unknown device"),
    );
  });

  it("names a known masking mode by its choice, an unknown one as written, none as not reported", () => {
    const ja: Translator = translatorFor("ja");

    expect(describeReplayMasking("MaskAllText", ja)).toBe(
      drawn("ja", "Mask all text"),
    );
    expect(describeReplayMasking("SomethingNew", ja)).toBe("SomethingNew");
    expect(describeReplayMasking(undefined, ja)).toBe(
      drawn("ja", "not reported"),
    );
  });

  it("counts each frustration signal in the reader's plural, and leaves out the ones at zero", () => {
    const ru: Translator = translatorFor("ru");

    expect(
      describeReplaySignals(
        {
          rageClickCount: 1,
          deadClickCount: 0,
          errorClickCount: 5,
          refreshRageCount: 0,
        },
        ru,
      ),
    ).toEqual(["1 гневный клик", "Кликов с ошибкой: 5"]);
  });

  it("writes a duration the language's way, and an empty one as a dash", () => {
    expect(describeReplayDuration(0, translatorFor("de"))).toBe("—");
    expect(describeReplayDuration(150000, translatorFor("en"))).toBe("2m 30s");
    expect(describeReplayDuration(150000, translatorFor("de"))).not.toBe(
      "2m 30s",
    );
  });

  it("words a refusal or a failure in the reader's language, the server's own words as they came", () => {
    const fr: Translator = translatorFor("fr");

    expect(
      describeReplayCardFailure(
        { kind: "plan", message: REPLAY_CARD_PLAN_COPY },
        fr,
      ),
    ).toBe(drawn("fr", REPLAY_CARD_PLAN_COPY));
    expect(
      describeReplayCardFailure(
        {
          kind: "error",
          message: "Could not check for a recording: ClickHouse is down",
          detail: "ClickHouse is down",
        },
        fr,
      ),
    ).toBe(
      drawn("fr", "Could not check for a recording: {{error}}").replace(
        "{{error}}",
        "ClickHouse is down",
      ),
    );
  });
});
