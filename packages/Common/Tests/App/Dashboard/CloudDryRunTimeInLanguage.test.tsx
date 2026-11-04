import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { CLOUD_DRY_RUN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/CloudDryRunCopy";
import CloudDryRunNote, {
  CLOUD_DRY_RUN_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/CloudDryRunNote";
import {
  AiRemediationCommandDryRun,
  AiRemediationDryRunStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import OneUptimeDate from "../../../Types/Date";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHEN A CLOUD CHANGE WAS DRY RUN, IN THE READER'S LANGUAGE (#5519's
 * follow-up): "Dry run 5 minutes ago: this change would run." read
 * "Probelauf 5 minutes ago" on a German page. The time is written as every
 * date the Dashboard writes - in the language the reader picked, Persian
 * in its own digits - and counted from the clock the note reads its status
 * at, so a view (and a test) that pins it reads the same words every day.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: Array<string> = ["en", "de", "fa", "ja", "ru"];

const NOW: Date = new Date("2026-10-29T12:00:00.000Z");

function before(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function dryRun(
  status: AiRemediationDryRunStatus,
  minutesAgo: number,
): AiRemediationCommandDryRun {
  return { status, checkedAt: before(minutesAgo) };
}

function headline(): string {
  return withoutIsolateMarks(
    screen.getByTestId(`${CLOUD_DRY_RUN_NOTE_TEST_ID}-headline`).textContent ||
      "",
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// The locale's own sentence, with the time in its own words set into it.
function sentence(language: string, key: string, time: string): string {
  return withoutIsolateMarks(readLocale(language)[key]!).replace(
    "{{time}}",
    time,
  );
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
  // As the Dashboard does: dates follow the reader's language.
  followLanguageForDates(i18next);
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  await inLanguage("en");
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a dry run's time", () => {
  test("in English, counted from the note's clock, not the machine's", () => {
    render(
      <CloudDryRunNote
        dryRun={dryRun(AiRemediationDryRunStatus.WouldRun, 5)}
        now={NOW}
      />,
    );

    expect(headline()).toBe(
      "Dry run 5 minutes ago: this change would run. Nothing was changed.",
    );
  });

  test.each<[string, string, string]>([
    ["de", "vor 5 Minuten", "vor 2 Stunden"],
    ["fa", "۵ دقیقه پیش", "۲ ساعت پیش"],
    ["ja", "5 分前", "2 時間前"],
    ["ru", "5 минут назад", "2 часа назад"],
  ])(
    "in %s, as the reader's language writes it",
    async (language: string, fiveMinutes: string, twoHours: string) => {
      await inLanguage(language);

      const view: ReturnType<typeof render> = render(
        <CloudDryRunNote
          dryRun={dryRun(AiRemediationDryRunStatus.WouldRun, 5)}
          now={NOW}
        />,
      );

      expect(headline()).toBe(
        sentence(language, CLOUD_DRY_RUN_COPY.wouldRun, fiveMinutes),
      );
      expect(headline()).not.toMatch(/minutes|ago/);

      view.rerender(
        <CloudDryRunNote
          dryRun={dryRun(AiRemediationDryRunStatus.WouldBeRefused, 120)}
          now={NOW}
        />,
      );

      expect(headline()).toBe(
        sentence(language, CLOUD_DRY_RUN_COPY.wouldBeRefused, twoHours),
      );
    },
  );

  test("every headline carries it: would run, would be refused, could not finish", async () => {
    await inLanguage("de");

    for (const [status, key] of [
      [AiRemediationDryRunStatus.WouldRun, CLOUD_DRY_RUN_COPY.wouldRun],
      [
        AiRemediationDryRunStatus.WouldBeRefused,
        CLOUD_DRY_RUN_COPY.wouldBeRefused,
      ],
      [AiRemediationDryRunStatus.Failed, CLOUD_DRY_RUN_COPY.failed],
    ] as Array<[AiRemediationDryRunStatus, string]>) {
      render(<CloudDryRunNote dryRun={dryRun(status, 3)} now={NOW} />);

      expect(headline()).toBe(sentence("de", key, "vor 3 Minuten"));
      cleanup();
    }
  });

  test("on the card, where no clock is pinned, it counts from now - in the reader's language", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    await inLanguage("de");

    render(
      <CloudDryRunNote
        dryRun={dryRun(AiRemediationDryRunStatus.WouldRun, 5)}
      />,
    );

    expect(headline()).toBe(
      sentence("de", CLOUD_DRY_RUN_COPY.wouldRun, "vor 5 Minuten"),
    );
  });

  test("a language switch rewrites it", async () => {
    const view: ReturnType<typeof render> = render(
      <CloudDryRunNote
        dryRun={dryRun(AiRemediationDryRunStatus.WouldRun, 5)}
        now={NOW}
      />,
    );
    expect(headline()).toContain("5 minutes ago");

    await inLanguage("ja");
    view.rerender(
      <CloudDryRunNote
        dryRun={dryRun(AiRemediationDryRunStatus.WouldRun, 5)}
        now={NOW}
      />,
    );

    expect(headline()).toBe(
      sentence("ja", CLOUD_DRY_RUN_COPY.wouldRun, "5 分前"),
    );
  });
});

describe("OneUptimeDate.fromNow from a given moment", () => {
  test("counts from it, rounded as moment rounds, in English and in the reader's language", async () => {
    const date: Date = new Date(before(50));

    expect(OneUptimeDate.fromNow(date, NOW)).toBe("an hour ago");
    expect(OneUptimeDate.fromNow(new Date(before(5)), NOW)).toBe(
      "5 minutes ago",
    );
    expect(
      OneUptimeDate.fromNow(new Date(NOW.getTime() + 3 * 86_400_000), NOW),
    ).toBe("in 3 days");

    await inLanguage("de");
    expect(OneUptimeDate.fromNow(date, NOW)).toBe("vor 1 Stunde");
  });

  test("without one, from now, as it always was", () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });

    expect(OneUptimeDate.fromNow(new Date(before(5)))).toBe("5 minutes ago");
  });
});
