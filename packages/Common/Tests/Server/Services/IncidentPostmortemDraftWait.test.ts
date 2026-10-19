import IncidentService from "../../../Server/Services/IncidentService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The automatic postmortem draft that waits for what an incident's calls
 * said keeps, on the incident, since when it waits. Starting the wait is
 * OneUptime's own bookkeeping - written as root, past the incident's hooks,
 * so it is no edit in the feed or a workflow - and ending it is one
 * conditional UPDATE, so that of two callers ending it at once only one
 * writes the draft.
 */

const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SINCE: Date = new Date("2026-10-19T12:00:00.000Z");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService.startPostmortemDraftWait", () => {
  test("writes since when, as root and past the incident's hooks", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(1);

    await IncidentService.startPostmortemDraftWait({
      incidentId: INCIDENT,
      waitingSince: SINCE,
    });

    expect(update).toHaveBeenCalledWith({
      id: INCIDENT,
      data: { postmortemDraftWaitingSince: SINCE },
      props: { isRoot: true, ignoreHooks: true },
    });
  });
});

describe("IncidentService.endPostmortemDraftWait", () => {
  interface RecordedUpdate {
    set: JSONObject | null;
    where: Array<{ sql: string; params?: JSONObject | undefined }>;
  }

  function stubRepository(affected: number | undefined): RecordedUpdate {
    const recorded: RecordedUpdate = { set: null, where: [] };
    const builder: Record<string, unknown> = {};

    builder["update"] = (): unknown => {
      return builder;
    };
    builder["set"] = (values: JSONObject): unknown => {
      recorded.set = values;
      return builder;
    };
    builder["where"] = (sql: string, params?: JSONObject): unknown => {
      recorded.where.push({ sql, params });
      return builder;
    };
    builder["andWhere"] = builder["where"];
    builder["execute"] = async (): Promise<{ affected?: number }> => {
      return affected === undefined ? {} : { affected };
    };

    jest.spyOn(IncidentService, "getRepository").mockReturnValue({
      createQueryBuilder: (): unknown => {
        return builder;
      },
    } as unknown as ReturnType<typeof IncidentService.getRepository>);

    return recorded;
  }

  test("clears the wait only while it still holds the time the caller read", async () => {
    const recorded: RecordedUpdate = stubRepository(1);

    expect(
      await IncidentService.endPostmortemDraftWait({
        incidentId: INCIDENT,
        waitingSince: SINCE,
      }),
    ).toBe(1);
    expect(recorded.set).toEqual({ postmortemDraftWaitingSince: null });
    expect(recorded.where).toEqual([
      { sql: '"_id" = :id', params: { id: INCIDENT.toString() } },
      {
        sql: '"postmortemDraftWaitingSince" = :waitingSince',
        params: { waitingSince: SINCE },
      },
      { sql: '"deletedAt" IS NULL', params: undefined },
    ]);
  });

  test("0 when another caller ended it first", async () => {
    stubRepository(0);

    expect(
      await IncidentService.endPostmortemDraftWait({
        incidentId: INCIDENT,
        waitingSince: SINCE,
      }),
    ).toBe(0);
  });

  test("0 when the database says nothing about what it changed", async () => {
    stubRepository(undefined);

    expect(
      await IncidentService.endPostmortemDraftWait({
        incidentId: INCIDENT,
        waitingSince: SINCE,
      }),
    ).toBe(0);
  });
});
