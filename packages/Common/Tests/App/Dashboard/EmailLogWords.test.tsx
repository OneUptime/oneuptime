import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN EMAIL LOG SAYS EMAIL (#7283).
 *
 * The email log model's status column was copied from the SMS log's and
 * kept its words: "Status of the SMS", "Status of the SMS sent". The title
 * is what the API reference, an export and the table's column picker call
 * the column, and the Dashboard's locale files translate it - so every
 * language said SMS on an email's status. It reads "Status of the Email"
 * now, worded in every language, and nothing else of the email log - its
 * model or its table - says SMS. The table's View Subject showed the
 * subject as a JSON string, in quotes and with its own quotes escaped; it
 * shows the subject as it was sent, as the SMS log shows its text.
 */

jest.mock("../../../UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,////YXZhdGFy";
});

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

interface CapturedActionButton {
  title: string;
  onClick: (item: Record<string, unknown>, done: () => void) => Promise<void>;
}

interface CapturedTableProps {
  columns: Array<{ title?: string | undefined }>;
  filters: Array<{ title?: string | undefined }>;
  actionButtons: Array<CapturedActionButton>;
  noItemsMessage?: string | undefined;
}

let capturedTableProps: CapturedTableProps | null = null;

// The real ModelTable needs an API; what matters is what it was handed.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import EmailLogsTable, {
  EMAIL_WITHOUT_SUBJECT_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable";
import EmailLog from "../../../Models/DatabaseModels/EmailLog";
import SmsLog from "../../../Models/DatabaseModels/SmsLog";
import ObjectID from "../../../Types/ObjectID";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const SMS: RegExp = /\bsms\b/i;

// Every title and description a model's columns carry.
function columnWords(
  model: EmailLog | SmsLog,
): Array<{ column: string; title: string; description: string }> {
  return model.getTableColumns().columns.map((column: string) => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);
    return {
      column,
      title: metadata.title || "",
      description: metadata.description || "",
    };
  });
}

function sayingSms(model: EmailLog | SmsLog): Array<string> {
  return columnWords(model)
    .filter((words: { title: string; description: string }): boolean => {
      return SMS.test(words.title) || SMS.test(words.description);
    })
    .map((words: { column: string }): string => {
      return words.column;
    });
}

describe("the email log model", () => {
  test("its status column is the email's status", () => {
    const status: TableColumnMetadata = new EmailLog().getTableColumnMetadata(
      "status",
    );

    expect(status.title).toBe("Status of the Email");
    expect(status.description).toBe("Status of the email sent");
  });

  test("no column of it says SMS", () => {
    expect(columnWords(new EmailLog()).length).toBeGreaterThan(20);
    expect(sayingSms(new EmailLog())).toEqual([]);
  });

  test("the check finds SMS where it belongs: the SMS log's status (control)", () => {
    expect(sayingSms(new SmsLog())).toContain("status");
    expect(new SmsLog().getTableColumnMetadata("status").title).toBe(
      "Status of the SMS",
    );
  });
});

describe("the email status's title, in every language", () => {
  test("is a key of the Dashboard's English file, beside the SMS log's", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(english["Status of the Email"]).toBe("Status of the Email");
    expect(english["Status of the SMS"]).toBe("Status of the SMS");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words it, and not as the SMS log's",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(isWordedInDashboardLocale("Status of the Email", language)).toBe(
        true,
      );
      expect(words["Status of the Email"]).not.toBe(words["Status of the SMS"]);
      expect(words["Status of the Email"]).not.toMatch(SMS);
    },
  );
});

describe("the email logs table", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID("00000000-0000-4000-8000-000000000001"));
    render(<EmailLogsTable />);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("names nothing SMS: no column, filter, button or empty message", () => {
    const words: Array<string> = [
      ...capturedTableProps!.columns.map(
        (column: { title?: string | undefined }) => {
          return column.title || "";
        },
      ),
      ...capturedTableProps!.filters.map(
        (filter: { title?: string | undefined }) => {
          return filter.title || "";
        },
      ),
      ...capturedTableProps!.actionButtons.map(
        (button: CapturedActionButton) => {
          return button.title;
        },
      ),
      capturedTableProps!.noItemsMessage || "",
    ];

    expect(words.length).toBeGreaterThan(5);
    expect(
      words.filter((word: string): boolean => {
        return SMS.test(word);
      }),
    ).toEqual([]);
  });

  test("View Subject shows the subject as it was sent, not as a JSON string", async () => {
    const viewSubject: CapturedActionButton =
      capturedTableProps!.actionButtons.find(
        (button: CapturedActionButton): boolean => {
          return button.title === "View Subject";
        },
      )!;
    const done: MockFunction = getJestMockFunction();
    const subject: string = 'Disk "data" is 95% full on db-1';

    await act(async () => {
      await viewSubject.onClick({ subject }, done);
    });

    expect(done).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Subject of Email Message")).toBeInTheDocument();
    expect(screen.getByText(subject)).toBeInTheDocument();
    expect(screen.queryByText(JSON.stringify(subject))).not.toBeInTheDocument();
  });

  /*
   * An email sent without a subject opened a dialog with nothing under its
   * title: a sentence says so, in the reader's language.
   */
  test.each([
    ["no subject", {}],
    ["an empty subject", { subject: "" }],
  ])(
    "View Subject of a row with %s says the email had none, never the word undefined",
    async (_case: string, item: Record<string, unknown>) => {
      const viewSubject: CapturedActionButton =
        capturedTableProps!.actionButtons.find(
          (button: CapturedActionButton): boolean => {
            return button.title === "View Subject";
          },
        )!;

      await act(async () => {
        await viewSubject.onClick(item, () => {
          return undefined;
        });
      });

      expect(screen.getByText("Subject of Email Message")).toBeInTheDocument();
      expect(
        screen.getByText("This email was sent without a subject."),
      ).toBeInTheDocument();
      expect(screen.queryByText("undefined")).not.toBeInTheDocument();
      expect(screen.queryByText('""')).not.toBeInTheDocument();
    },
  );
});

describe("an email without a subject, in every language", () => {
  test("the sentence is a key of the Dashboard's English file", () => {
    expect(EMAIL_WITHOUT_SUBJECT_TEXT).toBe(
      "This email was sent without a subject.",
    );
    expect(readDashboardLocale("en")[EMAIL_WITHOUT_SUBJECT_TEXT]).toBe(
      EMAIL_WITHOUT_SUBJECT_TEXT,
    );
  });

  test.each(DASHBOARD_LANGUAGES)("%s words it", (language: string) => {
    expect(
      isWordedInDashboardLocale(EMAIL_WITHOUT_SUBJECT_TEXT, language),
    ).toBe(true);
  });

  test.each([
    ["de", "Diese E-Mail wurde ohne Betreff gesendet."],
    ["fa", "این ایمیل بدون موضوع ارسال شده است."],
    ["ar", "أُرسل هذا البريد الإلكتروني بدون موضوع."],
  ])("%s reads %s", (language: string, sentence: string) => {
    expect(readDashboardLocale(language)[EMAIL_WITHOUT_SUBJECT_TEXT]).toBe(
      sentence,
    );
  });
});
