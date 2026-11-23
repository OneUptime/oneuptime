import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import ArchivableValueAPI from "../../../Server/API/ArchivableValueAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import LabelService, {
  Service as LabelServiceType,
} from "../../../Server/Services/LabelService";
import Label from "../../../Models/DatabaseModels/Label";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  getLabelSearchQuery,
  getLabelSearchSelect,
  LABEL_SEARCH_PAGE_SIZE,
} from "../../../UI/Components/EntityDropdown/LabelSearch";
import ProjectUser, {
  ProjectUserResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE PROJECT'S PEOPLE AND LABELS, READ PAST THEIR FIRST 10,000 THROUGH THE
 * REAL SERVER (#10646).
 *
 * - Every picker of the project's people (ProjectUser) read the first
 *   10,000 team memberships, unsorted - so the newest - and a person whose
 *   memberships were all past them was offered by none of them. It pages
 *   through every membership now, in the order they were made and by id
 *   among those made at once: memberships added in one go share their
 *   moment, and pages read by a time alone could leave one out between two
 *   of them.
 * - A picker's Labels tab, a table's "@label" suggestions and Bulk "Add
 *   Labels" filtered the project's first 10,000 labels in the browser; they
 *   search the server as you type (LabelSearch).
 *
 * Each read goes through the list routes as a member, on migrated Postgres
 * (PostgresListRouteHarness): the dashboard's own code, its reads answered
 * by the routes.
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

describePostgres(
  "the project's people and labels, read past their first 10,000 through the real server (#10646)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "people_and_labels",
      tables: [],
    });

    // The list routes, as the app registers them.
    new TeamMemberAPI();
    new ArchivableValueAPI<Label, LabelServiceType>(Label, LabelService);

    const projectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const bulkTeamId: ObjectID = ObjectID.generate();
    const lateUserId: ObjectID = ObjectID.generate();

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      /*
       * More people than a page holds, all added to one team in one go:
       * their memberships share the moment they were made.
       */
      await harness.query(
        `INSERT INTO "${harness.schema}"."User" ("_id", "version", "name", "email", "slug")
         SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 1, 'AP' || lpad(i::text, 6, '0'), 'ap' || i || '@example.com', 'ap-' || i
         FROM generate_series(1, $1) AS i`,
        [BEFORE_WB],
      );
      await harness.insert("Team", {
        _id: bulkTeamId,
        projectId: projectId,
        name: "Imported",
        slug: bulkTeamId.toString(),
        version: 1,
      });
      await harness.query(
        `INSERT INTO "${harness.schema}"."TeamMember" ("_id", "version", "projectId", "teamId", "userId", "hasAcceptedInvitation")
         SELECT gen_random_uuid(), 1, $1, $2, ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, true
         FROM generate_series(1, $3) AS i`,
        [projectId.toString(), bulkTeamId.toString(), BEFORE_WB],
      );

      // One more person, added after them.
      await harness.insertMember({
        userId: lateUserId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });
      await harness.query(
        `UPDATE "${harness.schema}"."User" SET "name" = 'Wanda Bell' WHERE "_id" = $1`,
        [lateUserId.toString()],
      );

      // More labels than the pickers read, then the late ones.
      await harness.query(
        `INSERT INTO "${harness.schema}"."Label" ("_id", "version", "projectId", "name", "slug", "color")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'label-' || gen_random_uuid(), '#6366f1'
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), BEFORE_WB],
      );

      for (const name of ["WB-kiosk", "WB-kitchen"]) {
        await harness.insertLabel({
          id: ObjectID.generate(),
          projectId: projectId,
          name: name,
        });
      }

      for (const table of ["User", "TeamMember", "Label"]) {
        await harness.analyze(table);
      }
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("every person is read, in pages, none left out between two pages of memberships made at once", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const users: Array<ProjectUserResult> =
        await ProjectUser.fetchAllProjectUsers(projectId);

      // The imported people, the member and the late person: each once.
      expect(users).toHaveLength(BEFORE_WB + 2);
      expect(
        new Set(
          users.map((user: ProjectUserResult): string => {
            return user.userId;
          }),
        ).size,
      ).toBe(BEFORE_WB + 2);
      expect(
        users.some((user: ProjectUserResult): boolean => {
          return user.name === "Wanda Bell";
        }),
      ).toBe(true);

      // Two pages: the old read was the first alone, unsorted.
      expect(
        reads.map((read: ListRequest): number => {
          return read.skip || 0;
        }),
      ).toEqual([0, LIMIT_PER_PROJECT]);
    });

    test("a label past the 10,000th is found by what is typed, 50 at most, by name", async () => {
      const page: ListedPage<Label> = await harness.list<Label>({
        path: "/label",
        query: getLabelSearchQuery("WB-ki") as Record<string, unknown>,
        select: getLabelSearchSelect() as Record<string, unknown>,
        sort: { name: SortOrder.Ascending },
        limit: LABEL_SEARCH_PAGE_SIZE,
        userId: memberId,
        projectId: projectId,
      });

      expect(valuesOf(page, "name")).toEqual(["WB-kiosk", "WB-kitchen"]);
      expect(page.count).toBe(2);
    });
  },
);
