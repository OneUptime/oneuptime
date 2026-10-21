import protobuf from "protobufjs";
import path from "path";

/*
 * OpAMP messages (the OpenTelemetry Agent Management Protocol) as OneUptime
 * reads and writes them over HTTP: the supervisor on a host POSTs one
 * AgentToServer, OneUptime answers with one ServerToAgent, both protobuf.
 *
 * Proto/opamp.proto and Proto/anyvalue.proto are the OpAMP specification's
 * (github.com/open-telemetry/opamp-spec, commit 49860fd6), the revision
 * opamp-go v0.23.0 builds on - the client inside opampsupervisor and the
 * collector's opamp extension of release 0.161.0, which the installers put
 * on hosts. Upstream's files, unchanged.
 *
 * Only the fields OneUptime reads or writes have types below; protobufjs
 * keeps the rest of a message as it decodes it and drops them on encode.
 */

const PROTO_DIR: string = path.join(__dirname, "Proto");

const OpAmpProto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "opamp.proto"),
);

const AgentToServerType: protobuf.Type = OpAmpProto.lookupType(
  "opamp.proto.AgentToServer",
);
const ServerToAgentType: protobuf.Type = OpAmpProto.lookupType(
  "opamp.proto.ServerToAgent",
);

// AgentCapabilities: what a supervisor says it can do.
export enum OpAmpAgentCapability {
  ReportsStatus = 0x00000001,
  AcceptsRemoteConfig = 0x00000002,
  ReportsEffectiveConfig = 0x00000004,
  ReportsHealth = 0x00000800,
  ReportsRemoteConfig = 0x00001000,
  ReportsHeartbeat = 0x00002000,
}

// ServerCapabilities: what OneUptime says it does.
export enum OpAmpServerCapability {
  AcceptsStatus = 0x00000001,
  OffersRemoteConfig = 0x00000002,
  AcceptsEffectiveConfig = 0x00000004,
}

/*
 * What OneUptime does: status reports, remote config, and the effective
 * config a supervisor reports (accepted, not kept: a host's version and
 * hash say which config it runs).
 */
export const ONEUPTIME_OPAMP_SERVER_CAPABILITIES: number =
  OpAmpServerCapability.AcceptsStatus |
  OpAmpServerCapability.OffersRemoteConfig |
  OpAmpServerCapability.AcceptsEffectiveConfig;

export enum OpAmpServerToAgentFlag {
  ReportFullState = 0x00000001,
}

export enum OpAmpRemoteConfigStatus {
  Unset = 0,
  Applied = 1,
  Applying = 2,
  Failed = 3,
}

export enum OpAmpServerErrorResponseType {
  Unknown = 0,
  BadRequest = 1,
  Unavailable = 2,
}

export interface OpAmpAnyValue {
  stringValue?: string | undefined;
  boolValue?: boolean | undefined;
  intValue?: string | undefined;
  doubleValue?: number | undefined;
}

export interface OpAmpKeyValue {
  key?: string | undefined;
  value?: OpAmpAnyValue | undefined;
}

export interface OpAmpAgentDescription {
  identifyingAttributes?: Array<OpAmpKeyValue> | undefined;
  nonIdentifyingAttributes?: Array<OpAmpKeyValue> | undefined;
}

export interface OpAmpComponentHealth {
  healthy?: boolean | undefined;
  startTimeUnixNano?: string | undefined;
  lastError?: string | undefined;
  status?: string | undefined;
}

export interface OpAmpRemoteConfigStatusMessage {
  lastRemoteConfigHash?: Uint8Array | undefined;
  status?: number | undefined;
  errorMessage?: string | undefined;
}

export interface OpAmpAgentToServer {
  instanceUid?: Uint8Array | undefined;
  sequenceNum?: string | undefined;
  agentDescription?: OpAmpAgentDescription | undefined;
  capabilities?: string | undefined;
  health?: OpAmpComponentHealth | undefined;
  remoteConfigStatus?: OpAmpRemoteConfigStatusMessage | undefined;
  agentDisconnect?: Record<string, never> | undefined;
  flags?: string | undefined;
}

export interface OpAmpAgentConfigFile {
  body: Uint8Array;
  contentType: string;
}

export interface OpAmpAgentRemoteConfig {
  config: {
    configMap: Record<string, OpAmpAgentConfigFile>;
  };
  configHash: Uint8Array;
}

export interface OpAmpServerToAgent {
  instanceUid: Uint8Array;
  errorResponse?:
    | {
        type: OpAmpServerErrorResponseType;
        errorMessage: string;
      }
    | undefined;
  remoteConfig?: OpAmpAgentRemoteConfig | undefined;
  flags?: number | undefined;
  capabilities?: number | undefined;
}

const TO_OBJECT_OPTIONS: protobuf.IConversionOptions = {
  longs: String,
  enums: Number,
  defaults: false,
  arrays: true,
};

export default class OpAmpCodec {
  /*
   * An AgentToServer from the bytes a supervisor posted. Throws when they
   * are not one (protobufjs' own error).
   */
  public static decodeAgentToServer(bytes: Uint8Array): OpAmpAgentToServer {
    const message: protobuf.Message = AgentToServerType.decode(bytes);
    return AgentToServerType.toObject(
      message,
      TO_OBJECT_OPTIONS,
    ) as OpAmpAgentToServer;
  }

  public static encodeServerToAgent(message: OpAmpServerToAgent): Uint8Array {
    const error: string | null = ServerToAgentType.verify(message);
    if (error) {
      throw new Error(`Not a ServerToAgent message: ${error}`);
    }

    return ServerToAgentType.encode(
      ServerToAgentType.fromObject(message),
    ).finish();
  }

  // The supervisor's side, for tests and the local harness.
  public static encodeAgentToServer(message: {
    instanceUid: Uint8Array;
    sequenceNum?: number | undefined;
    capabilities?: number | undefined;
    agentDescription?: OpAmpAgentDescription | undefined;
    health?: { healthy?: boolean; lastError?: string } | undefined;
    remoteConfigStatus?:
      | {
          lastRemoteConfigHash?: Uint8Array;
          status?: number;
          errorMessage?: string;
        }
      | undefined;
    agentDisconnect?: Record<string, never> | undefined;
  }): Uint8Array {
    return AgentToServerType.encode(
      AgentToServerType.fromObject(message),
    ).finish();
  }

  public static decodeServerToAgent(bytes: Uint8Array): OpAmpServerToAgent {
    const message: protobuf.Message = ServerToAgentType.decode(bytes);
    return ServerToAgentType.toObject(message, {
      ...TO_OBJECT_OPTIONS,
      longs: Number,
    }) as OpAmpServerToAgent;
  }
}
