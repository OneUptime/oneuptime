import VMwareSourceService from "../../../Server/Services/VMwareSourceService";
import VMwareResourceService from "../../../Server/Services/VMwareResourceService";
import {
  VMwareResourceSnapshot,
  VMwareSourceSnapshot,
} from "../../../Server/Utils/Telemetry/VMwareSnapshot";
import ObjectID from "../../../Types/ObjectID";

const PROJECT: ObjectID = ObjectID.generate();
const SOURCE: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-09-07T12:00:00Z");
function snapshot(
  overrides: Partial<VMwareResourceSnapshot> = {},
): VMwareResourceSnapshot {
  return {
    resourceIdentifier: "uuid-1",
    resourceType: "vm",
    name: "api",
    metadata: { "oneuptime.vmware.resource.observed": true },
    metrics: { "oneuptime.vmware.vm.cpu.utilization": 0 },
    lastSeenAt: NOW,
    lastReportedAt: NOW,
    ...overrides,
  };
}
function source(): VMwareSourceSnapshot {
  return {
    sourceIdentifier: "vcenter-prod",
    name: "Production",
    kind: "vcenter",
    metrics: { "oneuptime.vmware.source.up": 1 },
    lastSeenAt: NOW,
    lastCollectionAt: NOW,
    collectionIntervalSeconds: 60,
    lastSuccessfulCollectionAt: NOW,
    resources: [],
  };
}
function mockResourceQuery(): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue([]);
  jest
    .spyOn(VMwareResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}
afterEach(() => {
  jest.restoreAllMocks();
});

describe("VMware inventory persistence", () => {
  it("atomically scopes source identity by authenticated project and preserves display overrides/deletion", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockResolvedValue([{ _id: SOURCE.toString(), isArchived: true }]);
    jest
      .spyOn(VMwareSourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);
    expect(await VMwareSourceService.ingestSnapshot(PROJECT, source())).toEqual(
      { id: SOURCE, isArchived: true },
    );
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('ON CONFLICT ("projectId", "sourceIdentifier")');
    expect(sql).toContain('"VMwareSource"."deletedAt" IS NULL');
    expect(sql.split("DO UPDATE SET")[1]).not.toContain('"name" =');
    expect(sql).toContain('EXCLUDED."lastCollectionAt"');
    expect(params[0]).toBe(PROJECT.toString());
    expect(params[1]).toBe("vcenter-prod");
  });
  it("does not recreate a deleted source", async () => {
    const query: jest.Mock = jest.fn().mockResolvedValue([]);
    jest
      .spyOn(VMwareSourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);
    expect(
      await VMwareSourceService.ingestSnapshot(PROJECT, source()),
    ).toBeNull();
  });
  it("joins source project identity and leaves user policies/archive untouched", async () => {
    const query: jest.Mock = mockResourceQuery();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: SOURCE,
      resources: [snapshot()],
    });
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('parent."projectId" = incoming."projectId"');
    expect(sql).toContain('parent."isArchived" = false');
    expect(sql).toContain('"VMwareResource"."isArchived" = false');
    expect(sql).not.toContain('"expectedRunning"');
    expect(sql).not.toContain('"maintenanceMode"');
    expect(params.slice(0, 5)).toEqual([
      PROJECT.toString(),
      SOURCE.toString(),
      "vm",
      "uuid-1",
      "api",
    ]);
    expect(JSON.parse(params[6])).toEqual({
      "oneuptime.vmware.vm.cpu.utilization": 0,
    });
  });
  it("retains unknown rows, clears old metrics on newer reports, merges equal timestamps and rejects stale reports", async () => {
    const query: jest.Mock = mockResourceQuery();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: SOURCE,
      resources: [
        snapshot({
          lastSeenAt: null,
          metadata: { "oneuptime.vmware.resource.observed": false },
          metrics: { "oneuptime.vmware.resource.state": 0 },
        }),
      ],
    });
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).not.toContain("DELETE");
    expect(sql).toContain(
      'EXCLUDED."lastReportedAt" = "VMwareResource"."lastReportedAt"',
    );
    expect(sql).toContain(
      'THEN EXCLUDED."metrics" ELSE "VMwareResource"."metrics" END',
    );
    expect(sql).toContain('EXCLUDED."lastReportedAt" >=');
    expect(params[7]).toBeNull();
  });
  it("deduplicates latest same-identity rows before chunking", async () => {
    const query: jest.Mock = mockResourceQuery();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: SOURCE,
      resources: [
        snapshot({ name: "new" }),
        snapshot({
          name: "old",
          lastReportedAt: new Date(NOW.getTime() - 60000),
        }),
      ],
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toHaveLength(9);
    expect(query.mock.calls[0]![1][4]).toBe("new");
  });
  it("keeps SQL bounded for large fleets", async () => {
    const query: jest.Mock = mockResourceQuery();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: SOURCE,
      resources: Array.from({ length: 501 }, (_: unknown, index: number) => {
        return snapshot({ resourceIdentifier: `vm-${index}` });
      }),
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2]![1]).toHaveLength(9);
  });
  it("rejects invalid identities/types before any partial writes", async () => {
    const query: jest.Mock = mockResourceQuery();
    await expect(
      VMwareResourceService.bulkUpsert({
        projectId: PROJECT,
        sourceId: SOURCE,
        resources: [
          snapshot(),
          snapshot({ resourceIdentifier: "x".repeat(501) }),
        ],
      }),
    ).rejects.toThrow();
    await expect(
      VMwareResourceService.bulkUpsert({
        projectId: PROJECT,
        sourceId: SOURCE,
        resources: [snapshot({ resourceType: "other" })],
      }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it("does not write on an empty batch", async () => {
    const query: jest.Mock = mockResourceQuery();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: SOURCE,
      resources: [],
    });
    expect(query).not.toHaveBeenCalled();
  });
});
