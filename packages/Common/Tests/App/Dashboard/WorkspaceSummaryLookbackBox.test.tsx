import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import type Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Validation from "../../../UI/Components/Forms/Validation";
import Column from "../../../UI/Components/ModelTable/Column";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import {
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
} from "../../../Utils/Workspace/WorkspaceSummarySetup";

/*
 * #7352: A WORKSPACE SUMMARY'S LOOKBACK PERIOD (DAYS) on the Dashboard -
 * the box that sets it, the summaries table's Lookback column, and Send
 * Test Now's question.
 *
 * The box took 0, which the server refused by the column's name
 * ("numberOfDaysOfData is required"), and -5, which it saved: the summary
 * then covered a window in the future. It now takes 1 to 365 days, as the
 * server does. A summary stored before with less than a day covers 7 days,
 * and the table and Send Test Now say 7, as its report does; they said 0
 * and -5.
 *
 * The production table builds the form and the columns; the table around
 * them is a stand-in that keeps what it was handed and draws the row's
 * action buttons.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "73520000-0000-4000-8000-0000000000d1",
);

const SUMMARY_ID: ObjectID = new ObjectID(
  "73520000-0000-4000-8000-0000000000d2",
);

// The days the stand-in table's row was stored with.
let rowDays: number | undefined = 7;

// What the production table handed the stand-in.
let lastTableProps: ModelTableProps<WorkspaceNotificationSummary> | undefined =
  undefined;

function summaryRow(days: number | undefined): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = SUMMARY_ID.toString();
  summary.name = "Weekly incidents";

  if (days !== undefined) {
    summary.numberOfDaysOfData = days;
  }

  return summary;
}

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const StandInTable: (
    props: ModelTableProps<WorkspaceNotificationSummary>,
  ) => ReactElement = (
    props: ModelTableProps<WorkspaceNotificationSummary>,
  ): ReactElement => {
    lastTableProps = props;

    return (
      <div data-testid="summary-row">
        {(props.actionButtons || []).map(
          (button: {
            title: string;
            onClick: (
              item: WorkspaceNotificationSummary,
              onCompleteAction: () => void,
              onError: (error: Error) => void,
            ) => void;
          }): ReactElement => {
            return (
              <button
                key={button.title}
                type="button"
                onClick={() => {
                  button.onClick(
                    summaryRow(rowDays),
                    () => {},
                    () => {},
                  );
                }}
              >
                {button.title}
              </button>
            );
          },
        )}
      </div>
    );
  };

  return {
    __esModule: true,
    default: StandInTable,
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

import WorkspaceSummaryTable from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

type Values = Record<string, unknown>;

async function renderTable(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceSummaryTable
        workspaceType={WorkspaceType.Slack}
        summaryType={WorkspaceNotificationSummaryType.Incident}
      />,
    );
  });

  await screen.findByTestId("summary-row");
}

// Whether a field or a column is the summary's numberOfDaysOfData.
function isLookback(field: unknown): boolean {
  return Object.keys(
    (field as Record<string, unknown> | undefined) || {},
  ).includes("numberOfDaysOfData");
}

// The create and edit form's Lookback Period box.
function lookbackBox(): ModelField<WorkspaceNotificationSummary> {
  const box: ModelField<WorkspaceNotificationSummary> | undefined = (
    lastTableProps?.formFields || []
  ).find((field: ModelField<WorkspaceNotificationSummary>): boolean => {
    return isLookback(field.field);
  });

  expect(box).toBeDefined();
  return box!;
}

// What the form says about the box holding `value`, or undefined.
function errorFor(value: unknown): string | undefined {
  const errors: Record<string, string> = Validation.validate({
    formFields: [
      {
        ...(lookbackBox() as unknown as Field<Values>),
        name: "numberOfDaysOfData",
      },
    ],
    values: { numberOfDaysOfData: value } as never,
    onValidate: undefined,
    currentFormStepId: null,
  }) as Record<string, string>;

  return errors["numberOfDaysOfData"];
}

// What the summaries table's Lookback column says of a summary stored with `days`.
function lookbackShown(days: number | undefined): string {
  const column: Column<WorkspaceNotificationSummary> | undefined = (
    lastTableProps?.columns || []
  ).find((candidate: Column<WorkspaceNotificationSummary>): boolean => {
    return isLookback(candidate.field);
  });

  expect(column?.title).toBe("Lookback");

  const { container } = render(<>{column!.getElement!(summaryRow(days))}</>);
  const text: string = container.textContent || "";
  container.remove();
  return text;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
  rowDays = 7;
  lastTableProps = undefined;
});

describe("the Lookback Period (Days) box", () => {
  test("is a required number box with the server's bounds: 1 to 365", async () => {
    await renderTable();

    const box: ModelField<WorkspaceNotificationSummary> = lookbackBox();

    expect(box.title).toBe("Lookback Period (Days)");
    expect(box.fieldType).toBe(FormFieldSchemaType.Number);
    expect(box.required).toBe(true);
    expect(box.defaultValue).toBe(7);
    expect(box.validation).toEqual({
      minValue: MIN_LOOKBACK_DAYS,
      maxValue: MAX_LOOKBACK_DAYS,
    });
    expect(box.validation).toEqual({ minValue: 1, maxValue: 365 });
  });

  test("REGRESSION: says 0 and less are too few days, as typed or as a number", async () => {
    await renderTable();

    for (const value of [0, "0", -5, "-5", -1]) {
      expect(errorFor(value)).toBe(
        "Lookback Period (Days) should not be less than 1.",
      );
    }
  });

  test("says more than a year is too many", async () => {
    await renderTable();

    expect(errorFor(366)).toBe(
      "Lookback Period (Days) should not be more than 365.",
    );
  });

  test("takes a day, the 7 it starts on, a month and a year", async () => {
    await renderTable();

    for (const value of [1, "1", 7, "7", 30, 365, "365"]) {
      expect(errorFor(value)).toBeUndefined();
    }
  });

  test("left empty asks for it", async () => {
    await renderTable();

    expect(errorFor("")).toBe("Lookback Period (Days) is required.");
  });
});

describe("the summaries table's Lookback column", () => {
  test("says the days a summary covers", async () => {
    await renderTable();

    expect(lookbackShown(30)).toBe("30 days");
    expect(lookbackShown(1)).toBe("1 day");
    expect(lookbackShown(365)).toBe("365 days");
  });

  test("REGRESSION: a summary stored with 0 or -5 covers 7 days, and says so - not 0 days or -5 days", async () => {
    await renderTable();

    expect(lookbackShown(0)).toBe("7 days");
    expect(lookbackShown(-5)).toBe("7 days");
  });

  test("a summary stored with more than a year covers a year, and says so", async () => {
    await renderTable();

    expect(lookbackShown(400)).toBe("365 days");
  });
});

describe("Send Test Now", () => {
  async function confirmText(days: number | undefined): Promise<string> {
    rowDays = days;
    await renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Send Test Now" }));

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("modal-title").textContent).toBe(
      "Send Test Summary Now",
    );

    return dialog.textContent || "";
  }

  test("asks to send the days the summary covers", async () => {
    expect(await confirmText(14)).toContain(
      'Send the "Weekly incidents" summary to Slack now, with the last 14 days of data.',
    );
  });

  test("REGRESSION: for a summary stored with -5, the 7 days its report covers", async () => {
    expect(await confirmText(-5)).toContain(
      "now, with the last 7 days of data.",
    );
  });
});
