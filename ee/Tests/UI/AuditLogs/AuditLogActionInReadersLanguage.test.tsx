import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * An audit log entry's action in the reader's language (issue #7781).
 * ---------------------------------------------------------------------------
 *
 * The Action filter offers every action by its words - "Sign In", never the
 * stored "SignIn" - and those words are keys of the locales, so its menu and
 * its chip read them in the reader's language. The Action column's badge
 * drew the same words in English: a Spanish reader picked "Iniciar sesión"
 * in the filter, and every row it kept said "Sign In". The badge reads the
 * reader's language too, in the words the filter offers.
 *
 * AnalyticsModelTable is mocked to capture its props, as in
 * AuditLogSessionEntries.test.tsx; the Action cell is drawn from the
 * captured column, with the Dashboard's Spanish locale loaded.
 */

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

import AuditLogsTable, {
  AUDIT_LOG_ACTION_FILTER_OPTIONS,
} from "../../../Dashboard/AuditLogs/AuditLogsTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

const SPANISH: Record<string, string> = readDashboardLocale("es");

const PROJECT_ID: ObjectID = new ObjectID(
  "77810000-0000-4000-8000-000000000051",
);

const entryOf: (action: string) => AuditLog = (action: string): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.action = action;
  entry.resourceType = "Monitor";
  entry.resourceName = "Checkout API";
  entry.userName = "Grace Hopper";
  entry.userEmail = "grace@acme.test";
  entry.userType = "User";
  return entry;
};

// The Action column's cell for an entry, as the table drew its column.
const actionCellOf: (action: string) => Promise<HTMLElement> = async (
  action: string,
): Promise<HTMLElement> => {
  render(
    <MemoryRouter>
      <AuditLogsTable
        title="Audit Logs"
        description="Every change made to the resources in this project, and every time its members sign in or out."
      />
    </MemoryRouter>,
  );
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Action";
    },
  );

  expect(column?.getElement).toBeDefined();

  const { container } = render(
    <MemoryRouter>{column!.getElement!(entryOf(action))}</MemoryRouter>,
  );

  return container;
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      es: { translation: SPANISH },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  capturedTableProps = null;
  getItemMock.mockReset();
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  getItemMock.mockResolvedValue(project);
  mockLicenseFetch.mockReset();
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: { status: "valid", licenseValid: true } as JSONObject,
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Action column, read in Spanish", () => {
  test.each(
    AUDIT_LOG_ACTION_FILTER_OPTIONS.map(
      (option: DropdownOption): [string, string] => {
        return [String(option.value), option.label];
      },
    ),
  )(
    "%s reads as the Action filter offers it, in Spanish",
    async (action: string, label: string) => {
      const words: string | undefined = SPANISH[label];

      // A key Spanish words for itself, as the filter's menu reads it.
      expect(words).toBeTruthy();
      expect(words).not.toBe(label);

      const cell: HTMLElement = await actionCellOf(action);

      expect(cell).toHaveTextContent(words!);
      expect(cell).not.toHaveTextContent(label);
    },
  );
});
