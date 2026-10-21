/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import HostCollectorAgent, {
  HOST_COLLECTOR_LAST_CONTACT_WRITE_INTERVAL_MS,
  HostCollectorMessageResult,
  HostCollectorSnapshot,
} from "../../../../Server/Utils/HostCollector/HostCollectorAgent";
import HostCollectorProjectConfigsMemo from "../../../../Server/Utils/HostCollector/HostCollectorProjectConfigsMemo";
import OpAmpCodec, {
  OpAmpAgentDescription,
  OpAmpRemoteConfigStatus,
  OpAmpServerErrorResponseType,
  OpAmpServerToAgent,
  OpAmpServerToAgentFlag,
} from "../../../../Server/Utils/HostCollector/OpAmp/OpAmpCodec";
import {
  getHostCollectorConfigHash,
  hostCollectorConfigHashToBytes,
} from "../../../../Server/Utils/HostCollector/HostCollectorConfigHash";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../../Server/Services/HostService";
import HostCollectorConfigService from "../../../../Server/Services/HostCollectorConfigService";
import HostCollectorConfigVersionService from "../../../../Server/Services/HostCollectorConfigVersionService";
import LabelService from "../../../../Server/Services/LabelService";
import Host from "../../../../Models/DatabaseModels/Host";
import HostCollectorConfig from "../../../../Models/DatabaseModels/HostCollectorConfig";
import HostCollectorConfigVersion from "../../../../Models/DatabaseModels/HostCollectorConfigVersion";
import Label from "../../../../Models/DatabaseModels/Label";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  HostCollectorConfigStatus,
  HostCollectorOsType,
} from "../../../../Types/HostCollector/HostCollector";
import {
  ALL_HOST_FEATURES,
  UNKNOWN_HOST_FEATURES,
  getHostCollectorDefaultConfig,
} from "../../../../Utils/HostCollector/HostCollectorDefaultConfig";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The server side of a managed host: every message its OpAMP supervisor
 * posts reaches HostCollectorAgent with the project its key belongs to. It
 * files the host (creating it on its first message, before any metrics),
 * picks the config the host runs, records what the host reports, and
 * answers with the config when the host needs it - writing nothing for the
 * many polls that say nothing new.
 *
 * Postgres is a few rows in maps behind the services' methods; Redis is a
 * map; the clock is the test's.
 */

const PROJECT: ObjectID = new ObjectID("8f1e6c7a-0000-4000-8000-000000000001");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "8f1e6c7a-0000-4000-8000-000000000002",
);

const INSTANCE_ONE: Uint8Array = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);
const INSTANCE_TWO: Uint8Array = new Uint8Array([
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 1,
]);

interface FakeHost {
  id: string;
  projectId: string;
  hostIdentifier: string;
  registeredByCollectorManagement: boolean;
  labelIds: Array<string>;
  columns: Record<string, unknown>;
}

interface FakeConfig {
  id: string;
  projectId: string;
  osType: HostCollectorOsType;
  order: number;
  configYaml: string;
  labelIds: Array<string>;
}

interface FakeVersion {
  id: string;
  projectId: string;
  configId: string;
  versionNumber: number;
  configHash: string;
}

interface Write {
  id: string;
  data: Record<string, unknown>;
  skipUpdateDateColumn: boolean | undefined;
}

let hosts: Array<FakeHost>;
let hostNameMemo: Map<string, string>;
let configs: Array<FakeConfig>;
let versions: Array<FakeVersion>;
let labelIdsByName: Map<string, string>;
let cache: Map<string, string>;
let writes: Array<Write>;
let versionQueries: Array<Record<string, unknown>>;
let now: number;
let failNextWrite: boolean;
let nextId: number;

function newId(): string {
  nextId++;
  return `00000000-0000-4000-8000-${nextId.toString().padStart(12, "0")}`;
}

function toHostModel(fake: FakeHost): Host {
  const host: Host = new Host();
  host._id = fake.id;
  host.projectId = new ObjectID(fake.projectId);
  host.hostIdentifier = fake.hostIdentifier;
  for (const [column, value] of Object.entries(fake.columns)) {
    (host as unknown as Record<string, unknown>)[column] =
      value instanceof ObjectID ? value : value;
  }
  host.labels = fake.labelIds.map((labelId: string): Label => {
    const label: Label = new Label();
    label._id = labelId;
    return label;
  });
  return host;
}

function addConfig(
  data: Partial<FakeConfig> & { configYaml: string },
): FakeConfig {
  const config: FakeConfig = {
    id: newId(),
    projectId: PROJECT.toString(),
    osType: HostCollectorOsType.Linux,
    order: configs.length,
    labelIds: [],
    ...data,
  };
  configs.push(config);
  HostCollectorProjectConfigsMemo.clear();
  return config;
}

function addVersion(config: FakeConfig, versionNumber: number): FakeVersion {
  const version: FakeVersion = {
    id: newId(),
    projectId: config.projectId,
    configId: config.id,
    versionNumber,
    configHash: getHostCollectorConfigHash(config.configYaml),
  };
  versions.push(version);
  return version;
}

function installFakes(): void {
  jest
    .spyOn(HostService, "findOrCreateByHostIdentifier")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        hostIdentifier: string;
        isRegisteredByCollectorManagement?: boolean | undefined;
        bypassMemo?: boolean | undefined;
      }): Promise<Host> => {
        /*
         * HostService remembers a host name's id for a minute, even after
         * the host is deleted, unless told to look again.
         */
        const memoKey: string = `${data.projectId.toString()}:${data.hostIdentifier}`;
        const memoed: string | undefined = hostNameMemo.get(memoKey);
        if (memoed && !data.bypassMemo) {
          const remembered: Host = new Host();
          remembered._id = memoed;
          return remembered;
        }

        let host: FakeHost | undefined = hosts.find(
          (item: FakeHost): boolean => {
            return (
              item.projectId === data.projectId.toString() &&
              item.hostIdentifier === data.hostIdentifier
            );
          },
        );
        if (!host) {
          host = {
            id: newId(),
            projectId: data.projectId.toString(),
            hostIdentifier: data.hostIdentifier,
            registeredByCollectorManagement: Boolean(
              data.isRegisteredByCollectorManagement,
            ),
            labelIds: [],
            columns: {},
          };
          hosts.push(host);
        }
        hostNameMemo.set(memoKey, host.id);
        return toHostModel(host);
      },
    );

  jest
    .spyOn(HostService, "findOneById")
    .mockImplementation(async (data: { id: ObjectID }) => {
      const host: FakeHost | undefined = hosts.find(
        (item: FakeHost): boolean => {
          return item.id === data.id.toString();
        },
      );
      return host ? toHostModel(host) : null;
    });

  jest
    .spyOn(HostService, "findOneBy")
    .mockImplementation(async (data: { query: Record<string, unknown> }) => {
      const host: FakeHost | undefined = hosts.find(
        (item: FakeHost): boolean => {
          return (
            item.projectId === String(data.query["projectId"]) &&
            item.columns["collectorInstanceUid"] ===
              data.query["collectorInstanceUid"]
          );
        },
      );
      return host ? toHostModel(host) : null;
    });

  jest
    .spyOn(HostService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(
      async (input: {
        id: ObjectID;
        data: Record<string, unknown>;
        skipUpdateDateColumn?: boolean;
      }): Promise<void> => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("database is down");
        }
        writes.push({
          id: input.id.toString(),
          data: { ...input.data },
          skipUpdateDateColumn: input.skipUpdateDateColumn,
        });
        const host: FakeHost | undefined = hosts.find(
          (item: FakeHost): boolean => {
            return item.id === input.id.toString();
          },
        );
        if (host) {
          Object.assign(host.columns, input.data);
        }
      },
    );

  jest
    .spyOn(HostService, "attachLabels")
    .mockImplementation(
      async (data: { hostId: ObjectID; labelIds: Array<ObjectID> }) => {
        const host: FakeHost = hosts.find((item: FakeHost): boolean => {
          return item.id === data.hostId.toString();
        })!;
        for (const labelId of data.labelIds) {
          if (!host.labelIds.includes(labelId.toString())) {
            host.labelIds.push(labelId.toString());
          }
        }
      },
    );

  jest
    .spyOn(LabelService, "findOrCreateLabelsByNames")
    .mockImplementation(async (data: { labelNames: Array<string> }) => {
      return data.labelNames.map((name: string): ObjectID => {
        if (!labelIdsByName.has(name)) {
          labelIdsByName.set(name, newId());
        }
        return new ObjectID(labelIdsByName.get(name)!);
      });
    });

  jest
    .spyOn(HostCollectorConfigService, "findBy")
    .mockImplementation(async (data: { query: Record<string, unknown> }) => {
      return configs
        .filter((config: FakeConfig): boolean => {
          return config.projectId === String(data.query["projectId"]);
        })
        .sort((a: FakeConfig, b: FakeConfig): number => {
          return a.order - b.order;
        })
        .map((config: FakeConfig): HostCollectorConfig => {
          const model: HostCollectorConfig = new HostCollectorConfig();
          model._id = config.id;
          model.osType = config.osType;
          model.order = config.order;
          model.configYaml = config.configYaml;
          model.configHash = getHostCollectorConfigHash(config.configYaml);
          model.labels = config.labelIds.map((labelId: string): Label => {
            const label: Label = new Label();
            label._id = labelId;
            return label;
          });
          return model;
        });
    });

  jest
    .spyOn(HostCollectorConfigVersionService, "findOneBy")
    .mockImplementation(async (data: { query: Record<string, unknown> }) => {
      versionQueries.push({ ...data.query });
      const match: Array<FakeVersion> = versions
        .filter((version: FakeVersion): boolean => {
          return (
            version.projectId === String(data.query["projectId"]) &&
            version.configId === String(data.query["hostCollectorConfigId"]) &&
            version.configHash === data.query["configHash"]
          );
        })
        .sort((a: FakeVersion, b: FakeVersion): number => {
          return b.versionNumber - a.versionNumber;
        });
      if (!match[0]) {
        return null;
      }
      const model: HostCollectorConfigVersion =
        new HostCollectorConfigVersion();
      model._id = match[0].id;
      return model;
    });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return cache.get(`${namespace}:${key}`) ?? null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        cache.set(`${namespace}:${key}`, value);
      },
    );
  jest
    .spyOn(GlobalCache, "getJSONObject")
    .mockImplementation(async (namespace: string, key: string) => {
      const value: string | undefined = cache.get(`${namespace}:${key}`);
      return value ? (JSON.parse(value) as JSONObject) : null;
    });
  jest
    .spyOn(GlobalCache, "setJSON")
    .mockImplementation(
      async (namespace: string, key: string, value: JSONObject) => {
        cache.set(`${namespace}:${key}`, JSON.stringify(value));
      },
    );
  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      cache.delete(`${namespace}:${key}`);
    });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now);
  });
}

const DESCRIPTION: OpAmpAgentDescription = {
  identifyingAttributes: [
    { key: "service.name", value: { stringValue: "otelcol-contrib" } },
    { key: "service.version", value: { stringValue: "0.161.0" } },
  ],
  nonIdentifyingAttributes: [
    { key: "host.name", value: { stringValue: "Web-1" } },
    { key: "os.type", value: { stringValue: "linux" } },
    { key: "host.arch", value: { stringValue: "amd64" } },
    { key: "oneuptime.label.env", value: { stringValue: "production" } },
    { key: "oneuptime.host.journald", value: { stringValue: "true" } },
    { key: "oneuptime.host.systemd", value: { stringValue: "false" } },
  ],
};

async function post(
  data: {
    projectId?: ObjectID;
    instanceUid?: Uint8Array;
    sequenceNum?: number;
    description?: OpAmpAgentDescription;
    status?: OpAmpRemoteConfigStatus;
    hash?: string;
    errorMessage?: string;
  } = {},
): Promise<OpAmpServerToAgent> {
  const result: HostCollectorMessageResult =
    await HostCollectorAgent.handleMessage({
      projectId: data.projectId || PROJECT,
      body: OpAmpCodec.encodeAgentToServer({
        instanceUid: data.instanceUid || INSTANCE_ONE,
        sequenceNum: data.sequenceNum ?? 1,
        agentDescription: data.description,
        remoteConfigStatus:
          data.status === undefined && !data.hash
            ? undefined
            : {
                ...(data.hash
                  ? {
                      lastRemoteConfigHash: new Uint8Array(
                        hostCollectorConfigHashToBytes(data.hash),
                      ),
                    }
                  : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
                ...(data.errorMessage
                  ? { errorMessage: data.errorMessage }
                  : {}),
              },
      }),
    });

  expect(result.isBadRequest).toBe(false);
  return OpAmpCodec.decodeServerToAgent(result.body);
}

function sentYaml(response: OpAmpServerToAgent): string | null {
  const body: Uint8Array | undefined =
    response.remoteConfig?.config.configMap[""]?.body;
  return body ? Buffer.from(body).toString("utf8") : null;
}

function sentHash(response: OpAmpServerToAgent): string | null {
  return response.remoteConfig
    ? Buffer.from(response.remoteConfig.configHash).toString("hex")
    : null;
}

// A new install: registers, then reports it runs what it was sent.
async function installAndApply(): Promise<{ hash: string }> {
  const first: OpAmpServerToAgent = await post({
    sequenceNum: 0,
    description: DESCRIPTION,
  });
  const hash: string = sentHash(first) as string;
  await post({ status: OpAmpRemoteConfigStatus.Applied, hash });
  return { hash };
}

beforeEach(() => {
  hosts = [];
  hostNameMemo = new Map<string, string>();
  configs = [];
  versions = [];
  labelIdsByName = new Map<string, string>();
  cache = new Map<string, string>();
  writes = [];
  versionQueries = [];
  now = Date.UTC(2026, 9, 21, 8, 0, 0);
  failNextWrite = false;
  nextId = 0;
  HostCollectorProjectConfigsMemo.clear();
  installFakes();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a host's first message", () => {
  test("files the host under its name before any telemetry, and sends the default for what the installer found", async () => {
    const response: OpAmpServerToAgent = await post({
      sequenceNum: 0,
      description: DESCRIPTION,
    });

    expect(hosts.length).toBe(1);
    const host: FakeHost = hosts[0]!;
    // Named as the collector's own telemetry names it, so both land on one host.
    expect(host.hostIdentifier).toBe("web-1");
    expect(host.registeredByCollectorManagement).toBe(true);

    expect(sentYaml(response)).toBe(
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
        journald: true,
        systemd: false,
      }),
    );

    expect(writes.length).toBe(1);
    expect(writes[0]!.data).toMatchObject({
      osType: "linux",
      hostArch: "amd64",
      agentVersion: "0.161.0",
      collectorHostFeatures: "journald",
      collectorInstanceUid: "01020304-0506-0708-090a-0b0c0d0e0f10",
      collectorConfigStatus: HostCollectorConfigStatus.Waiting,
    });
    expect(writes[0]!.data["collectorRegisteredAt"]).toEqual(new Date(now));
    expect(writes[0]!.data["collectorLastContactAt"]).toEqual(new Date(now));
  });

  test("labels the host with the labels it was installed with", async () => {
    await post({ sequenceNum: 0, description: DESCRIPTION });

    expect(hosts[0]!.labelIds).toEqual([labelIdsByName.get("env:production")]);
  });

  test("a message with no host name in its description is refused", async () => {
    const response: OpAmpServerToAgent = await post({
      sequenceNum: 0,
      description: {
        nonIdentifyingAttributes: [
          { key: "os.type", value: { stringValue: "linux" } },
        ],
      },
    });

    expect(response.errorResponse?.type).toBe(
      OpAmpServerErrorResponseType.BadRequest,
    );
    expect(response.errorResponse?.errorMessage).toContain("host.name");
    expect(hosts).toEqual([]);
  });

  test("an instance OneUptime has never seen, sending only its id, is asked for everything", async () => {
    const response: OpAmpServerToAgent = await post({});

    expect(response.flags).toBe(OpAmpServerToAgentFlag.ReportFullState);
    expect(response.remoteConfig).toBeUndefined();
    expect(hosts).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("an instance id that is not 16 bytes is refused", async () => {
    const response: OpAmpServerToAgent = await post({
      instanceUid: new Uint8Array([1, 2, 3]),
      description: DESCRIPTION,
    });

    expect(response.errorResponse?.errorMessage).toBe(
      "instance_uid must be 16 bytes.",
    );
    expect(hosts).toEqual([]);
  });

  test("bytes that are not an OpAMP message are a bad request", async () => {
    const result: HostCollectorMessageResult =
      await HostCollectorAgent.handleMessage({
        projectId: PROJECT,
        body: new Uint8Array([0xff, 0xff, 0xff]),
      });

    expect(result.isBadRequest).toBe(true);
    expect(
      OpAmpCodec.decodeServerToAgent(result.body).errorResponse?.errorMessage,
    ).toBe("The request is not an OpAMP AgentToServer message.");
  });
});

describe("polls that say nothing new", () => {
  test("write nothing and send nothing", async () => {
    await installAndApply();
    const before: number = writes.length;

    now += 30 * 1000;
    const response: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: hostsHash(),
    });

    expect(response.remoteConfig).toBeUndefined();
    expect(writes.length).toBe(before);
  });

  test("an instance that sends only its id is found again from the cache, or from the host", async () => {
    await installAndApply();

    expect(sentYaml(await post({}))).toBeNull();

    // Redis lost everything: the host is read by its instance.
    cache.clear();
    const response: OpAmpServerToAgent = await post({});
    expect(response.flags).toBeUndefined();
    expect(response.errorResponse).toBeUndefined();
  });

  test("last contact is written every few minutes, without touching updatedAt", async () => {
    await installAndApply();
    const before: number = writes.length;

    now += HOST_COLLECTOR_LAST_CONTACT_WRITE_INTERVAL_MS;
    await post({ status: OpAmpRemoteConfigStatus.Applied, hash: hostsHash() });

    expect(writes.length).toBe(before + 1);
    expect(writes[before]!.data).toEqual({
      collectorLastContactAt: new Date(now),
    });
    expect(writes[before]!.skipUpdateDateColumn).toBe(true);
  });

  test("the host is read again once its cached state is dropped, and still answered the same", async () => {
    await installAndApply();
    cache.clear();

    const response: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: hostsHash(),
    });

    expect(response.remoteConfig).toBeUndefined();
  });
});

function hostsHash(): string {
  return hosts[0]!.columns["collectorConfigHash"] as string;
}

describe("the config a host runs", () => {
  test("a Collector Config for its labels replaces the default, and the version it runs is recorded", async () => {
    await installAndApply();

    const config: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# production\n`,
      labelIds: [labelIdsByName.get("env:production")!],
    });
    const version: FakeVersion = addVersion(config, 1);

    const response: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: hostsHash(),
    });

    expect(sentYaml(response)).toBe(config.configYaml);
    expect(hosts[0]!.columns["collectorConfigId"]).toEqual(
      new ObjectID(config.id),
    );

    await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: version.configHash,
    });

    expect(hosts[0]!.columns["collectorConfigHash"]).toBe(version.configHash);
    expect(hosts[0]!.columns["collectorConfigVersionId"]).toEqual(
      new ObjectID(version.id),
    );
    expect(hosts[0]!.columns["collectorConfigStatus"]).toBe(
      HostCollectorConfigStatus.Applied,
    );
  });

  test("the version is looked up in the host's own project and config only", async () => {
    await installAndApply();

    const yaml: string = `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# shared\n`;
    const config: FakeConfig = addConfig({ configYaml: yaml });

    // Another project, and another config of this one, hold the same YAML.
    addVersion(
      { ...config, id: newId(), projectId: OTHER_PROJECT.toString() },
      7,
    );
    addVersion({ ...config, id: newId() }, 9);
    const own: FakeVersion = addVersion(config, 2);

    await post({ status: OpAmpRemoteConfigStatus.Applied, hash: hostsHash() });
    await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: own.configHash,
    });

    expect(hosts[0]!.columns["collectorConfigVersionId"]).toEqual(
      new ObjectID(own.id),
    );
    for (const query of versionQueries) {
      expect(String(query["projectId"])).toBe(PROJECT.toString());
      expect(String(query["hostCollectorConfigId"])).toBe(config.id);
    }
  });

  test("a host that still runs the old config shows no version of the new one", async () => {
    const old: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# old\n`,
    });
    const oldVersion: FakeVersion = addVersion(old, 4);

    await post({ sequenceNum: 0, description: DESCRIPTION });
    await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: oldVersion.configHash,
    });
    expect(hosts[0]!.columns["collectorConfigVersionId"]).toEqual(
      new ObjectID(oldVersion.id),
    );

    // A narrower config goes first in the list.
    const newer: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# new\n`,
      order: -1,
    });
    addVersion(newer, 1);

    const response: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: oldVersion.configHash,
    });

    expect(sentYaml(response)).toBe(newer.configYaml);
    expect(hosts[0]!.columns["collectorConfigId"]).toEqual(
      new ObjectID(newer.id),
    );
    expect(hosts[0]!.columns["collectorConfigVersionId"]).toBeNull();
  });

  test("a host on a default runs no version", async () => {
    await installAndApply();

    expect(hosts[0]!.columns["collectorConfigVersionId"]).toBeUndefined();
    expect(versionQueries).toEqual([]);
  });

  test("a config picked for the host wins over the list", async () => {
    await installAndApply();
    const listed: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# listed\n`,
    });
    const picked: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Any)}# picked\n`,
      osType: HostCollectorOsType.Any,
    });

    hosts[0]!.columns["collectorConfigId"] = new ObjectID(picked.id);
    hosts[0]!.columns["isCollectorConfigPinned"] = true;
    cache.clear();

    const response: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: hostsHash(),
    });

    expect(sentYaml(response)).toBe(picked.configYaml);
    expect(sentYaml(response)).not.toBe(listed.configYaml);
  });

  test("a host whose picked config was deleted goes back to the list, and says so", async () => {
    await installAndApply();
    const listed: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# listed\n`,
    });

    hosts[0]!.columns["collectorConfigId"] = new ObjectID(newId());
    hosts[0]!.columns["isCollectorConfigPinned"] = true;
    cache.clear();

    const response: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: hostsHash(),
    });

    expect(sentYaml(response)).toBe(listed.configYaml);
    expect(hosts[0]!.columns["isCollectorConfigPinned"]).toBe(false);
    expect(hosts[0]!.columns["collectorConfigId"]).toEqual(
      new ObjectID(listed.id),
    );
  });

  test("a host OneUptime knows nothing about reads host metrics only", async () => {
    const response: OpAmpServerToAgent = await post({
      sequenceNum: 0,
      description: {
        identifyingAttributes: [],
        nonIdentifyingAttributes: [
          { key: "host.name", value: { stringValue: "bare" } },
          { key: "os.type", value: { stringValue: "linux" } },
        ],
      },
    });

    expect(sentYaml(response)).toBe(
      getHostCollectorDefaultConfig(
        HostCollectorOsType.Linux,
        UNKNOWN_HOST_FEATURES,
      ),
    );
    expect(sentYaml(response)).not.toBe(
      getHostCollectorDefaultConfig(
        HostCollectorOsType.Linux,
        ALL_HOST_FEATURES,
      ),
    );
  });
});

describe("a config that fails on a host", () => {
  test("is recorded with the collector's reason, and not sent again until Try again", async () => {
    await installAndApply();
    const config: FakeConfig = addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# broken on this host\n`,
    });
    const good: string = hostsHash();

    const sent: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: good,
    });
    const failedHash: string = sentHash(sent) as string;

    await post({
      status: OpAmpRemoteConfigStatus.Failed,
      hash: failedHash,
      errorMessage: "open /var/log/app.log: permission denied",
    });

    expect(hosts[0]!.columns).toMatchObject({
      collectorConfigStatus: HostCollectorConfigStatus.Failed,
      collectorFailedConfigHash: failedHash,
      collectorConfigError: "open /var/log/app.log: permission denied",
    });

    // Rolled back: the host runs the last config that worked, and is left alone.
    now += 30 * 1000;
    const again: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: good,
    });
    expect(again.remoteConfig).toBeUndefined();

    // Try again: the failure is cleared on the host, and HostService drops its cache.
    hosts[0]!.columns["collectorFailedConfigHash"] = null;
    cache.clear();

    const retried: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: good,
    });
    expect(sentYaml(retried)).toBe(config.configYaml);
  });

  test("a reinstall forgets the failure and gets its config", async () => {
    await installAndApply();
    addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# broken\n`,
    });
    const sent: OpAmpServerToAgent = await post({
      status: OpAmpRemoteConfigStatus.Applied,
      hash: hostsHash(),
    });
    await post({
      status: OpAmpRemoteConfigStatus.Failed,
      hash: sentHash(sent) as string,
      errorMessage: "boom",
    });

    const fresh: OpAmpServerToAgent = await post({
      instanceUid: INSTANCE_TWO,
      sequenceNum: 0,
      description: DESCRIPTION,
    });

    expect(sentHash(fresh)).toBe(sentHash(sent));
    expect(hosts.length).toBe(1);
    expect(hosts[0]!.columns["collectorInstanceUid"]).toBe(
      "09090909-0909-0909-0909-090909090901",
    );
    expect(hosts[0]!.columns["collectorFailedConfigHash"]).toBeNull();
  });
});

describe("one host per project", () => {
  test("the same host name in two projects is two hosts, each with its own configs", async () => {
    addConfig({
      configYaml: `${getHostCollectorDefaultConfig(HostCollectorOsType.Linux)}# project two\n`,
      projectId: OTHER_PROJECT.toString(),
    });

    const own: OpAmpServerToAgent = await post({
      sequenceNum: 0,
      description: DESCRIPTION,
    });
    const other: OpAmpServerToAgent = await post({
      projectId: OTHER_PROJECT,
      instanceUid: INSTANCE_TWO,
      sequenceNum: 0,
      description: DESCRIPTION,
    });

    expect(hosts.length).toBe(2);
    expect(sentYaml(own)).toBe(
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
        journald: true,
        systemd: false,
      }),
    );
    expect(sentYaml(other)).toContain("# project two");
  });

  test("an instance seen in one project is not found from another", async () => {
    await installAndApply();

    const response: OpAmpServerToAgent = await post({
      projectId: OTHER_PROJECT,
    });

    expect(response.flags).toBe(OpAmpServerToAgentFlag.ReportFullState);
  });
});

describe("a host deleted while its collector runs", () => {
  // As HostService does when a host is deleted: its state is dropped.
  function deleteTheHost(): string {
    const deleted: FakeHost = hosts[0]!;
    hosts = [];
    cache.delete(`host-collector-state:${deleted.id}`);
    return deleted.id;
  }

  test("an instance that sends only its id is asked for everything, and forgotten", async () => {
    await installAndApply();
    deleteTheHost();

    const response: OpAmpServerToAgent = await post({});

    expect(response.flags).toBe(OpAmpServerToAgentFlag.ReportFullState);
    expect(
      [...cache.keys()].some((key: string): boolean => {
        return key.startsWith("host-collector-instance:");
      }),
    ).toBe(false);
  });

  test("its next full report files it anew at once, though its name was remembered", async () => {
    await installAndApply();
    const deletedId: string = deleteTheHost();

    const response: OpAmpServerToAgent = await post({
      sequenceNum: 7,
      description: DESCRIPTION,
      status: OpAmpRemoteConfigStatus.Applied,
      hash: getHostCollectorConfigHash(
        getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
          journald: true,
          systemd: false,
        }),
      ),
    });

    expect(response.flags).toBeUndefined();
    expect(hosts.length).toBe(1);
    expect(hosts[0]!.id).not.toBe(deletedId);
    expect(hosts[0]!.hostIdentifier).toBe("web-1");
    expect(hosts[0]!.columns["collectorInstanceUid"]).toBe(
      "01020304-0506-0708-090a-0b0c0d0e0f10",
    );
  });
});

describe("when the host cannot be written", () => {
  test("the host still gets its config, and its next poll writes again", async () => {
    failNextWrite = true;

    const response: OpAmpServerToAgent = await post({
      sequenceNum: 0,
      description: DESCRIPTION,
    });

    expect(sentYaml(response)).not.toBeNull();
    expect(
      [...cache.keys()].some((key: string): boolean => {
        return key.startsWith("host-collector-state:");
      }),
    ).toBe(false);

    await post({ sequenceNum: 1, description: DESCRIPTION });
    expect(hosts[0]!.columns["collectorInstanceUid"]).toBe(
      "01020304-0506-0708-090a-0b0c0d0e0f10",
    );
  });
});

describe("a host's state between polls", () => {
  test("is kept as JSON and read back the same", () => {
    const snapshot: HostCollectorSnapshot = {
      hostId: "host-1",
      osType: HostCollectorOsType.Windows,
      hostArch: "amd64",
      agentVersion: "0.161.0",
      labelIds: ["a", "b"],
      hostFeatures: "",
      instanceUid: "uid",
      configId: "config-1",
      isConfigPinned: true,
      versionId: "version-1",
      lastContactAt: 1234,
      state: {
        configHash: "hash",
        configStatus: HostCollectorConfigStatus.Failed,
        failedConfigHash: "failed",
        configError: "boom",
        isHealthy: false,
        healthError: "bad",
      },
    };

    expect(
      HostCollectorAgent.snapshotFromJSON(
        JSON.parse(
          JSON.stringify(HostCollectorAgent.snapshotToJSON(snapshot)),
        ) as JSONObject,
      ),
    ).toEqual(snapshot);
  });

  test("anything unreadable in it is read as nothing", () => {
    expect(HostCollectorAgent.snapshotFromJSON({})).toBeNull();
    expect(
      HostCollectorAgent.snapshotFromJSON({
        hostId: "h",
        osType: "plan9",
        labelIds: [1, "a"],
        configStatus: "exploded",
        isHealthy: "yes",
        lastContactAt: "yesterday",
        isConfigPinned: "true",
      }),
    ).toMatchObject({
      hostId: "h",
      osType: null,
      labelIds: ["a"],
      isConfigPinned: false,
      lastContactAt: null,
      state: { configStatus: null, isHealthy: null },
    });
  });
});
