import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * What the audit log draws in place of what its reader may not read (#10642).
 * ---------------------------------------------------------------------------
 *
 * The server keeps, from a reader, the values of the fields they may not
 * read on the record itself, and the name of a record they may not read
 * (Server/Utils/AuditLog/AuditLogReadAccess): the field is named, its values
 * read "[HIDDEN]" and the change says valueHidden: true; the name reads
 * "[HIDDEN]". The changes dialog lists the field by its product name with
 * "Value hidden" in place of its values, and says once why; the table's
 * Resource column says "Name hidden" and opens nothing; the dialog's title
 * names the type alone. Never the marker itself, in every language.
 *
 * AnalyticsModelTable is mocked to capture its columns, as in
 * AuditLogTableInReadersLanguage.test.tsx.
 */

jest.mock("Common/UI/Config", () => {
  return {
    ...(jest.requireActual("Common/UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
  };
});

const mockLicenseFetch: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockLicenseFetch(...args);
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

type CapturedColumn = {
  title: string;
  getElement?: ((item: AuditLog) => React.ReactElement) | undefined;
};

let capturedColumns: Array<CapturedColumn> = [];
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns?: Array<CapturedColumn> }): React.ReactElement => {
      capturedColumns = props.columns || [];
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": "audit-logs-analytics-table",
      });
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import AuditLogChangesModal, {
  AUDIT_LOG_HIDDEN_WORDS,
  ChangeRow,
  getAuditLogChangesTitle,
  getChangedFieldLabels,
  getShownResourceName,
  readChangeRows,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import AuditLogsTable, {
  AUDIT_LOGS_TABLE_WORDS,
} from "../../../Dashboard/AuditLogs/AuditLogsTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import {
  AUDIT_LOG_HIDDEN_VALUE,
  hideAuditLogChange,
} from "Common/Types/AuditLog/AuditLogHiddenValues";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/Types/Translator";
import ProjectUtil from "Common/UI/Utils/Project";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const PROJECT_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-000000000201",
);

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

// A word as `language` writes it.
const wordIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return readDashboardLocale(language)[english] || english;
};

// A security case's update as a Settings Admin is handed it.
const HIDDEN_CASE_CHANGES: JSONArray = [
  hideAuditLogChange({
    field: "verdict",
    oldValue: "Suspicious",
    newValue: "Malicious",
  }),
  hideAuditLogChange({
    field: "aiTriageReport",
    oldValue: null,
    newValue: "The host encrypted 4,000 files",
    summary: ["Changed the report"],
  }),
];

// A finding's update as a Security Viewer is handed it: one field hidden.
const PARTLY_HIDDEN_CHANGES: JSONArray = [
  { field: "sensitivity", oldValue: "Medium", newValue: "High" },
  hideAuditLogChange({
    field: "maskedSamples",
    oldValue: [],
    newValue: ["j***@e******.com"],
  }),
];

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words, in every language", () => {
  const words: Array<string> = Object.values(AUDIT_LOG_HIDDEN_WORDS);

  test("each is a key of the English locale", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of words) {
      expect({ word, isKey: english[word] === word }).toEqual({
        word,
        isKey: true,
      });
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each of them in its own words",
    (language: string) => {
      for (const word of words) {
        expect({
          word,
          isWorded: isWordedInDashboardLocale(word, language),
        }).toEqual({ word, isWorded: true });

        if (language !== "en") {
          expect({
            word,
            translation: readDashboardLocale(language)[word],
          }).not.toEqual({ word, translation: word });
        }
      }
    },
  );
});

describe("the rows the dialog lists", () => {
  test("a hidden change is a row by its field, with no value and no lines", () => {
    const rows: Array<ChangeRow> = readChangeRows(HIDDEN_CASE_CHANGES);

    expect(rows).toEqual([
      {
        field: "aiTriageReport",
        oldValue: undefined,
        newValue: undefined,
        summary: [],
        isHidden: true,
      },
      {
        field: "verdict",
        oldValue: undefined,
        newValue: undefined,
        summary: [],
        isHidden: true,
      },
    ]);
  });

  test("a change the reader reads is a row as before, never marked hidden", () => {
    const rows: Array<ChangeRow> = readChangeRows(PARTLY_HIDDEN_CHANGES);

    expect(rows[1]).toEqual({
      field: "sensitivity",
      oldValue: "Medium",
      newValue: "High",
      summary: [],
    });
    expect(rows[0]!.isHidden).toBe(true);
  });

  test("a row of the log still names the hidden fields", () => {
    expect(
      getChangedFieldLabels({
        changes: HIDDEN_CASE_CHANGES,
        storedResourceType: "Security Case",
        translator: dashboardTranslator("en"),
      }),
    ).toHaveLength(2);
  });
});

describe("the changes dialog", () => {
  const drawDialog: (data: {
    language: string;
    changes: JSONArray;
    resourceName?: string | undefined;
  }) => void = (data: {
    language: string;
    changes: JSONArray;
    resourceName?: string | undefined;
  }): void => {
    render(
      <I18nextProvider i18n={instanceFor(data.language)}>
        <AuditLogChangesModal
          isOpen={true}
          onClose={jest.fn()}
          action="Update"
          resourceType="Security Case"
          storedResourceType="Security Case"
          resourceName={data.resourceName}
          changes={data.changes}
        />
      </I18nextProvider>,
    );
  };

  test.each(LANGUAGES)(
    "%s: each hidden field says Value hidden in the reader's words, and the dialog says why once",
    (language: string) => {
      drawDialog({
        language,
        changes: HIDDEN_CASE_CHANGES,
        resourceName: AUDIT_LOG_HIDDEN_VALUE,
      });

      const hidden: Array<HTMLElement> = screen.getAllByTestId(
        "audit-log-hidden-change",
      );
      expect(hidden).toHaveLength(2);

      for (const row of hidden) {
        expect(
          within(row).getByText(
            wordIn(language, AUDIT_LOG_HIDDEN_WORDS.valueHidden),
          ),
        ).toBeInTheDocument();
        // No Before, no After: there is no value to put there.
        expect(
          within(row).queryByText(wordIn(language, "Before")),
        ).not.toBeInTheDocument();
      }

      expect(
        screen.getAllByTestId("audit-log-hidden-values-note"),
      ).toHaveLength(1);
      expect(
        screen.getByText(
          wordIn(language, AUDIT_LOG_HIDDEN_WORDS.hiddenValuesNote),
        ),
      ).toBeInTheDocument();

      // Nothing of the marker, nor of what was kept, is drawn.
      expect(document.body.textContent).not.toContain(AUDIT_LOG_HIDDEN_VALUE);
      expect(document.body.textContent).not.toContain("Malicious");
      expect(document.body.textContent).not.toContain("Changed the report");
    },
  );

  test("a field the reader reads keeps its values beside a hidden one", () => {
    drawDialog({ language: "en", changes: PARTLY_HIDDEN_CHANGES });

    expect(screen.getAllByTestId("audit-log-hidden-change")).toHaveLength(1);
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("j***@");
  });

  test("a dialog with nothing hidden says nothing about hidden values", () => {
    drawDialog({
      language: "en",
      changes: [{ field: "sensitivity", oldValue: "Medium", newValue: "High" }],
      resourceName: "Customer emails",
    });

    expect(
      screen.queryByTestId("audit-log-hidden-values-note"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("audit-log-hidden-change"),
    ).not.toBeInTheDocument();
  });

  test.each(LANGUAGES)(
    "%s: the title of a record the reader may not read names its type alone",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      const title: string = getAuditLogChangesTitle({
        action: "Update",
        resourceType: "Security Case",
        resourceName: AUDIT_LOG_HIDDEN_VALUE,
        translator,
      });

      expect(title).toBe(
        getAuditLogChangesTitle({
          action: "Update",
          resourceType: "Security Case",
          translator,
        }),
      );
      expect(title).not.toContain(AUDIT_LOG_HIDDEN_VALUE);
    },
  );

  test("a name the reader reads is the name; a hidden one is none", () => {
    expect(getShownResourceName("Phishing campaign")).toBe(
      "Phishing campaign",
    );
    expect(getShownResourceName(AUDIT_LOG_HIDDEN_VALUE)).toBeUndefined();
    expect(getShownResourceName(undefined)).toBeUndefined();
  });
});

describe("the table's Resource column", () => {
  const projectWithAuditLogs: () => Project = (): Project => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.enableAuditLogs = true;
    return project;
  };

  beforeEach(() => {
    capturedColumns = [];
    getItemMock.mockReset();
    getItemMock.mockResolvedValue(projectWithAuditLogs());
    mockLicenseFetch.mockReset();
    mockLicenseFetch.mockResolvedValue({
      isSuccess: (): boolean => {
        return true;
      },
      data: { status: "valid", licenseValid: true } as JSONObject,
    });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  const drawResourceCell: (data: {
    language: string;
    entry: AuditLog;
  }) => Promise<HTMLElement> = async (data: {
    language: string;
    entry: AuditLog;
  }): Promise<HTMLElement> => {
    render(
      <I18nextProvider i18n={instanceFor(data.language)}>
        <MemoryRouter>
          <AuditLogsTable title="Audit Logs" description="Every change." />
        </MemoryRouter>
      </I18nextProvider>,
    );

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    const column: CapturedColumn | undefined = capturedColumns.find(
      (candidate: CapturedColumn): boolean => {
        return candidate.title === "Resource";
      },
    );

    expect(column?.getElement).toBeDefined();

    cleanup();

    const { container } = render(
      <I18nextProvider i18n={instanceFor(data.language)}>
        <MemoryRouter>{column!.getElement!(data.entry)}</MemoryRouter>
      </I18nextProvider>,
    );

    return container;
  };

  const caseEntry: (resourceName: string | undefined) => AuditLog = (
    resourceName: string | undefined,
  ): AuditLog => {
    const entry: AuditLog = new AuditLog();
    entry.projectId = PROJECT_ID;
    entry.action = "Update";
    entry.resourceType = "Monitor";
    entry.resourceId = ObjectID.generate();
    entry.rootResourceType = "Monitor";
    entry.rootResourceId = entry.resourceId;

    if (resourceName !== undefined) {
      entry.resourceName = resourceName;
    }

    return entry;
  };

  test.each(LANGUAGES)(
    "%s: a hidden name says Name hidden in the reader's words, and opens nothing",
    async (language: string) => {
      const cell: HTMLElement = await drawResourceCell({
        language,
        entry: caseEntry(AUDIT_LOG_HIDDEN_VALUE),
      });

      expect(within(cell).getByTestId("audit-log-name-hidden")).toHaveTextContent(
        wordIn(language, AUDIT_LOG_HIDDEN_WORDS.nameHidden),
      );
      expect(cell.querySelector("a")).toBeNull();
      expect(cell.textContent).not.toContain(AUDIT_LOG_HIDDEN_VALUE);
    },
  );

  test("a name the reader reads opens its record, as before", async () => {
    const cell: HTMLElement = await drawResourceCell({
      language: "en",
      entry: caseEntry("Checkout API"),
    });

    expect(within(cell).getByText("Checkout API")).toBeInTheDocument();
    expect(cell.querySelector("a")).not.toBeNull();
    expect(
      within(cell).queryByTestId("audit-log-name-hidden"),
    ).not.toBeInTheDocument();
  });

  test("a record with no name still says Unnamed", async () => {
    const cell: HTMLElement = await drawResourceCell({
      language: "en",
      entry: caseEntry(undefined),
    });

    expect(
      within(cell).getAllByText(AUDIT_LOGS_TABLE_WORDS.unnamed).length,
    ).toBeGreaterThan(0);
    expect(
      within(cell).queryByTestId("audit-log-name-hidden"),
    ).not.toBeInTheDocument();
  });
});
