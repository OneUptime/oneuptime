import {
  HOST_COLLECTOR_ERROR_MAX_LENGTH,
  HOST_COLLECTOR_LABEL_ATTRIBUTE_PREFIX,
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorOsType,
} from "../../../../Types/HostCollector/HostCollector";
import { JSONArray } from "../../../../Types/JSON";
import { extractOneuptimeLabelNames } from "../../Telemetry/OneuptimeLabel";
import {
  HostCollectorHostFeatures,
  readHostCollectorHostFeatures,
} from "../../../../Utils/HostCollector/HostCollectorDefaultConfig";
import {
  hostCollectorConfigHashFromBytes,
  hostCollectorConfigHashToBytes,
} from "../HostCollectorConfigHash";
import {
  ONEUPTIME_OPAMP_SERVER_CAPABILITIES,
  OpAmpAgentToServer,
  OpAmpKeyValue,
  OpAmpRemoteConfigStatus,
  OpAmpServerErrorResponseType,
  OpAmpServerToAgent,
  OpAmpServerToAgentFlag,
} from "./OpAmpCodec";

/*
 * What OneUptime makes of one AgentToServer, without a database: the host's
 * new state, and what to answer. HostCollectorAgentService reads and writes
 * the host around it.
 *
 * The rules a host's config follows:
 *
 *   - A host is sent the config it should run (the desired config) whenever
 *     it does not have it yet: neither runs it nor is applying it.
 *   - A config that failed on a host is not sent to it again: the
 *     supervisor rolled the host back to the last config that worked there,
 *     and sending the failed one again would only fail again. A change to
 *     the config (a new hash) is sent; so is the same config once someone
 *     clears the failure (Try again).
 *   - A supervisor that starts with no config of its own (a new install)
 *     gets one whatever failed on that host before.
 */

export interface HostCollectorAgentState {
  // The hash of the config the host runs, or is applying.
  configHash: string | null;
  configStatus: HostCollectorConfigStatus | null;
  // A config that did not start on this host, which it is not sent again.
  failedConfigHash: string | null;
  configError: string | null;
  isHealthy: boolean | null;
  healthError: string | null;
}

export interface DesiredHostCollectorConfig {
  configYaml: string;
  configHash: string;
}

export interface HostCollectorAgentDescription {
  hostName: string | null;
  osType: HostCollectorOsType | null;
  hostArch: string | null;
  osDescription: string | null;
  // The collector's release, which is the host's agent version.
  collectorVersion: string | null;
  // env:production for oneuptime.label.env=production.
  labelNames: Array<string>;
  /*
   * What OneUptime's installer found on the host (oneuptime.host.journald,
   * oneuptime.host.systemd), or null when the supervisor did not say.
   */
  hostFeatures: HostCollectorHostFeatures | null;
}

// The attributes OneUptime's installer reports what it found on a host with.
export const HOST_FEATURE_JOURNALD_ATTRIBUTE: string =
  "oneuptime.host.journald";
export const HOST_FEATURE_SYSTEMD_ATTRIBUTE: string = "oneuptime.host.systemd";

export interface OpAmpExchangeResult {
  state: HostCollectorAgentState;
  response: OpAmpServerToAgent;
  // The hash of the config this answer sends, or null when it sends none.
  sentConfigHash: string | null;
}

// What the supervisor reports about where it runs.
export function describeHostCollectorAgent(
  message: OpAmpAgentToServer,
): HostCollectorAgentDescription | null {
  const description: OpAmpAgentToServer["agentDescription"] =
    message.agentDescription;

  if (!description) {
    return null;
  }

  const identifying: Array<OpAmpKeyValue> =
    description.identifyingAttributes || [];
  const nonIdentifying: Array<OpAmpKeyValue> =
    description.nonIdentifyingAttributes || [];

  const read: (
    attributes: Array<OpAmpKeyValue>,
    key: string,
  ) => string | null = (
    attributes: Array<OpAmpKeyValue>,
    key: string,
  ): string | null => {
    const attribute: OpAmpKeyValue | undefined = attributes.find(
      (item: OpAmpKeyValue): boolean => {
        return item.key === key;
      },
    );
    const value: string | undefined = attribute?.value?.stringValue;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  const labelAttributes: Array<OpAmpKeyValue> = nonIdentifying.filter(
    (item: OpAmpKeyValue): boolean => {
      return (
        typeof item.key === "string" &&
        item.key.startsWith(HOST_COLLECTOR_LABEL_ATTRIBUTE_PREFIX)
      );
    },
  );

  return {
    hostName: read(nonIdentifying, "host.name"),
    osType: getHostCollectorOsType(read(nonIdentifying, "os.type")),
    hostArch: read(nonIdentifying, "host.arch"),
    osDescription: read(nonIdentifying, "os.description"),
    collectorVersion: read(identifying, "service.version"),
    labelNames: extractOneuptimeLabelNames(
      labelAttributes as unknown as JSONArray,
    ),
    hostFeatures: readHostCollectorHostFeatures({
      journald: read(nonIdentifying, HOST_FEATURE_JOURNALD_ATTRIBUTE),
      systemd: read(nonIdentifying, HOST_FEATURE_SYSTEMD_ATTRIBUTE),
    }),
  };
}

/*
 * Whether the supervisor says it has no config at all: a remote config
 * status with no status and no hash (the empty status a supervisor without
 * stored state starts with), or none.
 */
export function hasNoHostCollectorConfig(message: OpAmpAgentToServer): boolean {
  const status: OpAmpAgentToServer["remoteConfigStatus"] =
    message.remoteConfigStatus;

  if (!status) {
    return true;
  }

  const hasHash: boolean = Boolean(
    status.lastRemoteConfigHash && status.lastRemoteConfigHash.length > 0,
  );

  return (
    !hasHash &&
    (status.status === undefined ||
      status.status === OpAmpRemoteConfigStatus.Unset)
  );
}

/*
 * Whether this is the first message of a supervisor run that has no config
 * of its own: a new install, or one whose storage was wiped. A supervisor
 * that starts with a config it ran before says so in its first message
 * (its remote config status), and every later message of a run counts on.
 */
export function isNewHostCollectorRun(message: OpAmpAgentToServer): boolean {
  const sequenceNum: string | undefined = message.sequenceNum;
  const isFirstMessage: boolean = !sequenceNum || sequenceNum === "0";
  return isFirstMessage && hasNoHostCollectorConfig(message);
}

// A string a host reported, cut to what OneUptime keeps.
export function truncateHostCollectorText(
  text: string | null | undefined,
): string | null {
  if (!text) {
    return null;
  }

  return text.length > HOST_COLLECTOR_ERROR_MAX_LENGTH
    ? `${text.substring(0, HOST_COLLECTOR_ERROR_MAX_LENGTH)}…`
    : text;
}

/*
 * The host's state once this message's reports are taken in: its remote
 * config status and its health.
 */
export function applyHostCollectorReport(data: {
  state: HostCollectorAgentState;
  message: OpAmpAgentToServer;
  desiredConfigHash: string | null;
}): HostCollectorAgentState {
  const state: HostCollectorAgentState = { ...data.state };
  const message: OpAmpAgentToServer = data.message;

  /*
   * A supervisor run that starts with no config of its own is new, or its
   * storage was wiped: what failed on this host before does not hold
   * against it, and it has no config yet.
   */
  if (isNewHostCollectorRun(message)) {
    state.configHash = null;
    state.failedConfigHash = null;
    state.configError = null;
    state.configStatus = HostCollectorConfigStatus.Waiting;
  }

  const status: OpAmpAgentToServer["remoteConfigStatus"] =
    message.remoteConfigStatus;

  /*
   * An empty status, whenever it comes, says the supervisor holds no config
   * from OneUptime: it is sent the one it should run.
   */
  if (status && hasNoHostCollectorConfig(message)) {
    state.configHash = null;
  }

  if (status) {
    const reportedHash: string | null = hostCollectorConfigHashFromBytes(
      status.lastRemoteConfigHash,
    );

    switch (status.status) {
      case OpAmpRemoteConfigStatus.Applied:
        state.configHash = reportedHash;
        if (
          reportedHash !== null &&
          (reportedHash === state.failedConfigHash ||
            reportedHash === data.desiredConfigHash)
        ) {
          state.failedConfigHash = null;
          state.configError = null;
        }
        state.configStatus = state.failedConfigHash
          ? HostCollectorConfigStatus.Failed
          : HostCollectorConfigStatus.Applied;
        break;

      case OpAmpRemoteConfigStatus.Applying:
        state.configHash = reportedHash;
        state.configStatus = HostCollectorConfigStatus.Applying;
        break;

      case OpAmpRemoteConfigStatus.Failed:
        state.failedConfigHash = reportedHash;
        state.configError =
          truncateHostCollectorText(status.errorMessage) ||
          "The collector did not start with this config.";
        state.configStatus = HostCollectorConfigStatus.Failed;
        break;

      default:
        break;
    }
  }

  if (message.health) {
    const isHealthy: boolean = message.health.healthy === true;
    state.isHealthy = isHealthy;
    state.healthError = isHealthy
      ? null
      : truncateHostCollectorText(message.health.lastError);
  }

  if (message.agentDisconnect) {
    state.isHealthy = false;
    state.healthError = "The collector service stopped.";
  }

  return state;
}

/*
 * Whether this answer sends the desired config: the host neither runs nor
 * is applying it, and it is not a config that failed on this host.
 */
export function shouldSendHostCollectorConfig(data: {
  state: HostCollectorAgentState;
  desired: DesiredHostCollectorConfig;
}): boolean {
  return (
    data.desired.configHash !== data.state.configHash &&
    data.desired.configHash !== data.state.failedConfigHash
  );
}

export function getOpAmpRemoteConfig(
  desired: DesiredHostCollectorConfig,
): NonNullable<OpAmpServerToAgent["remoteConfig"]> {
  return {
    config: {
      configMap: {
        "": {
          body: new Uint8Array(Buffer.from(desired.configYaml, "utf8")),
          contentType: "text/yaml",
        },
      },
    },
    configHash: new Uint8Array(
      hostCollectorConfigHashToBytes(desired.configHash),
    ),
  };
}

/*
 * One exchange: the host's new state and the answer, with the desired
 * config sent when the host needs it.
 */
export function exchangeWithHostCollector(data: {
  state: HostCollectorAgentState;
  message: OpAmpAgentToServer;
  desired: DesiredHostCollectorConfig;
}): OpAmpExchangeResult {
  const state: HostCollectorAgentState = applyHostCollectorReport({
    state: data.state,
    message: data.message,
    desiredConfigHash: data.desired.configHash,
  });

  const response: OpAmpServerToAgent = {
    instanceUid: data.message.instanceUid || new Uint8Array(),
    capabilities: ONEUPTIME_OPAMP_SERVER_CAPABILITIES,
  };

  // A supervisor that is stopping is not sent anything new.
  if (data.message.agentDisconnect) {
    return { state, response, sentConfigHash: null };
  }

  if (shouldSendHostCollectorConfig({ state, desired: data.desired })) {
    response.remoteConfig = getOpAmpRemoteConfig(data.desired);
    return { state, response, sentConfigHash: data.desired.configHash };
  }

  return { state, response, sentConfigHash: null };
}

/*
 * The answer to a supervisor OneUptime cannot place yet - it sent only its
 * instance and nothing to say which host it is on: tell it to send
 * everything, which it does with its next message.
 */
export function getReportFullStateResponse(
  instanceUid: Uint8Array,
): OpAmpServerToAgent {
  return {
    instanceUid: instanceUid,
    capabilities: ONEUPTIME_OPAMP_SERVER_CAPABILITIES,
    flags: OpAmpServerToAgentFlag.ReportFullState,
  };
}

export function getOpAmpErrorResponse(data: {
  instanceUid: Uint8Array;
  message: string;
}): OpAmpServerToAgent {
  return {
    instanceUid: data.instanceUid,
    errorResponse: {
      type: OpAmpServerErrorResponseType.BadRequest,
      errorMessage: data.message,
    },
  };
}

// The instance as text (a UUID), or null when it is not 16 bytes.
export function getOpAmpInstanceUidText(
  instanceUid: Uint8Array | null | undefined,
): string | null {
  if (!instanceUid || instanceUid.length !== 16) {
    return null;
  }

  const hex: string = Buffer.from(instanceUid).toString("hex");

  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join("-");
}
