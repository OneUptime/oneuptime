import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The audit-log area of the Enterprise Dashboard plugin: that it hands the
 * core shells the real screens, lazily, and that those screens keep the
 * behaviour the pages had before the Community / Enterprise split.
 *
 *   - AuditLogsTable / SettingsAuditLogsSettings are React.lazy components
 *     that resolve to ee/Dashboard/AuditLogs/{AuditLogsTable,AuditLogsSettings};
 *   - the assembled plugin (ee/Dashboard/Index.tsx) carries both keys;
 *   - the Settings form still edits the same three Project columns, with the
 *     same 7-180 day retention bounds - the recorder's own rule
 *     (Common/Types/AuditLog/AuditLogRetention) - and the card shows, and the
 *     form opens on, the retention the project keeps (#6383);
 *   - the bodies never import a core shell that reads the plugins (that
 *     import cycle crashes the Enterprise bundle), and the table takes its
 *     resource metadata from core's AuditLogsTableUtils, not a private copy.
 *
 * The tables and the settings card are mocked to capture their props.
 */

type CapturedCardModelDetailProps = {
  name?: string;
  cardProps?: { title?: string; description?: string };
  isEditable?: boolean;
  formFields?: Array<{
    field?: Record<string, boolean>;
    title?: string;
    description?: string;
    required?: boolean;
    validation?: { minValue?: number; maxValue?: number };
  }>;
  onEditFormItemFetched?: (item: Project) => Promise<Project>;
  modelDetailProps?: {
    modelType?: unknown;
    modelId?: unknown;
    fields?: Array<{
      field?: Record<string, boolean>;
      getElement?: (item: Project) => React.ReactElement;
    }>;
  };
};

let capturedCardProps: CapturedCardModelDetailProps | null = null;
let capturedTableProps: Record<string, unknown> | null = null;

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedCardModelDetailProps): React.ReactElement => {
      capturedCardProps = props;
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement(
        "div",
        { "data-testid": "audit-logs-settings-card" },
        props.cardProps?.title || "",
      );
    },
  };
});

jest.mock("Common/UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
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
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

import AuditLogsPlugins from "../../../Dashboard/AuditLogs/Plugins";
import EnterpriseDashboardPlugins from "../../../Dashboard/Index";
import AuditLogsSettings from "../../../Dashboard/AuditLogs/AuditLogsSettings";
import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import {
  AUDIT_LOG_MAX_RETENTION_IN_DAYS,
  AUDIT_LOG_MIN_RETENTION_IN_DAYS,
} from "Common/Types/AuditLog/AuditLogRetention";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/audit-logs"),
  currentProject: null,
  hasPaymentMethod: true,
};

const EE_DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Dashboard",
);

type ReadSourceFunction = (...segments: Array<string>) => string;

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
// A relative path into packages/: ee must use the mapped specifiers instead.
const INTO_PACKAGES: RegExp = /(^|\/)packages\//;

// Source with comments stripped, so prose about an import never counts as one.
const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(EE_DASHBOARD_DIR, ...segments), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
};

// Every module specifier a source file imports (static or dynamic).
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

const importsOf: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const specifiers: Array<string> = [];
  const pattern: RegExp = new RegExp(IMPORT_SPECIFIER.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
};

beforeEach(() => {
  capturedCardProps = null;
  capturedTableProps = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the audit-log plugin keys", () => {
  test("the assembled Enterprise plugin carries both audit-log screens", () => {
    const plugins: DashboardEnterprisePlugins = EnterpriseDashboardPlugins;

    expect(plugins.AuditLogsTable).toBe(AuditLogsPlugins.AuditLogsTable);
    expect(plugins.SettingsAuditLogsSettings).toBe(
      AuditLogsPlugins.SettingsAuditLogsSettings,
    );
  });

  test("both are lazy, so the audit-log code downloads only where it is shown", () => {
    const lazyType: symbol = Symbol.for("react.lazy");

    for (const plugin of [
      AuditLogsPlugins.AuditLogsTable,
      AuditLogsPlugins.SettingsAuditLogsSettings,
    ]) {
      expect(plugin).toBeDefined();
      expect((plugin as unknown as { $$typeof: symbol }).$$typeof).toBe(
        lazyType,
      );
    }
  });

  test("the table plugin resolves to the Enterprise table body and passes the shell's props through", async () => {
    const TablePlugin: NonNullable<
      DashboardEnterprisePlugins["AuditLogsTable"]
    > = AuditLogsPlugins.AuditLogsTable!;

    render(
      <MemoryRouter>
        <React.Suspense fallback={<div data-testid="loading" />}>
          <TablePlugin
            title="Project Audit Logs"
            description="Every change in this project."
          />
        </React.Suspense>
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("audit-logs-analytics-table"),
    ).toBeInTheDocument();
    expect(
      (capturedTableProps?.["cardProps"] as Record<string, unknown>)["title"],
    ).toBe("Project Audit Logs");
    expect(capturedTableProps?.["query"]).toEqual({ projectId: PROJECT_ID });
  });

  test("the settings plugin resolves to the Enterprise settings page", async () => {
    const SettingsPlugin: NonNullable<
      DashboardEnterprisePlugins["SettingsAuditLogsSettings"]
    > = AuditLogsPlugins.SettingsAuditLogsSettings!;

    render(
      <React.Suspense fallback={<div data-testid="loading" />}>
        <SettingsPlugin {...PAGE_PROPS} />
      </React.Suspense>,
    );

    expect(
      await screen.findByTestId("audit-logs-settings-card"),
    ).toHaveTextContent("Audit Logs");
  });
});

describe("Settings > Audit Logs (the Enterprise page)", () => {
  test("edits the project's three audit-log columns, with the 7-180 day retention bounds", () => {
    render(<AuditLogsSettings {...PAGE_PROPS} />);

    expect(capturedCardProps?.name).toBe("Audit Logs");
    expect(capturedCardProps?.isEditable).toBe(true);

    const formFields: Array<string> = (capturedCardProps?.formFields || []).map(
      (field: { field?: Record<string, boolean> }): string => {
        return Object.keys(field.field || {})[0] as string;
      },
    );

    expect(formFields).toEqual([
      "enableAuditLogs",
      "auditLogsRetentionInDays",
      "storeSystemEventsInAuditLogs",
    ]);

    const retention:
      | {
          required?: boolean;
          description?: string;
          validation?: { minValue?: number; maxValue?: number };
        }
      | undefined = (capturedCardProps?.formFields || [])[1];

    expect(retention?.required).toBe(true);
    expect(retention?.validation).toEqual({ minValue: 7, maxValue: 180 });
    // The server's range: one rule, which the form's own words state too.
    expect(retention?.validation).toEqual({
      minValue: AUDIT_LOG_MIN_RETENTION_IN_DAYS,
      maxValue: AUDIT_LOG_MAX_RETENTION_IN_DAYS,
    });
    expect(retention?.description).toBe(
      `Number of days to retain audit log entries. Minimum ${AUDIT_LOG_MIN_RETENTION_IN_DAYS}, maximum ${AUDIT_LOG_MAX_RETENTION_IN_DAYS}.`,
    );
  });

  /*
   * A project that stores a retention from before the server checked it
   * (-3, 500, written through the API) keeps its entries for the nearest
   * retention from 7 to 180 days. The card says so, and the form opens on
   * it, so saving it stores what the project already keeps.
   */
  test.each([
    [30, "30"],
    [7, "7"],
    [180, "180"],
    [-3, "7"],
    [0, "7"],
    [3, "7"],
    [500, "180"],
  ])(
    "a stored retention of %p shows, and opens the form, as the %s days entries are kept",
    async (stored: number, shown: string) => {
      render(<AuditLogsSettings {...PAGE_PROPS} />);

      const project: Project = new Project();
      project.auditLogsRetentionInDays = stored;

      const retentionField:
        | { getElement?: (item: Project) => React.ReactElement }
        | undefined = (capturedCardProps?.modelDetailProps?.fields || [])[1];

      cleanup();
      render(retentionField!.getElement!(project));
      expect(screen.getByText(shown)).toBeInTheDocument();

      const opened: Project =
        await capturedCardProps!.onEditFormItemFetched!(project);

      expect(opened.auditLogsRetentionInDays).toBe(Number(shown));
    },
  );

  test("reads and writes the current project", () => {
    render(<AuditLogsSettings {...PAGE_PROPS} />);

    expect(capturedCardProps?.modelDetailProps?.modelType).toBe(Project);
    expect(capturedCardProps?.modelDetailProps?.modelId).toBe(PROJECT_ID);
    expect(
      (capturedCardProps?.modelDetailProps?.fields || []).map(
        (field: { field?: Record<string, boolean> }): string => {
          return Object.keys(field.field || {})[0] as string;
        },
      ),
    ).toEqual([
      "enableAuditLogs",
      "auditLogsRetentionInDays",
      "storeSystemEventsInAuditLogs",
    ]);
  });

  test("shows the form itself: the upsell decision is the core shell's", () => {
    render(<AuditLogsSettings {...PAGE_PROPS} />);

    expect(screen.getByTestId("audit-logs-settings-card")).toBeInTheDocument();
  });
});

describe("the audit-log screens' imports", () => {
  test.each([
    ["AuditLogs", "AuditLogsTable.tsx"],
    ["AuditLogs", "AuditLogsSettings.tsx"],
    ["AuditLogs", "AuditLogChangesModal.tsx"],
    ["AuditLogs", "Plugins.ts"],
  ])(
    "%s/%s never imports a core shell that reads the plugins",
    (directory: string, file: string) => {
      const specifiers: Array<string> = importsOf(readSource(directory, file));

      for (const specifier of specifiers) {
        expect(specifier).not.toBe(
          "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTable",
        );
        expect(specifier).not.toBe(
          "@oneuptime/dashboard/Pages/Settings/AuditLogsSettings",
        );
        expect(specifier).not.toBe("@oneuptime/dashboard/Enterprise/Plugins");
        expect(specifier).not.toBe("@oneuptime/ee-dashboard");
        // ee reaches core only through the mapped specifiers.
        expect(specifier).not.toMatch(INTO_PACKAGES);
      }
    },
  );

  test("the table takes its resource metadata from core's helper module, not a private copy", () => {
    const table: string = readSource("AuditLogs", "AuditLogsTable.tsx");

    expect(importsOf(table)).toContain(
      "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils",
    );
    expect(table).not.toContain("const RESOURCE_META");
  });
});
