import "@testing-library/jest-dom";
import {
  afterEach,
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
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ARCHIVE AND UNARCHIVE ON THE EIGHT SETTINGS PAGES OF THE VALUES RECORDS
 * PICK FROM (Common/Utils/ArchivableValues): Incident State, Incident
 * Severity, Alert State, Alert Severity, Monitor Status, Event State, Labels
 * and Incident Roles.
 *
 * The maintainer: "Can we build functionality to archive things like
 * severity, stage, labels, etc., so they cannot be used in new records like
 * incidents or monitors, but the old records should exist?"
 *
 * Every page draws the real useArchivableValues hook; ModelTable is stubbed
 * and its props recorded, the API the hook calls is answered here, and the
 * dialogs the hook draws itself are real:
 *
 *   - the page's table lists the live values only, with Archive in each
 *     row's ⋯ menu, locked with why on a value OneUptime relies on or a
 *     project's last live severity;
 *   - Archive asks first, naming the settings that keep using the value,
 *     and archives it on confirm; the tables read again;
 *   - the archived values are listed apart, in a folded section that only
 *     shows while something is archived, newest first, with Unarchive;
 *   - Delete says what it would do: refused while records have the value,
 *     with Archive instead as the way on; otherwise what it changes.
 */

const recordedTables: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `model-table-${String(props["id"])}`,
      });
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

const countMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const usageMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/FetchArchivableValueUsage",
  () => {
    return {
      __esModule: true,
      fetchArchivableValueUsage: (...args: Array<unknown>): unknown => {
        return usageMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      check: (): { isAllowed: boolean } => {
        return { isAllowed: true };
      },
    },
  };
});

import IncidentStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentState";
import IncidentSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSeverity";
import AlertStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertState";
import AlertSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertSeverity";
import MonitorStatusesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorStatus";
import ScheduledMaintenanceStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState";
import LabelsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Labels";
import IncidentRolesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentRoles";
import {
  ARCHIVABLE_VALUE_COPY,
  ArchivableValueCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueCopy";
import { ARCHIVED_SECTION_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/UseArchivableValues";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Label from "../../../Models/DatabaseModels/Label";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import Route from "../../../Types/API/Route";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../../Utils/ArchivableValues";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { DeleteConfirmation } from "../../../UI/Components/ModelTable/BaseModelTable";

interface PageCase {
  name: string;
  type: ArchivableValueType;
  page: React.FunctionComponent<PageComponentProps>;
  tableId: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "Incident State",
    type: ArchivableValueType.IncidentState,
    page: IncidentStatesPage,
    tableId: "incident-state-table",
  },
  {
    name: "Incident Severity",
    type: ArchivableValueType.IncidentSeverity,
    page: IncidentSeveritiesPage,
    tableId: "incident-severity-table",
  },
  {
    name: "Alert State",
    type: ArchivableValueType.AlertState,
    page: AlertStatesPage,
    tableId: "alert-state-table",
  },
  {
    name: "Alert Severity",
    type: ArchivableValueType.AlertSeverity,
    page: AlertSeveritiesPage,
    tableId: "alert-severity-table",
  },
  {
    name: "Monitor Status",
    type: ArchivableValueType.MonitorStatus,
    page: MonitorStatusesPage,
    tableId: "monitor-status-table",
  },
  {
    name: "Event State",
    type: ArchivableValueType.ScheduledMaintenanceState,
    page: ScheduledMaintenanceStatesPage,
    tableId: "scheduled-maintenance-state-table",
  },
  {
    name: "Labels",
    type: ArchivableValueType.Label,
    page: LabelsPage,
    tableId: "labels-table",
  },
  {
    name: "Incident Roles",
    type: ArchivableValueType.IncidentRole,
    page: IncidentRolesPage,
    tableId: "incident-roles-table",
  },
];

const VALUE_ID: string = "0193c0de-9999-4999-8999-000000000001";

// How many values the project has, archived and not, as count() answers.
let archivedCount: number = 0;
let liveCount: number = 5;

beforeEach(() => {
  recordedTables.length = 0;
  archivedCount = 0;
  liveCount = 5;

  countMock.mockReset();
  countMock.mockImplementation(
    async (args: { query: Record<string, unknown> }): Promise<number> => {
      return args.query["isArchived"] === true ? archivedCount : liveCount;
    },
  );
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<void> => {
    // Saved.
  });
  usageMock.mockReset();
  usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
    return [];
  });
});

afterEach(() => {
  cleanup();
});

const renderPage: (pageCase: PageCase) => Promise<void> = async (
  pageCase: PageCase,
): Promise<void> => {
  const Page: React.FunctionComponent<PageComponentProps> = pageCase.page;

  await act(async () => {
    render(
      <Page
        pageRoute={new Route("/dashboard/project/settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });
};

// The last props a table was drawn with.
const table: (id: string) => Record<string, unknown> | undefined = (
  id: string,
): Record<string, unknown> | undefined => {
  for (let index: number = recordedTables.length - 1; index >= 0; index--) {
    if (recordedTables[index]!["id"] === id) {
      return recordedTables[index];
    }
  }

  return undefined;
};

const archivedTableId: (pageCase: PageCase) => string = (
  pageCase: PageCase,
): string => {
  return `${ARCHIVABLE_VALUES[pageCase.type].tableName}-archived-table`;
};

const actionTitled: (
  props: Record<string, unknown> | undefined,
  title: string,
) => ActionButtonSchema<BaseModel> = (
  props: Record<string, unknown> | undefined,
  title: string,
): ActionButtonSchema<BaseModel> => {
  const found: ActionButtonSchema<BaseModel> | undefined = (
    (props?.["actionButtons"] || []) as Array<ActionButtonSchema<BaseModel>>
  ).find((action: ActionButtonSchema<BaseModel>): boolean => {
    return action.title === title;
  });

  if (!found) {
    throw new Error(`No ${title} action`);
  }

  return found;
};

const severity: (values: Record<string, unknown>) => IncidentSeverity = (
  values: Record<string, unknown>,
): IncidentSeverity => {
  const value: IncidentSeverity = new IncidentSeverity();
  value._id = VALUE_ID;
  value.name = "Critical";

  for (const [key, entry] of Object.entries(values)) {
    (value as unknown as Record<string, unknown>)[key] = entry;
  }

  return value;
};

const usageItem: (
  overrides: Partial<ArchivableValueUsageItem>,
) => ArchivableValueUsageItem = (
  overrides: Partial<ArchivableValueUsageItem>,
): ArchivableValueUsageItem => {
  return {
    tableName: "Incident",
    title: "Incidents",
    singularTitle: "Incident",
    count: 12,
    isCountCapped: false,
    effect: ArchivableValueDeleteEffect.Refused,
    kind: ArchivableValueUsageKind.Records,
    ...overrides,
  };
};

const runAction: (
  action: ActionButtonSchema<BaseModel>,
  item: BaseModel,
) => Promise<void> = async (
  action: ActionButtonSchema<BaseModel>,
  item: BaseModel,
): Promise<void> => {
  await act(async () => {
    // Typed as returning nothing; the archive actions are async, so wait.
    const clicked: unknown = action.onClick(
      item,
      () => {
        // done
      },
      (error: Error) => {
        throw error;
      },
    );

    await Promise.resolve(clicked);
  });
};

/*
 * Clicks an action whose work goes on after the click - the Archive dialog
 * opens on it, and what uses the value is read after - without waiting for
 * that work to finish.
 */
const startAction: (
  action: ActionButtonSchema<BaseModel>,
  item: BaseModel,
) => Promise<void> = async (
  action: ActionButtonSchema<BaseModel>,
  item: BaseModel,
): Promise<void> => {
  await act(async () => {
    void action.onClick(
      item,
      () => {
        // done
      },
      (error: Error) => {
        throw error;
      },
    );
  });
};

describe.each(PAGES)("$name", (pageCase: PageCase) => {
  const copy: ArchivableValueCopy = ARCHIVABLE_VALUE_COPY[pageCase.type];

  test("its table lists the values that are not archived, with Archive in each row's ⋯ menu", async () => {
    await renderPage(pageCase);

    const live: Record<string, unknown> | undefined = table(pageCase.tableId);

    expect(live).toBeDefined();
    expect(live!["query"]).toMatchObject({ isArchived: false });
    expect(typeof live!["getDeleteConfirmation"]).toBe("function");
    expect(typeof live!["refreshToggle"]).toBe("string");

    const archive: ActionButtonSchema<BaseModel> = actionTitled(
      live,
      "Archive",
    );

    expect(archive.placement).toBe(ActionButtonPlacement.MoreMenu);
    expect(archive.disabled).toBe(false);
    expect(typeof archive.getDisabledReason).toBe("function");
  });

  test("no Archived section while nothing is archived", async () => {
    await renderPage(pageCase);

    expect(screen.queryByTestId(ARCHIVED_SECTION_TEST_ID)).toBeNull();
    expect(table(archivedTableId(pageCase))).toBeUndefined();
  });

  test("the archived values are listed apart, folded, newest first, with Unarchive", async () => {
    archivedCount = 3;

    await renderPage(pageCase);

    await waitFor(() => {
      expect(screen.getByTestId(ARCHIVED_SECTION_TEST_ID)).toBeInTheDocument();
    });

    expect(screen.getByText(copy.archivedTitle)).toBeInTheDocument();
    expect(screen.getByText("3 archived")).toBeInTheDocument();

    const archived: Record<string, unknown> | undefined = table(
      archivedTableId(pageCase),
    );

    expect(archived).toBeDefined();
    expect(archived!["query"]).toEqual({ isArchived: true });
    expect(archived!["sortBy"]).toBe("archivedAt");
    expect(archived!["sortOrder"]).toBe(SortOrder.Descending);
    expect(archived!["isCreateable"]).toBe(false);
    expect(archived!["isEditable"]).toBe(false);
    expect(archived!["isDeleteable"]).toBe(true);
    // A section of the fold, not a framed table inside it.
    expect(archived!["cardProps"]).toBeDefined();

    const unarchive: ActionButtonSchema<BaseModel> = actionTitled(
      archived,
      "Unarchive",
    );

    expect(unarchive.placement).toBe(ActionButtonPlacement.Primary);
  });
});

describe("Archive", () => {
  const severities: PageCase = PAGES[1]!;
  const states: PageCase = PAGES[0]!;

  test("is locked on a value OneUptime moves records into, with why", async () => {
    await renderPage(states);

    const archive: ActionButtonSchema<BaseModel> = actionTitled(
      table(states.tableId),
      "Archive",
    );

    const created: IncidentState = new IncidentState();
    created.isCreatedState = true;

    const custom: IncidentState = new IncidentState();
    custom.isCreatedState = false;

    expect(archive.getDisabledReason!(created)).toBe(
      "New incidents start in this state, so it can't be archived.",
    );
    expect(archive.getDisabledReason!(custom)).toBeUndefined();
  });

  test("is locked on a project's last live severity, and only then", async () => {
    liveCount = 1;
    await renderPage(severities);

    await waitFor(() => {
      expect(
        actionTitled(table(severities.tableId), "Archive").getDisabledReason!(
          severity({}),
        ),
      ).toBe(
        "Every new incident needs a severity, so keep at least one that is not archived.",
      );
    });

    cleanup();
    recordedTables.length = 0;
    liveCount = 2;
    await renderPage(severities);

    await waitFor(() => {
      expect(countMock).toHaveBeenCalled();
    });

    expect(
      actionTitled(table(severities.tableId), "Archive").getDisabledReason!(
        severity({}),
      ),
    ).toBeUndefined();
  });

  test("asks first, naming the settings that keep using it, then archives it and reads the tables again", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({}),
        usageItem({
          tableName: "IncidentOnCallRule",
          title: "Incident On-Call Rules",
          singularTitle: "Incident On-Call Rule",
          count: 3,
          effect: ArchivableValueDeleteEffect.RemovedFromList,
          kind: ArchivableValueUsageKind.Settings,
        }),
      ];
    });

    await renderPage(severities);

    const refreshBefore: unknown = table(severities.tableId)!["refreshToggle"];

    await runAction(
      actionTitled(table(severities.tableId), "Archive"),
      severity({}),
    );

    // The usage is read for this value of this model.
    expect(usageMock).toHaveBeenCalledTimes(1);
    expect(usageMock.mock.calls[0]![0]).toMatchObject({
      modelType: IncidentSeverity,
    });
    expect(
      (usageMock.mock.calls[0]![0] as { valueId: ObjectID }).valueId.toString(),
    ).toBe(VALUE_ID);

    expect(screen.getByText("Archive Critical?")).toBeInTheDocument();
    expect(
      screen.getByText(
        ARCHIVABLE_VALUE_COPY[ArchivableValueType.IncidentSeverity]
          .archiveMessage,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("These keep using it until you change them:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Incident On-Call Rules (3)")).toBeInTheDocument();
    // The incidents that have it are not "set up to use it": archiving keeps them.
    expect(screen.queryByText("Incidents (12)")).toBeNull();

    expect(updateByIdMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(update.modelType).toBe(IncidentSeverity);
    expect(update.id.toString()).toBe(VALUE_ID);
    expect(update.data).toEqual({ isArchived: true });

    await waitFor(() => {
      expect(screen.queryByText("Archive Critical?")).toBeNull();
    });
    expect(table(severities.tableId)!["refreshToggle"]).not.toBe(refreshBefore);
  });

  /*
   * The dialog opens on the click: what still uses the value is read after,
   * and the dialog says so while it is - a slow read never leaves the click
   * without an answer.
   */
  const deferUsage: () => {
    answer: (usage: Array<unknown>) => void;
    fail: (error: Error) => void;
  } = (): {
    answer: (usage: Array<unknown>) => void;
    fail: (error: Error) => void;
  } => {
    const pending: Array<{
      resolve: (usage: Array<unknown>) => void;
      reject: (error: Error) => void;
    }> = [];

    usageMock.mockImplementation((): Promise<Array<unknown>> => {
      return new Promise<Array<unknown>>(
        (
          resolve: (usage: Array<unknown>) => void,
          reject: (error: Error) => void,
        ) => {
          pending.push({ resolve, reject });
        },
      );
    });

    return {
      answer: (usage: Array<unknown>): void => {
        pending.shift()!.resolve(usage);
      },
      fail: (error: Error): void => {
        pending.shift()!.reject(error);
      },
    };
  };

  const onCallRules: ArchivableValueUsageItem = usageItem({
    tableName: "IncidentOnCallRule",
    title: "Incident On-Call Rules",
    singularTitle: "Incident On-Call Rule",
    count: 3,
    effect: ArchivableValueDeleteEffect.RemovedFromList,
    kind: ArchivableValueUsageKind.Settings,
  });

  test("opens on the click, saying it is checking what still uses the value, then lists it", async () => {
    const usage: { answer: (usage: Array<unknown>) => void } = deferUsage();

    await renderPage(severities);
    await startAction(
      actionTitled(table(severities.tableId), "Archive"),
      severity({}),
    );

    // Open, before the answer: what archiving does, and that it is checking.
    expect(screen.getByText("Archive Critical?")).toBeInTheDocument();
    expect(
      screen.getByText(
        ARCHIVABLE_VALUE_COPY[ArchivableValueType.IncidentSeverity]
          .archiveMessage,
      ),
    ).toBeInTheDocument();

    const checking: HTMLElement = screen.getByTestId(
      "archivable-value-checking",
    );

    expect(checking).toHaveTextContent("Checking what still uses it…");
    // A screen reader hears it once, politely.
    expect(checking).toHaveAttribute("role", "status");
    expect(checking).toHaveAttribute("aria-live", "polite");
    expect(
      screen.queryByText("These keep using it until you change them:"),
    ).toBeNull();

    await act(async () => {
      usage.answer([usageItem({}), onCallRules]);
    });

    expect(screen.queryByTestId("archivable-value-checking")).toBeNull();
    expect(
      screen.getByText("These keep using it until you change them:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Incident On-Call Rules (3)")).toBeInTheDocument();
    // The incidents that have it keep it: never listed as using it.
    expect(screen.queryByText("Incidents (12)")).toBeNull();
  });

  test("Archive does not wait for the list: archiving changes no setting", async () => {
    deferUsage();

    await renderPage(severities);
    await startAction(
      actionTitled(table(severities.tableId), "Archive"),
      severity({}),
    );

    expect(screen.getByTestId("archivable-value-checking")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({ isArchived: true });
    await waitFor(() => {
      expect(screen.queryByText("Archive Critical?")).toBeNull();
    });
  });

  test("a read of what uses it that fails leaves the dialog as it is, without a list or an error", async () => {
    const usage: { fail: (error: Error) => void } = deferUsage();

    await renderPage(severities);
    await startAction(
      actionTitled(table(severities.tableId), "Archive"),
      severity({}),
    );

    await act(async () => {
      usage.fail(new Error("Could not count what uses this value."));
    });

    expect(screen.queryByTestId("archivable-value-checking")).toBeNull();
    expect(screen.getByText("Archive Critical?")).toBeInTheDocument();
    expect(
      screen.queryByText("Could not count what uses this value."),
    ).toBeNull();
    expect(
      screen.queryByText("These keep using it until you change them:"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
  });

  test("closed before the answer comes, it stays closed; the next value's dialog never shows the last one's answer", async () => {
    const usage: { answer: (usage: Array<unknown>) => void } = deferUsage();

    await renderPage(severities);

    const archive: ActionButtonSchema<BaseModel> = actionTitled(
      table(severities.tableId),
      "Archive",
    );

    await startAction(archive, severity({}));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Archive Critical?")).toBeNull();
    });

    // Another value's dialog opens while the first answer is still out.
    await startAction(archive, severity({ name: "Minor" }));

    expect(screen.getByText("Archive Minor?")).toBeInTheDocument();

    // The first value's answer arrives late: not this dialog's.
    await act(async () => {
      usage.answer([onCallRules]);
    });

    expect(screen.queryByText("Archive Critical?")).toBeNull();
    expect(screen.getByTestId("archivable-value-checking")).toBeInTheDocument();
    expect(screen.queryByText("Incident On-Call Rules (3)")).toBeNull();

    // Its own answer: nothing set up to use it.
    await act(async () => {
      usage.answer([usageItem({})]);
    });

    expect(screen.queryByTestId("archivable-value-checking")).toBeNull();
    expect(
      screen.queryByText("These keep using it until you change them:"),
    ).toBeNull();
    expect(screen.getByText("Archive Minor?")).toBeInTheDocument();
  });

  test("a refused archive keeps the dialog open, with the server's words", async () => {
    updateByIdMock.mockImplementation(async (): Promise<void> => {
      throw new Error(
        "Every new incident needs a severity, so keep at least one that is not archived.",
      );
    });

    await renderPage(severities);
    await runAction(
      actionTitled(table(severities.tableId), "Archive"),
      severity({}),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Every new incident needs a severity, so keep at least one that is not archived.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Archive Critical?")).toBeInTheDocument();
  });

  test("Unarchive puts it back at once", async () => {
    archivedCount = 1;
    await renderPage(severities);

    await waitFor(() => {
      expect(table(archivedTableId(severities))).toBeDefined();
    });

    await runAction(
      actionTitled(table(archivedTableId(severities)), "Unarchive"),
      severity({ isArchived: true }),
    );

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({ isArchived: false });
  });
});

/*
 * The Archived section names each value the way its page's own table does:
 * a label as a label, a role with its icon, and a state or a severity as
 * the coloured pill.
 */
describe("the Archived section draws each value as its page's table does", () => {
  const nameCellOf: (pageCase: PageCase, item: BaseModel) => HTMLElement = (
    pageCase: PageCase,
    item: BaseModel,
  ): HTMLElement => {
    const columns: Array<{
      title: string;
      getElement?: (item: BaseModel) => ReactElement;
    }> = table(archivedTableId(pageCase))!["columns"] as Array<{
      title: string;
      getElement?: (item: BaseModel) => ReactElement;
    }>;

    expect(columns[0]!.title).toBe("Name");

    const view: { container: HTMLElement } = render(
      <div data-testid="archived-name-cell">
        {columns[0]!.getElement!(item)}
      </div>,
    );

    return view.container;
  };

  const openArchived: (pageCase: PageCase) => Promise<void> = async (
    pageCase: PageCase,
  ): Promise<void> => {
    archivedCount = 1;
    await renderPage(pageCase);

    await waitFor(() => {
      expect(table(archivedTableId(pageCase))).toBeDefined();
    });
  };

  test("a label: its name and colour, as on everything that has it", async () => {
    const labels: PageCase = PAGES[6]!;

    await openArchived(labels);

    const label: Label = new Label();
    label._id = VALUE_ID;
    label.name = "legacy-db";
    label.color = new Color("#64748b");

    const cell: HTMLElement = nameCellOf(labels, label);

    expect(cell).toHaveTextContent("legacy-db");
    // The label's own pill, not the minimal one states are listed with.
    expect(table(archivedTableId(labels))!["selectMoreFields"]).toMatchObject({
      color: true,
    });
  });

  test("an incident role: with its icon, read beside its name", async () => {
    const roles: PageCase = PAGES[7]!;

    await openArchived(roles);

    expect(table(archivedTableId(roles))!["selectMoreFields"]).toEqual({
      color: true,
      roleIcon: true,
      description: true,
    });

    const role: IncidentRole = new IncidentRole();
    role._id = VALUE_ID;
    role.name = "Customer Liaison";
    role.roleIcon = IconProp.Chat;

    const cell: HTMLElement = nameCellOf(roles, role);

    expect(cell).toHaveTextContent("Customer Liaison");
    // RoleLabel draws the role's icon in its tile.
    expect(cell.querySelector("svg")).not.toBeNull();
  });

  test("a state or a severity: the coloured pill, with nothing more to read", async () => {
    const severities: PageCase = PAGES[1]!;

    await openArchived(severities);

    expect(table(archivedTableId(severities))!["selectMoreFields"]).toEqual({
      color: true,
    });

    const cell: HTMLElement = nameCellOf(
      severities,
      severity({ name: "[DONOTUSE] Very critical", isArchived: true }),
    );

    expect(cell).toHaveTextContent("[DONOTUSE] Very critical");
  });
});

describe("Delete says what it would do", () => {
  const severities: PageCase = PAGES[1]!;
  const states: PageCase = PAGES[0]!;
  const labels: PageCase = PAGES[6]!;

  const confirmationOf: (
    tableId: string,
    item: BaseModel,
  ) => Promise<DeleteConfirmation> = async (
    tableId: string,
    item: BaseModel,
  ): Promise<DeleteConfirmation> => {
    const getDeleteConfirmation: (
      item: BaseModel,
    ) => Promise<DeleteConfirmation> = table(tableId)![
      "getDeleteConfirmation"
    ] as (item: BaseModel) => Promise<DeleteConfirmation>;

    return await getDeleteConfirmation(item);
  };

  const textOf: (confirmation: DeleteConfirmation) => string = (
    confirmation: DeleteConfirmation,
  ): string => {
    const view: { container: HTMLElement } = render(
      <div>{confirmation.description}</div>,
    );

    return (view.container.textContent || "").replace(/\s+/g, " ");
  };

  test("a value nothing uses gets the usual question, and nothing else", async () => {
    await renderPage(severities);

    const confirmation: DeleteConfirmation = await confirmationOf(
      severities.tableId,
      severity({}),
    );

    expect(confirmation.isDeleteBlocked).toBeUndefined();
    expect(confirmation.alternative).toBeUndefined();
    expect(textOf(confirmation)).toContain("Critical");
  });

  test("records still have it: refused, naming them, with Archive instead as the way on", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({}),
        usageItem({
          tableName: "IncidentEpisode",
          title: "Incident Episodes",
          singularTitle: "Incident Episode",
          count: 2,
        }),
      ];
    });

    await renderPage(severities);

    const confirmation: DeleteConfirmation = await confirmationOf(
      severities.tableId,
      severity({}),
    );

    expect(confirmation.isDeleteBlocked).toBe(true);
    expect(confirmation.alternative?.title).toBe("Archive instead");

    const text: string = textOf(confirmation);

    expect(text).toContain("Critical can't be deleted while these have it:");
    expect(text).toContain("Incidents (12)");
    expect(text).toContain("Incident Episodes (2)");
    expect(text).toContain(
      "Archive it instead: nobody can pick it again, and everything that has it keeps it.",
    );
    // No question: the delete cannot go through.
    expect(text).not.toContain("Are you sure");

    await act(async () => {
      await confirmation.alternative!.onClick();
    });

    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({ isArchived: true });
  });

  test("an archived value records still have: refused, and it stays archived", async () => {
    archivedCount = 1;
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [usageItem({})];
    });

    await renderPage(severities);

    await waitFor(() => {
      expect(table(archivedTableId(severities))).toBeDefined();
    });

    const confirmation: DeleteConfirmation = await confirmationOf(
      archivedTableId(severities),
      severity({ isArchived: true }),
    );

    expect(confirmation.isDeleteBlocked).toBe(true);
    expect(confirmation.alternative).toBeUndefined();
    expect(textOf(confirmation)).toContain(
      "It can stay archived: nobody can pick it, and everything that has it keeps it.",
    );
  });

  test("otherwise it lists what the delete changes, the gravest first, and offers Archive instead", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({
          tableName: "MonitorLabel",
          title: "Monitors",
          singularTitle: "Monitor",
          count: 4,
          effect: ArchivableValueDeleteEffect.RemovedFromList,
        }),
        usageItem({
          tableName: "IncidentLabelRule",
          title: "Incident Label Rules",
          singularTitle: "Incident Label Rule",
          count: 1,
          effect: ArchivableValueDeleteEffect.RemovedFromList,
          kind: ArchivableValueUsageKind.Settings,
        }),
      ];
    });

    await renderPage(labels);

    const label: Label = new Label();
    label._id = VALUE_ID;
    label.name = "legacy-db";

    const confirmation: DeleteConfirmation = await confirmationOf(
      labels.tableId,
      label,
    );

    expect(confirmation.isDeleteBlocked).toBe(false);
    expect(confirmation.alternative?.title).toBe("Archive instead");

    const text: string = textOf(confirmation);

    expect(text).toContain("legacy-db");
    expect(text).toContain("Deleting it also changes these:");
    expect(text).toContain(
      "Removed from: Monitors (4), Incident Label Rules (1)",
    );
    expect(text).toContain(
      "This can't be undone. Archive it instead to keep them as they are.",
    );
  });

  test("a value that can't be archived offers no Archive instead", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({
          tableName: "IncidentStateTimeline",
          title: "Incident State Timelines",
          singularTitle: "Incident State Timeline",
          count: 40,
          effect: ArchivableValueDeleteEffect.Deleted,
        }),
      ];
    });

    await renderPage(states);

    const resolved: IncidentState = new IncidentState();
    resolved._id = VALUE_ID;
    resolved.name = "Resolved";
    resolved.isResolvedState = true;

    const confirmation: DeleteConfirmation = await confirmationOf(
      states.tableId,
      resolved,
    );

    expect(confirmation.alternative).toBeUndefined();

    const text: string = textOf(confirmation);

    expect(text).toContain("Deleted with it: Incident State Timelines (40)");
    expect(text).toContain("This can't be undone.");
    expect(text).not.toContain("Archive it instead");
  });
});
