import OpAmpCodec, {
  ONEUPTIME_OPAMP_SERVER_CAPABILITIES,
  OpAmpAgentToServer,
  OpAmpRemoteConfigStatus,
  OpAmpServerErrorResponseType,
  OpAmpServerToAgent,
  OpAmpServerToAgentFlag,
} from "../../../../Server/Utils/HostCollector/OpAmp/OpAmpCodec";
import {
  DesiredHostCollectorConfig,
  HOST_FEATURE_JOURNALD_ATTRIBUTE,
  HOST_FEATURE_SYSTEMD_ATTRIBUTE,
  HostCollectorAgentState,
  OpAmpExchangeResult,
  applyHostCollectorReport,
  describeHostCollectorAgent,
  exchangeWithHostCollector,
  getOpAmpErrorResponse,
  getOpAmpInstanceUidText,
  getOpAmpRemoteConfig,
  getReportFullStateResponse,
  hasNoHostCollectorConfig,
  isNewHostCollectorRun,
  shouldSendHostCollectorConfig,
  truncateHostCollectorText,
} from "../../../../Server/Utils/HostCollector/OpAmp/OpAmpExchange";
import {
  getHostCollectorConfigHash,
  hostCollectorConfigHashToBytes,
} from "../../../../Server/Utils/HostCollector/HostCollectorConfigHash";
import {
  HOST_COLLECTOR_ERROR_MAX_LENGTH,
  HostCollectorConfigStatus,
  HostCollectorOsType,
} from "../../../../Types/HostCollector/HostCollector";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What OneUptime makes of one message from a host's OpAMP supervisor: the
 * host's new state, and whether the answer carries the config. A host gets
 * the config it should run until it runs it; a config that failed there is
 * not sent again until it changes or someone selects Try again; a fresh
 * install gets its config whatever failed on the host before.
 */

const INSTANCE: Uint8Array = new Uint8Array([
  0x01, 0x8f, 0x2b, 0x3c, 0x4d, 0x5e, 0x7f, 0x80, 0x91, 0xa2, 0xb3, 0xc4, 0xd5,
  0xe6, 0xf7, 0x08,
]);

const CONFIG_A: string = "# config A\nreceivers: {}\n";
const CONFIG_B: string = "# config B\nreceivers: {}\n";
const HASH_A: string = getHostCollectorConfigHash(CONFIG_A);
const HASH_B: string = getHostCollectorConfigHash(CONFIG_B);

const DESIRED_A: DesiredHostCollectorConfig = {
  configYaml: CONFIG_A,
  configHash: HASH_A,
};
const DESIRED_B: DesiredHostCollectorConfig = {
  configYaml: CONFIG_B,
  configHash: HASH_B,
};

const FRESH: HostCollectorAgentState = {
  configHash: null,
  configStatus: null,
  failedConfigHash: null,
  configError: null,
  isHealthy: null,
  healthError: null,
};

function hashBytes(hash: string): Uint8Array {
  return new Uint8Array(hostCollectorConfigHashToBytes(hash));
}

// A message as it arrives: encoded by the supervisor, decoded by OneUptime.
function message(data: {
  sequenceNum?: number;
  status?: OpAmpRemoteConfigStatus;
  hash?: string | null;
  errorMessage?: string;
  health?: { healthy: boolean; lastError?: string };
  disconnect?: boolean;
  noStatus?: boolean;
  description?: Parameters<
    typeof OpAmpCodec.encodeAgentToServer
  >[0]["agentDescription"];
}): OpAmpAgentToServer {
  return OpAmpCodec.decodeAgentToServer(
    OpAmpCodec.encodeAgentToServer({
      instanceUid: INSTANCE,
      sequenceNum: data.sequenceNum ?? 5,
      agentDescription: data.description,
      health: data.health,
      remoteConfigStatus: data.noStatus
        ? undefined
        : {
            ...(data.hash
              ? { lastRemoteConfigHash: hashBytes(data.hash) }
              : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
          },
      agentDisconnect: data.disconnect ? {} : undefined,
    }),
  );
}

function sentYaml(response: OpAmpServerToAgent): string | null {
  const body: Uint8Array | undefined =
    response.remoteConfig?.config.configMap[""]?.body;
  return body ? Buffer.from(body).toString("utf8") : null;
}

describe("OpAMP messages", () => {
  test("an AgentToServer survives the trip from supervisor to OneUptime", () => {
    const decoded: OpAmpAgentToServer = OpAmpCodec.decodeAgentToServer(
      OpAmpCodec.encodeAgentToServer({
        instanceUid: INSTANCE,
        sequenceNum: 7,
        capabilities: 0x3807,
        agentDescription: {
          identifyingAttributes: [
            { key: "service.version", value: { stringValue: "0.161.0" } },
          ],
          nonIdentifyingAttributes: [
            { key: "host.name", value: { stringValue: "web-1" } },
          ],
        },
        health: { healthy: false, lastError: "boom" },
        remoteConfigStatus: {
          lastRemoteConfigHash: hashBytes(HASH_A),
          status: OpAmpRemoteConfigStatus.Failed,
          errorMessage: "invalid config",
        },
      }),
    );

    expect(Buffer.from(decoded.instanceUid!)).toEqual(Buffer.from(INSTANCE));
    expect(decoded.sequenceNum).toBe("7");
    expect(decoded.capabilities).toBe("14343");
    expect(decoded.health).toEqual({ healthy: false, lastError: "boom" });
    expect(decoded.remoteConfigStatus?.status).toBe(
      OpAmpRemoteConfigStatus.Failed,
    );
    expect(decoded.remoteConfigStatus?.errorMessage).toBe("invalid config");
    expect(
      decoded.agentDescription?.nonIdentifyingAttributes?.[0]?.value
        ?.stringValue,
    ).toBe("web-1");
  });

  test("a ServerToAgent with a config survives the trip to the supervisor", () => {
    const response: OpAmpServerToAgent = {
      instanceUid: INSTANCE,
      capabilities: ONEUPTIME_OPAMP_SERVER_CAPABILITIES,
      remoteConfig: getOpAmpRemoteConfig(DESIRED_A),
    };

    const decoded: OpAmpServerToAgent = OpAmpCodec.decodeServerToAgent(
      OpAmpCodec.encodeServerToAgent(response),
    );

    expect(sentYaml(decoded)).toBe(CONFIG_A);
    expect(decoded.remoteConfig?.config.configMap[""]?.contentType).toBe(
      "text/yaml",
    );
    expect(Buffer.from(decoded.remoteConfig!.configHash).toString("hex")).toBe(
      HASH_A,
    );
    expect(decoded.capabilities).toBe(ONEUPTIME_OPAMP_SERVER_CAPABILITIES);
  });

  test("bytes that are not an AgentToServer are refused", () => {
    expect(() => {
      OpAmpCodec.decodeAgentToServer(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    }).toThrow();
  });

  test("OneUptime takes status reports and the effective config, and offers remote config", () => {
    // AcceptsStatus | OffersRemoteConfig | AcceptsEffectiveConfig
    expect(ONEUPTIME_OPAMP_SERVER_CAPABILITIES).toBe(0x1 | 0x2 | 0x4);
  });

  test("the proto files are the OpAMP specification's, unchanged", () => {
    const dir: string = path.join(
      __dirname,
      "../../../../Server/Utils/HostCollector/OpAmp/Proto",
    );
    const opamp: string = fs.readFileSync(
      path.join(dir, "opamp.proto"),
      "utf8",
    );
    const anyvalue: string = fs.readFileSync(
      path.join(dir, "anyvalue.proto"),
      "utf8",
    );

    expect(opamp).toContain("package opamp.proto;");
    expect(opamp).toContain("message AgentToServer {");
    expect(opamp).toContain("message ServerToAgent {");
    expect(opamp).toContain("bytes config_hash = 2;");
    expect(anyvalue).toContain("message AnyValue {");
  });
});

describe("what a supervisor says about where it runs", () => {
  test("its host, system, architecture, collector release, labels and what the installer found", () => {
    const description: ReturnType<typeof describeHostCollectorAgent> =
      describeHostCollectorAgent(
        message({
          description: {
            identifyingAttributes: [
              { key: "service.name", value: { stringValue: "otelcol" } },
              { key: "service.version", value: { stringValue: "0.161.0" } },
            ],
            nonIdentifyingAttributes: [
              { key: "host.name", value: { stringValue: "  web-1  " } },
              { key: "os.type", value: { stringValue: "darwin" } },
              { key: "host.arch", value: { stringValue: "arm64" } },
              { key: "os.description", value: { stringValue: "macOS 15" } },
              {
                key: "oneuptime.label.env",
                value: { stringValue: "production" },
              },
              { key: "oneuptime.label.team", value: { stringValue: "web" } },
              {
                key: HOST_FEATURE_JOURNALD_ATTRIBUTE,
                value: { stringValue: "true" },
              },
              {
                key: HOST_FEATURE_SYSTEMD_ATTRIBUTE,
                value: { stringValue: "false" },
              },
            ],
          },
        }),
      );

    expect(description).toEqual({
      hostName: "web-1",
      osType: HostCollectorOsType.MacOS,
      hostArch: "arm64",
      osDescription: "macOS 15",
      collectorVersion: "0.161.0",
      labelNames: ["env:production", "team:web"],
      hostFeatures: { journald: true, systemd: false },
    });
  });

  test("a message that says nothing about where it runs has no description", () => {
    expect(describeHostCollectorAgent(message({}))).toBeNull();
  });

  test("blank values are none, and a supervisor OneUptime did not set up reports no features", () => {
    const description: ReturnType<typeof describeHostCollectorAgent> =
      describeHostCollectorAgent(
        message({
          description: {
            nonIdentifyingAttributes: [
              { key: "host.name", value: { stringValue: "   " } },
              { key: "os.type", value: { stringValue: "freebsd" } },
            ],
          },
        }),
      );

    expect(description?.hostName).toBeNull();
    expect(description?.osType).toBeNull();
    expect(description?.labelNames).toEqual([]);
    expect(description?.hostFeatures).toBeNull();
  });

  test("the host is read from what is not identifying, the release from what is", () => {
    const description: ReturnType<typeof describeHostCollectorAgent> =
      describeHostCollectorAgent(
        message({
          description: {
            identifyingAttributes: [
              { key: "host.name", value: { stringValue: "spoofed" } },
            ],
            nonIdentifyingAttributes: [
              { key: "service.version", value: { stringValue: "9.9.9" } },
            ],
          },
        }),
      );

    expect(description?.hostName).toBeNull();
    expect(description?.collectorVersion).toBeNull();
  });
});

describe("whether a supervisor holds a config", () => {
  test("no status, or an empty one, says it holds none", () => {
    expect(hasNoHostCollectorConfig(message({ noStatus: true }))).toBe(true);
    expect(hasNoHostCollectorConfig(message({}))).toBe(true);
    expect(
      hasNoHostCollectorConfig(
        message({ status: OpAmpRemoteConfigStatus.Unset }),
      ),
    ).toBe(true);
  });

  test("a hash or a status says it holds one", () => {
    expect(hasNoHostCollectorConfig(message({ hash: HASH_A }))).toBe(false);
    expect(
      hasNoHostCollectorConfig(
        message({ status: OpAmpRemoteConfigStatus.Applied, hash: HASH_A }),
      ),
    ).toBe(false);
  });

  test("a new run is the first message of a supervisor that holds no config", () => {
    expect(isNewHostCollectorRun(message({ sequenceNum: 0 }))).toBe(true);
    expect(isNewHostCollectorRun(message({ sequenceNum: 3 }))).toBe(false);
    expect(
      isNewHostCollectorRun(
        message({
          sequenceNum: 0,
          status: OpAmpRemoteConfigStatus.Applied,
          hash: HASH_A,
        }),
      ),
    ).toBe(false);
  });
});

describe("the host's state after a report", () => {
  test("Applied: the host runs that config", () => {
    expect(
      applyHostCollectorReport({
        state: FRESH,
        message: message({
          status: OpAmpRemoteConfigStatus.Applied,
          hash: HASH_A,
        }),
        desiredConfigHash: HASH_A,
      }),
    ).toEqual({
      ...FRESH,
      configHash: HASH_A,
      configStatus: HostCollectorConfigStatus.Applied,
    });
  });

  test("Applying: the host is starting the collector with it", () => {
    expect(
      applyHostCollectorReport({
        state: FRESH,
        message: message({
          status: OpAmpRemoteConfigStatus.Applying,
          hash: HASH_A,
        }),
        desiredConfigHash: HASH_A,
      }),
    ).toMatchObject({
      configHash: HASH_A,
      configStatus: HostCollectorConfigStatus.Applying,
    });
  });

  test("Failed: the config and the collector's reason are kept, and the host still runs the last one that worked", () => {
    const state: HostCollectorAgentState = applyHostCollectorReport({
      state: {
        ...FRESH,
        configHash: HASH_A,
        configStatus: HostCollectorConfigStatus.Applied,
      },
      message: message({
        status: OpAmpRemoteConfigStatus.Failed,
        hash: HASH_B,
        errorMessage: "open /var/log/app.log: permission denied",
      }),
      desiredConfigHash: HASH_B,
    });

    expect(state).toEqual({
      ...FRESH,
      configHash: HASH_A,
      configStatus: HostCollectorConfigStatus.Failed,
      failedConfigHash: HASH_B,
      configError: "open /var/log/app.log: permission denied",
    });
  });

  test("a failure with no reason says the config did not start", () => {
    expect(
      applyHostCollectorReport({
        state: FRESH,
        message: message({
          status: OpAmpRemoteConfigStatus.Failed,
          hash: HASH_B,
        }),
        desiredConfigHash: HASH_B,
      }).configError,
    ).toBe("The collector did not start with this config.");
  });

  test("a long reason is cut to what OneUptime keeps", () => {
    const error: string | null = applyHostCollectorReport({
      state: FRESH,
      message: message({
        status: OpAmpRemoteConfigStatus.Failed,
        hash: HASH_B,
        errorMessage: "x".repeat(HOST_COLLECTOR_ERROR_MAX_LENGTH * 3),
      }),
      desiredConfigHash: HASH_B,
    }).configError;

    expect(error?.length).toBe(HOST_COLLECTOR_ERROR_MAX_LENGTH + 1);
    expect(error?.endsWith("…")).toBe(true);
    expect(truncateHostCollectorText("short")).toBe("short");
    expect(truncateHostCollectorText("")).toBeNull();
    expect(truncateHostCollectorText(null)).toBeNull();
  });

  test("a host that applies the config it should run is no longer failed", () => {
    const failed: HostCollectorAgentState = {
      ...FRESH,
      configHash: HASH_A,
      configStatus: HostCollectorConfigStatus.Failed,
      failedConfigHash: HASH_B,
      configError: "boom",
    };

    expect(
      applyHostCollectorReport({
        state: failed,
        message: message({
          status: OpAmpRemoteConfigStatus.Applied,
          hash: HASH_B,
        }),
        desiredConfigHash: HASH_B,
      }),
    ).toEqual({
      ...FRESH,
      configHash: HASH_B,
      configStatus: HostCollectorConfigStatus.Applied,
    });
  });

  test("a host that keeps running the last config that worked stays failed", () => {
    const failed: HostCollectorAgentState = {
      ...FRESH,
      configHash: HASH_A,
      configStatus: HostCollectorConfigStatus.Failed,
      failedConfigHash: HASH_B,
      configError: "boom",
    };

    expect(
      applyHostCollectorReport({
        state: failed,
        message: message({
          status: OpAmpRemoteConfigStatus.Applied,
          hash: HASH_A,
        }),
        desiredConfigHash: HASH_B,
      }),
    ).toEqual(failed);
  });

  test("a new install forgets what failed on the host before", () => {
    expect(
      applyHostCollectorReport({
        state: {
          ...FRESH,
          configHash: HASH_A,
          configStatus: HostCollectorConfigStatus.Failed,
          failedConfigHash: HASH_B,
          configError: "boom",
        },
        message: message({ sequenceNum: 0 }),
        desiredConfigHash: HASH_B,
      }),
    ).toEqual({
      ...FRESH,
      configStatus: HostCollectorConfigStatus.Waiting,
    });
  });

  test("an empty status later in a run says the supervisor holds no config: it is sent one", () => {
    const state: HostCollectorAgentState = applyHostCollectorReport({
      state: {
        ...FRESH,
        configHash: HASH_A,
        configStatus: HostCollectorConfigStatus.Applied,
      },
      message: message({ sequenceNum: 9 }),
      desiredConfigHash: HASH_A,
    });

    expect(state.configHash).toBeNull();
    expect(shouldSendHostCollectorConfig({ state, desired: DESIRED_A })).toBe(
      true,
    );
  });

  test("health: healthy clears the error; unhealthy keeps the collector's", () => {
    expect(
      applyHostCollectorReport({
        state: { ...FRESH, isHealthy: false, healthError: "old" },
        message: message({ health: { healthy: true } }),
        desiredConfigHash: HASH_A,
      }),
    ).toMatchObject({ isHealthy: true, healthError: null });

    expect(
      applyHostCollectorReport({
        state: FRESH,
        message: message({
          health: { healthy: false, lastError: "exporter refused" },
        }),
        desiredConfigHash: HASH_A,
      }),
    ).toMatchObject({ isHealthy: false, healthError: "exporter refused" });
  });

  test("a supervisor that stops says so", () => {
    expect(
      applyHostCollectorReport({
        state: { ...FRESH, isHealthy: true },
        message: message({ disconnect: true, noStatus: true }),
        desiredConfigHash: HASH_A,
      }),
    ).toMatchObject({
      isHealthy: false,
      healthError: "The collector service stopped.",
    });
  });

  test("the state it was given is left as it was", () => {
    const state: HostCollectorAgentState = { ...FRESH };

    applyHostCollectorReport({
      state,
      message: message({
        status: OpAmpRemoteConfigStatus.Applied,
        hash: HASH_A,
      }),
      desiredConfigHash: HASH_A,
    });

    expect(state).toEqual(FRESH);
  });
});

describe("whether the answer carries the config", () => {
  test("a host that does not run the config yet is sent it", () => {
    expect(
      shouldSendHostCollectorConfig({ state: FRESH, desired: DESIRED_A }),
    ).toBe(true);
    expect(
      shouldSendHostCollectorConfig({
        state: { ...FRESH, configHash: HASH_B },
        desired: DESIRED_A,
      }),
    ).toBe(true);
  });

  test("a host that runs it, or is applying it, is not sent it again", () => {
    expect(
      shouldSendHostCollectorConfig({
        state: { ...FRESH, configHash: HASH_A },
        desired: DESIRED_A,
      }),
    ).toBe(false);
  });

  test("a config that failed on the host is not sent again", () => {
    expect(
      shouldSendHostCollectorConfig({
        state: { ...FRESH, configHash: HASH_B, failedConfigHash: HASH_A },
        desired: DESIRED_A,
      }),
    ).toBe(false);
  });
});

describe("one exchange", () => {
  test("a new install is sent its config at once", () => {
    const result: OpAmpExchangeResult = exchangeWithHostCollector({
      state: FRESH,
      message: message({ sequenceNum: 0 }),
      desired: DESIRED_A,
    });

    expect(result.sentConfigHash).toBe(HASH_A);
    expect(sentYaml(result.response)).toBe(CONFIG_A);
    expect(Buffer.from(result.response.instanceUid)).toEqual(
      Buffer.from(INSTANCE),
    );
    expect(result.response.capabilities).toBe(
      ONEUPTIME_OPAMP_SERVER_CAPABILITIES,
    );
    expect(result.state.configStatus).toBe(HostCollectorConfigStatus.Waiting);
  });

  test("a host that runs its config gets an answer with nothing in it", () => {
    const result: OpAmpExchangeResult = exchangeWithHostCollector({
      state: {
        ...FRESH,
        configHash: HASH_A,
        configStatus: HostCollectorConfigStatus.Applied,
      },
      message: message({
        status: OpAmpRemoteConfigStatus.Applied,
        hash: HASH_A,
      }),
      desired: DESIRED_A,
    });

    expect(result.sentConfigHash).toBeNull();
    expect(result.response.remoteConfig).toBeUndefined();
  });

  test("a changed config reaches a host that runs the old one", () => {
    const result: OpAmpExchangeResult = exchangeWithHostCollector({
      state: {
        ...FRESH,
        configHash: HASH_A,
        configStatus: HostCollectorConfigStatus.Applied,
      },
      message: message({
        status: OpAmpRemoteConfigStatus.Applied,
        hash: HASH_A,
      }),
      desired: DESIRED_B,
    });

    expect(sentYaml(result.response)).toBe(CONFIG_B);
  });

  test("a config that failed is not sent again, and a change to it is", () => {
    const failed: OpAmpExchangeResult = exchangeWithHostCollector({
      state: {
        ...FRESH,
        configHash: HASH_A,
        configStatus: HostCollectorConfigStatus.Applied,
      },
      message: message({
        status: OpAmpRemoteConfigStatus.Failed,
        hash: HASH_B,
        errorMessage: "boom",
      }),
      desired: DESIRED_B,
    });

    expect(failed.sentConfigHash).toBeNull();
    expect(failed.state.failedConfigHash).toBe(HASH_B);

    const fixed: DesiredHostCollectorConfig = {
      configYaml: `${CONFIG_B}# fixed\n`,
      configHash: getHostCollectorConfigHash(`${CONFIG_B}# fixed\n`),
    };
    const changed: OpAmpExchangeResult = exchangeWithHostCollector({
      state: failed.state,
      message: message({
        status: OpAmpRemoteConfigStatus.Applied,
        hash: HASH_A,
      }),
      desired: fixed,
    });

    expect(changed.sentConfigHash).toBe(fixed.configHash);
  });

  test("Try again: once the failure is cleared, the same config is sent once more", () => {
    const retried: OpAmpExchangeResult = exchangeWithHostCollector({
      state: {
        ...FRESH,
        configHash: HASH_A,
        configStatus: HostCollectorConfigStatus.Failed,
        // Cleared by Try again.
        failedConfigHash: null,
        configError: "boom",
      },
      message: message({
        status: OpAmpRemoteConfigStatus.Applied,
        hash: HASH_A,
      }),
      desired: DESIRED_B,
    });

    expect(retried.sentConfigHash).toBe(HASH_B);
  });

  test("a supervisor that is stopping is sent nothing new", () => {
    const result: OpAmpExchangeResult = exchangeWithHostCollector({
      state: FRESH,
      message: message({ disconnect: true }),
      desired: DESIRED_A,
    });

    expect(result.sentConfigHash).toBeNull();
    expect(result.response.remoteConfig).toBeUndefined();
  });

  test("every answer encodes as a ServerToAgent", () => {
    const result: OpAmpExchangeResult = exchangeWithHostCollector({
      state: FRESH,
      message: message({ sequenceNum: 0 }),
      desired: DESIRED_A,
    });

    expect(() => {
      OpAmpCodec.encodeServerToAgent(result.response);
    }).not.toThrow();
  });
});

describe("answers that carry no config", () => {
  test("a supervisor OneUptime cannot place is asked for everything", () => {
    const response: OpAmpServerToAgent = getReportFullStateResponse(INSTANCE);

    expect(response.flags).toBe(OpAmpServerToAgentFlag.ReportFullState);
    expect(
      OpAmpCodec.decodeServerToAgent(OpAmpCodec.encodeServerToAgent(response))
        .flags,
    ).toBe(1);
  });

  test("an error says what is wrong, as a bad request", () => {
    const response: OpAmpServerToAgent = getOpAmpErrorResponse({
      instanceUid: INSTANCE,
      message: "instance_uid must be 16 bytes.",
    });

    expect(
      OpAmpCodec.decodeServerToAgent(OpAmpCodec.encodeServerToAgent(response))
        .errorResponse,
    ).toEqual({
      type: OpAmpServerErrorResponseType.BadRequest,
      errorMessage: "instance_uid must be 16 bytes.",
    });
  });
});

describe("an instance's id", () => {
  test("is a UUID of its 16 bytes", () => {
    expect(getOpAmpInstanceUidText(INSTANCE)).toBe(
      "018f2b3c-4d5e-7f80-91a2-b3c4d5e6f708",
    );
  });

  test("of any other length is none", () => {
    expect(getOpAmpInstanceUidText(new Uint8Array(15))).toBeNull();
    expect(getOpAmpInstanceUidText(new Uint8Array(17))).toBeNull();
    expect(getOpAmpInstanceUidText(new Uint8Array())).toBeNull();
    expect(getOpAmpInstanceUidText(null)).toBeNull();
    expect(getOpAmpInstanceUidText(undefined)).toBeNull();
  });

  test("random ids read as distinct UUIDs", () => {
    const random: SeededRandom = seededRandom(16);
    const seen: Set<string> = new Set<string>();
    for (let index: number = 0; index < 50; index++) {
      const bytes: Uint8Array = new Uint8Array(16);
      for (let byte: number = 0; byte < bytes.length; byte++) {
        bytes[byte] = random(256);
      }
      const text: string | null = getOpAmpInstanceUidText(bytes);
      expect(text).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      seen.add(text as string);
    }
    expect(seen.size).toBe(50);
  });
});
