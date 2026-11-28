import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import { BLOCK_CHECK_KEY } from "../../../../../../Server/Utils/SecurityEvent/Connectors/BlockingConnectionChecks";
import CrowdSecConnector, {
  CROWDSEC_ALLOWLISTS_CHECK_NAME,
  CROWDSEC_BLOCK_CHECK_NAME,
  CROWDSEC_REACH_CHECK_NAME,
  CROWDSEC_SIGN_IN_CHECK_NAME,
  isLapiReachedInTheClear,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/CrowdSec/CrowdSecConnector";
import SecurityEventConnectionTester from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import { SecurityConnectorSettings } from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { CROWDSEC_LOGIN_HINTS } from "../../../../../../Server/Utils/SecurityEvent/Response/CrowdSecLapiClient";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
  SecurityConnectorTestReport,
} from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  BLOCK_INDICATORS_KEY,
  ConnectorField,
  PUSHED_ALERTS_NOTHING_TO_POLL,
  areSecurityEventConnectorAlertsPushed,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CROWDSEC_META_CONNECTION,
  CROWDSEC_ONEUPTIME_SCENARIO,
} from "../../../../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import FakeCrowdSecLapi, {
  loopbackTransport,
} from "../../Response/FakeCrowdSecLapi";

jest.mock("../../../../../../Server/Utils/Logger");

/*
 * The CrowdSec connection (#11158): what it asks for, and what its Test
 * connection checks, against a Local API that answers as CrowdSec v1.8.2
 * does. Its alerts are sent to OneUptime, so nothing polls it: its test
 * checks the Local API it blocks through, and, for a saved connection,
 * when its last alert arrived - never the poll scheduler.
 */

const MACHINE: string = "oneuptime";
const PASSWORD: string = "Rv8n2Qw7xKp4Lm9ZtY3sB6dF";

const HEALTHY_PLATFORM: ConnectorPlatformStatus = {
  workerConsumers: 1,
  schedulerRegistered: true,
  queueWaiting: 0,
  queueFailed: 0,
  storageReachable: true,
};

let lapi: FakeCrowdSecLapi;
let url: string;

function settings(data?: {
  lapiUrl?: string;
  machineId?: string;
  password?: string;
  blocking?: boolean;
  none?: boolean;
}): SecurityConnectorSettings {
  if (data?.none) {
    return {
      provider: SecurityEventConnectorProvider.CrowdSec,
      config: data.blocking ? { [BLOCK_INDICATORS_KEY]: true } : {},
      secrets: {},
      alertingOnly: true,
    };
  }

  return {
    provider: SecurityEventConnectorProvider.CrowdSec,
    config: {
      lapiUrl: data?.lapiUrl ?? url,
      machineId: data?.machineId ?? MACHINE,
      ...(data?.blocking ? { [BLOCK_INDICATORS_KEY]: true } : {}),
    },
    secrets: { password: data?.password ?? PASSWORD },
    alertingOnly: true,
  };
}

function statuses(checks: Array<SecurityConnectorCheck>): Array<string> {
  return checks.map((check: SecurityConnectorCheck): string => {
    return `${check.key}:${check.status}`;
  });
}

const connector: CrowdSecConnector = new CrowdSecConnector(loopbackTransport);

beforeEach(async () => {
  lapi = new FakeCrowdSecLapi();
  lapi.addMachine(MACHINE, { password: PASSWORD });
  url = await lapi.start();
});

afterEach(async () => {
  await lapi.stop();
});

describe("the catalog's CrowdSec", () => {
  test("is pushed, registered, and asks to block on its last step", () => {
    expect(
      areSecurityEventConnectorAlertsPushed(
        SecurityEventConnectorProvider.CrowdSec,
      ),
    ).toBe(true);
    expect(
      areSecurityEventConnectorAlertsPushed(
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      ),
    ).toBe(false);
    expect(
      SecurityEventConnectorRegistry.getConnector(
        SecurityEventConnectorProvider.CrowdSec,
      ),
    ).toBeInstanceOf(CrowdSecConnector);

    const definition: ReturnType<typeof getSecurityEventConnectorDefinition> =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.CrowdSec,
      )!;

    expect(definition.category).toBe("Network security");
    expect(
      definition.configFields.map((field: ConnectorField): string => {
        return `${field.key}${field.isOption ? " (option)" : ""}`;
      }),
    ).toEqual(["lapiUrl", "machineId", `${BLOCK_INDICATORS_KEY} (option)`]);
    expect(definition.howToSendTestAlert).toContain(
      "sudo cscli notifications test oneuptime",
    );
  });
});

describe("what a CrowdSec connection asks for", () => {
  test("nothing, to receive alerts alone", () => {
    expect(() => {
      return connector.validateSettings(settings({ none: true }));
    }).not.toThrow();
    expect(
      CrowdSecConnector.readLapiSettings(settings({ none: true })),
    ).toBeNull();
  });

  test("the Local API's URL, a machine and its password, all three, to block", () => {
    expect(() => {
      return connector.validateSettings(
        settings({ none: true, blocking: true }),
      );
    }).toThrow(
      "To block addresses with CrowdSec, give its Local API URL, a Machine ID and its Machine password.",
    );

    expect(() => {
      return connector.validateSettings(settings({ password: "" }));
    }).toThrow("Missing: Machine password.");

    expect(() => {
      return connector.validateSettings(
        settings({ lapiUrl: "", machineId: "" }),
      );
    }).toThrow("Missing: Local API URL, Machine ID.");
  });

  test("a URL LAPI can be reached at, and a machine's ID", () => {
    expect(() => {
      return connector.validateSettings(settings({ lapiUrl: "not a url" }));
    }).toThrow("The Local API URL must be an address");

    // A host and port with no scheme reads as a scheme of its own.
    expect(() => {
      return connector.validateSettings(settings({ lapiUrl: "lapi:8080" }));
    }).toThrow("The Local API URL must use https or http.");

    expect(() => {
      return connector.validateSettings(settings({ machineId: "my machine" }));
    }).toThrow("without spaces or slashes");

    expect(
      CrowdSecConnector.readLapiSettings(
        settings({ lapiUrl: "https://lapi.example.com:8080/v1/" }),
      )?.lapiUrl,
    ).toBe("https://lapi.example.com:8080");
  });

  test("another provider's settings are none of its", () => {
    expect(() => {
      return connector.validateSettings({
        ...settings(),
        provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      });
    }).toThrow("not CrowdSec");
  });

  test("nothing to poll: its alerts are sent to OneUptime", async () => {
    await expect(
      connector.fetchEvents(
        settings(),
        { startTime: new Date(), endTime: new Date() },
        {
          maxRequests: 1,
          maxEvents: 1,
          requestTimeoutInMs: 1000,
          sampleLimit: 1,
        },
      ),
    ).rejects.toThrow("there is nothing to poll");
    expect(PUSHED_ALERTS_NOTHING_TO_POLL).toContain("nothing to poll");
  });
});

describe("whether the Local API is reached in the clear", () => {
  test.each([
    ["https://lapi.example.com:8080", false],
    ["http://127.0.0.1:8080", false],
    ["http://localhost:8080", false],
    ["http://10.0.0.5:8080", false],
    ["http://192.168.1.20:8080", false],
    ["http://[::1]:8080", false],
    ["http://203.0.113.7:8080", true],
    ["http://lapi.example.com:8080", true],
  ])("%s", (lapiUrl: string, inTheClear: boolean) => {
    expect(isLapiReachedInTheClear(lapiUrl)).toBe(inTheClear);
  });
});

describe("Test connection, against the Local API", () => {
  test("a connection that only receives alerts has no Local API to test, and says so", async () => {
    const checks: Array<SecurityConnectorCheck> =
      await connector.testConnection(settings({ none: true }), {
        requestTimeoutInMs: 5000,
      });

    expect(statuses(checks)).toEqual(["reachability:skip"]);
    expect(checks[0]?.message).toContain("only receives CrowdSec's alerts");
    expect(lapi.requests).toEqual([]);
  });

  test("reaches it, signs in, reads its allowlists - and with blocking on, reads OneUptime's bans, changing nothing", async () => {
    lapi.allowlists = [
      {
        name: "office",
        items: [{ value: "198.51.100.10" }, { value: "203.0.113.0/24" }],
      },
    ];
    lapi.addDecisionAlert({
      machineId: MACHINE,
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      origin: "cscli",
      value: "192.0.2.1",
      durationInMs: 3600000,
      meta: [{ key: CROWDSEC_META_CONNECTION, value: "some-connection" }],
    });

    const off: Array<SecurityConnectorCheck> = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 5000 },
    );
    expect(statuses(off)).toEqual([
      "reachability:pass",
      "authentication:pass",
      "allowlists:pass",
    ]);
    expect(
      off.map((check: SecurityConnectorCheck) => {
        return check.name;
      }),
    ).toEqual([
      CROWDSEC_REACH_CHECK_NAME,
      CROWDSEC_SIGN_IN_CHECK_NAME,
      CROWDSEC_ALLOWLISTS_CHECK_NAME,
    ]);
    expect(off[2]?.message).toBe(
      "CrowdSec has 1 allowlist holding 2 addresses and ranges. OneUptime never bans one of them.",
    );

    const on: Array<SecurityConnectorCheck> = await connector.testConnection(
      settings({ blocking: true }),
      { requestTimeoutInMs: 5000 },
    );
    expect(statuses(on)).toEqual([
      "reachability:pass",
      "authentication:pass",
      "allowlists:pass",
      `${BLOCK_CHECK_KEY}:pass`,
    ]);
    expect(on[3]?.name).toBe(CROWDSEC_BLOCK_CHECK_NAME);
    expect(on[3]?.message).toContain(
      "It has 1 ban in force on this Local API. Nothing was changed.",
    );

    // Nothing written: no alert posted, no decision ended.
    expect(
      lapi.requests.filter((request: { method: string; path: string }) => {
        return (
          request.method !== "GET" && request.path !== "/v1/watchers/login"
        );
      }),
    ).toEqual([]);
  });

  test("a LAPI that cannot be reached fails there, and skips the rest, saying where it listens", async () => {
    await lapi.stop();

    const checks: Array<SecurityConnectorCheck> =
      await connector.testConnection(settings({ blocking: true }), {
        requestTimeoutInMs: 5000,
      });

    expect(statuses(checks)).toEqual([
      "reachability:fail",
      "authentication:skip",
      `${BLOCK_CHECK_KEY}:skip`,
    ]);
    expect(checks[0]?.message).toContain(
      "CrowdSec Local API health check could not be completed",
    );
    expect(checks[0]?.remediation).toContain("api.server.listen_uri");
    // Started again for afterEach.
    url = await lapi.start();
  });

  test("a machine LAPI refuses fails the sign-in with what to do, and skips blocking", async () => {
    const checks: Array<SecurityConnectorCheck> =
      await connector.testConnection(
        settings({ password: "wrong-password", blocking: true }),
        { requestTimeoutInMs: 5000 },
      );

    expect(statuses(checks)).toEqual([
      "reachability:pass",
      "authentication:fail",
      `${BLOCK_CHECK_KEY}:skip`,
    ]);
    expect(checks[1]?.message).toContain(CROWDSEC_LOGIN_HINTS.password);
    expect(checks[1]?.message).not.toContain("wrong-password");
  });

  test("a LAPI older than allowlists passes, saying it has none", async () => {
    lapi.hasAllowlists = false;

    const checks: Array<SecurityConnectorCheck> =
      await connector.testConnection(settings(), { requestTimeoutInMs: 5000 });

    expect(statuses(checks)).toEqual([
      "reachability:pass",
      "authentication:pass",
      "allowlists:pass",
    ]);
    expect(checks[2]?.message).toContain("older than 1.6.8");
  });

  test("settings that are wrong fail before anything is sent", async () => {
    const checks: Array<SecurityConnectorCheck> =
      await connector.testConnection(settings({ machineId: "" }), {
        requestTimeoutInMs: 5000,
      });

    expect(statuses(checks)).toEqual(["reachability:fail"]);
    expect(lapi.requests).toEqual([]);
  });
});

describe("the shared Test connection, for a connection whose alerts are sent", () => {
  function savedConnection(
    lastEventIngestedAt?: Date | undefined,
  ): SecurityEventConnection {
    const connection: SecurityEventConnection = new SecurityEventConnection();
    connection._id = "cccccccc-cccc-4ccc-8ccc-000000000001";
    connection.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");
    connection.provider = SecurityEventConnectorProvider.CrowdSec;
    connection.isEnabled = true;
    connection.pollIntervalInMinutes = 5;
    if (lastEventIngestedAt) {
      connection.lastEventIngestedAt = lastEventIngestedAt;
    }
    return connection;
  }

  test("checks no poll scheduler, and says no alert has arrived yet, with how to send one", async () => {
    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: settings({ none: true }),
        connection: savedConnection(),
        connectorOverride: connector,
        platformOverride: HEALTHY_PLATFORM,
        recordRun: false,
      });

    expect(statuses(report.checks)).toEqual([
      "configuration:pass",
      "reachability:skip",
      "worker-consumers:pass",
      "storage:pass",
      "alerts-received:warn",
    ]);
    expect(report.checks[4]?.remediation).toContain(
      "sudo cscli notifications test oneuptime",
    );
  });

  test("says when the last alert arrived", async () => {
    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: settings({ none: true }),
        connection: savedConnection(new Date("2026-11-28T09:59:00.000Z")),
        connectorOverride: connector,
        platformOverride: HEALTHY_PLATFORM,
        recordRun: false,
      });

    const received: SecurityConnectorCheck | undefined = report.checks.find(
      (check: SecurityConnectorCheck): boolean => {
        return check.key === "alerts-received";
      },
    );

    expect(received?.status).toBe("pass");
    expect(received?.message).toBe(
      "The last alert arrived at 2026-11-28T09:59:00.000Z.",
    );
  });
});
