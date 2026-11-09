import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Settings > Telemetry Ingestion Keys > a key > Refused Telemetry (issue
 * #6378), rendered for real with only the API and the router replaced: what
 * OneUptime refused of this key's telemetry in the past 30 days - why,
 * where, how many and when, the latest first. Each line is headed by its
 * reason in a few words, without the key's name (the page is the key's);
 * one refused in the past day is drawn as a problem, an older one as
 * history. A fix in the project's settings is a link, and the card has its
 * own loading, empty and failed states.
 */

const KEY_ID: string = "6c3d0000-0000-4000-8000-0000000000a7";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000063";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000063");
      },
    },
  };
});

// A plain anchor, so hrefs can be read without a router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        className?: string;
        dataTestId?: string;
        children: React.ReactNode;
      }) => {
        return (
          <a
            href={props.to ? props.to.toString() : ""}
            className={props.className}
            data-testid={props.dataTestId}
          >
            {props.children}
          </a>
        );
      },
    };
  },
);

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import IngestionKeyRefusalsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeyRefusalsCard";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function refusalRow(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reason: "origin-not-allowed",
    surface: "otel-traces",
    refusedCount: 1,
    firstRefusedAt: ago(20 * MINUTE_MS),
    lastRefusedAt: ago(20 * MINUTE_MS),
    telemetryIngestionKeyId: KEY_ID,
    telemetryIngestionKey: {
      name: "Storefront browser key",
      keyType: "Browser",
    },
    ...extra,
  };
}

// Each read answers with the next of `answers`; the last one keeps answering.
function arrange(
  ...answers: Array<Array<Record<string, unknown>> | "fails" | "pending">
): void {
  let call: number = 0;

  getListMock.mockImplementation(() => {
    const answer: Array<Record<string, unknown>> | "fails" | "pending" =
      answers[Math.min(call, answers.length - 1)]!;
    call++;

    if (answer === "pending") {
      return never();
    }

    if (answer === "fails") {
      return Promise.reject(new Error("Network error"));
    }

    return Promise.resolve({
      data: answer,
      count: answer.length,
      skip: 0,
      limit: 50,
    });
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(
  wrap?: (element: React.ReactElement) => React.ReactElement,
): Promise<void> {
  const card: React.ReactElement = (
    <IngestionKeyRefusalsCard ingestionKeyId={new ObjectID(KEY_ID)} />
  );
  render(wrap ? wrap(card) : card);
  await flush();
}

function lines(): Array<HTMLElement> {
  return screen.queryAllByTestId("ingestion-key-refusal");
}

function checkAgain(): HTMLElement {
  return within(screen.getByTestId("ingestion-key-refusals")).getByRole(
    "button",
    { name: "Check again" },
  );
}

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the key's Refused Telemetry card", () => {
  test("reads this key's past 30 days, the latest first", async () => {
    arrange([]);
    await renderCard();

    expect(getListMock).toHaveBeenCalledTimes(1);
    const read: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(read["modelType"]).toBe(TelemetryIngestionKeyRefusal);

    const query: Record<string, unknown> = read["query"] as Record<
      string,
      unknown
    >;
    expect(String(query["telemetryIngestionKeyId"])).toBe(KEY_ID);
    expect(query["lastRefusedAt"]).toBeInstanceOf(GreaterThanOrEqual);
    const since: Date = (query["lastRefusedAt"] as GreaterThanOrEqual<Date>)
      .value as Date;
    expect(Math.round((Date.now() - since.getTime()) / DAY_MS)).toBe(30);
    expect(read["sort"]).toEqual({ lastRefusedAt: SortOrder.Descending });
    expect(read["limit"]).toBe(50);
  });

  test("while it reads: Checking, and the card is busy", async () => {
    arrange("pending");
    await renderCard();

    const loading: HTMLElement = screen.getByTestId(
      "ingestion-key-refusals-loading",
    );
    expect(loading).toHaveTextContent("Checking…");
    // A clock beside it, as the lines and the other states have their icon.
    expect(loading.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("ingestion-key-refusals")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  test("nothing refused: says so", async () => {
    arrange([]);
    await renderCard();

    expect(screen.getByTestId("ingestion-key-refusals-none")).toHaveTextContent(
      "Nothing sent with this key was refused in the past 30 days.",
    );
    expect(screen.getByTestId("ingestion-key-refusals")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(screen.getByText("Refused Telemetry")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("ingestion-key-refusals")).getByTestId(
        "card-description",
      ),
    ).toHaveTextContent(
      "Telemetry sent with this key that OneUptime refused in the past 30 days, and why. A refusal shows here within a few minutes.",
    );
  });

  test("one line per reason and endpoint: why, where, how many and when", async () => {
    const budget: Record<string, unknown> = refusalRow({
      reason: "project-daily-budget",
      surface: "otel-logs",
      refusedCount: 1234,
      firstRefusedAt: ago(5 * DAY_MS),
      lastRefusedAt: ago(3 * MINUTE_MS),
    });
    const origin: Record<string, unknown> = refusalRow();
    arrange([budget, origin]);
    await renderCard();

    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toHaveAttribute("data-reason", "project-daily-budget");
    expect(lines()[0]).toHaveAttribute("data-surface", "otel-logs");

    expect(
      within(lines()[0]!).getByTestId("ingestion-key-refusal-reason")
        .textContent,
    ).toBe("Project's daily ingestion budget used up");
    expect(
      within(lines()[0]!).getByTestId("ingestion-key-refusal-detail")
        .textContent,
    ).toBe(
      `Logs · 1,234 requests refused since ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        budget["firstRefusedAt"] as Date,
        true,
      )}, the latest ${OneUptimeDate.fromNow(
        budget["lastRefusedAt"] as Date,
        new Date(),
      )}.`,
    );

    // The page is the key's: its name would only repeat.
    expect(
      within(lines()[1]!).getByTestId("ingestion-key-refusal-reason")
        .textContent,
    ).toBe("Origin not allowed by the key");
    expect(lines()[1]!.textContent).not.toContain("Storefront browser key");
    expect(
      within(lines()[1]!).getByTestId("ingestion-key-refusal-detail")
        .textContent,
    ).toBe(
      `Traces · One request refused ${OneUptimeDate.fromNow(
        origin["lastRefusedAt"] as Date,
        new Date(),
      )}.`,
    );
  });

  test("refused in the past day: drawn as a problem; longer ago: as history", async () => {
    arrange([
      refusalRow({ reason: "key-disabled", lastRefusedAt: ago(3 * MINUTE_MS) }),
      refusalRow({
        reason: "key-expired",
        firstRefusedAt: ago(9 * DAY_MS),
        lastRefusedAt: ago(DAY_MS + 5 * MINUTE_MS),
      }),
    ]);
    await renderCard();

    expect(
      lines().map((line: HTMLElement): Array<string | null> => {
        return [
          line.getAttribute("data-recent"),
          line.querySelector("svg")?.getAttribute("class") || null,
        ];
      }),
    ).toEqual([
      ["true", expect.stringContaining("text-red-600")],
      ["false", expect.stringContaining("text-gray-400")],
    ]);
    // Told as what it was then, which an old line still is.
    expect(
      within(lines()[1]!).getByTestId("ingestion-key-refusal-reason")
        .textContent,
    ).toBe("Key expired");
  });

  test("a fix in the project's settings is a link; the key's own settings are on this page", async () => {
    arrange([
      refusalRow({ reason: "project-ingestion-rate", surface: "otel-metrics" }),
      refusalRow({ reason: "payment-required", surface: "syslog" }),
      refusalRow({ reason: "key-requests-per-minute", surface: "otel-logs" }),
      refusalRow({ reason: "key-disabled", surface: "session-replay" }),
      refusalRow({ reason: "project-blocked", surface: "grpc" }),
    ]);
    await renderCard();

    const links: Array<Array<string | null>> = lines().map(
      (line: HTMLElement): Array<string | null> => {
        const link: HTMLElement | null = within(line).queryByTestId(
          "ingestion-key-refusal-action",
        );
        return link ? [link.textContent, link.getAttribute("href")] : [];
      },
    );

    expect(links).toEqual([
      ["See budgets", `/dashboard/${PROJECT_ID}/settings/usage-history`],
      ["Add a payment method", `/dashboard/${PROJECT_ID}/settings/billing`],
      [],
      [],
      [],
    ]);
  });

  test("an endpoint it has no name for, or the guard's unnamed callers, are other endpoints", async () => {
    arrange([
      refusalRow({ surface: "unnamed" }),
      refusalRow({ surface: "a-surface-from-later", reason: "key-expired" }),
    ]);
    await renderCard();

    for (const line of lines()) {
      expect(
        within(line).getByTestId("ingestion-key-refusal-detail").textContent,
      ).toMatch(/^Other endpoints · /);
    }
  });

  test("a row it cannot read is left out", async () => {
    arrange([refusalRow({ reason: "some-future-reason" }), refusalRow()]);
    await renderCard();

    expect(lines()).toHaveLength(1);
  });

  test("a read that failed says so, and Check again reads again", async () => {
    arrange("fails", [refusalRow()]);
    await renderCard();

    expect(
      screen.getByTestId("ingestion-key-refusals-failed"),
    ).toHaveTextContent(
      "Couldn't load the refused telemetry. Try again in a moment.",
    );

    fireEvent.click(checkAgain());
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("ingestion-key-refusals-failed")).toBeNull();
    expect(lines()).toHaveLength(1);
  });

  test("a check again that fails keeps the lines the last read gave", async () => {
    arrange([refusalRow()], "fails");
    await renderCard();

    fireEvent.click(checkAgain());
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(lines()).toHaveLength(1);
    expect(screen.queryByTestId("ingestion-key-refusals-failed")).toBeNull();
  });
});

describe("in the reader's language", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const [language, locale] of [
      ["de", germanLocale],
      ["fa", persianLocale],
    ] as Array<[string, Record<string, unknown>]>) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: englishLocale },
          [language]: { translation: locale },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances[language] = instance;
    }
  });

  function within18n(
    language: string,
  ): (element: React.ReactElement) => React.ReactElement {
    return function inLanguage(
      element: React.ReactElement,
    ): React.ReactElement {
      return (
        <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>
      );
    };
  }

  test("German: the title, the reason, the endpoint and the fix", async () => {
    arrange([
      refusalRow({ reason: "key-disabled" }),
      refusalRow({ reason: "project-daily-budget", surface: "otel-logs" }),
    ]);
    await renderCard(within18n("de"));

    expect(screen.queryByText("Refused Telemetry")).toBeNull();
    expect(
      within(lines()[0]!).getByTestId("ingestion-key-refusal-reason")
        .textContent,
    ).toBe("Schlüssel ausgeschaltet");
    expect(
      within(lines()[1]!).getByTestId("ingestion-key-refusal-reason")
        .textContent,
    ).toBe("Tägliches Ingestion-Budget des Projekts aufgebraucht");
    expect(
      within(lines()[1]!).getByTestId("ingestion-key-refusal-action"),
    ).toHaveTextContent("Budgets ansehen");
  });

  test("Persian: the reason in Persian words alone, the line's bullet its own, and nothing left in English", async () => {
    arrange([refusalRow({ reason: "key-expired", refusedCount: 3 })]);
    await renderCard(within18n("fa"));

    const reason: string =
      within(lines()[0]!).getByTestId("ingestion-key-refusal-reason")
        .textContent || "";
    expect(reason).not.toBe("");
    expect(reason).not.toMatch(/[A-Za-z]/);
    expect(reason).not.toContain(FIRST_STRONG_ISOLATE);
    expect(reason).not.toContain(POP_DIRECTIONAL_ISOLATE);

    const detail: string =
      within(lines()[0]!).getByTestId("ingestion-key-refusal-detail")
        .textContent || "";
    expect(detail).toContain(" • ");
    expect(detail).not.toContain("requests refused");
    expect(detail).not.toMatch(/^Traces/);
  });
});
