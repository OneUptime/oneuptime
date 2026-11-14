import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import AttemptLine from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/AttemptLine";
import CustomMonitorSummaryView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/CustomMonitorSummaryView";
import ProbeAttemptsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeAttemptsView";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * ONE ATTEMPT OF A CHECK ON ONE LINE, IN ANY READING ORDER.
 *
 * A probe's Retry Attempts and a custom code monitor's drew "Attempt 3/3 —
 * Succeeded — 1,234 ms — HTTP 200" as plain spans in one line. On an
 * Arabic or Persian page "1,234 ms" and "HTTP 200" ran together into one
 * left-to-right stretch, which drew "1,234 HTTP 200 — ms": the milliseconds
 * cut from their number. On a phone a line broke inside a part, "HTTP"
 * above its "200", and a wrapped line started with a dash. Its figures
 * were in a monospace font, which spaced out the Arabic word for "Attempt"
 * letter by letter.
 *
 * Each part is an isolate of its own now, never broken across lines, with
 * its dash kept beside the part before it; and the card is worded in every
 * language, not only the count.
 */

const LANGUAGES: Array<string> = ["en", "de", "fa", "ar"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

afterAll(() => {
  setDateDisplayLanguage("en");
});

const inLanguage: (
  language: string,
  element: React.ReactElement,
) => React.ReactElement = (
  language: string,
  element: React.ReactElement,
): React.ReactElement => {
  return (
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>
  );
};

// What a line says, part by part: each part's isolate, as a reader sees it.
const partsOf: (line: Element) => Array<string> = (
  line: Element,
): Array<string> => {
  return Array.from(line.querySelectorAll("bdi")).map(
    (part: Element): string => {
      return withoutIsolateMarks(part.textContent || "");
    },
  );
};

describe("the line itself", () => {
  const line: () => HTMLElement = (): HTMLElement => {
    const result: RenderResult = render(
      <AttemptLine
        testId="line"
        parts={[
          { text: "المحاولة 3/3" },
          { text: "نجح", className: "text-green-700" },
          { text: "1,234 ms" },
          { text: "HTTP 200" },
        ]}
      />,
    );

    return result.getByTestId("line");
  };

  test("each part is an isolate of its own, with its own colour", () => {
    const drawn: HTMLElement = line();
    const parts: Array<Element> = Array.from(drawn.querySelectorAll("bdi"));

    expect(
      parts.map((part: Element) => {
        return part.textContent;
      }),
    ).toEqual(["المحاولة 3/3", "نجح", "1,234 ms", "HTTP 200"]);
    expect(parts[1]).toHaveClass("text-green-700");
    expect(parts[0]!.className).toBe("");
  });

  test("a part never breaks across lines, and its dash stays beside it", () => {
    const drawn: HTMLElement = line();
    const groups: Array<Element> = Array.from(drawn.children).filter(
      (child: Element): boolean => {
        return child.tagName === "SPAN";
      },
    );

    expect(groups).toHaveLength(4);

    groups.forEach((group: Element, index: number) => {
      expect(group).toHaveClass("whitespace-nowrap");
      // The part first, then its dash: a wrapped line ends in a dash.
      expect(group.firstElementChild!.tagName).toBe("BDI");
      expect(group.textContent!.endsWith("—")).toBe(index < 3);
    });

    // The line may wrap after a dash, and nowhere else.
    expect(drawn.querySelectorAll("wbr")).toHaveLength(3);
    expect(drawn.firstElementChild!.tagName).toBe("SPAN");
  });

  test("its figures are tabular, in the page's own font", () => {
    const drawn: HTMLElement = line();

    expect(drawn).toHaveClass("tabular-nums");
    expect(drawn.querySelector(".font-mono")).toBeNull();
    expect(drawn.textContent).toBe("المحاولة 3/3—نجح—1,234 ms—HTTP 200");
  });
});

describe("a probe's Retry Attempts", () => {
  const attempts: Array<ProbeAttempt> = [1, 2, 3].map(
    (attemptNumber: number): ProbeAttempt => {
      return {
        attemptNumber: attemptNumber,
        attemptedAt: new Date(Date.UTC(2026, 10, 12, 9, 30, attemptNumber)),
        responseReceivedAt: new Date(
          Date.UTC(2026, 10, 12, 9, 30, attemptNumber + 1),
        ),
        responseTimeInMs: 1234.4,
        responseCode: attemptNumber === 3 ? 200 : undefined,
        isOnline: attemptNumber === 3,
        failureCause: attemptNumber === 3 ? undefined : "Timed out",
      };
    },
  );

  const drawn: (language: string) => RenderResult = (
    language: string,
  ): RenderResult => {
    return render(
      inLanguage(language, <ProbeAttemptsView attempts={attempts} />),
    );
  };

  test("in Persian: each part apart, in Persian digits, and the card worded", () => {
    const result: RenderResult = drawn("fa");
    const lines: Array<HTMLElement> =
      result.getAllByTestId("probe-attempt-line");

    expect(lines).toHaveLength(3);
    expect(partsOf(lines[2]!)).toEqual([
      "تلاش ۳/۳",
      "موفق",
      "۱٬۲۳۴ میلی‌ثانیه",
      "HTTP 200",
    ]);
    expect(partsOf(lines[0]!)).toEqual([
      "تلاش ۱/۳",
      "ناموفق",
      "۱٬۲۳۴ میلی‌ثانیه",
    ]);

    const card: string = withoutIsolateMarks(
      result.container.textContent || "",
    );
    expect(card).toContain("تلاش‌های مجدد");
    expect(card).toContain("هر تلاشی که برای این بررسی انجام شد، به ترتیب.");
    expect(card).toContain("شروع ");
    expect(card).toContain(" ← پاسخ ");
    expect(card).not.toContain("Retry Attempts");
    expect(card).not.toContain("Started");
  });

  test("in Arabic: Latin digits, each part apart", () => {
    const result: RenderResult = drawn("ar");

    expect(partsOf(result.getAllByTestId("probe-attempt-line")[2]!)).toEqual([
      "المحاولة 3/3",
      "نجح",
      "1,234 ملي ث",
      "HTTP 200",
    ]);
  });

  test("in German: the count, the start and the answer are worded", () => {
    const result: RenderResult = drawn("de");

    expect(partsOf(result.getAllByTestId("probe-attempt-line")[0]!)).toEqual([
      "Versuch 1/3",
      "Fehlgeschlagen",
      "1.234 ms",
    ]);

    const card: string = withoutIsolateMarks(
      result.container.textContent || "",
    );
    expect(card).toContain("Wiederholungsversuche");
    expect(card).toContain("Gestartet ");
    expect(card).toContain(" → Antwort ");
    expect(card).not.toContain("Attempt");
  });

  test("in English the line reads as before", () => {
    const result: RenderResult = drawn("en");

    expect(
      result.getAllByTestId("probe-attempt-line").map((line: HTMLElement) => {
        return line.textContent;
      }),
    ).toEqual([
      "Attempt 1/3—Failed—1,234 ms",
      "Attempt 2/3—Failed—1,234 ms",
      "Attempt 3/3—Succeeded—1,234 ms—HTTP 200",
    ]);
  });
});

describe("a custom code monitor's Retry Attempts", () => {
  const RUN: CustomCodeMonitorResponse = {
    executionTimeInMS: 1234.4,
    totalAttempts: 2,
    retryAttempts: [
      { attemptNumber: 1, executionTimeInMS: 30000, scriptError: "Timeout" },
      { attemptNumber: 2, executionTimeInMS: 1234.4 },
    ],
  } as CustomCodeMonitorResponse;

  const drawn: (language: string) => RenderResult = (
    language: string,
  ): RenderResult => {
    const result: RenderResult = render(
      inLanguage(
        language,
        <CustomMonitorSummaryView
          customCodeMonitorResponse={RUN}
          monitoredAt={new Date(Date.UTC(2026, 10, 12, 9, 30))}
        />,
      ),
    );

    fireEvent.click(result.getByRole("button"));

    return result;
  };

  test("in Persian: each part apart, in Persian digits", () => {
    const lines: Array<HTMLElement> = drawn("fa").getAllByTestId(
      "custom-monitor-attempt-line",
    );

    expect(lines.map(partsOf)).toEqual([
      ["تلاش ۱/۲", "ناموفق", "۳۰٬۰۰۰ میلی‌ثانیه"],
      ["تلاش ۲/۲", "موفق", "۱٬۲۳۴ میلی‌ثانیه"],
    ]);
  });

  test("in English the line reads as before", () => {
    const lines: Array<HTMLElement> = drawn("en").getAllByTestId(
      "custom-monitor-attempt-line",
    );

    expect(
      lines.map((line: HTMLElement) => {
        return line.textContent;
      }),
    ).toEqual([
      "Attempt 1/2—Failed—30,000 ms",
      "Attempt 2/2—Succeeded—1,234 ms",
    ]);
  });
});
