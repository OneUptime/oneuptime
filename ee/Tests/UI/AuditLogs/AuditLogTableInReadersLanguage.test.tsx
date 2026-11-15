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
 * The audit log table's own words, in the reader's language (issue #8319).
 * ---------------------------------------------------------------------------
 *
 * The Action column (#7781) and the Resource column's type (#7580) read in
 * the reader's language; everything else the table draws itself stayed
 * English, because it was JSX text or a template literal: the header pills
 * ("Audit logging is off", "Turn on", the license's "not recording"), the
 * empty states, "Unnamed", the actor lines ("API request", "Workflow",
 * "System", "Automated change", "Unknown user", the stored "MasterAdmin"),
 * the "via ... (MCP client)" line, and "3 fields changed" built with
 * English's plural. Each is a key of the Dashboard's locales now, a count
 * goes through the reader's plural forms and digits, and names are drawn as
 * they were recorded.
 *
 * Drawn here in English, German, Arabic and Persian. AnalyticsModelTable is
 * mocked to capture its props and draw its header element and empty state,
 * as in AuditLogsTable.test.tsx; each cell is drawn from the captured column.
 */

let billingEnabledForTest: boolean = false;

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
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

type CapturedTableProps = {
  cardProps?: { rightElement?: React.ReactElement | undefined };
  noItemsMessage?: React.ReactElement;
  columns?: Array<CapturedColumn>;
};

let capturedTableProps: CapturedTableProps | null = null;
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): React.ReactElement => {
      capturedTableProps = props;
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement(
        "div",
        { "data-testid": "audit-logs-analytics-table" },
        props.cardProps?.rightElement || null,
        props.noItemsMessage || null,
      );
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

import AuditLogsTable, {
  AUDIT_LOG_FIELDS_CAPTURED,
  AUDIT_LOGS_TABLE_WORDS,
  getAuditLogFieldCountLabel,
} from "../../../Dashboard/AuditLogs/AuditLogsTable";
import { AUDIT_LOG_FIELDS_CHANGED } from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import {
  AUDIT_LOGS_LAPSED_DESCRIPTION,
  AUDIT_LOGS_LAPSED_TITLE,
  AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION,
  AUDIT_LOGS_NOT_INCLUDED_TITLE,
} from "../../../Dashboard/AuditLogs/AuditLogsLicenseNotice";
import {
  AUDIT_LOG_ACTOR_TYPE_LABELS,
  getActorCredentialLabel,
  getActorTypeLabel,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import { AuditLogSessionField } from "Common/Types/AuditLog/AuditLogSessionEvent";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/Types/Translator";
import UserType from "Common/Types/UserType";
import ProjectUtil from "Common/UI/Utils/Project";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TRANSLATED: ReadonlyArray<string> = ["de", "ar", "fa"];

const PROJECT_ID: ObjectID = new ObjectID(
  "83190000-0000-4000-8000-000000000001",
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

const projectWith: (enableAuditLogs: boolean) => Project = (
  enableAuditLogs: boolean,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = enableAuditLogs;
  return project;
};

const answerLicense: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: payload,
  });
};

// The table, drawn in `language`, once the switch and the license are read.
const drawTable: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  render(
    <I18nextProvider i18n={instanceFor(language)}>
      <MemoryRouter>
        <AuditLogsTable
          title="Audit Logs"
          description="Every change made to the resources in this project, and every time its members sign in or out."
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

// One cell of the table's column `title`, drawn for `entry` in `language`.
const drawCell: (data: {
  language: string;
  column: string;
  entry: AuditLog;
}) => Promise<HTMLElement> = async (data: {
  language: string;
  column: string;
  entry: AuditLog;
}): Promise<HTMLElement> => {
  await drawTable(data.language);

  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === data.column;
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

const entryOf: (
  fields: Partial<Record<keyof AuditLog, unknown>>,
) => AuditLog = (
  fields: Partial<Record<keyof AuditLog, unknown>>,
): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.action = "Update";
  entry.resourceType = "Monitor";
  Object.assign(entry, fields);
  return entry;
};

const changesOf: (count: number) => JSONArray = (count: number): JSONArray => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return { field: `field${index}`, oldValue: index, newValue: index + 1 };
  });
};

beforeEach(() => {
  capturedTableProps = null;
  billingEnabledForTest = false;
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(projectWith(true));
  mockLicenseFetch.mockReset();
  answerLicense({ status: "valid", licenseValid: true });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the table's words are worded in every language it is drawn in here", () => {
  const words: Array<string> = [
    ...Object.values(AUDIT_LOGS_TABLE_WORDS),
    AUDIT_LOG_FIELDS_CAPTURED.other,
    `${AUDIT_LOG_FIELDS_CAPTURED.other}_one`,
    AUDIT_LOG_FIELDS_CHANGED.other,
    `${AUDIT_LOG_FIELDS_CHANGED.other}_one`,
    AUDIT_LOGS_LAPSED_TITLE,
    AUDIT_LOGS_LAPSED_DESCRIPTION,
    AUDIT_LOGS_NOT_INCLUDED_TITLE,
    AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION,
    ...Object.values(AUDIT_LOG_ACTOR_TYPE_LABELS),
    "via {{name}} (MCP client)",
  ];

  test("each is a key of the English locale", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of words) {
      expect({ word, isKey: typeof english[word] === "string" }).toEqual({
        word,
        isKey: true,
      });
    }
  });

  // Every language the Dashboard offers, not only the four drawn below.
  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each of them, or keeps the English on purpose",
    (language: string) => {
      for (const word of words) {
        expect({
          word,
          isWorded: isWordedInDashboardLocale(word, language),
        }).toEqual({ word, isWorded: true });
      }
    },
  );

  test.each(TRANSLATED)(
    "%s, drawn below, words the sentences in its own words",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const word of words.filter((candidate: string): boolean => {
        return candidate.split(" ").length > 2;
      })) {
        expect({ word, isOwn: locale[word] !== english[word] }).toEqual({
          word,
          isOwn: true,
        });
      }
    },
  );
});

describe("the header and the empty state", () => {
  test.each(LANGUAGES)(
    "%s: audit logging off says so, links to turn it on, and the empty state says what to do",
    async (language: string) => {
      getItemMock.mockResolvedValue(projectWith(false));

      await drawTable(language);

      const notice: HTMLElement = screen.getByTestId(
        "audit-logging-disabled-notice",
      );

      expect(notice).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.loggingOff),
      );
      expect(within(notice).getByRole("link")).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.turnOn),
      );
      expect(notice).toHaveAttribute(
        "title",
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.loggingOffHint),
      );

      const emptyState: HTMLElement = screen.getByTestId(
        "audit-logging-disabled-empty-state",
      );

      expect(emptyState).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.turnedOffTitle),
      );
      expect(emptyState).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.turnedOffDescription),
      );
      expect(within(emptyState).getByRole("link")).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.openSettings),
      );

      if (language !== "en") {
        expect(screen.queryByText(/Audit logging/)).not.toBeInTheDocument();
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a table with nothing recorded yet says so in its words",
    async (language: string) => {
      await drawTable(language);

      expect(
        screen.getByText(
          wordIn(language, AUDIT_LOGS_TABLE_WORDS.noEntriesTitle),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          wordIn(language, AUDIT_LOGS_TABLE_WORDS.noEntriesDescription),
        ),
      ).toBeInTheDocument();
    },
  );

  test.each(LANGUAGES)(
    "%s: a lapsed license says the table is not recording, and why, in its words",
    async (language: string) => {
      answerLicense({ status: "expired", licenseValid: false });

      await drawTable(language);

      const notice: HTMLElement = await screen.findByTestId(
        "audit-logging-license-notice",
      );

      expect(notice).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.notRecordingLicenseRequired),
      );
      expect(notice).toHaveAttribute(
        "title",
        wordIn(language, AUDIT_LOGS_LAPSED_DESCRIPTION),
      );

      const emptyState: HTMLElement = screen.getByTestId(
        "audit-logging-license-empty-state",
      );

      expect(emptyState).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_LAPSED_TITLE),
      );
      expect(emptyState).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_LAPSED_DESCRIPTION),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: a license that leaves audit logs out says so, in its words",
    async (language: string) => {
      answerLicense({
        status: "valid",
        licenseValid: true,
        features: ["scim"],
      });

      await drawTable(language);

      const notice: HTMLElement = await screen.findByTestId(
        "audit-logging-license-notice",
      );

      expect(notice).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.notRecordingNotIncluded),
      );

      const emptyState: HTMLElement = screen.getByTestId(
        "audit-logging-license-empty-state",
      );

      expect(emptyState).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_NOT_INCLUDED_TITLE),
      );
      expect(emptyState).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION),
      );
    },
  );
});

describe("the Resource column", () => {
  test.each(LANGUAGES)(
    "%s: an entry about something without a name says Unnamed in its words",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Resource",
        entry: entryOf({ resourceType: "Unknown Thing" }),
      });

      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.unnamed),
      );
    },
  );
});

describe("the Actor column", () => {
  test.each(LANGUAGES)(
    "%s: an API key without a name, and what it did, in its words",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({ userType: UserType.API }),
      });

      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.apiKey),
      );
      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.apiRequest),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: a named API key is drawn as it was named",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({ userType: UserType.API, apiKeyName: "Deploy bot" }),
      });

      expect(cell).toHaveTextContent("Deploy bot");
      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.apiRequest),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: a workflow's step, named or not",
    async (language: string) => {
      const unnamed: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({ userType: UserType.Workflow }),
      });

      expect(
        within(unnamed).getAllByText(
          wordIn(language, AUDIT_LOGS_TABLE_WORDS.workflow),
        ),
      ).toHaveLength(2);

      cleanup();

      const named: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({
          userType: UserType.Workflow,
          workflowName: "Page the on-call",
        }),
      });

      expect(named).toHaveTextContent("Page the on-call");
      expect(named).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.workflow),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: OneUptime itself: System, an automated change",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({ userType: "System" }),
      });

      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.system),
      );
      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.automatedChange),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: a person with a name but no address: their name, and what they acted as, in its words",
    async (language: string) => {
      const user: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({ userType: UserType.User, userName: "Grace Hopper" }),
      });

      expect(user).toHaveTextContent("Grace Hopper");
      expect(user).toHaveTextContent(wordIn(language, "User"));

      cleanup();

      const masterAdmin: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({
          userType: UserType.MasterAdmin,
          userEmail: "admin@acme.test",
        }),
      });

      expect(masterAdmin).toHaveTextContent("admin@acme.test");
      expect(masterAdmin).toHaveTextContent(wordIn(language, "Master Admin"));
      // Never the stored value.
      expect(masterAdmin).not.toHaveTextContent("MasterAdmin");
    },
  );

  test.each(LANGUAGES)(
    "%s: a person's change through an MCP client says so in its words, the client as named",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({
          userType: UserType.User,
          userName: "Grace Hopper",
          userEmail: "grace@acme.test",
          mcpClientName: "Claude Code",
        }),
      });

      const credential: HTMLElement = within(cell).getByTestId(
        "audit-actor-credential",
      );

      expect(credential).toHaveTextContent(
        dashboardTranslator(language).translateTemplate(
          "via {{name}} (MCP client)",
          { name: "Claude Code" },
        ),
      );
      expect(credential).toHaveTextContent("Claude Code");

      if (language !== "en") {
        expect(credential).not.toHaveTextContent("MCP client");
      }
    },
  );

  test("German reads the MCP line in German, and a master key's line in German", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getActorCredentialLabel(
        { userType: UserType.User, mcpClientName: "Claude Code" },
        german,
      ),
    ).toBe("über Claude Code (MCP-Client)");
    expect(
      getActorCredentialLabel(
        { userType: UserType.MasterAdmin, apiKeyName: "Master API Key" },
        german,
      ),
    ).toBe("über Master API Key");
    // Without a translator, English, as before.
    expect(
      getActorCredentialLabel({
        userType: UserType.User,
        mcpClientName: "Claude Code",
      }),
    ).toBe("via Claude Code (MCP client)");
  });

  test.each(LANGUAGES)(
    "%s: a person known by neither name nor address is an unknown user, in its words",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Actor",
        entry: entryOf({ userType: UserType.User, apiKeyName: "Old key" }),
      });

      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.unknownUser),
      );
    },
  );

  test("the words an actor type is drawn by: the person's, the master admin's, OneUptime's, and any other as stored", () => {
    expect(getActorTypeLabel(UserType.User)).toBe("User");
    expect(getActorTypeLabel(UserType.MasterAdmin)).toBe("Master Admin");
    expect(getActorTypeLabel("System")).toBe("System");
    expect(getActorTypeLabel(undefined)).toBe("User");
    expect(getActorTypeLabel("")).toBe("User");
    expect(getActorTypeLabel("SomethingNew")).toBe("SomethingNew");
  });
});

describe("the Changes column", () => {
  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, number]> => {
      return [
        [language, 1],
        [language, 3],
        [language, 12],
      ];
    }),
  )(
    "%s: an update that changed %d fields says how many, in its plural forms and digits",
    async (language: string, count: number) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Changes",
        entry: entryOf({ action: "Update", changes: changesOf(count) }),
      });

      expect(cell).toHaveTextContent(
        dashboardTranslator(language).translatePlural(
          AUDIT_LOG_FIELDS_CHANGED,
          count,
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: a created record says how many fields it kept",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Changes",
        entry: entryOf({ action: "Create", changes: changesOf(4) }),
      });

      expect(cell).toHaveTextContent(
        dashboardTranslator(language).translatePlural(
          AUDIT_LOG_FIELDS_CAPTURED,
          4,
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: an entry with no fields says so",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Changes",
        entry: entryOf({ action: "Update", changes: [] }),
      });

      expect(cell).toHaveTextContent(
        wordIn(language, AUDIT_LOGS_TABLE_WORDS.noFieldsRecorded),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: a session entry's button says, on hover, that it opens the session's details",
    async (language: string) => {
      const cell: HTMLElement = await drawCell({
        language,
        column: "Changes",
        entry: entryOf({
          action: "SignIn",
          resourceType: "User Session",
          changes: [
            { field: AuditLogSessionField.SignInMethod, newValue: "Password" },
          ],
        }),
      });

      const button: HTMLElement = within(cell).getByTestId(
        "audit-log-session-summary",
      );

      expect(button).toHaveAttribute(
        "title",
        dashboardTranslator(language).translateTemplate(
          AUDIT_LOGS_TABLE_WORDS.viewSessionDetails,
          { summary: "Password" },
        ),
      );

      if (language !== "en") {
        expect(button.getAttribute("title")).not.toContain(
          "view session details",
        );
      }
    },
  );

  test("the counts, word for word: English as it always read, German, Arabic and Persian", () => {
    const counts: Array<[string, string, number, string]> = [
      ["en", "Update", 1, "1 field changed"],
      ["en", "Update", 3, "3 fields changed"],
      ["en", "Create", 1, "1 field captured"],
      ["en", "Delete", 5, "5 fields captured"],
      ["de", "Update", 1, "1 Feld geändert"],
      ["de", "Update", 3, "3 Felder geändert"],
      ["de", "Create", 5, "5 Felder erfasst"],
      ["ar", "Update", 3, "الحقول المتغيّرة: 3"],
      ["ar", "Update", 1, "تغيّر 1 حقل"],
      ["ar", "Create", 11, "الحقول المحفوظة: 11"],
      ["fa", "Update", 3, "۳ فیلد تغییر کرد"],
      ["fa", "Create", 12, "۱۲ فیلد ثبت شد"],
    ];

    for (const [language, action, count, text] of counts) {
      expect({
        language,
        action,
        count,
        label: getAuditLogFieldCountLabel({
          action,
          count,
          translator: dashboardTranslator(language),
        }),
      }).toEqual({ language, action, count, label: text });
    }
  });
});
