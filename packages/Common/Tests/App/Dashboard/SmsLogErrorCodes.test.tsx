import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import {
  TWILIO_ERROR_CODE_MEANINGS,
  getTwilioErrorCodeMeaning,
} from "../../../Types/CallAndSMS/TwilioErrorCode";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";

/*
 * THE SMS LOG'S ERROR CODE SAYS WHAT IT MEANS (#11417).
 *
 * The Error Code column showed Twilio's code as a bare number. It links to
 * Twilio's page for the code, in a new tab, and the codes an SMS most often
 * fails with say under it in one plain line what they mean, in the
 * reader's language. A code that is not Twilio's - the HTTP status the
 * server's own SMS and call gateway answered, a network's code - is drawn
 * as written, with nothing to open.
 *
 * The SMS log runs as it is and hands its columns to ModelTable, replaced
 * by a recorder; its Error Code column is drawn for a row, from the
 * Dashboard's own locale files.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

type LogRow = Record<string, unknown> & { _id: string };

interface CapturedColumn {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  hideOnMobile?: boolean | undefined;
  getElement?: ((item: LogRow) => ReactElement) | undefined;
}

let capturedColumns: Array<CapturedColumn> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns: Array<CapturedColumn> }) => {
      capturedColumns = props.columns;
      return null;
    },
  };
});

import SmsLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable";
import SmsErrorCode, {
  SMS_ERROR_CODE_LINK_TEST_ID,
  SMS_ERROR_CODE_MEANING_TEST_ID,
  SMS_ERROR_CODE_TEST_ID,
  TWILIO_ERROR_CODE_LINK_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsErrorCode";

const PROJECT_ID: ObjectID = new ObjectID(
  "11417000-0000-4000-8000-0000000000b1",
);

async function readIn(language: string): Promise<void> {
  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: "en",
    resources: {
      [language]: { translation: readDashboardLocale(language) },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  await i18next.changeLanguage(language);
}

beforeEach(async () => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  await readIn("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The SMS log's Error Code column, as it hands it to ModelTable.
function errorCodeColumn(): CapturedColumn {
  capturedColumns = [];
  render(<SmsLogsTable />);
  cleanup();

  const column: CapturedColumn | undefined = capturedColumns.find(
    (candidate: CapturedColumn): boolean => {
      return Boolean(candidate.field && "errorCode" in candidate.field);
    },
  );

  expect(column?.getElement).toBeDefined();

  return column!;
}

interface DrawnCode {
  cell: HTMLElement;
  link: HTMLAnchorElement | null;
  meaning: string | null;
}

// A row's Error Code, drawn as the table draws it.
function drawCode(errorCode: string | undefined): DrawnCode {
  const column: CapturedColumn = errorCodeColumn();

  render(
    <div data-testid="cell">
      {column.getElement!({
        _id: "11417000-0000-4000-8000-0000000000b2",
        ...(errorCode !== undefined ? { errorCode: errorCode } : {}),
      })}
    </div>,
  );

  const cell: HTMLElement = screen.getByTestId("cell");

  return {
    cell: cell,
    link: within(cell).queryByTestId(
      SMS_ERROR_CODE_LINK_TEST_ID,
    ) as HTMLAnchorElement | null,
    meaning:
      within(cell).queryByTestId(SMS_ERROR_CODE_MEANING_TEST_ID)?.textContent ||
      null,
  };
}

describe("the SMS log's Error Code column", () => {
  test("is titled Error Code, and shows on a phone's card too: it says why an SMS failed", () => {
    const column: CapturedColumn = errorCodeColumn();

    expect(column.title).toBe("Error Code");
    expect(column.hideOnMobile).toBeFalsy();
  });

  test("a code Twilio gave opens Twilio's page for it, in a new tab, and says what it means", () => {
    const drawn: DrawnCode = drawCode("30003");

    expect(drawn.link).not.toBeNull();
    expect(drawn.link!.getAttribute("href")).toBe(
      "https://www.twilio.com/docs/api/errors/30003",
    );
    expect(drawn.link!.getAttribute("target")).toBe("_blank");
    expect(drawn.link).toHaveTextContent("30003");
    expect(drawn.meaning).toBe("The phone is off or out of reach.");
  });

  test("the link says where it leads to a screen reader and under a pointer", () => {
    const drawn: DrawnCode = drawCode("30005");

    expect(drawn.link!.getAttribute("aria-label")).toBe(
      "Twilio's page for error 30005, in a new tab",
    );
    expect(drawn.link!.getAttribute("title")).toBe(
      "Twilio's page for error 30005, in a new tab",
    );
    expect(TWILIO_ERROR_CODE_LINK_TITLE).toContain("{{code}}");
  });

  test("the code reads from the left on a page read from the right too", () => {
    const drawn: DrawnCode = drawCode("30007");

    expect(within(drawn.link!).getByText("30007")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test.each(Object.keys(TWILIO_ERROR_CODE_MEANINGS))(
    "%s: its page, and its plain line",
    (code: string) => {
      const drawn: DrawnCode = drawCode(code);

      expect(drawn.link!.getAttribute("href")).toBe(
        `https://www.twilio.com/docs/api/errors/${code}`,
      );
      expect(drawn.meaning).toBe(getTwilioErrorCodeMeaning(code));
    },
  );

  test("a code of Twilio's the log does not explain still opens its page, with no line under it", () => {
    const drawn: DrawnCode = drawCode("63016");

    expect(drawn.link!.getAttribute("href")).toBe(
      "https://www.twilio.com/docs/api/errors/63016",
    );
    expect(drawn.meaning).toBeNull();
  });

  test("the HTTP status a gateway answered, and a network's code, are drawn as written, with nothing to open", () => {
    for (const code of ["500", "404", "ECONNRESET"]) {
      const drawn: DrawnCode = drawCode(code);

      expect({ code, link: drawn.link }).toEqual({ code, link: null });
      expect(
        within(drawn.cell).getByTestId(SMS_ERROR_CODE_TEST_ID),
      ).toHaveTextContent(code);
      expect(drawn.meaning).toBeNull();
      cleanup();
    }
  });

  test("an SMS with no code draws the quiet dash", () => {
    for (const code of [undefined, "", "  "]) {
      const drawn: DrawnCode = drawCode(code);

      expect(
        within(drawn.cell).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
      ).toBeInTheDocument();
      expect(drawn.link).toBeNull();
      cleanup();
    }
  });

  test("the line under a code is small print people can read: 12px, at 4.5:1", () => {
    const drawn: DrawnCode = drawCode("30003");
    const meaning: HTMLElement = within(drawn.cell).getByTestId(
      SMS_ERROR_CODE_MEANING_TEST_ID,
    );

    expect(meaning.className).toContain("text-xs");
    expect(meaning.className).toContain("text-gray-600");
  });
});

describe("in every language the Dashboard ships", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s says what each code means in its own words, and names the link in them",
    async (language: string) => {
      await readIn(language);

      const locale: Record<string, string> = readDashboardLocale(language);
      // As the page draws it: French's colon with its no-break space, and the like.
      const drawn: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      for (const [code, meaning] of Object.entries(
        TWILIO_ERROR_CODE_MEANINGS,
      )) {
        render(<SmsErrorCode code={code} />);

        expect({
          code,
          meaning: screen.getByTestId(SMS_ERROR_CODE_MEANING_TEST_ID)
            .textContent,
        }).toEqual({ code, meaning: drawn[meaning] });
        expect({ code, isEnglish: locale[meaning] === meaning }).toEqual({
          code,
          isEnglish: false,
        });

        const title: string = screen
          .getByTestId(SMS_ERROR_CODE_LINK_TEST_ID)
          .getAttribute("aria-label")!;

        expect(title).toContain(code);
        expect(title).toBe(
          drawn[TWILIO_ERROR_CODE_LINK_TITLE]!.replace("{{code}}", code),
        );
        cleanup();
      }
    },
  );
});
