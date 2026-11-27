import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import { FibreChannelCounter } from "../../../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "../../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * A SAN switch's alerts through the criteria evaluator (#11014, #11015):
 * SNMP Interface Errors (per second) on Fibre Channel ports, whose
 * thresholds are fractions - the recommended one is 0.1, one error in ten
 * seconds - and SNMP Fibre Channel Counter (per second).
 *
 * The errors threshold used to be read with parseInt, so "0.1" became 0
 * and every port with a single error rate above zero breached: a port
 * that took one CRC error in an hour (0.0003/s) paged someone.
 */

function poll(interfaces: Array<SnmpInterface>): ProbeMonitorResponse {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 30,
    failureCause: "",
    oidResponses: [],
    interfaces: interfaces,
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    snmpResponse: snmpResponse,
    monitoredAt: new Date(),
  };
}

function fcPort(
  name: string,
  errorsPerSecond: number | undefined,
  rates: Partial<Record<FibreChannelCounter, number>> = {},
): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: name,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    interfaceType: 56,
    ...(errorsPerSecond !== undefined
      ? { errorsPerSecond: errorsPerSecond }
      : {}),
    fibreChannel: { ratesPerSecond: rates },
  };
}

async function evaluate(
  criteriaFilter: CriteriaFilter,
  interfaces: Array<SnmpInterface>,
): Promise<string | null> {
  return SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: poll(interfaces),
    criteriaFilter: criteriaFilter,
  });
}

const ERRORS_ABOVE_A_TENTH: CriteriaFilter = {
  checkOn: CheckOn.SnmpInterfaceErrorsPerSecond,
  filterType: FilterType.GreaterThan,
  value: "0.1",
};

describe("SNMP Interface Errors (per second) with a fractional threshold", () => {
  test("a port taking one error an hour does not breach 0.1 a second", async () => {
    expect(
      await evaluate(ERRORS_ABOVE_A_TENTH, [fcPort("fc1/3", 0.0003)]),
    ).toBeNull();
  });

  test("a port taking eight a second does", async () => {
    expect(
      await evaluate(ERRORS_ABOVE_A_TENTH, [
        fcPort("fc1/1", 0),
        fcPort("fc1/3", 8),
      ]),
    ).toBeTruthy();
  });

  test("the threshold as a number reads the same as the text", async () => {
    expect(
      await evaluate({ ...ERRORS_ABOVE_A_TENTH, value: 0.1 }, [
        fcPort("fc1/3", 0.05),
      ]),
    ).toBeNull();
    expect(
      await evaluate({ ...ERRORS_ABOVE_A_TENTH, value: 0.1 }, [
        fcPort("fc1/3", 0.2),
      ]),
    ).toBeTruthy();
  });

  test("a port with no rate yet (its first poll) does not breach", async () => {
    expect(
      await evaluate(ERRORS_ABOVE_A_TENTH, [fcPort("fc1/3", undefined)]),
    ).toBeNull();
  });
});

describe("SNMP Fibre Channel Counter (per second) through the evaluator", () => {
  const CREDIT_LOSS: CriteriaFilter = {
    checkOn: CheckOn.SnmpFibreChannelCounterPerSecond,
    filterType: FilterType.GreaterThan,
    value: 0,
    snmpMonitorOptions: {
      interfaceName: "*",
      fibreChannelCounter: FibreChannelCounter.CreditLoss,
    },
  };

  test("met on the port losing credit, and says so", async () => {
    expect(
      await evaluate(CREDIT_LOSS, [
        fcPort("fc1/1", 0, { [FibreChannelCounter.CreditLoss]: 0 }),
        fcPort("fc1/5", 0, { [FibreChannelCounter.CreditLoss]: 0.05 }),
      ]),
    ).toContain("fc1/5");
  });

  test("not met while no port loses credit", async () => {
    expect(
      await evaluate(CREDIT_LOSS, [
        fcPort("fc1/1", 0, { [FibreChannelCounter.CreditLoss]: 0 }),
      ]),
    ).toBeNull();
  });

  test("scoped to the ports the criteria names", async () => {
    expect(
      await evaluate(
        {
          ...CREDIT_LOSS,
          snmpMonitorOptions: {
            interfaceName: "fc1/1",
            fibreChannelCounter: FibreChannelCounter.CreditLoss,
          },
        },
        [
          fcPort("fc1/1", 0, { [FibreChannelCounter.CreditLoss]: 0 }),
          fcPort("fc1/5", 0, { [FibreChannelCounter.CreditLoss]: 0.05 }),
        ],
      ),
    ).toBeNull();
  });

  test("a trap never evaluates it: it reads the walk", async () => {
    const response: ProbeMonitorResponse = poll([
      fcPort("fc1/5", 0, { [FibreChannelCounter.CreditLoss]: 1 }),
    ]);

    response.snmpTrapResponse = {
      sourceIpAddress: "10.20.0.5",
      trapOid: "1.3.6.1.6.3.1.1.5.3",
      snmpVersion: "v2c",
      receivedAt: new Date(),
      varbinds: [],
    };

    expect(
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        criteriaFilter: CREDIT_LOSS,
      }),
    ).toBeNull();
  });
});
