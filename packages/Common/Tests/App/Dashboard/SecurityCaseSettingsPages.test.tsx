import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events > Settings > Case Statuses and Case Priorities, as the UI
 * review left them. ModelTable is stubbed and its props recorded (what each
 * page hands it is the page's contract), the archive hook is the real one,
 * and the reader's language is a German stand-in for a few strings:
 *
 *   - each page names one value and several as its title does: "Create
 *     Case Status" under the Case Statuses title, "case statuses" in the
 *     footer, and the folded Archived section's table and dialogs the same,
 *     never the model's "Security Case Status";
 *   - Case Priorities says which detection severity opens its cases at each
 *     built-in priority, in a column called Detection severity; a priority
 *     of the project's own has none, said in a muted "None";
 *   - the description a new project's built-in values start with reads in
 *     the reader's language, as their names do; words the project wrote read
 *     as written.
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

// The reader's language: a German stand-in for the strings these tests read.
const GERMAN: Record<string, string> = {
  "Nobody has looked at it yet.": "Noch hat sich niemand den Fall angesehen.",
  "Medium or unknown": "Mittel oder unbekannt",
  None: "Keine",
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return GERMAN[key] ?? opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
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

import SecurityCasePrioritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/CasePriorities";
import SecurityCaseStatusesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/CaseStatuses";
import { ARCHIVED_SECTION_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/UseArchivableValues";
import {
  STATE_SETTINGS_COPY,
  StateSettingsBuiltInColumnCopy,
  getStateSettingsStrings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import Route from "../../../Types/API/Route";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../../Utils/ArchivableValues";
import { StateListType } from "../../../Utils/StateOrder";

interface RecordedColumn {
  id?: string;
  title?: string;
  headerTooltip?: string;
  getElement?: (item: unknown) => ReactElement;
  getExportValue?: (item: unknown) => string;
}

interface PageCase {
  name: string;
  page: React.FunctionComponent<PageComponentProps>;
  modelType: { new (): SecurityCasePriority | SecurityCaseStatus };
  type: ArchivableValueType;
  tableId: string;
  singularName: string;
  pluralName: string;
  columnTitles: Array<string>;
  // What the create and edit form says under Name and under Description.
  formHelp: [string, string];
}

const PAGES: Array<PageCase> = [
  {
    name: "Case Statuses",
    page: SecurityCaseStatusesPage,
    modelType: SecurityCaseStatus,
    type: ArchivableValueType.SecurityCaseStatus,
    tableId: "security-case-status-table",
    singularName: "Case Status",
    pluralName: "Case Statuses",
    columnTitles: ["Name", "Counts as", "Description"],
    formHelp: [
      "What the status is called, like Investigating or Triage.",
      "What a case in this status is waiting for, in a sentence.",
    ],
  },
  {
    name: "Case Priorities",
    page: SecurityCasePrioritiesPage,
    modelType: SecurityCasePriority,
    type: ArchivableValueType.SecurityCasePriority,
    tableId: "security-case-priority-table",
    singularName: "Case Priority",
    pluralName: "Case Priorities",
    columnTitles: ["Name", "Detection severity", "Description"],
    formHelp: [
      "What the priority is called, like High or P1.",
      "How fast a case at this priority needs a person, in a sentence.",
    ],
  },
];

// How many values are archived, as count() answers.
let archivedCount: number = 0;

beforeEach(() => {
  recordedTables.length = 0;
  archivedCount = 0;
  countMock.mockReset();
  countMock.mockImplementation(
    async (args: { query: Record<string, unknown> }): Promise<number> => {
      return args.query["isArchived"] === true ? archivedCount : 5;
    },
  );
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
        pageRoute={new Route("/dashboard/project/security-events")}
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

const columnsOf: (pageCase: PageCase) => Array<RecordedColumn> = (
  pageCase: PageCase,
): Array<RecordedColumn> => {
  return table(pageCase.tableId)!["columns"] as Array<RecordedColumn>;
};

describe.each(PAGES)("$name", (pageCase: PageCase) => {
  test("names one value and several as its title does, not as the model does", async () => {
    await renderPage(pageCase);

    const live: Record<string, unknown> = table(pageCase.tableId)!;

    expect(live["modelType"]).toBe(pageCase.modelType);
    expect(live["singularName"]).toBe(pageCase.singularName);
    expect(live["pluralName"]).toBe(pageCase.pluralName);
    expect((live["cardProps"] as { title: string }).title).toBe(
      pageCase.pluralName,
    );
    // The model's own name is the longer one the review left behind.
    expect(new pageCase.modelType().singularName).toBe(
      `Security ${pageCase.singularName}`,
    );
  });

  test("the Archived section's table names them the same", async () => {
    archivedCount = 2;

    await renderPage(pageCase);

    await waitFor(() => {
      expect(screen.getByTestId(ARCHIVED_SECTION_TEST_ID)).toBeInTheDocument();
    });

    const archived: Record<string, unknown> | undefined = table(
      `${ARCHIVABLE_VALUES[pageCase.type].tableName}-archived-table`,
    );

    expect(archived).toBeDefined();
    expect(archived!["singularName"]).toBe(pageCase.singularName);
    expect(archived!["pluralName"]).toBe(pageCase.pluralName);
  });

  test("its form says what Name and Description are for in its own words, which a locale translates", async () => {
    await renderPage(pageCase);

    const fields: Array<{
      field?: Record<string, unknown>;
      description?: string;
    }> = table(pageCase.tableId)!["formFields"] as Array<{
      field?: Record<string, unknown>;
      description?: string;
    }>;

    expect(
      fields.map((field: { field?: Record<string, unknown> }): string => {
        return Object.keys(field.field || {})[0] || "";
      }),
    ).toEqual(["name", "description", "color"]);
    expect([fields[0]!.description, fields[1]!.description]).toEqual(
      pageCase.formHelp,
    );
    // The words a locale translates, not the model's API description.
    for (const help of pageCase.formHelp) {
      expect(getStateSettingsStrings()).toContain(help);
    }
  });

  test("lists the name, what the page says of each, then the description", async () => {
    await renderPage(pageCase);

    expect(
      columnsOf(pageCase).map((column: RecordedColumn): string => {
        return column.title || "";
      }),
    ).toEqual(pageCase.columnTitles);
  });

  test("a built-in value's description reads in the reader's language, the project's own as written", async () => {
    await renderPage(pageCase);

    const description: RecordedColumn =
      columnsOf(pageCase)[columnsOf(pageCase).length - 1]!;

    render(
      description.getElement!({
        _id: "a",
        name: "New",
        description: "Nobody has looked at it yet.",
      }),
    );
    expect(screen.getByTestId("state-settings-description")).toHaveTextContent(
      "Noch hat sich niemand den Fall angesehen.",
    );
    cleanup();

    await renderPage(pageCase);
    render(
      columnsOf(pageCase)[columnsOf(pageCase).length - 1]!.getElement!({
        _id: "b",
        name: "Eradicating",
        description: "Our runbook's second half: rotate every secret.",
      }),
    );
    expect(screen.getByTestId("state-settings-description")).toHaveTextContent(
      "Our runbook's second half: rotate every secret.",
    );
  });
});

describe("Case Priorities' Detection severity column", () => {
  const copy: StateSettingsBuiltInColumnCopy =
    STATE_SETTINGS_COPY[StateListType.SecurityCasePriority].builtInColumn!;

  const column: () => RecordedColumn = (): RecordedColumn => {
    return columnsOf(PAGES[1]!).find((each: RecordedColumn): boolean => {
      return each.id === "built-in";
    })!;
  };

  // A built-in priority of a level, as the page reads it.
  const builtIn: (
    level: SecurityCasePriorityLevel,
  ) => Record<string, unknown> = (
    level: SecurityCasePriorityLevel,
  ): Record<string, unknown> => {
    return {
      _id: level,
      name: level,
      [SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level]]: true,
    };
  };

  test("is named for what it holds, and says in its header what that means", async () => {
    await renderPage(PAGES[1]!);

    expect(column().title).toBe("Detection severity");
    expect(column().headerTooltip).toBe(copy.tooltip);
    expect(copy.tooltip).toBe(
      "Detections of this severity open their cases at this priority, and a case rises when a more severe detection joins it. People and playbooks set the priorities you add.",
    );
  });

  test("gives each built-in priority the detection severity that opens its cases", async () => {
    await renderPage(PAGES[1]!);

    expect(
      [
        SecurityCasePriorityLevel.Critical,
        SecurityCasePriorityLevel.High,
        SecurityCasePriorityLevel.Medium,
        SecurityCasePriorityLevel.Low,
        SecurityCasePriorityLevel.Informational,
      ].map((level: SecurityCasePriorityLevel): string => {
        return column().getExportValue!(builtIn(level));
      }),
    ).toEqual([
      "Critical",
      "High",
      "Medium or unknown",
      "Low",
      "Informational",
    ]);
  });

  test("a priority of the project's own has none, drawn muted as an empty value is", async () => {
    await renderPage(PAGES[1]!);

    expect(column().getExportValue!({ _id: "e", name: "Emergency" })).toBe(
      "None",
    );

    render(column().getElement!({ _id: "e", name: "Emergency" }));
    const none: HTMLElement = screen.getByTestId(
      "state-settings-built-in-column",
    );
    // In the reader's language, and muted.
    expect(none).toHaveTextContent("Keine");
    expect(none).toHaveClass("text-gray-400");
    cleanup();

    await renderPage(PAGES[1]!);
    render(column().getElement!(builtIn(SecurityCasePriorityLevel.Medium)));
    const medium: HTMLElement = screen.getByTestId(
      "state-settings-built-in-column",
    );
    expect(medium).toHaveTextContent("Mittel oder unbekannt");
    expect(medium).not.toHaveClass("text-gray-400");
  });
});
