// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * Deliberately different from every retry count used below, so a branch that
 * still hands the probe-wide env default to the monitor util is visible in
 * the assertion rather than accidentally matching.
 */
process.env["PROBE_MONITOR_RETRY_LIMIT"] = "9";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/typedef
const mockSnmpQuery = jest.fn();
// eslint-disable-next-line @typescript-eslint/typedef
const mockDnsQuery = jest.fn();
// eslint-disable-next-line @typescript-eslint/typedef
const mockDomainQuery = jest.fn();
// eslint-disable-next-line @typescript-eslint/typedef
const mockDnssecQuery = jest.fn();
// eslint-disable-next-line @typescript-eslint/typedef
const mockExternalStatusPageFetch = jest.fn();

jest.mock("../../../Utils/Monitors/MonitorTypes/SnmpMonitor", () => {
  return {
    __esModule: true,
    default: {
      query: (...args: Array<unknown>): unknown => {
        return mockSnmpQuery(...args);
      },
    },
  };
});

jest.mock("../../../Utils/Monitors/MonitorTypes/DnsMonitor", () => {
  return {
    __esModule: true,
    default: {
      query: (...args: Array<unknown>): unknown => {
        return mockDnsQuery(...args);
      },
    },
  };
});

jest.mock("../../../Utils/Monitors/MonitorTypes/DomainMonitor", () => {
  return {
    __esModule: true,
    default: {
      query: (...args: Array<unknown>): unknown => {
        return mockDomainQuery(...args);
      },
    },
  };
});

jest.mock("../../../Utils/Monitors/MonitorTypes/DnssecMonitor", () => {
  return {
    __esModule: true,
    default: {
      query: (...args: Array<unknown>): unknown => {
        return mockDnssecQuery(...args);
      },
    },
  };
});

jest.mock(
  "../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor",
  () => {
    return {
      __esModule: true,
      default: {
        fetch: (...args: Array<unknown>): unknown => {
          return mockExternalStatusPageFetch(...args);
        },
      },
    };
  },
);

import MonitorUtil from "../../../Utils/Monitors/Monitor";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * Follow-up to https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * The Website/API/SSL/Port/Ping/SQL branches of probeMonitorStep pass the
 * user's per-step retry count and timeout down to the monitor util. These five
 * branches did not: they passed PROBE_MONITOR_RETRY_LIMIT (a probe-wide env
 * default) as the retry count, which discarded BOTH the step-level setting and
 * the type-specific "retries" field, because the monitor utils treat a supplied
 * options.retry as the winner over config.retries.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

// The env default seeded above. Any branch still leaking it fails the tests.
const PROBE_WIDE_RETRY_DEFAULT: number = 9;

interface MonitorOptions {
  retry?: number | undefined;
  timeout?: number | undefined;
}

type MonitorMock = { mock: { calls: Array<Array<unknown>> } };

function optionsOfFirstCall(mock: MonitorMock): MonitorOptions {
  return mock.mock.calls[0]?.[1] as MonitorOptions;
}

function newStep(): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    ...(step.data as NonNullable<MonitorStep["data"]>),
    id: ObjectID.generate().toString(),
  } as NonNullable<MonitorStep["data"]>;

  return step;
}

/*
 * Each branch, with a type-specific config carrying retries/timeout values
 * that differ both from the type default and from the probe-wide env default.
 */
interface BranchUnderTest {
  name: string;
  monitorType: MonitorType;
  monitorMock: MonitorMock;
  buildStep: () => MonitorStep;
  configRetries: number;
  configTimeoutInMs: number;
}

const BRANCHES: Array<BranchUnderTest> = [
  {
    name: "SNMP / NetworkDevice",
    monitorType: MonitorType.NetworkDevice,
    monitorMock: mockSnmpQuery as unknown as MonitorMock,
    configRetries: 2,
    configTimeoutInMs: 7000,
    buildStep: (): MonitorStep => {
      return newStep().setSnmpMonitor({
        snmpVersion: SnmpVersion.V2c,
        hostname: "10.0.0.1",
        port: 161,
        communityString: "public",
        oids: [{ oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" }],
        timeout: 7000,
        retries: 2,
        monitorInterfaces: false,
      });
    },
  },
  {
    name: "DNS",
    monitorType: MonitorType.DNS,
    monitorMock: mockDnsQuery as unknown as MonitorMock,
    configRetries: 2,
    configTimeoutInMs: 7000,
    buildStep: (): MonitorStep => {
      return newStep().setDnsMonitor({
        queryName: "example.com",
        recordType: DnsRecordType.A,
        hostname: "",
        port: 53,
        timeout: 7000,
        retries: 2,
      });
    },
  },
  {
    name: "Domain",
    monitorType: MonitorType.Domain,
    monitorMock: mockDomainQuery as unknown as MonitorMock,
    configRetries: 2,
    configTimeoutInMs: 7000,
    buildStep: (): MonitorStep => {
      return newStep().setDomainMonitor({
        domainName: "example.com",
        lookupMethod: DomainLookupMethod.Auto,
        timeout: 7000,
        retries: 2,
      });
    },
  },
  {
    name: "DNSSEC",
    monitorType: MonitorType.DNSSEC,
    monitorMock: mockDnssecQuery as unknown as MonitorMock,
    configRetries: 2,
    configTimeoutInMs: 7000,
    buildStep: (): MonitorStep => {
      return newStep().setDnssecMonitor({
        domainName: "example.com",
        resolvers: ["1.1.1.1"],
        checkNameserverConsistency: false,
        signatureExpiryWarningDays: 7,
        timeout: 7000,
        retries: 2,
      });
    },
  },
  {
    name: "External Status Page",
    monitorType: MonitorType.ExternalStatusPage,
    monitorMock: mockExternalStatusPageFetch as unknown as MonitorMock,
    configRetries: 2,
    configTimeoutInMs: 7000,
    buildStep: (): MonitorStep => {
      return newStep().setExternalStatusPageMonitor({
        statusPageUrl: "https://status.example.com",
        provider: ExternalStatusPageProviderType.Auto,
        timeout: 7000,
        retries: 2,
      });
    },
  },
];

beforeEach(() => {
  for (const mock of [
    mockSnmpQuery,
    mockDnsQuery,
    mockDomainQuery,
    mockDnssecQuery,
    mockExternalStatusPageFetch,
  ]) {
    mock.mockReset();
    mock.mockResolvedValue({
      isOnline: true,
      isTimeout: false,
      responseTimeInMs: 12,
      failureCause: "",
    } as never);
  }
});

describe.each(BRANCHES)(
  "$name step passes the user's retry count and timeout through",
  (branch: BranchUnderTest) => {
    test("uses the step-level retry count and timeout when the user set them", async () => {
      const step: MonitorStep = branch.buildStep();
      step.setRetryCount(1);
      step.setRequestTimeoutInMs(4321);

      await MonitorUtil.probeMonitorStep({
        monitorStep: step,
        monitorType: branch.monitorType,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

      const options: MonitorOptions = optionsOfFirstCall(branch.monitorMock);

      expect(options.retry).toBe(1);
      expect(options.timeout).toBe(4321);
    });

    test("honours a step-level retry count of zero", async () => {
      const step: MonitorStep = branch.buildStep();
      step.setRetryCount(0);

      await MonitorUtil.probeMonitorStep({
        monitorStep: step,
        monitorType: branch.monitorType,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

      /*
       * "No retries" is a real answer, not a missing one - it must not fall
       * back to a default.
       */
      expect(optionsOfFirstCall(branch.monitorMock).retry).toBe(0);
    });

    test("clamps a step-level retry count above the documented maximum", async () => {
      const step: MonitorStep = branch.buildStep();
      // setRetryCount clamps too; assign directly to test the probe-side clamp.
      step.data!.retryCount = 99;

      await MonitorUtil.probeMonitorStep({
        monitorStep: step,
        monitorType: branch.monitorType,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

      expect(optionsOfFirstCall(branch.monitorMock).retry).toBe(3);
    });

    test("falls back to the type-specific config, not the probe-wide env default", async () => {
      const step: MonitorStep = branch.buildStep();

      await MonitorUtil.probeMonitorStep({
        monitorStep: step,
        monitorType: branch.monitorType,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

      const options: MonitorOptions = optionsOfFirstCall(branch.monitorMock);

      /*
       * The retries/timeout fields on the type-specific form are the only
       * ones these monitor types expose, so they have to win over the env
       * default when the step carries no override of its own.
       */
      expect(options.retry).toBe(branch.configRetries);
      expect(options.retry).not.toBe(PROBE_WIDE_RETRY_DEFAULT);
      expect(options.timeout).toBe(branch.configTimeoutInMs);
    });
  },
);
