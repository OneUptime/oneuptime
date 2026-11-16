import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import {
  AUDIT_LOG_EXPORT_SCOPE_COPY,
  AuditLogExportCopy,
  AuditLogExportScope,
} from "../../../Dashboard/AuditLogExport/AuditLogExportCopy";
import {
  AuditLogExportEntriesLostLine,
  getAuditLogExportEntriesLostSentence,
  readAuditLogExportEntriesLostAt,
} from "../../../Dashboard/AuditLogExport/AuditLogExportEntriesLost";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * A failing export's deadline, in its View Error dialog (#7186).
 * ---------------------------------------------------------------------------
 *
 * One line under the next try: from when the entries waiting to be sent
 * start to be deleted, or - once that moment has passed, by the moment the
 * server read it - that they are being deleted since then. Asked of the
 * project's route or the instance's, with the page's own headers; nothing
 * waiting, a read that fails or an answer with no date draws no line. In
 * the reader's language, Persian and Arabic included.
 */

const EXPORT_ID: string = "77777777-7777-4777-8777-777777777777";
const READ_AT: Date = new Date("2026-11-16T09:30:00.000Z");
const AHEAD: Date = new Date("2026-11-18T14:00:00.000Z");
const PASSED: Date = new Date("2026-11-10T06:00:00.000Z");

const answer: (entriesLostAt: Date | null) => HTTPResponse<JSONObject> = (
  entriesLostAt: Date | null,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(
    200,
    {
      entriesLostAt: entriesLostAt ? entriesLostAt.toISOString() : null,
      readAt: READ_AT.toISOString(),
    },
    {},
  );
};

const instanceFor: (language: string) => i18n = (language: string): i18n => {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
};

const drawLine: (data?: {
  language?: string;
  scope?: AuditLogExportScope;
}) => Promise<void> = async (data?: {
  language?: string;
  scope?: AuditLogExportScope;
}): Promise<void> => {
  const scope: AuditLogExportScope = data?.scope || AuditLogExportScope.Project;

  await act(async () => {
    render(
      <I18nextProvider i18n={instanceFor(data?.language || "en")}>
        <AuditLogExportEntriesLostLine
          route={AUDIT_LOG_EXPORT_SCOPE_COPY[scope].entriesLostAtRoute}
          modelAPI={
            scope === AuditLogExportScope.Project
              ? ModelAPI
              : (AdminModelAPI as unknown as typeof ModelAPI)
          }
          exportId={EXPORT_ID}
        />
      </I18nextProvider>,
    );
  });
  // The read's answer.
  await act(async () => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

const postsTo: () => Array<JSONObject> = (): Array<JSONObject> => {
  return jest.mocked(API.post).mock.calls.map((call: Array<unknown>) => {
    return call[0] as JSONObject;
  });
};

beforeEach(() => {
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: "11111111-1111-4111-8111-111111111111" });
  jest.spyOn(API, "post").mockResolvedValue(answer(AHEAD) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which words the line says", () => {
  test("a date still ahead: from when the entries start to be deleted", () => {
    expect(
      getAuditLogExportEntriesLostSentence({
        entriesLostAt: AHEAD,
        readAt: READ_AT,
      }),
    ).toEqual({
      template: AuditLogExportCopy.entriesLostFrom,
      isLosingEntries: false,
    });
  });

  test("a date that has passed - or is the moment it was read - since when they are being deleted", () => {
    for (const entriesLostAt of [PASSED, READ_AT]) {
      expect(
        getAuditLogExportEntriesLostSentence({
          entriesLostAt,
          readAt: READ_AT,
        }),
      ).toEqual({
        template: AuditLogExportCopy.entriesLostSince,
        isLosingEntries: true,
      });
    }
  });

  test("a millisecond ahead is still ahead", () => {
    expect(
      getAuditLogExportEntriesLostSentence({
        entriesLostAt: new Date(READ_AT.getTime() + 1),
        readAt: READ_AT,
      }).isLosingEntries,
    ).toBe(false);
  });

  test("the words are the export screens' own", () => {
    expect(AuditLogExportCopy.entriesLostFrom).toBe(
      "Entries waiting to be sent start to be deleted from about {{time}}.",
    );
    expect(AuditLogExportCopy.entriesLostSince).toBe(
      "Since about {{time}}, entries waiting to be sent are being deleted.",
    );
  });
});

describe("the line in the View Error dialog", () => {
  test("a date ahead: one quiet line, with the date", async () => {
    await drawLine();

    const line: HTMLElement = screen.getByTestId(
      "audit-log-export-entries-lost",
    );

    expect(line).toHaveTextContent(
      `Entries waiting to be sent start to be deleted from about ${OneUptimeDate.getDateAsLocalFormattedString(AHEAD)}.`,
    );
    expect(line.getAttribute("data-losing-entries")).toBe("false");
    expect(line.className).toContain("text-gray-500");
    // At a phone's width the sentence wraps, never cut or pushed sideways.
    expect(line.className).not.toMatch(/truncate|nowrap|w-\[/);
  });

  test("a date passed: said as entries being deleted, in red", async () => {
    jest.mocked(API.post).mockResolvedValue(answer(PASSED) as never);

    await drawLine();

    const line: HTMLElement = screen.getByTestId(
      "audit-log-export-entries-lost",
    );

    expect(line).toHaveTextContent(
      `Since about ${OneUptimeDate.getDateAsLocalFormattedString(PASSED)}, entries waiting to be sent are being deleted.`,
    );
    expect(line.getAttribute("data-losing-entries")).toBe("true");
    expect(line.className).toContain("text-red-700");
  });

  test("asks the project's route about this export, with the page's headers", async () => {
    await drawLine();

    expect(postsTo()).toHaveLength(1);
    expect(String(postsTo()[0]!["url"])).toContain(
      "/audit-log-export/entries-lost-at",
    );
    expect(postsTo()[0]!["data"]).toEqual({ exportId: EXPORT_ID });
    expect(postsTo()[0]!["headers"]).toEqual({
      tenantid: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("the instance's page asks the instance's route", async () => {
    jest.spyOn(AdminModelAPI, "getCommonHeaders").mockReturnValue({});

    await drawLine({ scope: AuditLogExportScope.Instance });

    expect(String(postsTo()[0]!["url"])).toContain(
      "/audit-log-export/instance/entries-lost-at",
    );
    expect(postsTo()[0]!["headers"]).toEqual({});
  });

  test("nothing waiting draws no line", async () => {
    jest.mocked(API.post).mockResolvedValue(answer(null) as never);

    await drawLine();

    expect(screen.queryByTestId("audit-log-export-entries-lost")).toBeNull();
  });

  test("a read that fails draws no line rather than a wrong date", async () => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPErrorResponse(
          500,
          { message: "TIMEOUT_EXCEEDED" },
          {},
        ) as never,
      );

    await drawLine();

    expect(screen.queryByTestId("audit-log-export-entries-lost")).toBeNull();
  });

  test("and so does a request that throws", async () => {
    jest.mocked(API.post).mockRejectedValue(new Error("offline") as never);

    await drawLine();

    expect(screen.queryByTestId("audit-log-export-entries-lost")).toBeNull();
    await expect(
      readAuditLogExportEntriesLostAt({
        route: "/audit-log-export/entries-lost-at",
        modelAPI: ModelAPI,
        exportId: EXPORT_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("in the reader's language", () => {
  test.each(["de", "fa", "ar"])(
    "in %s, the date ahead and the date passed are each the locale's sentence",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const [date, english] of [
        [AHEAD, AuditLogExportCopy.entriesLostFrom],
        [PASSED, AuditLogExportCopy.entriesLostSince],
      ] as Array<[Date, string]>) {
        jest.mocked(API.post).mockResolvedValue(answer(date) as never);

        await drawLine({ language });

        const line: HTMLElement = screen.getByTestId(
          "audit-log-export-entries-lost",
        );
        const sentence: string = words[english]!;
        const [before, after] = sentence.split("{{time}}") as [string, string];

        expect(sentence).not.toBe(english);
        expect(line.textContent).toContain(before.trim());
        expect(line.textContent).toContain(after.trim());
        // Never the English sentence around the date.
        expect(line.textContent).not.toContain("entries waiting to be sent");

        cleanup();
      }
    },
  );
});
