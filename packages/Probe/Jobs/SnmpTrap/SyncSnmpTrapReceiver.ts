import { PROBE_INGEST_URL } from "../../Config";
import SnmpTrapReceiver from "../../Services/SnmpTrapReceiver";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
} from "Common/Types/Probe/SnmpTrapReceiver";
import API from "Common/Utils/API";
import { EVERY_THIRTY_SECONDS } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import LogSecretValues from "Common/Server/Utils/LogSecretValues";
import logger from "Common/Server/Utils/Logger";

/*
 * The probe's SNMP trap receiver and OneUptime, every thirty seconds and
 * when the probe starts (OneUptime issue #11005):
 *
 *   - the probe says how its receiver is (SnmpTrapReceiver.getReport): on
 *     or off, its port, its SNMPv3 engine ID - which the probe's page shows,
 *     for the devices that send informs - how many SNMPv3 users it accepts,
 *     and the SNMPv3 traps it refused;
 *   - OneUptime answers with the SNMPv3 users of the devices assigned to
 *     the probe and of the sites whose Default Probe it is, which replace
 *     the receiver's at once. A credential, a credential profile or a
 *     device's probe changed is taken within a minute, and the receiver
 *     never stops listening for it.
 *
 * When the answer does not come, the receiver keeps the users it has: a
 * server that cannot be reached for a while must not start refusing every
 * SNMPv3 trap. A server older than SNMPv3 traps (404) has none to give.
 */

// What the server said last that the operator should hear, so it is said once.
let lastProblem: string | null = null;

// Exported for tests.
export function resetReportedProblem(): void {
  lastProblem = null;
}

function sayOnce(problem: string): void {
  if (problem === lastProblem) {
    return;
  }

  lastProblem = problem;
  logger.warn(problem);
}

export interface SyncDependencies {
  getReport: () => SnmpTrapReceiverReport;
  setUsers: (users: Array<SnmpTrapReceiverUser>) => void;
  fetch: (data: {
    url: URL;
    body: JSONObject;
  }) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;
}

const DEFAULT_DEPENDENCIES: SyncDependencies = {
  getReport: (): SnmpTrapReceiverReport => {
    return SnmpTrapReceiver.getReport();
  },
  setUsers: (users: Array<SnmpTrapReceiverUser>): void => {
    SnmpTrapReceiver.setUsers(users);
  },
  fetch: (data: {
    url: URL;
    body: JSONObject;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    return API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: data.url,
      data: data.body,
      headers: {},
      options: ProbeAPIRequest.getDefaultRequestOptions(data.url),
    });
  },
};

export async function syncSnmpTrapReceiver(
  dependencies: SyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/snmp-trap/receiver",
  );

  const report: SnmpTrapReceiverReport = dependencies.getReport();

  let result: HTTPResponse<JSONObject> | HTTPErrorResponse;

  try {
    result = await dependencies.fetch({
      url: url,
      body: {
        ...ProbeAPIRequest.getDefaultRequestBody(),
        snmpTrapReceiver: report as unknown as JSONObject,
      },
    });
  } catch (err) {
    sayOnce(
      `Could not report the SNMP trap receiver to OneUptime, so its SNMPv3 users were not refreshed: ${(err as Error).message}. It keeps the users it has and asks again in thirty seconds.`,
    );
    return;
  }

  if (result instanceof HTTPErrorResponse) {
    if (result.statusCode === 404) {
      sayOnce(
        "This OneUptime is older than SNMPv3 traps: the trap receiver takes v1 and v2c traps only until it is upgraded.",
      );

      // No users will come: SNMPv3 datagrams waiting for them are refused now, not held.
      if (report.isEnabled) {
        dependencies.setUsers([]);
      }
      return;
    }

    sayOnce(
      `OneUptime did not take the SNMP trap receiver's report: HTTP ${result.statusCode}${result.message ? ` - ${result.message}` : ""}. It keeps the SNMPv3 users it has and asks again in thirty seconds.`,
    );
    return;
  }

  lastProblem = null;

  if (!report.isEnabled) {
    return;
  }

  const rawUsers: unknown = (result.data as JSONObject | undefined)?.["users"];

  /*
   * The users carry their passphrases: nothing logged while they are read
   * and handed over may show one.
   */
  LogSecretValues.run(
    SnmpTrapReceiverSync.getPassphrases(rawUsers),
    (): void => {
      dependencies.setUsers(SnmpTrapReceiverUtil.sanitizeUsers(rawUsers));
    },
  );
}

export class SnmpTrapReceiverSync {
  public static getPassphrases(rawUsers: unknown): Array<string> {
    if (!Array.isArray(rawUsers)) {
      return [];
    }

    const passphrases: Array<string> = [];

    for (const user of rawUsers) {
      if (!user || typeof user !== "object") {
        continue;
      }

      for (const field of ["authKey", "privKey"]) {
        const value: unknown = (user as JSONObject)[field];

        if (typeof value === "string" && value) {
          passphrases.push(value);
        }
      }
    }

    return passphrases;
  }
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:SyncSnmpTrapReceiver",
    options: {
      schedule: EVERY_THIRTY_SECONDS,
      runOnStartup: true,
    },
    runFunction: async (): Promise<void> => {
      await syncSnmpTrapReceiver();
    },
  });
};

export default InitJob;
