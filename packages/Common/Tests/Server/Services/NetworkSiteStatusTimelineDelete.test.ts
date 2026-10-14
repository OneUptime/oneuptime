import NetworkSiteStatusTimeline from "../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import NetworkSiteStatusTimelineService, {
  NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE,
} from "../../../Server/Services/NetworkSiteStatusTimelineService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import StateTimelineRowsKept from "../../../Server/Utils/Database/StateTimelineRowsKept";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { FindOperator } from "typeorm";

/*
 * A NETWORK SITE'S STATUS HISTORY IS ONLY EVER TRIMMED AT ITS OLD END.
 *
 * Its rollups alone write it, and its uptime is worked out from it, so a
 * delete - by query, or of one event by its id - may take only events a
 * delete by query may: never the site's current status, nor an event that
 * covers part of the last 90 days. A delete by query is narrowed by
 * DatabaseService (DeleteByQueryKeepsStateTimelineRows); one by its id is
 * refused here, asked of the same rule.
 */

const EVENT_ID: ObjectID = new ObjectID("4e000000-0000-4000-8000-00000000000e");
const SITE_ID: ObjectID = new ObjectID("4e000000-0000-4000-8000-000000000051");

interface Hooks {
  onBeforeDelete: (
    deleteBy: DeleteBy<NetworkSiteStatusTimeline>,
  ) => Promise<OnDelete<NetworkSiteStatusTimeline>>;
}

const hooks: Hooks = NetworkSiteStatusTimelineService as unknown as Hooks;

function deleteOf(query: JSONObject): DeleteBy<NetworkSiteStatusTimeline> {
  return {
    query: query,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as DeleteBy<NetworkSiteStatusTimeline>;
}

function siteEvent(): NetworkSiteStatusTimeline {
  const row: NetworkSiteStatusTimeline = new NetworkSiteStatusTimeline();
  row._id = EVENT_ID.toString();
  row.siteId = SITE_ID;
  return row;
}

// The SQL a condition on the id holds, "and"s spelled out.
function sqlOf(condition: unknown, columnPath: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<FindOperator<unknown>>)
      .map((each: FindOperator<unknown>): string => {
        return sqlOf(each, columnPath);
      })
      .join(" AND ");
  }

  return (operator.getSql as (columnPath: string) => string)(columnPath);
}

// The name a binding gives the oldest moment kept: a fresh one each time.
const BOUND_PARAMETER_NAME: RegExp = /keptHistoryFrom[A-Za-z]{10}/g;

afterEach(() => {
  jest.restoreAllMocks();
});

test("a delete by query is left to DatabaseService, which has narrowed it: nothing is read", async () => {
  const hold: jest.SpyInstance = jest.spyOn(
    NetworkSiteStatusTimelineService,
    "findOneRowAndHoldDeleteToIt",
  );
  const countBy: jest.SpyInstance = jest.spyOn(
    NetworkSiteStatusTimelineService,
    "countBy",
  );

  const onDelete: OnDelete<NetworkSiteStatusTimeline> =
    await hooks.onBeforeDelete(deleteOf({ siteId: SITE_ID }));

  expect(onDelete.carryForward).toBeNull();
  expect(hold).not.toHaveBeenCalled();
  expect(countBy).not.toHaveBeenCalled();
});

test("one event by its id that a delete by query would keep is refused, asked of the same rule as OneUptime", async () => {
  jest
    .spyOn(NetworkSiteStatusTimelineService, "findOneRowAndHoldDeleteToIt")
    .mockResolvedValue({ row: siteEvent(), deletesMore: false } as never);

  const counts: Array<{ query: JSONObject; props: JSONObject }> = [];

  jest
    .spyOn(NetworkSiteStatusTimelineService, "countBy")
    .mockImplementation((async (countBy: {
      query: JSONObject;
      props: JSONObject;
    }): Promise<PositiveNumber> => {
      counts.push(countBy);
      return new PositiveNumber(1);
    }) as never);

  await expect(
    hooks.onBeforeDelete(deleteOf({ _id: EVENT_ID.toString() })),
  ).rejects.toThrow(
    new BadDataException(NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE),
  );

  expect(counts.length).toBe(1);
  expect(counts[0]!.props).toEqual({ isRoot: true });

  // The event's id, and the rule a delete by query keeps rows by.
  const sql: string = sqlOf(
    counts[0]!.query["_id"],
    "NetworkSiteStatusTimeline._id",
  ).replace(BOUND_PARAMETER_NAME, "from");

  expect(sql).toContain("NetworkSiteStatusTimeline._id = :");
  expect(sql).toContain(
    StateTimelineRowsKept.forTable("NetworkSiteStatusTimeline")
      .bind()
      .sqlForRowKept('"NetworkSiteStatusTimeline"')
      .replace(BOUND_PARAMETER_NAME, "from"),
  );
});

test("one event by its id that is over may go", async () => {
  jest
    .spyOn(NetworkSiteStatusTimelineService, "findOneRowAndHoldDeleteToIt")
    .mockResolvedValue({ row: siteEvent(), deletesMore: false } as never);
  jest
    .spyOn(NetworkSiteStatusTimelineService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  const onDelete: OnDelete<NetworkSiteStatusTimeline> =
    await hooks.onBeforeDelete(deleteOf({ _id: EVENT_ID.toString() }));

  expect(onDelete.carryForward).toBeNull();
});

test("an event the delete does not reach is not asked about", async () => {
  jest
    .spyOn(NetworkSiteStatusTimelineService, "findOneRowAndHoldDeleteToIt")
    .mockResolvedValue({ row: null, deletesMore: false } as never);
  const countBy: jest.SpyInstance = jest.spyOn(
    NetworkSiteStatusTimelineService,
    "countBy",
  );

  await hooks.onBeforeDelete(deleteOf({ _id: EVENT_ID.toString() }));

  expect(countBy).not.toHaveBeenCalled();
});

test("the refusal says why, and which events can go", () => {
  expect(NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE).toBe(
    "A site's current status, and every status event that covers part of its last 90 days, can't be deleted: the site's uptime is worked out from them. Status events that ended more than 90 days ago can be deleted.",
  );
});
