import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import ArchivableValueAPI from "../../../Server/API/ArchivableValueAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import OnCallDutyPolicyAPI from "../../../Server/API/OnCallDutyPolicyAPI";
import DashboardService, {
  Service as DashboardServiceType,
} from "../../../Server/Services/DashboardService";
import IncidentTemplateService, {
  Service as IncidentTemplateServiceType,
} from "../../../Server/Services/IncidentTemplateService";
import LabelService, {
  Service as LabelServiceType,
} from "../../../Server/Services/LabelService";
import TeamService, {
  Service as TeamServiceType,
} from "../../../Server/Services/TeamService";
import WorkflowService, {
  Service as WorkflowServiceType,
} from "../../../Server/Services/WorkflowService";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ComponentInputType } from "../../../Types/Workflow/Component";
import {
  withSearch,
  withSearchIn,
} from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import { DropdownOptionGroup } from "../../../UI/Components/Dropdown/Dropdown";
import {
  getRecordChoiceDropdownModal,
  RecordChoiceDropdownModal,
} from "../../../UI/Components/Workflow/RecordChoices";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import OnCallSetupApi, {
  PolicyChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi";
import SetupHealthQuickFixApi, {
  SetupHealthPolicyChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthQuickFix";
import { readTeamOrLabelOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryIngestionBudget/TeamOrLabelPicker";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE LOWER-LIKELIHOOD PICKERS OF #10764, SEARCHED AND READ THROUGH THE REAL
 * SERVER.
 *
 * Each read a first page - the project's first 10,000 by name - and filtered
 * it in the browser: a record past it could not be picked, and one a form
 * held showed blank. Each searches the server now, as the person types:
 *
 *   - the On-Call guided setup's and Setup Health's on-call policy
 *     (OnCallSetupApi.searchPolicyChoices, SetupHealthQuickFixApi
 *     .searchPolicies), archived policies never offered;
 *   - a team or label budget's team or label (readTeamOrLabelOptions),
 *     archived labels never offered;
 *   - Execute Workflow's Workflow and Create One Incident's Incident Template
 *     (getRecordChoiceDropdownModal, drawn by EntityDropdown), the workflow
 *     being edited never offered, a held one read by its id;
 *   - Metrics Explorer's Add to Dashboard (ModelList's server search), by a
 *     dashboard's name or description.
 *
 * The list routes the app registers, as a member, on migrated Postgres
 * (PostgresListRouteHarness), with more of each than a picker ever read.
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source is the harness's; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

const ENGLISH: Translator = {
  translateText: (text: string | undefined): string | undefined => {
    return text;
  },
  translateTemplate: (text: string): string => {
    return text;
  },
} as unknown as Translator;

describePostgres(
  "the lower-likelihood pickers of #10764, searched and read through the real server",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "lower_pickers",
      tables: ["OnCallDutyPolicy", "Workflow", "IncidentTemplate", "Dashboard"],
    });

    // The list routes, as the app registers them.
    new OnCallDutyPolicyAPI();
    new BaseAPI<Workflow, WorkflowServiceType>(Workflow, WorkflowService);
    new BaseAPI<IncidentTemplate, IncidentTemplateServiceType>(
      IncidentTemplate,
      IncidentTemplateService,
    );
    new BaseAPI<Dashboard, DashboardServiceType>(Dashboard, DashboardService);
    new BaseAPI<Team, TeamServiceType>(Team, TeamService);
    new ArchivableValueAPI<Label, LabelServiceType>(Label, LabelService);

    const projectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const memberTeamId: ObjectID = ObjectID.generate();

    const latePolicyId: ObjectID = ObjectID.generate();
    const archivedPolicyId: ObjectID = ObjectID.generate();
    const currentWorkflowId: ObjectID = ObjectID.generate();
    const lateWorkflowId: ObjectID = ObjectID.generate();
    const lateTemplateId: ObjectID = ObjectID.generate();
    const lateDashboardId: ObjectID = ObjectID.generate();
    const lateTeamId: ObjectID = ObjectID.generate();
    const lateLabelId: ObjectID = ObjectID.generate();
    const archivedLabelId: ObjectID = ObjectID.generate();

    const list: (request: {
      path: string;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort?: Record<string, unknown> | undefined;
      limit: number;
    }) => Promise<ListedPage> = async (request: {
      path: string;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort?: Record<string, unknown> | undefined;
      limit: number;
    }): Promise<ListedPage> => {
      return await harness.list({
        ...request,
        userId: memberId,
        projectId: projectId,
      });
    };

    // A search typed into a workflow setting, as EntityDropdown sends it.
    const searchRecordChoice: (
      modal: RecordChoiceDropdownModal,
      text: string,
    ) => Promise<ListedPage> = async (
      modal: RecordChoiceDropdownModal,
      text: string,
    ): Promise<ListedPage> => {
      return await list({
        path: new modal.type().crudApiPath!.toString(),
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(modal.type, modal.query),
          modal.labelField,
          text,
        ),
        select: { _id: true, [modal.labelField]: true },
        sort: { [modal.labelField]: SortOrder.Ascending },
        limit: PICKER_PAGE_SIZE,
      });
    };

    /*
     * More rows than a picker ever read, named "AP000001" ... - all before
     * "WB" by name: each table's columns that take no default, and theirs.
     */
    const ROWS_BEFORE_WB: Array<[string, string, string]> = [
      [
        "OnCallDutyPolicy",
        `"name", "slug"`,
        `'AP' || lpad(i::text, 6, '0'), 'p-' || gen_random_uuid()`,
      ],
      [
        "Workflow",
        `"name", "slug"`,
        `'AP' || lpad(i::text, 6, '0'), 'w-' || gen_random_uuid()`,
      ],
      [
        "Dashboard",
        `"name", "slug", "dashboardViewConfig"`,
        `'AP' || lpad(i::text, 6, '0'), 'd-' || gen_random_uuid(), '{}'::jsonb`,
      ],
      [
        "IncidentTemplate",
        `"templateName", "title", "templateDescription", "slug"`,
        `'AP' || lpad(i::text, 6, '0'), 'Title', 'About', 't-' || gen_random_uuid()`,
      ],
      [
        "Team",
        `"name", "slug"`,
        `'AP' || lpad(i::text, 6, '0'), 'team-' || gen_random_uuid()`,
      ],
      [
        "Label",
        `"name", "slug", "color", "isArchived"`,
        `'AP' || lpad(i::text, 6, '0'), 'l-' || gen_random_uuid(), '#6366f1', false`,
      ],
    ];

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");
      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: memberTeamId,
        permission: Permission.ProjectMember,
      });

      for (const [table, columns, values] of ROWS_BEFORE_WB) {
        await harness.query(
          `INSERT INTO "${harness.schema}"."${table}" ("_id", "version", "projectId", ${columns})
           SELECT gen_random_uuid(), 1, $1, ${values}
           FROM generate_series(1, $2) AS i`,
          [projectId.toString(), BEFORE_WB],
        );
      }

      for (const [id, name, isArchived] of [
        [latePolicyId, "WB Payments Escalation", false],
        [archivedPolicyId, "WB Payments (old)", true],
      ] as Array<[ObjectID, string, boolean]>) {
        await harness.insert("OnCallDutyPolicy", {
          _id: id,
          version: 1,
          projectId: projectId,
          name: name,
          slug: `policy-${id.toString()}`,
          isArchived: isArchived,
        });
      }

      for (const [id, name] of [
        [lateWorkflowId, "WB Restock"],
        // The one being edited, which a search for "WB" would find.
        [currentWorkflowId, "WB Alerts"],
      ] as Array<[ObjectID, string]>) {
        await harness.insert("Workflow", {
          _id: id,
          version: 1,
          projectId: projectId,
          name: name,
          slug: `workflow-${id.toString()}`,
        });
      }

      await harness.insert("IncidentTemplate", {
        _id: lateTemplateId,
        version: 1,
        projectId: projectId,
        templateName: "WB Fire",
        title: "Fire at the warehouse",
        templateDescription: "When the sprinklers go off",
        slug: `template-${lateTemplateId.toString()}`,
      });

      await harness.insert("Dashboard", {
        _id: lateDashboardId,
        version: 1,
        projectId: projectId,
        name: "Warehouse board",
        description: "Stock and pick rates",
        slug: `dashboard-${lateDashboardId.toString()}`,
        dashboardViewConfig: {},
      });

      await harness.insert("Team", {
        _id: lateTeamId,
        version: 1,
        projectId: projectId,
        name: "WB Team",
        slug: `team-${lateTeamId.toString()}`,
      });

      for (const [id, name, isArchived] of [
        [lateLabelId, "WB-label", false],
        [archivedLabelId, "WB-old", true],
      ] as Array<[ObjectID, string, boolean]>) {
        await harness.insert("Label", {
          _id: id,
          version: 1,
          projectId: projectId,
          name: name,
          slug: `label-${id.toString()}`,
          color: "#6366f1",
          isArchived: isArchived,
        });
      }

      for (const [table] of ROWS_BEFORE_WB) {
        await harness.analyze(table);
      }
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    describe("an on-call policy to pick (the guided setup, Setup Health)", () => {
      test("the old read never had the late policy; both searches find it, never the archived one", async () => {
        const old: ListedPage = await list({
          path: "/on-call-duty-policy",
          query: { isArchived: false },
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
        });

        expect(valuesOf(old, "name")).not.toContain("WB Payments Escalation");

        harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

        const setup: Array<PolicyChoice> =
          await OnCallSetupApi.searchPolicyChoices("WB Pay");
        const quickFix: Array<SetupHealthPolicyChoice> =
          await SetupHealthQuickFixApi.searchPolicies("WB Pay");

        for (const found of [setup, quickFix]) {
          expect(
            found.map((entry: { id: string; name: string }) => {
              return [entry.id, entry.name];
            }),
          ).toEqual([[latePolicyId.toString(), "WB Payments Escalation"]]);
        }
      });

      test("each opens on the first 50 in service by name", async () => {
        harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

        const first: Array<SetupHealthPolicyChoice> =
          await SetupHealthQuickFixApi.getPolicies();

        expect(first).toHaveLength(PICKER_PAGE_SIZE);
        expect(first[0]!.name).toBe("AP000001");
      });
    });

    describe("a team or label budget's team or label", () => {
      test("found past the first 10,000 by what is typed - an archived label never", async () => {
        harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

        const groups: Array<DropdownOptionGroup> = await readTeamOrLabelOptions(
          { search: "WB", translator: ENGLISH },
        );

        expect(
          groups.flatMap((group: DropdownOptionGroup): Array<string> => {
            return group.options.map((option: { label: string }): string => {
              return option.label;
            });
          }),
        ).toEqual(["WB Team", "WB-label"]);
      });
    });

    describe("a workflow step's Workflow and Incident Template", () => {
      test("Execute Workflow's search finds the late workflow, never the one being edited, and a read by id names it", async () => {
        const modal: RecordChoiceDropdownModal = getRecordChoiceDropdownModal({
          type: ComponentInputType.WorkflowSelect,
          workflowId: currentWorkflowId,
        })!;

        const old: ListedPage = await list({
          path: "/workflow",
          query: {},
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
        });

        expect(valuesOf(old, "name")).not.toContain("WB Restock");

        expect(valuesOf(await searchRecordChoice(modal, "WB"), "name")).toEqual(
          ["WB Restock"],
        );

        const held: ListedPage = await list({
          path: "/workflow",
          query: { _id: new Includes([lateWorkflowId]) },
          select: { _id: true, name: true },
          limit: 1,
        });

        expect(valuesOf(held, "name")).toEqual(["WB Restock"]);
      });

      test("Create One Incident's search finds the late template by its name", async () => {
        const modal: RecordChoiceDropdownModal = getRecordChoiceDropdownModal({
          type: ComponentInputType.IncidentTemplateSelect,
          workflowId: currentWorkflowId,
        })!;

        expect(
          valuesOf(await searchRecordChoice(modal, "WB F"), "templateName"),
        ).toEqual(["WB Fire"]);
      });
    });

    describe("Metrics Explorer's Add to Dashboard", () => {
      test("a dashboard past the first 10,000 is found by its description, as the list searches it", async () => {
        const search: ListedPage = await list({
          path: "/dashboard",
          query: withSearchIn(
            { projectId: projectId },
            ["name", "description"],
            "pick rates",
          ),
          select: { _id: true, name: true, description: true },
          sort: { name: SortOrder.Ascending },
          limit: PICKER_PAGE_SIZE,
        });

        expect(valuesOf(search, "name")).toEqual(["Warehouse board"]);
      });
    });
  },
);
