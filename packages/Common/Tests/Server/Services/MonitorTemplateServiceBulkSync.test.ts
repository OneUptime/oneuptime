import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  SyncLinkedMonitorsResult,
} from "../../../Server/Services/MonitorTemplateService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function buildPingTemplate(): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  // Not a Network Device template, so sync takes the bulk update path.
  template.monitorType = MonitorType.Ping;
  template.monitoringInterval = "*/10 * * * *";
  template.minimumProbeAgreement = 2;
  return template;
}

/*
 * Stand in for a project holding more linked monitors than a single update
 * can carry. Pages are served by skip so the service's paging loop is what
 * decides how many rows it discovers.
 */
function mockLinkedMonitorPages(totalLinkedMonitors: number): Array<ObjectID> {
  /*
   * A fixed pool rather than ids minted per page, so a test can assert which
   * monitors were written and not merely how many — dropping one row while
   * double-writing another keeps the counts intact.
   */
  const pool: Array<ObjectID> = Array.from(
    { length: totalLinkedMonitors },
    (): ObjectID => {
      return ObjectID.generate();
    },
  );

  jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<Monitor>): Promise<Array<Monitor>> => {
        const skip: number = Number(findBy.skip?.toString() || 0);
        const limit: number = Number(findBy.limit?.toString() || 0);

        return pool.slice(skip, skip + limit).map((id: ObjectID): Monitor => {
          const monitor: Monitor = new Monitor();
          monitor.id = id;
          monitor.projectId = PROJECT_ID;
          monitor.monitorTemplateId = TEMPLATE_ID;
          return monitor;
        });
      },
    );

  return pool;
}

function writtenIdsFrom(
  updateSpy: SpyInstance<typeof MonitorService.updateBy>,
): Array<string> {
  return updateSpy.mock.calls.flatMap(
    (call: [UpdateBy<Monitor>]): Array<string> => {
      return (call[0].query as Record<string, Includes>)["_id"]!.values.map(
        (id: string | ObjectID | number): string => {
          return id.toString();
        },
      );
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService bulk sync coverage", () => {
  /*
   * Regression: the bulk path issued one updateBy capped at LIMIT_MAX with no
   * paging, so a template linked to more monitors than that silently left the
   * remainder on the old configuration and still reported success.
   */
  it("syncs every linked monitor when the fleet exceeds one update batch", async () => {
    const totalLinkedMonitors: number = LIMIT_MAX * 2 + 500;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(totalLinkedMonitors);
    mockLinkedMonitorPages(totalLinkedMonitors);

    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockImplementation(
        async (updateBy: UpdateBy<Monitor>): Promise<number> => {
          const ids: Includes = (updateBy.query as Record<string, Includes>)[
            "_id"
          ]!;
          return ids.values.length;
        },
      );

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({
      totalLinkedMonitors: totalLinkedMonitors,
      syncedMonitors: totalLinkedMonitors,
    });

    // Three batches: LIMIT_MAX, LIMIT_MAX, then the 500 remainder.
    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect(
      updateSpy.mock.calls.map((call: [UpdateBy<Monitor>]): number => {
        return (call[0].query as Record<string, Includes>)["_id"]!.values
          .length;
      }),
    ).toEqual([LIMIT_MAX, LIMIT_MAX, 500]);

    // Every batch stays scoped to this template and project.
    for (const call of updateSpy.mock.calls) {
      const query: Record<string, unknown> = call[0].query as Record<
        string,
        unknown
      >;
      expect(query["monitorTemplateId"]).toEqual(TEMPLATE_ID);
      expect(query["projectId"]).toEqual(PROJECT_ID);
    }
  });

  it("still issues a single batch for a fleet that fits in one update", async () => {
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(3);
    mockLinkedMonitorPages(3);

    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(3);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 3, syncedMonitors: 3 });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the template has no linked monitors", async () => {
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(0);

    const findSpy: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest.spyOn(
      MonitorService,
      "updateBy",
    );

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 0, syncedMonitors: 0 });
    expect(findSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  /*
   * Boundary: a full first page cannot be assumed to be the last one, so the
   * loop must ask again and only stop on the short (here empty) page. Getting
   * this wrong is how the original truncation behaved.
   */
  it("covers a fleet of exactly one page without stopping early", async () => {
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(LIMIT_MAX);
    mockLinkedMonitorPages(LIMIT_MAX);

    const findSpy: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockImplementation(
        async (updateBy: UpdateBy<Monitor>): Promise<number> => {
          return (updateBy.query as Record<string, Includes>)["_id"]!.values
            .length;
        },
      );

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({
      totalLinkedMonitors: LIMIT_MAX,
      syncedMonitors: LIMIT_MAX,
    });
    // Full page, then the empty page that ends the loop.
    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("carries the single monitor that overflows a page into a second batch", async () => {
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(LIMIT_MAX + 1);
    mockLinkedMonitorPages(LIMIT_MAX + 1);

    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockImplementation(
        async (updateBy: UpdateBy<Monitor>): Promise<number> => {
          return (updateBy.query as Record<string, Includes>)["_id"]!.values
            .length;
        },
      );

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({
      totalLinkedMonitors: LIMIT_MAX + 1,
      syncedMonitors: LIMIT_MAX + 1,
    });
    expect(
      updateSpy.mock.calls.map((call: [UpdateBy<Monitor>]): number => {
        return (call[0].query as Record<string, Includes>)["_id"]!.values
          .length;
      }),
    ).toEqual([LIMIT_MAX, 1]);
  });

  /*
   * countLinkedMonitors reads project-wide as root while the writes stay
   * narrowed to the caller, so a label-scoped operator legitimately syncs
   * fewer rows than are linked. The shortfall must reach the caller rather
   * than being rounded up to the linked count.
   */
  it("reports a permission-narrowed write honestly instead of claiming full coverage", async () => {
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(9);
    mockLinkedMonitorPages(9);

    jest.spyOn(MonitorService, "updateBy").mockResolvedValue(4);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: false },
      });

    expect(result).toEqual({ totalLinkedMonitors: 9, syncedMonitors: 4 });
  });

  /*
   * The per-monitor rebind path exists only to keep each Network Device
   * monitor pointed at its own device, which is a monitorSteps concern. A
   * sync that leaves steps alone has no reason to pay for it.
   */
  it("takes the bulk path for a Network Device template when steps are not synced", async () => {
    const template: MonitorTemplate = buildPingTemplate();
    template.monitorType = MonitorType.NetworkDevice;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(2);
    mockLinkedMonitorPages(2);

    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(2);
    const perMonitorSpy: SpyInstance<typeof MonitorService.updateOneById> =
      jest.spyOn(MonitorService, "updateOneById");

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 2 });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(perMonitorSpy).not.toHaveBeenCalled();
  });

  it("writes nothing when the template carries none of the requested fields", async () => {
    // Deliberately never assigns monitoringInterval, so buildUpdateData skips it.
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.Ping;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(5);

    const findSpy: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest.spyOn(
      MonitorService,
      "updateBy",
    );

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 5, syncedMonitors: 0 });
    expect(findSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  /*
   * The read enumerates as root so the reported linked total is project-wide,
   * while every write carries the caller so updateBy can narrow it. Losing
   * either half is a security-relevant change, and a count assertion cannot
   * see it.
   */
  it("enumerates ids as root while narrowing every write to the caller", async () => {
    const callerProps: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(3);
    mockLinkedMonitorPages(3);

    const findSpy: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(3);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitoringInterval"],
      props: callerProps,
    });

    expect(findSpy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    for (const call of updateSpy.mock.calls) {
      expect(call[0].props).toBe(callerProps);
    }
  });

  /*
   * skip/limit paging is only stable over a total order, and a fleet
   * provisioned by one auto-import run shares a createdAt. Without the _id
   * tiebreaker a boundary tie returns one row twice and another never.
   */
  it("pages linked ids under a total order scoped to the template", async () => {
    const total: number = LIMIT_MAX * 2 + 5;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(total);
    mockLinkedMonitorPages(total);

    const findSpy: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    jest.spyOn(MonitorService, "updateBy").mockResolvedValue(0);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitoringInterval"],
      props: { isRoot: true },
    });

    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { monitorTemplateId: TEMPLATE_ID, projectId: PROJECT_ID },
        select: { _id: true },
        sort: {
          createdAt: SortOrder.Ascending,
          _id: SortOrder.Ascending,
        },
        props: { isRoot: true },
      }),
    );

    // A dropped skip increment would hang rather than fail; pin the walk.
    expect(
      findSpy.mock.calls.map((call: [FindBy<Monitor>]): number => {
        return Number(call[0].skip?.toString() || 0);
      }),
    ).toEqual([0, LIMIT_MAX, LIMIT_MAX * 2]);
  });

  it("writes every linked monitor exactly once across batches", async () => {
    const total: number = LIMIT_MAX + 250;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(total);
    const pool: Array<ObjectID> = mockLinkedMonitorPages(total);

    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(0);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitoringInterval"],
      props: { isRoot: true },
    });

    const written: Array<string> = writtenIdsFrom(updateSpy);

    expect(written).toHaveLength(total);
    expect(new Set(written).size).toBe(total);
    expect(new Set(written)).toEqual(
      new Set(
        pool.map((id: ObjectID): string => {
          return id.toString();
        }),
      ),
    );
  });

  /*
   * Batch width and the update limit are the same constant today. If they ever
   * diverge, updateBy silently truncates each batch and the original bug comes
   * back green.
   */
  it("never hands updateBy more ids than its own limit allows", async () => {
    const total: number = LIMIT_MAX * 2 + 7;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(buildPingTemplate());
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(total);
    mockLinkedMonitorPages(total);

    const updateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(0);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitoringInterval"],
      props: { isRoot: true },
    });

    for (const call of updateSpy.mock.calls) {
      const batchSize: number = (call[0].query as Record<string, Includes>)[
        "_id"
      ]!.values.length;
      expect(Number(call[0].limit)).toBeGreaterThanOrEqual(batchSize);
    }
  });

  it("rejects a field that is not syncable from a template", async () => {
    await expect(
      MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorName"],
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      'Field "monitorName" is not syncable from a monitor template',
    );
  });
});
