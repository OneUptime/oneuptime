import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  IS_POSTGRES_PICKER_SEARCH_RUN,
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import RunbookService, {
  Service as RunbookServiceType,
} from "../../../Server/Services/RunbookService";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  RUNNABLE_RUNBOOKS_PAGE_SIZE,
  getRunnableRunbooksQuery,
} from "../../../Utils/Runbook/RunnableRunbooks";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RUN A RUNBOOK, SEARCHED THROUGH THE REAL SERVER (#10580).
 *
 * The dialog read the first 200 enabled runbooks by name when it opened and
 * searched them in the browser. In a project with more, a runbook whose name
 * sorted late - "WB1500 Restart kiosk" - was never offered, and a search for
 * it said "No matches". Every search now goes to the server with
 * getRunnableRunbooksQuery: the project's enabled runbooks whose name holds
 * what was typed, 50 by name.
 *
 * A project of 250 enabled runbooks named before "WB", with the late one
 * beside a disabled runbook and another project's of the same name; each
 * read goes through the runbook list route the app registers (POST
 * /runbook/get-list) as a member (PostgresListRouteHarness).
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

// The dialog's old read, and how many enabled runbooks sort before "WB".
const OLD_CAP: number = 200;
const RUNBOOKS_BEFORE_WB: number = 250;

describePostgres(
  "Run a Runbook, searched through the real server (#10580)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "runbook_picker",
      tables: ["Runbook", "RunbookLabel"],
    });

    // The runbook list route, as the app registers it.
    new BaseAPI<Runbook, RunbookServiceType>(Runbook, RunbookService);

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    // A member who may read only the runbooks labelled Kiosk.
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();

    const insertRunbook: (data: {
      name: string;
      isEnabled?: boolean | undefined;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      isEnabled?: boolean | undefined;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("Runbook", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `runbook-${id.toString()}`,
        isEnabled: data.isEnabled !== false,
      });

      if (data.labelId) {
        await harness.insert("RunbookLabel", {
          runbookId: id,
          labelId: data.labelId,
        });
      }
    };

    // A search typed into the dialog: a page of 50, by name.
    const search: (
      text: string,
      asUserId?: ObjectID | undefined,
    ) => Promise<ListedPage<Runbook>> = async (
      text: string,
      asUserId?: ObjectID | undefined,
    ): Promise<ListedPage<Runbook>> => {
      return await harness.list<Runbook>({
        path: "/runbook",
        query: getRunnableRunbooksQuery({
          projectId: projectId,
          searchText: text,
        }),
        select: { _id: true, name: true, description: true },
        sort: { name: SortOrder.Ascending },
        limit: RUNNABLE_RUNBOOKS_PAGE_SIZE,
        userId: asUserId || memberId,
        projectId: projectId,
      });
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

      // More enabled runbooks than the dialog ever read, all before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Runbook" ("_id", "version", "projectId", "name", "slug", "isEnabled")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 4, '0') || ' Restart kiosk', 'runbook-' || gen_random_uuid(), true
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), RUNBOOKS_BEFORE_WB],
      );

      // The late one, and its neighbours under the same search.
      await insertRunbook({
        name: "WB1500 Restart kiosk",
        labelId: kioskLabelId,
      });
      await insertRunbook({ name: "WB1500 Reboot router" });
      // Switched off: it cannot be started, so it is never offered.
      await insertRunbook({
        name: "WB1500 Restart kiosk (old)",
        isEnabled: false,
        labelId: kioskLabelId,
      });
      // Another project's.
      await insertRunbook({
        name: "WB1500 Restart kiosk (another project)",
        inProject: otherProjectId,
      });

      await harness.analyze("Runbook");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    describe("the read the dialog made until now", () => {
      test("never had WB1500 Restart kiosk to offer: the first 200 enabled runbooks, by name", async () => {
        // The read as the dialog made it, and the search it ran in the browser.
        const read: ListedPage<Runbook> = await harness.list<Runbook>({
          path: "/runbook",
          query: { projectId: projectId, isEnabled: true },
          select: { _id: true, name: true, description: true },
          sort: { name: SortOrder.Ascending },
          limit: OLD_CAP,
          userId: memberId,
          projectId: projectId,
        });

        expect(read.rows).toHaveLength(OLD_CAP);
        expect(read.count).toBe(RUNBOOKS_BEFORE_WB + 2);
        expect(
          valuesOf(read, "name").filter((name: string): boolean => {
            return name.toLowerCase().includes("wb1500");
          }),
        ).toEqual([]);
      });
    });

    describe("the dialog's search", () => {
      test("finds WB1500 Restart kiosk past the 200th runbook", async () => {
        const page: ListedPage<Runbook> = await search("WB1500 Restart");

        expect(valuesOf(page, "name")).toEqual(["WB1500 Restart kiosk"]);
        expect(page.count).toBe(1);
      });

      test("finds it by any part of its name, in any case", async () => {
        for (const text of [
          "wb1500 restart",
          "WB1500 RESTART KIOSK",
          "B1500 Rest",
          "1500 restart k",
        ]) {
          const names: Array<string> = valuesOf(await search(text), "name");

          expect(names).toContain("WB1500 Restart kiosk");
        }
      });

      /*
       * A word every runbook shares matches more than a page: the late one
       * is not on the first, and the count says how many more to narrow.
       */
      test("a word every runbook shares fills the page with the first 50, and counts the rest", async () => {
        const page: ListedPage<Runbook> = await search("kiosk");

        expect(page.rows).toHaveLength(RUNNABLE_RUNBOOKS_PAGE_SIZE);
        expect(valuesOf(page, "name")).not.toContain("WB1500 Restart kiosk");
        expect(page.count).toBe(RUNBOOKS_BEFORE_WB + 1);
      });

      test("never offers a disabled runbook or another project's", async () => {
        const names: Array<string> = valuesOf(await search("WB1500"), "name");

        expect(names).toEqual(["WB1500 Reboot router", "WB1500 Restart kiosk"]);
        expect(names).not.toContain("WB1500 Restart kiosk (old)");
        expect(names).not.toContain("WB1500 Restart kiosk (another project)");
      });

      test("with nothing typed, lists the first 50 by name and counts every enabled runbook", async () => {
        const page: ListedPage<Runbook> = await search("");

        expect(page.rows).toHaveLength(RUNNABLE_RUNBOOKS_PAGE_SIZE);
        expect(page.count).toBe(RUNBOOKS_BEFORE_WB + 2);
        expect(valuesOf(page, "name")[0]).toBe("AP0001 Restart kiosk");
        expect(valuesOf(page, "name")).toEqual(
          [...valuesOf(page, "name")].sort(),
        );
      });

      test("a search matching more than a page says how many: the dialog's 'Showing 50 of 251'", async () => {
        const page: ListedPage<Runbook> = await search("Restart kiosk");

        expect(page.rows).toHaveLength(RUNNABLE_RUNBOOKS_PAGE_SIZE);
        expect(page.count).toBe(RUNBOOKS_BEFORE_WB + 1);
      });

      test("reads % and _ as letters, never as wildcards", async () => {
        expect((await search("WB1500_Restart")).rows).toHaveLength(0);
        expect((await search("%kiosk")).rows).toHaveLength(0);
      });

      // Permissions narrow the search as they narrow every runbook list.
      test("a member limited to a label finds only that label's runbooks", async () => {
        const page: ListedPage<Runbook> = await search("WB1500", kioskMemberId);

        expect(valuesOf(page, "name")).toEqual(["WB1500 Restart kiosk"]);
        expect(page.count).toBe(1);
      });
    });
  },
);
