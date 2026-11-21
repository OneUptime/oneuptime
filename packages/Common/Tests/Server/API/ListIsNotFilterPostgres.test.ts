import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  IS_POSTGRES_PICKER_SEARCH_RUN,
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { buildMonitorTemplateFacetQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorFacets";
import {
  buildEntityFacetQuery,
  defaultFacetQueryValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "TEMPLATE IS NOT X" KEEPS THE MONITORS WITH NO TEMPLATE (#10581), ASKED
 * OF POSTGRES THROUGH THE MONITOR LIST ROUTE.
 *
 * On the Monitors list, the Template chip set to "is not WB KSK Ping
 * Monitor Template" listed the monitors linked to other templates and left
 * out every monitor linked to none, though those are not linked to it
 * either: the chip wrote IncludesNone (`NOT IN`) and NotEqual (`<>`), which
 * an empty column never passes. It now writes IncludesNoneOrNull and
 * NotEqualOrNull, `(column NOT IN (...) OR column IS NULL)`.
 *
 * Every query here is the one the chip writes (buildMonitorTemplateFacetQuery,
 * the Dashboard's own), merged into the list's own query as the Monitors page
 * merges it, serialized as ModelAPI serializes it, and read through POST
 * /monitor/get-list as a member of the project (PostgresListRouteHarness).
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
 */
const describePostgres: typeof describe.skip = IS_POSTGRES_PICKER_SEARCH_RUN
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

describePostgres(
  "a list's 'is not' filter keeps the records with none, on Postgres (#10581)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "list_is_not",
      tables: ["Monitor", "MonitorLabel"],
    });

    // The monitor list route, as the app registers it.
    new MonitorAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    // A member who may read only the monitors labelled Kiosk.
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    // "WB KSK Ping Monitor Template", and two others.
    const wbTemplateId: ObjectID = ObjectID.generate();
    const apTemplateId: ObjectID = ObjectID.generate();
    const tnTemplateId: ObjectID = ObjectID.generate();

    const insertMonitor: (data: {
      name: string;
      monitorTemplateId?: ObjectID | undefined;
      description?: string | undefined;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      monitorTemplateId?: ObjectID | undefined;
      description?: string | undefined;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("Monitor", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `${data.name.toLowerCase()}-${id.toString()}`,
        description: data.description || null,
        monitorType: MonitorType.Ping,
        currentMonitorStatusId: monitorStatusId,
        monitorTemplateId: data.monitorTemplateId || null,
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await harness.insert("MonitorLabel", {
          monitorId: id,
          labelId: data.labelId,
        });
      }
    };

    /*
     * The Monitors list, as the page reads it: the live monitors, with the
     * chips' query merged in, by name.
     */
    const listMonitors: (
      chips: Dictionary<unknown>,
      asUserId?: ObjectID | undefined,
    ) => Promise<ListedPage<Monitor>> = async (
      chips: Dictionary<unknown>,
      asUserId?: ObjectID | undefined,
    ): Promise<ListedPage<Monitor>> => {
      return await harness.list<Monitor>({
        path: "/monitor",
        query: { isArchived: false, ...chips },
        select: { _id: true, name: true, monitorTemplateId: true },
        sort: { name: SortOrder.Ascending },
        limit: 100,
        userId: asUserId || memberId,
        projectId: projectId,
      });
    };

    const namesOf: (page: ListedPage<Monitor>) => Array<string> = (
      page: ListedPage<Monitor>,
    ): Array<string> => {
      return valuesOf(page, "name");
    };

    // The Template chip, as the Monitors page's facet bar writes it.
    const templateChip: (
      operator: "is" | "is_not" | "is_empty" | "is_not_empty",
      templateIds: Array<ObjectID>,
    ) => Dictionary<unknown> = (
      operator: "is" | "is_not" | "is_empty" | "is_not_empty",
      templateIds: Array<ObjectID>,
    ): Dictionary<unknown> => {
      return {
        monitorTemplateId: buildMonitorTemplateFacetQuery(
          templateIds.map((id: ObjectID): string => {
            return id.toString();
          }),
          operator,
        ),
      };
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      await harness.insertLabel({
        id: kioskLabelId,
        projectId: projectId,
        name: "SubCategory: Kiosk",
      });

      await harness.insertMember({
        userId: kioskMemberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
        labelIds: [kioskLabelId],
      });

      // Linked to the WB template.
      await insertMonitor({
        name: "WB1500KSK01",
        monitorTemplateId: wbTemplateId,
        description: "Kiosk ping",
        labelId: kioskLabelId,
      });
      await insertMonitor({
        name: "WB1500KSK03",
        monitorTemplateId: wbTemplateId,
      });
      // Linked to the other templates.
      await insertMonitor({
        name: "AP0001KSK01",
        monitorTemplateId: apTemplateId,
        description: "Kiosk ping",
        labelId: kioskLabelId,
      });
      await insertMonitor({
        name: "TN0001KSK01",
        monitorTemplateId: tnTemplateId,
      });
      // Linked to no template: the report's.
      await insertMonitor({
        name: "WB1500KSK02",
        labelId: kioskLabelId,
      });
      await insertMonitor({
        name: "ZZ9999NOTEMPLATE",
        description: "Office router",
      });
      // Archived: not on the Monitors list at all.
      await insertMonitor({ name: "WB1500KSK05", isArchived: true });
      // Another project's, linked to nothing.
      await insertMonitor({
        name: "WB1500KSK06",
        inProject: otherProjectId,
      });
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    describe("the Template chip", () => {
      test("is not WB: the other templates' monitors and the ones with no template", async () => {
        const page: ListedPage<Monitor> = await listMonitors(
          templateChip("is_not", [wbTemplateId]),
        );

        expect(namesOf(page)).toEqual([
          "AP0001KSK01",
          "TN0001KSK01",
          "WB1500KSK02",
          "ZZ9999NOTEMPLATE",
        ]);
        expect(page.count).toBe(4);
      });

      test("is not WB or AP: TN's monitors and the ones with no template", async () => {
        const page: ListedPage<Monitor> = await listMonitors(
          templateChip("is_not", [wbTemplateId, apTemplateId]),
        );

        expect(namesOf(page)).toEqual([
          "TN0001KSK01",
          "WB1500KSK02",
          "ZZ9999NOTEMPLATE",
        ]);
      });

      test("is not any of them: only the monitors with no template", async () => {
        const page: ListedPage<Monitor> = await listMonitors(
          templateChip("is_not", [wbTemplateId, apTemplateId, tnTemplateId]),
        );

        expect(namesOf(page)).toEqual(["WB1500KSK02", "ZZ9999NOTEMPLATE"]);
      });

      test("is WB: its own monitors, as before", async () => {
        expect(
          namesOf(await listMonitors(templateChip("is", [wbTemplateId]))),
        ).toEqual(["WB1500KSK01", "WB1500KSK03"]);
      });

      test("is empty: the monitors with no template, as before", async () => {
        expect(
          namesOf(await listMonitors(templateChip("is_empty", []))),
        ).toEqual(["WB1500KSK02", "ZZ9999NOTEMPLATE"]);
      });

      test("is not empty: every monitor with a template, as before", async () => {
        expect(
          namesOf(await listMonitors(templateChip("is_not_empty", []))),
        ).toEqual(["AP0001KSK01", "TN0001KSK01", "WB1500KSK01", "WB1500KSK03"]);
      });

      test("is and is not split the list between them, with nothing lost", async () => {
        const is: Array<string> = namesOf(
          await listMonitors(templateChip("is", [wbTemplateId])),
        );
        const isNot: Array<string> = namesOf(
          await listMonitors(templateChip("is_not", [wbTemplateId])),
        );
        const all: Array<string> = namesOf(await listMonitors({}));

        expect([...is, ...isNot].sort()).toEqual(all);
        expect(all).toHaveLength(6);
      });

      test("never lists another project's monitor, or an archived one", async () => {
        const names: Array<string> = namesOf(
          await listMonitors(templateChip("is_not", [wbTemplateId])),
        );

        expect(names).not.toContain("WB1500KSK06");
        expect(names).not.toContain("WB1500KSK05");
      });

      /*
       * Permissions narrow the list as they did: a member who may read only
       * the Kiosk monitors gets the Kiosk monitors not linked to WB - the
       * one with no template among them - and nothing else.
       */
      test("a member limited to a label reads only that label's monitors, the one with no template among them", async () => {
        const page: ListedPage<Monitor> = await listMonitors(
          templateChip("is_not", [wbTemplateId]),
          kioskMemberId,
        );

        expect(namesOf(page)).toEqual(["AP0001KSK01", "WB1500KSK02"]);
        expect(page.count).toBe(2);
      });
    });

    describe("the chips' builders, on other columns", () => {
      test("a single-select entity chip's 'is not' keeps the empty too", async () => {
        expect(
          namesOf(
            await listMonitors({
              monitorTemplateId: buildEntityFacetQuery(
                [apTemplateId.toString()],
                "is_not",
                false,
              ),
            }),
          ),
        ).toEqual([
          "TN0001KSK01",
          "WB1500KSK01",
          "WB1500KSK02",
          "WB1500KSK03",
          "ZZ9999NOTEMPLATE",
        ]);
      });

      test("a text column's 'is not' keeps the monitors with no description", async () => {
        expect(
          namesOf(
            await listMonitors({
              description: defaultFacetQueryValue(
                ["Kiosk ping"],
                "is_not",
                false,
              ),
            }),
          ),
        ).toEqual([
          "TN0001KSK01",
          "WB1500KSK02",
          "WB1500KSK03",
          "ZZ9999NOTEMPLATE",
        ]);
      });
    });

    /*
     * Why the operators had to change: what the chip wrote until now, asked
     * of the same rows, never had the monitors with no template.
     */
    describe("what the chip wrote until now", () => {
      test("IncludesNone (NOT IN) lost every monitor linked to no template", async () => {
        const names: Array<string> = namesOf(
          await listMonitors({
            monitorTemplateId: new IncludesNone([wbTemplateId]),
          }),
        );

        expect(names).toEqual(["AP0001KSK01", "TN0001KSK01"]);
        expect(names).not.toContain("WB1500KSK02");
      });

      test("NotEqual (<>) lost them too", async () => {
        const names: Array<string> = namesOf(
          await listMonitors({
            monitorTemplateId: new NotEqual(wbTemplateId.toString()),
          }),
        );

        expect(names).toEqual(["AP0001KSK01", "TN0001KSK01"]);
      });
    });
  },
);
