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
import type { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";

/*
 * "This page is extremely hard to understand and use ... We have a similar
 * issue with monitor status, incident state, monitor severity ... Please
 * overhaul the entire UI and make it much better and simpler to understand."
 *
 * The six settings pages for a project's states, severities and monitor
 * statuses. Each was a stack of big centred cards - raw ID, Edit, ⋯, a
 * chevron and an "Add New Item" bubble between every pair. Each is now one
 * compact drag-ordered table, built the same way. ModelTable is stubbed and
 * its props recorded: what each page hands it is the page's whole contract.
 *
 *   - dragged into order by the column the model keeps, listed in that
 *     order, with no Order number anywhere - not in the form, not as a
 *     column, not in the select;
 *   - one Create button (the card's), the usual edit form - name,
 *     description, colour - and the ID behind Show ID in the row's menu;
 *   - a sentence under the title saying what the order means;
 *   - the built-in rows locked against delete, with why; nothing else;
 *   - on the state pages, a "Counts as" column worked out from the rows on
 *     the page, so it changes when a row is dragged;
 *   - every fetch drops the cached lists the pickers read.
 */

const recordedTables: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", { "data-testid": "model-table" });
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import IncidentStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentState";
import IncidentSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSeverity";
import AlertStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertState";
import AlertSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertSeverity";
import MonitorStatusesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorStatus";
import ScheduledMaintenanceStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState";
import {
  STATE_SETTINGS_COPY,
  StateSettingsPageCopy,
  StateSettingsSharedCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { StateListType, STATE_LISTS } from "../../../Utils/StateOrder";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ModelListCache from "../../../UI/Utils/ModelListCache";

interface RecordedColumn {
  field?: Record<string, unknown>;
  id?: string;
  title?: string;
  headerTooltip?: string;
  isNotCustomizable?: boolean;
  wrapContent?: boolean;
  hideOnMobile?: boolean;
  getElement?: (item: unknown) => ReactElement;
  getExportValue?: (item: unknown) => string;
}

interface RecordedField {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  placeholder?: string;
  fieldType?: FormFieldSchemaType;
  required?: unknown;
}

interface PageCase {
  type: StateListType;
  page: React.FunctionComponent<PageComponentProps>;
  modelType: { new (): BaseModel };
  id: string;
  flags: Array<string>;
}

const PAGES: Array<PageCase> = [
  {
    type: StateListType.IncidentState,
    page: IncidentStatesPage,
    modelType: IncidentState,
    id: "incident-state-table",
    flags: ["isCreatedState", "isAcknowledgedState", "isResolvedState"],
  },
  {
    type: StateListType.AlertState,
    page: AlertStatesPage,
    modelType: AlertState,
    id: "alert-state-table",
    flags: ["isCreatedState", "isAcknowledgedState", "isResolvedState"],
  },
  {
    type: StateListType.ScheduledMaintenanceState,
    page: ScheduledMaintenanceStatesPage,
    modelType: ScheduledMaintenanceState,
    id: "scheduled-maintenance-state-table",
    flags: [
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ],
  },
  {
    type: StateListType.MonitorStatus,
    page: MonitorStatusesPage,
    modelType: MonitorStatus,
    id: "monitor-status-table",
    flags: ["isOperationalState", "isOfflineState"],
  },
  {
    type: StateListType.IncidentSeverity,
    page: IncidentSeveritiesPage,
    modelType: IncidentSeverity,
    id: "incident-severity-table",
    flags: [],
  },
  {
    type: StateListType.AlertSeverity,
    page: AlertSeveritiesPage,
    modelType: AlertSeverity,
    id: "alert-severity-table",
    flags: [],
  },
];

const renderPage: (pageCase: PageCase) => void = (pageCase: PageCase): void => {
  const Page: React.FunctionComponent<PageComponentProps> = pageCase.page;

  render(
    <Page
      pageRoute={new Route("/dashboard/project/settings")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
};

const lastTable: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const table: Record<string, unknown> | undefined =
    recordedTables[recordedTables.length - 1];

  if (!table) {
    throw new Error("ModelTable was not rendered.");
  }

  return table;
};

const columns: () => Array<RecordedColumn> = (): Array<RecordedColumn> => {
  return lastTable()["columns"] as Array<RecordedColumn>;
};

const formFields: () => Array<RecordedField> = (): Array<RecordedField> => {
  return lastTable()["formFields"] as Array<RecordedField>;
};

const fieldKeys: (
  entries: Array<{ field?: Record<string, unknown> }>,
) => Array<string> = (
  entries: Array<{ field?: Record<string, unknown> }>,
): Array<string> => {
  return entries.map((entry: { field?: Record<string, unknown> }) => {
    return Object.keys(entry.field || {})[0] || "";
  });
};

const copyOf: (pageCase: PageCase) => StateSettingsPageCopy = (
  pageCase: PageCase,
): StateSettingsPageCopy => {
  return STATE_SETTINGS_COPY[pageCase.type];
};

beforeEach(() => {
  recordedTables.length = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGES)("$type settings page", (pageCase: PageCase) => {
  const orderColumn: string = STATE_LISTS[pageCase.type].orderColumn;

  test("is a table of the model, under its own id and saved preferences", () => {
    renderPage(pageCase);

    expect(lastTable()["modelType"]).toBe(pageCase.modelType);
    expect(lastTable()["id"]).toBe(pageCase.id);
    expect(lastTable()["userPreferencesKey"]).toBe(pageCase.id);
    // A table, not the retired ordered states list.
    expect(lastTable()["showAs"]).toBeUndefined();
    expect(lastTable()["orderedStatesListProps"]).toBeUndefined();
  });

  test("is dragged into order by the column the model keeps, and listed in it", () => {
    renderPage(pageCase);

    expect(lastTable()["enableDragAndDrop"]).toBe(true);
    expect(lastTable()["dragDropIndexField"]).toBe(orderColumn);
    expect(new pageCase.modelType().getListOrder()?.column).toBe(orderColumn);
    expect(lastTable()["sortBy"]).toBe(orderColumn);
    expect(lastTable()["sortOrder"]).toBe(SortOrder.Ascending);
  });

  test("shows and asks for no order number anywhere", () => {
    renderPage(pageCase);

    expect(fieldKeys(formFields())).not.toContain(orderColumn);
    expect(fieldKeys(columns())).not.toContain(orderColumn);
    expect(
      Object.keys(lastTable()["selectMoreFields"] as Record<string, unknown>),
    ).not.toContain(orderColumn);

    for (const field of formFields()) {
      expect(field.fieldType).not.toBe(FormFieldSchemaType.Number);
    }
  });

  test("creates from the card's one button and edits with the usual form", () => {
    renderPage(pageCase);

    expect(lastTable()["isCreateable"]).toBe(true);
    expect(lastTable()["isEditable"]).toBe(true);
    expect(lastTable()["isDeleteable"]).toBe(true);
    // Nothing custom stands in for Create any more.
    expect(lastTable()["onCreateClick"]).toBeUndefined();
    expect(lastTable()["onBeforeCreate"]).toBeUndefined();
  });

  test("the form asks for a name, a description and a colour - with placeholders that fit", () => {
    renderPage(pageCase);

    expect(fieldKeys(formFields())).toEqual(["name", "description", "color"]);

    const [name, description, color] = formFields() as [
      RecordedField,
      RecordedField,
      RecordedField,
    ];

    expect(name).toMatchObject({
      title: StateSettingsSharedCopy.nameFieldTitle,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: copyOf(pageCase).namePlaceholder,
    });
    expect(description).toMatchObject({
      title: StateSettingsSharedCopy.descriptionFieldTitle,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: copyOf(pageCase).descriptionPlaceholder,
    });
    expect(color).toMatchObject({
      title: StateSettingsSharedCopy.colorFieldTitle,
      description: StateSettingsSharedCopy.colorFieldDescription,
      fieldType: FormFieldSchemaType.Color,
      required: true,
    });
  });

  test("keeps the ID behind Show ID in the row menu", () => {
    renderPage(pageCase);

    expect(lastTable()["showViewIdButton"]).toBe(true);
  });

  test("says what its order means under the title", () => {
    renderPage(pageCase);

    expect(lastTable()["cardProps"]).toEqual({
      title: copyOf(pageCase).title,
      description: copyOf(pageCase).description,
    });
  });

  test("lists the name first, then (on a state page) what it counts as, then the description", () => {
    renderPage(pageCase);

    const titles: Array<string> = columns().map((column: RecordedColumn) => {
      return column.title || "";
    });

    expect(titles).toEqual(
      copyOf(pageCase).countsAs
        ? ["Name", "Counts as", "Description"]
        : ["Name", "Description"],
    );

    expect(columns()[0]!.isNotCustomizable).toBe(true);

    const description: RecordedColumn = columns()[columns().length - 1]!;
    expect(description.wrapContent).toBe(true);
    expect(description.hideOnMobile).toBe(true);
  });

  test("selects the colour and the built-in flags it shows", () => {
    renderPage(pageCase);

    const select: Record<string, unknown> = lastTable()[
      "selectMoreFields"
    ] as Record<string, unknown>;

    expect(Object.keys(select).sort()).toEqual(
      ["color", ...pageCase.flags].sort(),
    );
  });

  test("locks Delete on built-in rows only, and says why", () => {
    renderPage(pageCase);

    const reason: ((item: unknown) => string | undefined) | undefined =
      lastTable()["getDeleteDisabledReason"] as
        | ((item: unknown) => string | undefined)
        | undefined;

    if (pageCase.flags.length === 0) {
      // A severity has nothing built in: any can be deleted.
      expect(reason).toBeUndefined();
      return;
    }

    expect(reason).toBeDefined();

    for (const flag of pageCase.flags) {
      expect(reason!({ _id: "a", name: "Built", [flag]: true })).toBe(
        copyOf(pageCase).deleteLockedReason,
      );
    }

    expect(reason!({ _id: "b", name: "Added" })).toBeUndefined();
  });

  test("never refuses a delete from onBeforeDelete any more - the lock says it first", () => {
    renderPage(pageCase);

    expect(lastTable()["onBeforeDelete"]).toBeUndefined();
  });

  test("every fetch drops the cached lists the pickers read", () => {
    const invalidate: SpyInstance = jest.spyOn(ModelListCache, "invalidate");

    renderPage(pageCase);

    act(() => {
      (lastTable()["onFetchSuccess"] as (data: Array<unknown>) => void)([]);
    });

    expect(invalidate).toHaveBeenCalledWith(pageCase.modelType);
  });
});

describe("the name cell", () => {
  test("a built-in row is tagged, and the tag says what OneUptime does with it", () => {
    renderPage(PAGES[0]!);

    const nameColumn: RecordedColumn = columns()[0]!;

    render(
      nameColumn.getElement!({
        _id: "resolved",
        name: "Resolved",
        color: "#2ab57d",
        isResolvedState: true,
      }),
    );

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByTestId("state-settings-built-in")).toHaveTextContent(
      "Built-in",
    );
    expect(screen.getByTestId("state-settings-built-in")).toHaveTextContent(
      "Resolving an incident moves it to this state. It can be renamed, but not deleted.",
    );
    // Reachable from the keyboard, so its tooltip is too.
    expect(screen.getByTestId("state-settings-built-in")).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  test("a row the project added has no tag", () => {
    renderPage(PAGES[0]!);

    render(
      columns()[0]!.getElement!({
        _id: "investigating",
        name: "Investigating",
        color: "#ffbf53",
      }),
    );

    expect(screen.getByText("Investigating")).toBeInTheDocument();
    expect(screen.queryByTestId("state-settings-built-in")).toBeNull();
  });

  test("the operational status says new monitors start in it", () => {
    renderPage(PAGES[3]!);

    render(
      columns()[0]!.getElement!({
        _id: "operational",
        name: "Operational",
        color: "#2ab57d",
        isOperationalState: true,
      }),
    );

    expect(screen.getByTestId("state-settings-built-in")).toHaveTextContent(
      "New monitors start in this status.",
    );
  });

  test("a severity is never tagged", () => {
    renderPage(PAGES[4]!);

    render(
      columns()[0]!.getElement!({
        _id: "critical",
        name: "Critical Incident",
        color: "#b70400",
        order: 1,
      }),
    );

    expect(screen.queryByTestId("state-settings-built-in")).toBeNull();
  });
});

describe("the Counts as column", () => {
  const INCIDENT_ROWS: Array<Record<string, unknown>> = [
    { _id: "1", name: "Identified", order: 1, isCreatedState: true },
    { _id: "2", name: "Investigating", order: 2 },
    { _id: "3", name: "Acknowledged", order: 3, isAcknowledgedState: true },
    { _id: "4", name: "Mitigated", order: 4 },
    { _id: "5", name: "Resolved", order: 5, isResolvedState: true },
    { _id: "6", name: "Postmortem", order: 6 },
  ];

  const countsAsColumn: () => RecordedColumn = (): RecordedColumn => {
    return columns().find((column: RecordedColumn) => {
      return column.id === "counts-as";
    })!;
  };

  test("is worked out from the rows the page last fetched", () => {
    renderPage(PAGES[0]!);

    act(() => {
      (lastTable()["onFetchSuccess"] as (data: Array<unknown>) => void)(
        INCIDENT_ROWS,
      );
    });

    expect(
      INCIDENT_ROWS.map((row: Record<string, unknown>) => {
        return countsAsColumn().getExportValue!(row);
      }),
    ).toEqual([
      "Not acknowledged",
      "Not acknowledged",
      "Acknowledged",
      "Acknowledged",
      "Resolved",
      "Resolved",
    ]);
  });

  test("changes when a row is dragged past a built-in state", () => {
    renderPage(PAGES[0]!);

    act(() => {
      (lastTable()["onFetchSuccess"] as (data: Array<unknown>) => void)(
        INCIDENT_ROWS,
      );
    });

    // Investigating dragged below Acknowledged: the refetch after the drop.
    act(() => {
      (lastTable()["onFetchSuccess"] as (data: Array<unknown>) => void)([
        { _id: "1", name: "Identified", order: 1, isCreatedState: true },
        { _id: "3", name: "Acknowledged", order: 2, isAcknowledgedState: true },
        { _id: "2", name: "Investigating", order: 3 },
        { _id: "5", name: "Resolved", order: 5, isResolvedState: true },
      ]);
    });

    expect(
      countsAsColumn().getExportValue!({
        _id: "2",
        name: "Investigating",
        order: 3,
      }),
    ).toBe("Acknowledged");
  });

  test("renders the label in the cell, with the column's meaning in its header", () => {
    renderPage(PAGES[0]!);

    act(() => {
      (lastTable()["onFetchSuccess"] as (data: Array<unknown>) => void)(
        INCIDENT_ROWS,
      );
    });

    expect(countsAsColumn().headerTooltip).toBe(
      STATE_SETTINGS_COPY[StateListType.IncidentState].countsAs!.tooltip,
    );

    render(countsAsColumn().getElement!(INCIDENT_ROWS[3]));

    expect(screen.getByTestId("state-settings-counts-as")).toHaveTextContent(
      "Acknowledged",
    );
  });

  test("a maintenance state counts as scheduled, ongoing, ended or completed", () => {
    renderPage(PAGES[2]!);

    const rows: Array<Record<string, unknown>> = [
      { _id: "1", name: "Scheduled", order: 1, isScheduledState: true },
      { _id: "2", name: "Ongoing", order: 2, isOngoingState: true },
      { _id: "3", name: "Extended", order: 3 },
      { _id: "4", name: "Ended", order: 4, isEndedState: true },
      { _id: "5", name: "Completed", order: 5, isResolvedState: true },
    ];

    act(() => {
      (lastTable()["onFetchSuccess"] as (data: Array<unknown>) => void)(rows);
    });

    expect(
      rows.map((row: Record<string, unknown>) => {
        return countsAsColumn().getExportValue!(row);
      }),
    ).toEqual(["Scheduled", "Ongoing", "Ongoing", "Ended", "Completed"]);
  });
});
