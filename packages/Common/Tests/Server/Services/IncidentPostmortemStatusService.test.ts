import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentPostmortemStatusService, {
  POSTMORTEM_STATUS_BACKFILL_BATCH_SIZE,
  getPostmortemStatusBackfillSql,
} from "../../../Server/Services/IncidentPostmortemStatusService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * The postmortem status service's own reads and writes, beside the list
 * rules StateListServicesOrder pins through the real pipelines:
 *
 *   - the project's statuses as OneUptime reads them, archived ones too;
 *   - a delete names the status it deletes;
 *   - the backfill for incidents from before statuses runs one statement a
 *     batch until a batch gives none a status, and the statement gives each
 *     incident the status its postmortem is in by its fields (run against
 *     Postgres in PostmortemStatusPostgres.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SIGNED_IN: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
};

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the project's statuses, as OneUptime reads them", () => {
  test("are every status of the project, top first, with what decides what each counts as", async () => {
    const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    status._id = "22222222-2222-4222-8222-222222222222";

    const findBy: jest.SpyInstance = getJestSpyOn(
      IncidentPostmortemStatusService,
      "findBy",
    ).mockResolvedValue([status] as never);

    const statuses: Array<IncidentPostmortemStatus> =
      await IncidentPostmortemStatusService.getProjectStatuses(PROJECT_ID);

    expect(statuses).toEqual([status]);

    const args: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    // Archived ones too: an incident in one keeps it.
    expect(args.query).toEqual({ projectId: PROJECT_ID });
    expect(args.sort).toEqual({ order: SortOrder.Ascending });
    expect(args.props).toEqual({ isRoot: true });

    for (const column of [
      "_id",
      "name",
      "order",
      "isNotStartedStatus",
      "isDraftStatus",
      "isCompletedStatus",
      "isArchived",
    ]) {
      expect(args.select[column]).toBe(true);
    }
  });
});

describe("a delete", () => {
  /*
   * The hook itself: DatabaseService asks the caller's permissions before
   * it, which a test of the hook leaves out.
   */
  const onBeforeDelete: (deleteBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<unknown> = (deleteBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<unknown> => {
    return (
      IncidentPostmortemStatusService as unknown as {
        onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
      }
    ).onBeforeDelete(deleteBy);
  };

  test("by a person names the status it deletes", async () => {
    await expect(
      onBeforeDelete({ query: { projectId: PROJECT_ID }, props: SIGNED_IN }),
    ).rejects.toThrow(
      new BadDataException(
        "_id should be present when deleting postmortem statuses. Please try the delete with objectId",
      ),
    );
  });
});

describe("the backfill for incidents from before statuses", () => {
  type RawQuery = Mock<(statement: string) => Promise<unknown>>;

  const runsOf: (counts: Array<number>) => {
    query: RawQuery;
    sql: Array<string>;
  } = (counts: Array<number>): { query: RawQuery; sql: Array<string> } => {
    const sql: Array<string> = [];
    const queue: Array<number> = [...counts];

    const query: RawQuery = jest.fn(
      async (statement: string): Promise<unknown> => {
        sql.push(statement);
        // What the Postgres driver answers an UPDATE with: [rows, affected].
        return [[], queue.shift() ?? 0];
      },
    );

    getJestSpyOn(
      IncidentPostmortemStatusService,
      "getRepository",
    ).mockReturnValue({
      manager: { query: query },
    } as never);

    return { query, sql };
  };

  test("runs a batch at a time until one gives no incident a status, and says how many it gave one", async () => {
    const { sql } = runsOf([5000, 5000, 1234, 0]);

    const total: number =
      await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses();

    expect(total).toBe(11234);
    expect(sql).toHaveLength(4);
    // The same statement each time: it reads which incidents are left.
    expect(new Set(sql).size).toBe(1);
    expect(sql[0]).toContain(`LIMIT ${POSTMORTEM_STATUS_BACKFILL_BATCH_SIZE}`);
  });

  test("with nothing to do, one statement and none given a status", async () => {
    const { sql } = runsOf([0]);

    expect(
      await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(
        100,
      ),
    ).toBe(0);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("LIMIT 100");
  });

  test("an answer the driver does not count as rows written ends it", async () => {
    getJestSpyOn(
      IncidentPostmortemStatusService,
      "getRepository",
    ).mockReturnValue({
      manager: {
        query: async (): Promise<unknown> => {
          return "UPDATE 7";
        },
      },
    } as never);

    expect(
      await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
    ).toBe(0);
  });
});

describe("the backfill's statement", () => {
  const sql: string = getPostmortemStatusBackfillSql(250);

  test("gives only incidents with no status one, and leaves one given meanwhile", () => {
    // In the batch it reads, and again in the UPDATE that writes.
    expect(sql.match(/"postmortemStatusId" IS NULL/g)).toHaveLength(2);
    expect(sql).toContain("LIMIT 250");
  });

  test("reads each project's built-in statuses, the first from the top, live rows only", () => {
    for (const flag of [
      "isNotStartedStatus",
      "isDraftStatus",
      "isCompletedStatus",
    ]) {
      expect(sql).toContain(
        `(ARRAY_AGG("_id" ORDER BY "order" ASC NULLS LAST, "createdAt" ASC) FILTER (WHERE "${flag}" = true))[1]`,
      );
    }

    expect(sql).toContain('FROM "IncidentPostmortemStatus"');
    expect(sql).toContain('WHERE "deletedAt" IS NULL');
    expect(sql).toContain('GROUP BY "projectId"');
  });

  test("published and written goes to completed, written to draft, the rest to not started", () => {
    const completed: number = sql.indexOf(
      'COALESCE("statuses"."completedId", "statuses"."notStartedId")',
    );
    const draft: number = sql.indexOf(
      'COALESCE("statuses"."draftId", "statuses"."notStartedId")',
    );
    const notStarted: number = sql.indexOf('ELSE "statuses"."notStartedId"');

    expect(completed).toBeGreaterThan(-1);
    expect(draft).toBeGreaterThan(completed);
    expect(notStarted).toBeGreaterThan(draft);

    // Published: the switch on and a note that says something.
    expect(sql).toContain(
      `WHEN "incident"."showPostmortemOnStatusPage" = true AND COALESCE("incident"."postmortemNote", '') ~ '[^[:space:]]'`,
    );
  });

  test("leaves a project with no statuses yet for a later run", () => {
    expect(sql).toContain('AND "statuses"."notStartedId" IS NOT NULL');
    expect(sql).toContain(
      'INNER JOIN "statuses" ON "statuses"."projectId" = "incident"."projectId"',
    );
  });

  test("never names a batch of fewer than one, or a fraction", () => {
    expect(getPostmortemStatusBackfillSql(0)).toContain("LIMIT 1");
    expect(getPostmortemStatusBackfillSql(-5)).toContain("LIMIT 1");
    expect(getPostmortemStatusBackfillSql(12.7)).toContain("LIMIT 12");
  });
});
