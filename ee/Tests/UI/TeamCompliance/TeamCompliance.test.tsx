import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";

/*
 * The team-compliance area of the Enterprise Dashboard plugin: the Compliance
 * page and the member status table, which moved to ee/ in the Community /
 * Enterprise split (core keeps shells at the old paths - see
 * packages/Common/Tests/App/Dashboard/AuditLogsAndComplianceShells.test.tsx).
 *
 * The status table's rendering tests moved here from
 * packages/Common/Tests/App/Dashboard/UserEmailCallSites.test.tsx with the
 * table: UserElement can only show an email and an avatar it was given, and
 * the compliance table hand-builds its user object from the payload, so the id
 * and the email must both make it through.
 */

/*
 * UserElement imports "Common/UI/Images/users/blank-profile.svg". ee's ui jest
 * project maps "Common/..." before Common's asset mapper, so the SVG would be
 * parsed as JavaScript; stub it the way Common's own suites do.
 */
jest.mock("Common/UI/Images/users/blank-profile.svg", () => {
  return "data:image/svg+xml;base64,////YXZhdGFy";
});

jest.mock("Common/UI/Utils/Permission", () => {
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

type CapturedModelTableProps = {
  query?: Record<string, unknown>;
  onCreateSuccess?: (item: unknown) => Promise<unknown>;
  onItemDeleted?: (item: unknown) => void;
  onBeforeCreate?: (item: Record<string, unknown>) => Promise<unknown>;
  formFields?: Array<{ field?: Record<string, boolean> }>;
};

let capturedModelTableProps: CapturedModelTableProps | null = null;

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedModelTableProps): null => {
      capturedModelTableProps = props;
      return null;
    },
  };
});

import TeamComplianceStatusTable, {
  TeamComplianceStatusTableRef,
} from "../../../Dashboard/TeamCompliance/TeamComplianceStatusTable";
import TeamViewCompliance from "../../../Dashboard/TeamCompliance/Compliance";
import TeamCompliancePlugins from "../../../Dashboard/TeamCompliance/Plugins";
import EnterpriseDashboardPlugins from "../../../Dashboard/Index";
import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-000000000002");
const USER_ID: string = "00000000-0000-4000-8000-000000000003";

type ComplianceResponse = {
  teamId: string;
  teamName: string;
  complianceSettings: Array<{ ruleType: string; enabled: boolean }>;
  userComplianceStatuses: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    isCompliant: boolean;
    nonCompliantRules: Array<{ ruleType: string; reason: string }>;
  }>;
};

const complianceResponse: () => ComplianceResponse =
  (): ComplianceResponse => {
    return {
      teamId: TEAM_ID.toString(),
      teamName: "On-Call",
      complianceSettings: [
        { ruleType: "HasNotificationEmailMethod", enabled: true },
      ],
      userComplianceStatuses: [
        {
          userId: USER_ID,
          userName: "Jane Doe",
          userEmail: "jane@acme.com",
          isCompliant: false,
          nonCompliantRules: [
            {
              ruleType: "HasNotificationEmailMethod",
              reason: "No email notification method",
            },
          ],
        },
      ],
    };
  };

const EE_DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Dashboard",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

const importsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const source: string = fs
    .readFileSync(path.join(EE_DASHBOARD_DIR, "TeamCompliance", file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
  const specifiers: Array<string> = [];
  const pattern: RegExp = new RegExp(IMPORT_SPECIFIER.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
};

let apiGet: jest.SpyInstance;

beforeEach(() => {
  capturedModelTableProps = null;
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  apiGet = jest
    .spyOn(API, "get")
    .mockResolvedValue({ data: complianceResponse() } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the member compliance status table", () => {
  const renderTable: (
    ref?: React.Ref<TeamComplianceStatusTableRef>,
  ) => Promise<void> = async (
    ref?: React.Ref<TeamComplianceStatusTableRef>,
  ): Promise<void> => {
    render(
      ref ? (
        <TeamComplianceStatusTable ref={ref} teamId={TEAM_ID} />
      ) : (
        <TeamComplianceStatusTable teamId={TEAM_ID} />
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });
  };

  test("asks the Enterprise compliance route about exactly this team", async () => {
    await renderTable();

    expect(apiGet).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string } } = apiGet.mock
      .calls[0]![0] as { url: { toString: () => string } };

    expect(request.url.toString()).toContain(
      `/team/compliance-status/${TEAM_ID.toString()}`,
    );
  });

  test("shows the member's email beside their name", async () => {
    await renderTable();

    expect(screen.getByTestId("user-email")).toHaveTextContent(
      "jane@acme.com",
    );
  });

  /*
   * The row is hand-built from the compliance payload. Without the id the
   * avatar route cannot be built and every member falls back to the blank
   * picture, which reads as "nobody has a photo" rather than as a bug.
   */
  test("builds the avatar from the member's own id", async () => {
    await renderTable();

    expect(screen.getAllByRole("img")[0]).toHaveAttribute(
      "src",
      `/api/user/profile-picture/${USER_ID}`,
    );
  });

  test("still shows why the member is non-compliant", async () => {
    await renderTable();

    expect(screen.getByText("Non-Compliant")).toBeInTheDocument();
    expect(
      screen.getByText(/No email notification method/),
    ).toBeInTheDocument();
  });

  test("refresh() through the ref reads the status again", async () => {
    const tableRef: React.RefObject<TeamComplianceStatusTableRef> =
      React.createRef<TeamComplianceStatusTableRef>();

    await renderTable(tableRef);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      tableRef.current?.refresh();
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  test("shows nothing at all while the team has no compliance rules", async () => {
    apiGet.mockResolvedValue({
      data: { ...complianceResponse(), complianceSettings: [] },
    } as never);

    const { container } = render(
      <TeamComplianceStatusTable teamId={TEAM_ID} />,
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("the Compliance page", () => {
  const PAGE_PROPS: PageComponentProps = {
    pageRoute: new Route("/dashboard/project-id/settings/teams/x/compliance"),
    currentProject: Object.assign(new Project(), {
      _id: PROJECT_ID.toString(),
    }),
    hasPaymentMethod: true,
  };

  beforeEach(() => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(TEAM_ID);
  });

  test("lists this team's rules, in this project, and shows the member table", async () => {
    render(<TeamViewCompliance {...PAGE_PROPS} />);

    expect(capturedModelTableProps?.query).toEqual({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    });
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
  });

  test("a new rule is created for this team and project", async () => {
    render(<TeamViewCompliance {...PAGE_PROPS} />);

    const item: Record<string, unknown> = {};
    await capturedModelTableProps?.onBeforeCreate?.(item);

    expect((item["teamId"] as ObjectID).toString()).toBe(TEAM_ID.toString());
    expect((item["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    await screen.findByText("Jane Doe");
  });

  test("creating or deleting a rule refreshes the member table", async () => {
    render(<TeamViewCompliance {...PAGE_PROPS} />);
    await screen.findByText("Jane Doe");
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await capturedModelTableProps?.onCreateSuccess?.({});
    });
    expect(apiGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      capturedModelTableProps?.onItemDeleted?.({});
    });
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  test("offers the same six rule types", () => {
    render(<TeamViewCompliance {...PAGE_PROPS} />);

    const ruleTypeField: { dropdownOptions?: Array<{ value: string }> } =
      (capturedModelTableProps?.formFields || [])[0] as {
        dropdownOptions?: Array<{ value: string }>;
      };

    expect(
      (ruleTypeField.dropdownOptions || []).map(
        (option: { value: string }): string => {
          return option.value;
        },
      ),
    ).toEqual([
      "HasNotificationEmailMethod",
      "HasNotificationSMSMethod",
      "HasNotificationCallMethod",
      "HasNotificationPushMethod",
      "HasIncidentOnCallRules",
      "HasAlertOnCallRules",
    ]);
  });
});

describe("the team-compliance plugin keys", () => {
  test("the assembled Enterprise plugin carries both team-compliance screens", () => {
    const plugins: DashboardEnterprisePlugins = EnterpriseDashboardPlugins;

    expect(plugins.TeamCompliance).toBe(TeamCompliancePlugins.TeamCompliance);
    expect(plugins.TeamComplianceStatusTable).toBe(
      TeamCompliancePlugins.TeamComplianceStatusTable,
    );
  });

  test("both are lazy", () => {
    const lazyType: symbol = Symbol.for("react.lazy");

    for (const plugin of [
      TeamCompliancePlugins.TeamCompliance,
      TeamCompliancePlugins.TeamComplianceStatusTable,
    ]) {
      expect((plugin as unknown as { $$typeof: symbol }).$$typeof).toBe(
        lazyType,
      );
    }
  });

  test("the lazy status table still hands its caller the refresh handle", async () => {
    const StatusTablePlugin: NonNullable<
      DashboardEnterprisePlugins["TeamComplianceStatusTable"]
    > = TeamCompliancePlugins.TeamComplianceStatusTable!;

    const tableRef: React.RefObject<TeamComplianceStatusTableRef> =
      React.createRef<TeamComplianceStatusTableRef>();

    render(
      <React.Suspense fallback={<div data-testid="loading" />}>
        <StatusTablePlugin ref={tableRef} teamId={TEAM_ID} />
      </React.Suspense>,
    );

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();

    await act(async () => {
      tableRef.current?.refresh();
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  test("the lazy Compliance page resolves to the Enterprise page", async () => {
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(TEAM_ID);

    const CompliancePlugin: NonNullable<
      DashboardEnterprisePlugins["TeamCompliance"]
    > = TeamCompliancePlugins.TeamCompliance!;

    const page: ReactElement = (
      <React.Suspense fallback={<div data-testid="loading" />}>
        <CompliancePlugin
          pageRoute={new Route("/dashboard/p/settings/teams/t/compliance")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </React.Suspense>
    );

    render(page);

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(capturedModelTableProps?.query).toEqual({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    });
  });
});

describe("the team-compliance screens' imports", () => {
  test("the page takes the status table from ee/, never from core's shell", () => {
    const specifiers: Array<string> = importsOf("Compliance.tsx");

    expect(specifiers).toContain("./TeamComplianceStatusTable");
    expect(specifiers).not.toContain(
      "@oneuptime/dashboard/Components/Team/TeamComplianceStatusTable",
    );
  });

  test.each(["Compliance.tsx", "TeamComplianceStatusTable.tsx", "Plugins.ts"])(
    "%s never reads the plugins",
    (file: string) => {
      const specifiers: Array<string> = importsOf(file);

      expect(specifiers).not.toContain(
        "@oneuptime/dashboard/Enterprise/Plugins",
      );
      expect(specifiers).not.toContain("@oneuptime/ee-dashboard");
      expect(specifiers).not.toContain(
        "@oneuptime/dashboard/Pages/Teams/View/Compliance",
      );
    },
  );
});
