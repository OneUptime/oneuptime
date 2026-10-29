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
 * WHAT REALLY USES A VALUE, SAID AS PEOPLE KNOW IT (block 28).
 *
 * The maintainer: "What are these 22 Notification Rules? I only have two
 * rules." An incident severity's Archive dialog listed "Notification Rules
 * (22)" among the project's settings that keep using it until someone
 * changes them: the rows of every member's own on-call rules - one per
 * severity, kind and notification method, seeded for each person - which
 * nobody thinks of as the project's rules, and which need no change.
 *
 * Every page draws the real useArchivableValues hook; ModelTable is stubbed
 * and its props recorded, the usage reads are answered here, and the
 * dialogs and the bulk Delete's details are real:
 *
 *   - the Archive dialog lists the project's settings that keep using the
 *     value, and says apart how many people have their own on-call rules
 *     (or notification settings) for it, that those stay and still page,
 *     with a link to the reader's own;
 *   - the Delete dialog names them as whose they are: "On-call rules of 2
 *     people";
 *   - Bulk Actions > Delete reads what the selected values have, once for
 *     the selection: which of them records still have - left out of the
 *     run, with why - and what deleting the rest changes, its Delete held
 *     while it reads.
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
const valuesUsageMock: MockFunction = getJestMockFunction();

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
      fetchArchivableValuesUsage: (...args: Array<unknown>): unknown => {
        return valuesUsageMock(...args);
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

import IncidentSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSeverity";
import AlertSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertSeverity";
import CasePrioritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/CasePriorities";
import LabelsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Labels";
import { getOwnSettingsRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/UseArchivableValues";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import ObjectID from "../../../Types/ObjectID";
import { ArchivableValueType } from "../../../Utils/ArchivableValues";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { BulkActionConfirmControls } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BulkActionProps,
  DeleteConfirmation,
} from "../../../UI/Components/ModelTable/BaseModelTable";

const CRITICAL_ID: string = "0193c0de-9999-4999-8999-000000000001";
const MAJOR_ID: string = "0193c0de-9999-4999-8999-000000000002";
const MINOR_ID: string = "0193c0de-9999-4999-8999-000000000003";

beforeEach(() => {
  recordedTables.length = 0;

  countMock.mockReset();
  countMock.mockImplementation(
    async (args: { query: Record<string, unknown> }): Promise<number> => {
      return args.query["isArchived"] === true ? 0 : 5;
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
  valuesUsageMock.mockReset();
  valuesUsageMock.mockImplementation(
    async (): Promise<ArchivableValuesUsage> => {
      return { usage: [], refusedValueIds: [], refusedUsage: [] };
    },
  );
});

afterEach(() => {
  cleanup();
});

const renderPage: (
  Page: React.FunctionComponent<PageComponentProps>,
) => Promise<void> = async (
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> => {
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
const table: (id: string) => Record<string, unknown> = (
  id: string,
): Record<string, unknown> => {
  for (let index: number = recordedTables.length - 1; index >= 0; index--) {
    if (recordedTables[index]!["id"] === id) {
      return recordedTables[index]!;
    }
  }

  throw new Error(`No table ${id}`);
};

const severity: (id: string, name: string) => IncidentSeverity = (
  id: string,
  name: string,
): IncidentSeverity => {
  const value: IncidentSeverity = new IncidentSeverity();
  value._id = id;
  value.name = name;
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

// Everybody's own on-call rules for the value, as the server counts them: by person.
const onCallRulesOf: (
  people: number,
  overrides?: Partial<ArchivableValueUsageItem>,
) => ArchivableValueUsageItem = (
  people: number,
  overrides?: Partial<ArchivableValueUsageItem>,
): ArchivableValueUsageItem => {
  return usageItem({
    tableName: "UserNotificationRule",
    title: "Notification Rules",
    singularTitle: "Notification Rule",
    count: people,
    effect: ArchivableValueDeleteEffect.Deleted,
    kind: ArchivableValueUsageKind.Personal,
    ...(overrides || {}),
  });
};

const onCallRuleSettings: ArchivableValueUsageItem = usageItem({
  tableName: "IncidentOnCallRule",
  title: "Incident On-Call Rules",
  singularTitle: "Incident On-Call Rule",
  count: 3,
  effect: ArchivableValueDeleteEffect.RemovedFromList,
  kind: ArchivableValueUsageKind.Settings,
});

const openArchive: (tableId: string, item: BaseModel) => Promise<void> = async (
  tableId: string,
  item: BaseModel,
): Promise<void> => {
  const archive: ActionButtonSchema<BaseModel> | undefined = (
    (table(tableId)["actionButtons"] || []) as Array<
      ActionButtonSchema<BaseModel>
    >
  ).find((action: ActionButtonSchema<BaseModel>): boolean => {
    return action.title === "Archive";
  });

  await act(async () => {
    await Promise.resolve(
      archive!.onClick(
        item,
        () => {
          // done
        },
        (error: Error) => {
          throw error;
        },
      ),
    );
  });
};

const dialogText: () => string = (): string => {
  return (
    screen.getByTestId("archivable-value-archive-confirmation").textContent ||
    ""
  ).replace(/\s+/g, " ");
};

describe("the Archive dialog says people's own settings apart", () => {
  test("an incident severity: the project's settings that keep using it, then how many people have on-call rules for it, which stay", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [usageItem({}), onCallRuleSettings, onCallRulesOf(2)];
    });

    await renderPage(IncidentSeveritiesPage);
    await openArchive(
      "incident-severity-table",
      severity(CRITICAL_ID, "Critical"),
    );

    await waitFor(() => {
      expect(screen.getByTestId("archivable-value-people")).toBeInTheDocument();
    });

    // The project's settings, and only them, under "keep using it".
    const settings: HTMLElement = screen.getByTestId(
      "archivable-value-still-used-by",
    );

    expect(settings).toHaveTextContent("Incident On-Call Rules (3)");
    expect(settings).not.toHaveTextContent("Notification Rules");

    // People's own rules: how many people, that they stay, and what they keep doing.
    expect(
      screen.getByTestId("archivable-value-people-UserNotificationRule"),
    ).toHaveTextContent(
      "2 people have on-call rules for this severity. They stay as they are, so incidents with it still page them. See your on-call rules",
    );

    // The rows nobody recognised are never listed as a count of rules.
    expect(dialogText()).not.toContain("Notification Rules (");
    // The incidents that have it are not listed either: archiving keeps them.
    expect(dialogText()).not.toContain("Incidents (12)");
  });

  test("the maintainer's dialog: only people's own rules use it - no list of settings to change, one sentence about them", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [onCallRulesOf(2)];
    });

    await renderPage(IncidentSeveritiesPage);
    await openArchive(
      "incident-severity-table",
      severity(CRITICAL_ID, "[DONOTUSE] Very critical"),
    );

    await waitFor(() => {
      expect(screen.getByTestId("archivable-value-people")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Archive [DONOTUSE] Very critical?"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("These keep using it until you change them:"),
    ).toBeNull();
    expect(screen.queryByTestId("archivable-value-still-used-by")).toBeNull();
    expect(dialogText()).toContain(
      "2 people have on-call rules for this severity.",
    );
  });

  test("one person is one person", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [onCallRulesOf(1)];
    });

    await renderPage(IncidentSeveritiesPage);
    await openArchive(
      "incident-severity-table",
      severity(CRITICAL_ID, "Critical"),
    );

    await waitFor(() => {
      expect(dialogText()).toContain(
        "1 person has on-call rules for this severity. They stay as they are, so incidents with it still page them.",
      );
    });
  });

  test("a count the server stopped at says there are more", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [onCallRulesOf(10000, { isCountCapped: true })];
    });

    await renderPage(IncidentSeveritiesPage);
    await openArchive(
      "incident-severity-table",
      severity(CRITICAL_ID, "Critical"),
    );

    await waitFor(() => {
      expect(dialogText()).toContain(
        "10,000+ people have on-call rules for this severity.",
      );
    });
  });

  test("its link opens the reader's own on-call rules, on the tab of the kind of record", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [onCallRulesOf(2)];
    });

    await renderPage(IncidentSeveritiesPage);
    await openArchive(
      "incident-severity-table",
      severity(CRITICAL_ID, "Critical"),
    );

    const link: HTMLElement = await screen.findByTestId(
      "archivable-value-people-link-UserNotificationRule",
    );

    expect(link).toHaveTextContent("See your on-call rules");

    const incidents: Route | null = getOwnSettingsRoute(
      ArchivableValueType.IncidentSeverity,
      "UserNotificationRule",
    );

    expect(incidents!.toString()).toContain("user-settings/on-call-rules");
    // Incidents is the page's first tab: its address is the bare one.
    expect(incidents!.toString()).not.toContain("type=");

    expect(
      getOwnSettingsRoute(
        ArchivableValueType.AlertSeverity,
        "UserNotificationRule",
      )!.toString(),
    ).toContain("type=alerts");

    expect(
      getOwnSettingsRoute(
        ArchivableValueType.SecurityCasePriority,
        "UserNotificationSetting",
      )!.toString(),
    ).toContain("user-settings/notification-settings");

    // A table with no page of the reader's own: no link.
    expect(
      getOwnSettingsRoute(ArchivableValueType.Label, "SomethingPersonal"),
    ).toBeNull();
  });

  test("an alert severity: alerts with it still page them", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [onCallRulesOf(3)];
    });

    await renderPage(AlertSeveritiesPage);
    await openArchive("alert-severity-table", severity(CRITICAL_ID, "High"));

    await waitFor(() => {
      expect(dialogText()).toContain(
        "3 people have on-call rules for this severity. They stay as they are, so alerts with it still page them.",
      );
    });
  });

  test("a security case priority: people's notification settings, which stay", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({
          tableName: "UserNotificationSetting",
          title: "Notification Settings",
          singularTitle: "Notification Setting",
          count: 4,
          effect: ArchivableValueDeleteEffect.Cleared,
          kind: ArchivableValueUsageKind.Personal,
        }),
      ];
    });

    await renderPage(CasePrioritiesPage);

    const priorityTable: string = String(
      recordedTables.find((props: Record<string, unknown>): boolean => {
        return Array.isArray(props["actionButtons"]);
      })!["id"],
    );

    await openArchive(priorityTable, severity(CRITICAL_ID, "P5"));

    await waitFor(() => {
      expect(dialogText()).toContain(
        "4 people are notified about new security cases at this priority and above. That stays as it is. See your notification settings",
      );
    });
  });

  test("people's own settings with no words of their own still read as people's", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({
          tableName: "UserSomethingNew",
          title: "Something News",
          count: 2,
          effect: ArchivableValueDeleteEffect.Deleted,
          kind: ArchivableValueUsageKind.Personal,
        }),
      ];
    });

    const label: Label = new Label();
    label._id = CRITICAL_ID;
    label.name = "payments";

    await renderPage(LabelsPage);
    await openArchive("labels-table", label);

    await waitFor(() => {
      expect(dialogText()).toContain(
        "2 people have their own settings that use it. They stay as they are.",
      );
    });

    expect(
      screen.queryByTestId("archivable-value-people-link-UserSomethingNew"),
    ).toBeNull();
  });

  test("a setting reached more than one way is one line, with every way together", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [
        usageItem({
          tableName: "Monitor",
          title: "Monitors",
          singularTitle: "Monitor",
          count: 2,
          totalCount: 3,
          isTotalCountCapped: false,
          effect: ArchivableValueDeleteEffect.RemovedFromList,
          kind: ArchivableValueUsageKind.Settings,
        }),
        usageItem({
          tableName: "Monitor",
          title: "Monitors",
          singularTitle: "Monitor",
          count: 2,
          totalCount: 3,
          isTotalCountCapped: false,
          effect: ArchivableValueDeleteEffect.LeftDangling,
          kind: ArchivableValueUsageKind.Settings,
        }),
      ];
    });

    await renderPage(IncidentSeveritiesPage);
    await openArchive(
      "incident-severity-table",
      severity(CRITICAL_ID, "Critical"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("archivable-value-still-used-by"),
      ).toHaveTextContent("Monitors (3)");
    });

    expect(dialogText()).not.toContain("Monitors (2)");
  });
});

describe("the Delete dialog names whose rules go with it", () => {
  test("deleting a severity takes people's own on-call rules for it: said as theirs, by person", async () => {
    usageMock.mockImplementation(async (): Promise<Array<unknown>> => {
      return [onCallRulesOf(2), onCallRuleSettings];
    });

    await renderPage(IncidentSeveritiesPage);

    const confirmation: DeleteConfirmation = await (
      table("incident-severity-table")["getDeleteConfirmation"] as (
        item: BaseModel,
      ) => Promise<DeleteConfirmation>
    )(severity(CRITICAL_ID, "Critical"));

    const view: { container: HTMLElement } = render(
      <div>{confirmation.description}</div>,
    );
    const text: string = (view.container.textContent || "").replace(
      /\s+/g,
      " ",
    );

    expect(text).toContain("Deleted with it: On-call rules of 2 people");
    expect(text).toContain("Removed from: Incident On-Call Rules (3)");
    expect(text).not.toContain("Notification Rules");
  });
});

describe("Bulk Actions > Delete of values says what it would do first", () => {
  interface Controls {
    controls: BulkActionConfirmControls;
    held: Array<boolean>;
  }

  const controls: () => Controls = (): Controls => {
    const held: Array<boolean> = [];

    return {
      held: held,
      controls: {
        setIsSubmitHeld: (isHeld: boolean): void => {
          held.push(isHeld);
        },
      },
    };
  };

  const bulkActionsOf: (tableId: string) => BulkActionProps<BaseModel> = (
    tableId: string,
  ): BulkActionProps<BaseModel> => {
    return table(tableId)["bulkActions"] as BulkActionProps<BaseModel>;
  };

  const SELECTED: Array<IncidentSeverity> = [
    severity(CRITICAL_ID, "Critical"),
    severity(MAJOR_ID, "Major"),
    severity(MINOR_ID, "Minor"),
  ];

  const drawDetails: (
    held: Controls,
    items?: Array<BaseModel>,
    tableId?: string,
  ) => Promise<void> = async (
    held: Controls,
    items?: Array<BaseModel>,
    tableId?: string,
  ): Promise<void> => {
    const details: ReactElement | undefined = bulkActionsOf(
      tableId || "incident-severity-table",
    ).deleteConfirmationDetails!(items || SELECTED, held.controls);

    await act(async () => {
      render(<div data-testid="bulk-dialog">{details}</div>);
    });
  };

  const bulkText: () => string = (): string => {
    return (screen.getByTestId("bulk-dialog").textContent || "").replace(
      /\s+/g,
      " ",
    );
  };

  test("every value page offers it, on its live table", async () => {
    await renderPage(IncidentSeveritiesPage);

    const bulk: BulkActionProps<BaseModel> = bulkActionsOf(
      "incident-severity-table",
    );

    // No buttons of its own: the table's own Delete is the one it describes.
    expect(bulk.buttons).toEqual([]);
    expect(typeof bulk.deleteConfirmationDetails).toBe("function");
    expect(typeof bulk.getDeleteRefusal).toBe("function");
    expect(typeof bulk.onDeleteEnd).toBe("function");
  });

  test("reads once for the selection, holding Delete while it does", async () => {
    let answer: (usage: ArchivableValuesUsage) => void = (): void => {};

    valuesUsageMock.mockImplementation((): Promise<ArchivableValuesUsage> => {
      return new Promise<ArchivableValuesUsage>(
        (resolve: (usage: ArchivableValuesUsage) => void) => {
          answer = resolve;
        },
      );
    });

    await renderPage(IncidentSeveritiesPage);

    const held: Controls = controls();
    await drawDetails(held);

    expect(valuesUsageMock).toHaveBeenCalledTimes(1);

    const asked: {
      modelType: unknown;
      valueIds: Array<ObjectID>;
      purpose: ArchivableValuesUsagePurpose;
    } = valuesUsageMock.mock.calls[0]![0] as {
      modelType: unknown;
      valueIds: Array<ObjectID>;
      purpose: ArchivableValuesUsagePurpose;
    };

    expect(asked.modelType).toBe(IncidentSeverity);
    expect(
      asked.valueIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([CRITICAL_ID, MAJOR_ID, MINOR_ID]);
    expect(asked.purpose).toBe(ArchivableValuesUsagePurpose.Delete);

    // Checking, and Delete held meanwhile.
    expect(
      screen.getByTestId("archivable-values-bulk-checking"),
    ).toHaveTextContent("Checking what still uses them…");
    expect(held.held).toEqual([true]);

    await act(async () => {
      answer({ usage: [], refusedValueIds: [], refusedUsage: [] });
    });

    // Nothing uses them: nothing more to say, and Delete is free.
    expect(screen.queryByTestId("archivable-values-bulk-checking")).toBeNull();
    expect(bulkText()).toBe("");
    expect(held.held).toEqual([true, false]);
  });

  test("names the values records still have, what has them, and what deleting the rest changes", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [CRITICAL_ID.toUpperCase()],
          refusedUsage: [usageItem({})],
          usage: [onCallRulesOf(11), onCallRuleSettings],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);

    const held: Controls = controls();
    await drawDetails(held);

    await waitFor(() => {
      expect(
        screen.getByTestId("archivable-values-bulk-delete-refused"),
      ).toBeInTheDocument();
    });

    expect(bulkText()).toContain(
      "Critical can't be deleted while these have it:",
    );
    expect(
      screen.getByTestId("archivable-values-bulk-delete-refused-by"),
    ).toHaveTextContent("Incidents (12)");
    expect(bulkText()).toContain(
      "It is left as it is. Archive it instead: nobody can pick it again, and everything that has it keeps it.",
    );
    expect(bulkText()).toContain("Deleting the others also changes these:");
    // Two values go: what goes is deleted with them.
    expect(bulkText()).toContain(
      "Deleted with them: On-call rules of 11 people",
    );
    expect(bulkText()).not.toContain("Deleted with it");
    expect(bulkText()).toContain("Removed from: Incident On-Call Rules (3)");

    // Two of three can go: Delete is free.
    expect(held.held).toEqual([true, false]);

    // The run leaves the refused one out, with why; the others go.
    const bulk: BulkActionProps<BaseModel> = bulkActionsOf(
      "incident-severity-table",
    );

    expect(bulk.getDeleteRefusal!(SELECTED[0]!)).toBe(
      "Records still have it, so it can't be deleted. Archive it instead.",
    );
    expect(bulk.getDeleteRefusal!(SELECTED[1]!)).toBeUndefined();
    expect(bulk.getDeleteRefusal!(SELECTED[2]!)).toBeUndefined();
  });

  test("several the records still have are named together", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [CRITICAL_ID, MAJOR_ID],
          refusedUsage: [usageItem({ count: 40 })],
          usage: [],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);
    await drawDetails(controls());

    await waitFor(() => {
      expect(bulkText()).toContain(
        "Critical and Major can't be deleted while these have them:",
      );
    });

    expect(
      screen.getByTestId("archivable-values-bulk-delete-refused-by"),
    ).toHaveTextContent("Incidents (40)");
    expect(bulkText()).toContain(
      "They are left as they are. Archive them instead: nobody can pick them again, and everything that has them keeps them.",
    );
    // Deleting the rest changes nothing: no second list.
    expect(
      screen.queryByTestId("archivable-values-bulk-delete-changes"),
    ).toBeNull();
  });

  test("when every one of them is refused, Delete stays held: there is nothing it could delete", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [CRITICAL_ID],
          refusedUsage: [usageItem({})],
          usage: [],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);

    const held: Controls = controls();
    await drawDetails(held, [severity(CRITICAL_ID, "Critical")]);

    await waitFor(() => {
      expect(held.held).toEqual([true, true]);
    });
  });

  test("with none refused, it says what deleting them changes", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [],
          refusedUsage: [],
          usage: [onCallRulesOf(2)],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);
    await drawDetails(controls());

    await waitFor(() => {
      expect(bulkText()).toContain("Deleting them also changes these:");
    });

    expect(bulkText()).toContain(
      "Deleted with them: On-call rules of 2 people",
    );
    expect(
      screen.queryByTestId("archivable-values-bulk-delete-refused"),
    ).toBeNull();
  });

  test("one left to delete beside a refused one: what goes is deleted with it", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [CRITICAL_ID],
          refusedUsage: [usageItem({})],
          usage: [onCallRulesOf(2)],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);
    await drawDetails(controls(), [
      severity(CRITICAL_ID, "Critical"),
      severity(MINOR_ID, "Minor"),
    ]);

    await waitFor(() => {
      expect(bulkText()).toContain(
        "Deleting the other one also changes these:",
      );
    });

    expect(bulkText()).toContain("Deleted with it: On-call rules of 2 people");
    expect(bulkText()).not.toContain("Deleted with them");
  });

  test("a read that fails says nothing and lets Delete go: the server refuses what it must", async () => {
    valuesUsageMock.mockImplementation(async (): Promise<never> => {
      throw new Error("Server Error");
    });

    await renderPage(IncidentSeveritiesPage);

    const held: Controls = controls();
    await drawDetails(held);

    await waitFor(() => {
      expect(held.held).toEqual([true, false]);
    });

    expect(bulkText()).toBe("");
    expect(
      bulkActionsOf("incident-severity-table").getDeleteRefusal!(SELECTED[0]!),
    ).toBeUndefined();
  });

  test("a new dialog forgets the last one's refusals until it has read its own", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [CRITICAL_ID],
          refusedUsage: [usageItem({})],
          usage: [],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);
    await drawDetails(controls());

    await waitFor(() => {
      expect(
        bulkActionsOf("incident-severity-table").getDeleteRefusal!(
          SELECTED[0]!,
        ),
      ).toBeDefined();
    });

    cleanup();

    valuesUsageMock.mockImplementation((): Promise<never> => {
      return new Promise<never>(() => {
        // Never answers.
      });
    });

    await renderPage(IncidentSeveritiesPage);
    bulkActionsOf("incident-severity-table").deleteConfirmationDetails!(
      SELECTED,
      controls().controls,
    );

    expect(
      bulkActionsOf("incident-severity-table").getDeleteRefusal!(SELECTED[0]!),
    ).toBeUndefined();
  });

  test("the Archived section's bulk Delete says the refused ones stay archived", async () => {
    countMock.mockImplementation(
      async (args: { query: Record<string, unknown> }): Promise<number> => {
        return args.query["isArchived"] === true ? 2 : 5;
      },
    );
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [CRITICAL_ID],
          refusedUsage: [usageItem({})],
          usage: [],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);

    await waitFor(() => {
      expect(
        recordedTables.some((props: Record<string, unknown>): boolean => {
          return props["id"] === "IncidentSeverity-archived-table";
        }),
      ).toBe(true);
    });

    await drawDetails(
      controls(),
      [severity(CRITICAL_ID, "Critical")],
      "IncidentSeverity-archived-table",
    );

    await waitFor(() => {
      expect(bulkText()).toContain(
        "It is left as it is, archived: nobody can pick it, and everything that has it keeps it.",
      );
    });
  });

  test("once a bulk Delete has run, the page reads its counts again", async () => {
    await renderPage(IncidentSeveritiesPage);

    const before: unknown = table("incident-severity-table")["refreshToggle"];
    const countsBefore: number = countMock.mock.calls.length;

    /*
     * Date.now() makes the toggle: let a few milliseconds pass after the
     * page drew, before the bulk Delete ends, so the two never share one.
     */
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 5);
      });
    });

    await act(async () => {
      bulkActionsOf("incident-severity-table").onDeleteEnd!();
    });

    await waitFor(() => {
      expect(countMock.mock.calls.length).toBeGreaterThan(countsBefore);
    });
    expect(table("incident-severity-table")["refreshToggle"]).not.toBe(before);
  });

  test("its words are drawn with a list's dot, and a click inside changes nothing", async () => {
    valuesUsageMock.mockImplementation(
      async (): Promise<ArchivableValuesUsage> => {
        return {
          refusedValueIds: [],
          refusedUsage: [],
          usage: [onCallRuleSettings],
        };
      },
    );

    await renderPage(IncidentSeveritiesPage);
    await drawDetails(controls());

    await waitFor(() => {
      expect(
        screen.getByTestId("archivable-values-bulk-delete-changes"),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByTestId("archivable-values-bulk-delete-changes"),
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
