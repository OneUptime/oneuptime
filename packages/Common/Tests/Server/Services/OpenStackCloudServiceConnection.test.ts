import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OpenStackCloudFeedService from "../../../Server/Services/OpenStackCloudFeedService";
import OpenStackCloudLabelRuleEngineService from "../../../Server/Services/OpenStackCloudLabelRuleEngineService";
import OpenStackCloudOwnerRuleEngineService from "../../../Server/Services/OpenStackCloudOwnerRuleEngineService";
import { Service as OpenStackCloudServiceType } from "../../../Server/Services/OpenStackCloudService";
import ProbeService from "../../../Server/Services/ProbeService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import OpenStackProbeCollectionStore from "../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import ResourceFeedUtil from "../../../Server/Utils/ResourceFeed/ResourceFeedUtil";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import Probe from "../../../Models/DatabaseModels/Probe";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import {
  OpenStackCollectionJob,
  OpenStackCollectionReport,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A cloud's probe collection settings, through the real service hooks. The rules are
 * OpenStackCloudConnection's and have their own suite. What these hold is the glue around
 * them, which is what a compiler cannot see:
 *
 *   - a cloud the agent or ingest registers names no setting, and nothing runs for it;
 *   - an update is checked against the row it writes, read with the columns the rules need;
 *   - what the hooks decide reaches the columns only the server writes, after the save, and
 *     the settings version moves in the same statement, so a report of older settings
 *     cannot overwrite the status of newer ones;
 *   - the probe is the service's own to answer for, because the generic check would refuse
 *     every global probe.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CLOUD_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_CLOUD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444445",
);

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<OpenStackCloud>,
  ) => Promise<OnCreate<OpenStackCloud>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<OpenStackCloud>,
  ) => Promise<OnUpdate<OpenStackCloud>>;
  onCreateSuccess: (
    onCreate: OnCreate<OpenStackCloud>,
    createdItem: OpenStackCloud,
  ) => Promise<OpenStackCloud>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<OpenStackCloud>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<OpenStackCloud>>;
  getRelationsCheckedByService: () => Array<string>;
};

let service: OpenStackCloudServiceType;
let internals: ServiceInternals;

type Spy = { mock: { calls: Array<Array<unknown>> } };

interface ColumnWrites {
  atomic: Array<{ id: string; add: unknown; set: Record<string, unknown> }>;
  plain: Array<{ id: string; data: Record<string, unknown> }>;
}

function stubColumnWrites(): ColumnWrites {
  const writes: ColumnWrites = { atomic: [], plain: [] };

  jest
    .spyOn(service, "atomicAddToColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      add: unknown;
      set: Record<string, unknown>;
    }) => {
      writes.atomic.push({
        id: input.id.toString(),
        add: input.add,
        set: input.set,
      });
    }) as never);

  jest
    .spyOn(service, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      writes.plain.push({ id: input.id.toString(), data: input.data });
    }) as never);

  return writes;
}

function stubFeed(): Spy {
  return jest
    .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
    .mockResolvedValue(undefined as never) as unknown as Spy;
}

function createBy(data: Record<string, unknown>): CreateBy<OpenStackCloud> {
  const cloud: OpenStackCloud = new OpenStackCloud();
  cloud.projectId = PROJECT_ID;
  Object.assign(cloud, data);

  return {
    data: cloud,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as CreateBy<OpenStackCloud>;
}

function updateBy(data: Record<string, unknown>): UpdateBy<OpenStackCloud> {
  return {
    query: { _id: CLOUD_ID },
    data: data,
    skip: 0,
    limit: 1,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<OpenStackCloud>;
}

const PROBE_SETTINGS: Record<string, unknown> = {
  name: "Production",
  collectionMethod: OpenStackCollectionMethod.Probe,
  authUrl: "keystone.example.com:5000/v3",
  applicationCredentialId: "an-id",
  credentialSecret: "a-secret",
  collectionRegions: ["RegionOne"],
  collectionProbeId: PROBE_ID,
};

function savedRow(overrides: Record<string, unknown> = {}): OpenStackCloud {
  const cloud: OpenStackCloud = new OpenStackCloud(CLOUD_ID);
  cloud.projectId = PROJECT_ID;
  cloud.collectionMethod = OpenStackCollectionMethod.Probe;
  cloud.authUrl = "https://keystone.example.com:5000";
  cloud.credentialKind = "applicationCredential";
  cloud.applicationCredentialId = "an-id";
  cloud.isCredentialSet = true;
  cloud.collectionProbeId = PROBE_ID;
  cloud.collectionRegions = ["RegionOne"];
  Object.assign(cloud, overrides);
  return cloud;
}

function stubSavedRows(rows: Array<OpenStackCloud>): Spy {
  return jest
    .spyOn(service, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue(rows as never) as unknown as Spy;
}

function probeRow(): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  probe.isGlobalProbe = false;
  return probe;
}

beforeEach(() => {
  service = new OpenStackCloudServiceType();
  internals = service as unknown as ServiceInternals;
  stubProjectDirectory({});
  jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(probeRow() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a cloud", () => {
  test("one the agent or ingest registers names no setting, so nothing is carried", async () => {
    const by: CreateBy<OpenStackCloud> = createBy({ name: "Production" });

    const result: OnCreate<OpenStackCloud> = await internals.onBeforeCreate(by);

    expect(result.createBy).toBe(by);
    expect(result.carryForward).toBeNull();
    expect(by.data.collectionMethod).toBeUndefined();
  });

  test("a probe-collected one is checked and normalized before it is saved", async () => {
    const by: CreateBy<OpenStackCloud> = createBy(PROBE_SETTINGS);

    const result: OnCreate<OpenStackCloud> = await internals.onBeforeCreate(by);

    expect(by.data.authUrl).toBe("https://keystone.example.com:5000");
    expect(by.data.credentialKind).toBe("applicationCredential");
    expect(
      (result.carryForward as { openStackConnectionChanges: Array<unknown> })
        .openStackConnectionChanges,
    ).toHaveLength(1);
  });

  test("one that is refused is refused before anything is saved", async () => {
    await expect(
      internals.onBeforeCreate(
        createBy({ ...PROBE_SETTINGS, authUrl: "http://keystone.example.com" }),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("once saved, the server's columns say a credential is saved and the probe collects now", async () => {
    const writes: ColumnWrites = stubColumnWrites();
    const feed: Spy = stubFeed();
    jest
      .spyOn(OpenStackCloudLabelRuleEngineService, "applyRulesToOpenStackCloud")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackCloudOwnerRuleEngineService, "applyRulesToOpenStackCloud")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.example.com"));
    jest.spyOn(ResourceFeedUtil, "getCreatedFeedMarkdown").mockResolvedValue({
      feedInfoInMarkdown: "created",
      moreInformationInMarkdown: "",
    });
    jest.spyOn(service, "findOneById").mockResolvedValue(null as never);

    const by: CreateBy<OpenStackCloud> = createBy(PROBE_SETTINGS);
    const onCreate: OnCreate<OpenStackCloud> =
      await internals.onBeforeCreate(by);

    const created: OpenStackCloud = new OpenStackCloud(CLOUD_ID);
    created.projectId = PROJECT_ID;

    const before: number = Date.now();

    await expect(internals.onCreateSuccess(onCreate, created)).resolves.toBe(
      created,
    );

    expect(writes.atomic).toHaveLength(1);
    expect(writes.atomic[0]!.id).toBe(CLOUD_ID.toString());
    expect(writes.atomic[0]!.add).toEqual({ collectionSettingsVersion: 1 });
    expect(writes.atomic[0]!.set).toMatchObject({
      isCredentialSet: true,
      collectionStatus: OpenStackCollectionStatus.Pending,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
    });
    expect(
      (writes.atomic[0]!.set["nextCollectionAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(writes.plain).toEqual([]);

    // The created feed item says the cloud exists: no second line about its settings.
    const connectionLines: Array<unknown> = feed.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(
          (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown,
        ).includes("Data collection changed");
      },
    );

    expect(connectionLines).toEqual([]);
  });

  test("a cloud saved with no settings writes none of the server's columns", async () => {
    const writes: ColumnWrites = stubColumnWrites();
    stubFeed();
    jest
      .spyOn(OpenStackCloudLabelRuleEngineService, "applyRulesToOpenStackCloud")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackCloudOwnerRuleEngineService, "applyRulesToOpenStackCloud")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.example.com"));
    jest.spyOn(ResourceFeedUtil, "getCreatedFeedMarkdown").mockResolvedValue({
      feedInfoInMarkdown: "created",
      moreInformationInMarkdown: "",
    });
    jest.spyOn(service, "findOneById").mockResolvedValue(null as never);

    const created: OpenStackCloud = new OpenStackCloud(CLOUD_ID);
    created.projectId = PROJECT_ID;

    await internals.onCreateSuccess(
      await internals.onBeforeCreate(createBy({ name: "Production" })),
      created,
    );

    expect(writes.atomic).toEqual([]);
    expect(writes.plain).toEqual([]);
  });
});

describe("updating a cloud", () => {
  test("a write that names no setting reads nothing and carries nothing", async () => {
    const read: Spy = stubSavedRows([]);

    const result: OnUpdate<OpenStackCloud> = await internals.onBeforeUpdate(
      updateBy({ description: "The big one" }),
    );

    expect(read.mock.calls).toHaveLength(0);
    expect(result.carryForward).toBeNull();
  });

  test("a settings write is checked against the row it writes, read with what the rules compare", async () => {
    const read: Spy = stubSavedRows([savedRow()]);
    const by: UpdateBy<OpenStackCloud> = updateBy({
      collectionIntervalInMinutes: 5,
    });

    const result: OnUpdate<OpenStackCloud> = await internals.onBeforeUpdate(by);

    expect(read.mock.calls).toHaveLength(1);
    expect(read.mock.calls[0]![0]).toBe(by);
    expect(read.mock.calls[0]![1]).toMatchObject({
      collectionMethod: true,
      authUrl: true,
      credentialKind: true,
      applicationCredentialId: true,
      keystoneUsername: true,
      isCredentialSet: true,
      collectionProbeId: true,
      collectionRegions: true,
      collectionOptions: true,
      trustedCertificateFingerprints: true,
      presentedCertificate: true,
    });

    const changes: Array<{ openStackCloudId: ObjectID }> = (
      result.carryForward as {
        openStackConnectionChanges: Array<{ openStackCloudId: ObjectID }>;
      }
    ).openStackConnectionChanges;

    expect(changes).toHaveLength(1);
    expect(changes[0]!.openStackCloudId.toString()).toBe(CLOUD_ID.toString());
  });

  test("the saved row reaches the rules: a saved secret does not follow another address", async () => {
    stubSavedRows([savedRow()]);

    await expect(
      internals.onBeforeUpdate(
        updateBy({ authUrl: "https://evil.example.com" }),
      ),
    ).rejects.toThrow(
      "Enter the credential again: a saved credential is only sent to the Keystone it was entered for.",
    );
  });

  test("every column the rules compare reaches them: the certificate the probe found may be trusted", async () => {
    const fingerprint: string =
      "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

    stubSavedRows([
      savedRow({ presentedCertificate: { fingerprint256: fingerprint } }),
    ]);

    await expect(
      internals.onBeforeUpdate(
        updateBy({ trustedCertificateFingerprints: [fingerprint] }),
      ),
    ).resolves.toBeDefined();
  });

  test("a new password for the saved user is that user's: the saved names reach the rules", async () => {
    stubSavedRows([
      savedRow({
        credentialKind: "password",
        applicationCredentialId: undefined,
        keystoneUsername: "reader",
        userDomainName: "Default",
        projectName: "monitoring",
        projectDomainName: "Default",
      }),
    ]);

    const by: UpdateBy<OpenStackCloud> = updateBy({
      credentialSecret: "a-new-password",
    });

    await internals.onBeforeUpdate(by);

    expect(by.data).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "reader",
      projectName: "monitoring",
    });
  });

  test("the settings version moves in the statement that says the probe should try again", async () => {
    const writes: ColumnWrites = stubColumnWrites();
    const feed: Spy = stubFeed();
    stubSavedRows([savedRow()]);

    const onUpdate: OnUpdate<OpenStackCloud> = await internals.onBeforeUpdate(
      updateBy({ credentialSecret: "a-new-secret" }),
    );

    await internals.onUpdateSuccess(onUpdate, [CLOUD_ID]);

    expect(writes.atomic).toHaveLength(1);
    expect(writes.atomic[0]!.add).toEqual({ collectionSettingsVersion: 1 });
    expect(writes.atomic[0]!.set).toMatchObject({
      isCredentialSet: true,
      collectionStatus: OpenStackCollectionStatus.Pending,
    });
    expect(writes.atomic[0]!.set["credentialsUpdatedAt"]).toBeInstanceOf(Date);
    expect(writes.plain).toEqual([]);

    // The feed says what changed and who changed it, never the secret.
    expect(feed.mock.calls).toHaveLength(1);

    const item: {
      openStackCloudId: ObjectID;
      projectId: ObjectID;
      feedInfoInMarkdown: string;
      userId: ObjectID;
    } = feed.mock.calls[0]![0] as never;

    expect(item.openStackCloudId.toString()).toBe(CLOUD_ID.toString());
    expect(item.userId).toBe(USER_ID);
    expect(item.feedInfoInMarkdown).toContain(
      "Its OpenStack credential changed",
    );
    expect(item.feedInfoInMarkdown).not.toContain("a-new-secret");
  });

  test("an interval only: the probe need not try again, so the version stands", async () => {
    const writes: ColumnWrites = stubColumnWrites();
    const feed: Spy = stubFeed();
    stubSavedRows([savedRow()]);

    const onUpdate: OnUpdate<OpenStackCloud> = await internals.onBeforeUpdate(
      updateBy({ collectionIntervalInMinutes: 5 }),
    );

    await internals.onUpdateSuccess(onUpdate, [CLOUD_ID]);

    expect(writes.atomic).toEqual([]);
    expect(writes.plain).toEqual([]);
    expect(feed.mock.calls).toHaveLength(1);
  });

  test("switching to the agent forgets the status and the schedule", async () => {
    const writes: ColumnWrites = stubColumnWrites();
    stubFeed();
    stubSavedRows([savedRow()]);

    const by: UpdateBy<OpenStackCloud> = updateBy({
      collectionMethod: OpenStackCollectionMethod.Agent,
    });
    const onUpdate: OnUpdate<OpenStackCloud> =
      await internals.onBeforeUpdate(by);

    // The person's own write takes the secret with it.
    expect(by.data).toMatchObject({ credentialSecret: null });

    await internals.onUpdateSuccess(onUpdate, [CLOUD_ID]);

    expect(writes.atomic[0]!.add).toEqual({ collectionSettingsVersion: 1 });
    expect(writes.atomic[0]!.set).toMatchObject({
      isCredentialSet: false,
      collectionStatus: null,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
      nextCollectionAt: null,
    });
  });

  test("a cloud the update did not reach gets nothing written", async () => {
    const writes: ColumnWrites = stubColumnWrites();
    const feed: Spy = stubFeed();
    stubSavedRows([savedRow()]);

    const onUpdate: OnUpdate<OpenStackCloud> = await internals.onBeforeUpdate(
      updateBy({ credentialSecret: "a-new-secret" }),
    );

    await internals.onUpdateSuccess(onUpdate, [OTHER_CLOUD_ID]);

    expect(writes.atomic).toEqual([]);
    expect(writes.plain).toEqual([]);
    expect(feed.mock.calls).toHaveLength(0);
  });

  test("the bookkeeping of a heartbeat is no settings write", async () => {
    const read: Spy = stubSavedRows([]);

    await internals.onBeforeUpdate(
      updateBy({
        lastSeenAt: new Date(),
        otelCollectorStatus: "disconnected",
        instanceCount: 3,
      }),
    );

    expect(read.mock.calls).toHaveLength(0);
  });
});

describe("the probe's side", () => {
  test("the collection probe is the service's own to answer for", () => {
    expect(internals.getRelationsCheckedByService()).toEqual([
      "collectionProbe",
    ]);
  });

  test("a claim goes through the store, with the service itself", async () => {
    const jobs: Array<OpenStackCollectionJob> = [];
    const claim: Spy = jest
      .spyOn(OpenStackProbeCollectionStore, "claimDueClouds")
      .mockResolvedValue(jobs as never) as unknown as Spy;

    const data: {
      probeId: ObjectID;
      runningOpenStackCloudIds: Array<string>;
      limit: number;
    } = {
      probeId: PROBE_ID,
      runningOpenStackCloudIds: [],
      limit: 4,
    };

    await expect(service.claimForCollection(data)).resolves.toBe(jobs);
    expect(claim.mock.calls[0]).toEqual([service, data]);
  });

  test("a report goes through the store, with the service itself", async () => {
    const outcome: { accepted: boolean } = { accepted: true };
    const record: Spy = jest
      .spyOn(OpenStackProbeCollectionStore, "recordCollectionReport")
      .mockResolvedValue(outcome as never) as unknown as Spy;

    const data: { probeId: ObjectID; report: OpenStackCollectionReport } = {
      probeId: PROBE_ID,
      report: {
        openStackCloudId: CLOUD_ID.toString(),
        settingsVersion: 1,
        collectedAt: "2026-11-04T12:00:00.000Z",
        status: "Succeeded",
        durationInMs: 1,
      },
    };

    await expect(service.recordCollectionReport(data)).resolves.toBe(outcome);
    expect(record.mock.calls[0]).toEqual([service, data]);
  });
});
