import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import snmp from "net-snmp";

export interface SnmpQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
}

export default class SnmpMonitor {
  public static async query(
    config: MonitorStepSnmpMonitor,
    options?: SnmpQueryOptions,
  ): Promise<SnmpMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    logger.debug(
      `SNMP Query: ${options?.monitorId?.toString()} ${config.hostname}:${config.port} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();

    try {
      const oidResponses: Array<SnmpOidResponse> =
        await SnmpMonitor.executeSnmpQuery(config, options);

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      logger.debug(
        `SNMP Query success: ${options?.monitorId?.toString()} ${config.hostname}:${config.port} - Response Time: ${responseTimeInMs}ms`,
      );

      return {
        isOnline: true,
        responseTimeInMs: responseTimeInMs,
        failureCause: "",
        oidResponses: oidResponses,
      };
    } catch (err: unknown) {
      logger.debug(
        `SNMP Query error: ${options?.monitorId?.toString()} ${config.hostname}:${config.port}`,
      );
      logger.debug(err);

      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0;
      }

      if (options.currentRetryCount < (options.retry || config.retries || 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await SnmpMonitor.query(config, options);
      }

      // Check if the probe is online
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorPortMonitors())) {
          logger.error(
            `SnmpMonitor - Probe is not online. Cannot query ${options?.monitorId?.toString()} ${config.hostname}:${config.port} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      // Check if timeout
      const isTimeout: boolean =
        (err as Error).message?.toLowerCase().includes("timeout") ||
        (err as Error).message?.toLowerCase().includes("timed out");

      if (isTimeout) {
        return {
          isOnline: true,
          isTimeout: true,
          responseTimeInMs: responseTimeInMs,
          failureCause:
            "Request was tried " +
            options.currentRetryCount +
            " times and it timed out.",
          oidResponses: [],
        };
      }

      return {
        isOnline: false,
        isTimeout: false,
        responseTimeInMs: responseTimeInMs,
        failureCause: (err as Error).message || (err as Error).toString(),
        oidResponses: [],
      };
    }
  }

  private static async executeSnmpQuery(
    config: MonitorStepSnmpMonitor,
    options: SnmpQueryOptions,
  ): Promise<Array<SnmpOidResponse>> {
    return new Promise(
      (
        resolve: (value: Array<SnmpOidResponse>) => void,
        reject: (reason?: Error) => void,
      ) => {
        let session: snmp.Session;

        try {
          if (config.snmpVersion === SnmpVersion.V3 && config.snmpV3Auth) {
            const sessionOptionsV3: snmp.SessionOptionsV3 = {
              port: config.port || 161,
              timeout: options.timeout || config.timeout || 5000,
              retries: 0, // We handle retries ourselves
              version: snmp.Version3,
            };
            const user: snmp.User = SnmpMonitor.buildV3User(config);
            session = snmp.createV3Session(
              config.hostname,
              user,
              sessionOptionsV3,
            );
          } else {
            const sessionOptions: snmp.SessionOptions = {
              port: config.port || 161,
              timeout: options.timeout || config.timeout || 5000,
              retries: 0, // We handle retries ourselves
              version:
                config.snmpVersion === SnmpVersion.V1
                  ? snmp.Version1
                  : snmp.Version2c,
            };
            session = snmp.createSession(
              config.hostname,
              config.communityString || "public",
              sessionOptions,
            );
          }

          const oids: Array<string> = config.oids.map((oid) => {
            return oid.oid;
          });

          if (oids.length === 0) {
            session.close();
            reject(new Error("No OIDs configured for SNMP monitor"));
            return;
          }

          session.get(oids, (error, varbinds) => {
            if (error || !varbinds) {
              session.close();
              reject(error || new Error("No varbinds returned"));
              return;
            }

            const oidResponses: Array<SnmpOidResponse> = [];

            for (let i = 0; i < varbinds.length; i++) {
              const varbind: snmp.Varbind = varbinds[i]!;
              const configOid = config.oids[i];

              if (snmp.isVarbindError(varbind)) {
                oidResponses.push({
                  oid: varbind.oid,
                  name: configOid?.name,
                  value: null,
                  type: SnmpMonitor.mapSnmpErrorType(varbind.type),
                });
              } else {
                oidResponses.push({
                  oid: varbind.oid,
                  name: configOid?.name,
                  value: SnmpMonitor.parseVarbindValue(varbind),
                  type: SnmpMonitor.mapSnmpDataType(varbind.type),
                });
              }
            }

            session.close();
            resolve(oidResponses);
          });
        } catch (err) {
          reject(err as Error);
        }
      },
    );
  }

  private static buildV3User(config: MonitorStepSnmpMonitor): snmp.User {
    const v3Auth = config.snmpV3Auth!;
    const user: snmp.User = {
      name: v3Auth.username,
      level: SnmpMonitor.mapSecurityLevel(v3Auth.securityLevel),
    };

    if (
      v3Auth.securityLevel === SnmpSecurityLevel.AuthNoPriv ||
      v3Auth.securityLevel === SnmpSecurityLevel.AuthPriv
    ) {
      user.authProtocol = SnmpMonitor.mapAuthProtocol(v3Auth.authProtocol);
      user.authKey = v3Auth.authKey || "";
    }

    if (v3Auth.securityLevel === SnmpSecurityLevel.AuthPriv) {
      user.privProtocol = SnmpMonitor.mapPrivProtocol(v3Auth.privProtocol);
      user.privKey = v3Auth.privKey || "";
    }

    return user;
  }

  private static mapSecurityLevel(
    level: SnmpSecurityLevel,
  ): snmp.SecurityLevel {
    switch (level) {
      case SnmpSecurityLevel.NoAuthNoPriv:
        return snmp.SecurityLevel.noAuthNoPriv;
      case SnmpSecurityLevel.AuthNoPriv:
        return snmp.SecurityLevel.authNoPriv;
      case SnmpSecurityLevel.AuthPriv:
        return snmp.SecurityLevel.authPriv;
      default:
        return snmp.SecurityLevel.noAuthNoPriv;
    }
  }

  private static mapAuthProtocol(
    protocol: SnmpAuthProtocol | undefined,
  ): snmp.AuthProtocols {
    switch (protocol) {
      case SnmpAuthProtocol.MD5:
        return snmp.AuthProtocols.md5;
      case SnmpAuthProtocol.SHA:
        return snmp.AuthProtocols.sha;
      case SnmpAuthProtocol.SHA256:
        return snmp.AuthProtocols.sha256;
      case SnmpAuthProtocol.SHA512:
        return snmp.AuthProtocols.sha512;
      default:
        return snmp.AuthProtocols.md5;
    }
  }

  private static mapPrivProtocol(
    protocol: SnmpPrivProtocol | undefined,
  ): snmp.PrivProtocols {
    switch (protocol) {
      case SnmpPrivProtocol.DES:
        return snmp.PrivProtocols.des;
      case SnmpPrivProtocol.AES:
        return snmp.PrivProtocols.aes;
      case SnmpPrivProtocol.AES256:
        return snmp.PrivProtocols.aes256b;
      default:
        return snmp.PrivProtocols.des;
    }
  }

  private static parseVarbindValue(varbind: snmp.Varbind): string | number {
    if (varbind.value === null || varbind.value === undefined) {
      return "";
    }

    // Handle Buffer values (OctetString)
    if (Buffer.isBuffer(varbind.value)) {
      return varbind.value.toString();
    }

    // Handle numeric values
    if (typeof varbind.value === "number" || typeof varbind.value === "bigint") {
      return Number(varbind.value);
    }

    // Default to string conversion
    return String(varbind.value);
  }

  private static mapSnmpDataType(type: snmp.ObjectType | undefined): SnmpDataType {
    switch (type) {
      case snmp.ObjectType.Integer:
        return SnmpDataType.Integer;
      case snmp.ObjectType.OctetString:
        return SnmpDataType.OctetString;
      case snmp.ObjectType.OID:
        return SnmpDataType.ObjectIdentifier;
      case snmp.ObjectType.IpAddress:
        return SnmpDataType.IpAddress;
      case snmp.ObjectType.Counter:
        return SnmpDataType.Counter;
      case snmp.ObjectType.Counter32:
        return SnmpDataType.Counter32;
      case snmp.ObjectType.Gauge:
        return SnmpDataType.Gauge;
      case snmp.ObjectType.Gauge32:
        return SnmpDataType.Gauge32;
      case snmp.ObjectType.TimeTicks:
        return SnmpDataType.TimeTicks;
      case snmp.ObjectType.Opaque:
        return SnmpDataType.Opaque;
      case snmp.ObjectType.Counter64:
        return SnmpDataType.Counter64;
      case snmp.ObjectType.Null:
        return SnmpDataType.Null;
      case snmp.ObjectType.Boolean:
        return SnmpDataType.Boolean;
      default:
        return SnmpDataType.Unknown;
    }
  }

  private static mapSnmpErrorType(type: snmp.ObjectType | undefined): SnmpDataType {
    switch (type) {
      case snmp.ObjectType.NoSuchObject:
        return SnmpDataType.NoSuchObject;
      case snmp.ObjectType.NoSuchInstance:
        return SnmpDataType.NoSuchInstance;
      case snmp.ObjectType.EndOfMibView:
        return SnmpDataType.EndOfMibView;
      default:
        return SnmpDataType.Unknown;
    }
  }
}
