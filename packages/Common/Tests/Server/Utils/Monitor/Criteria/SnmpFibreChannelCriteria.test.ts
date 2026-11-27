import SnmpFibreChannelCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpFibreChannelCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  FibreChannelCounter,
  FibreChannelCounterValues,
} from "../../../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "../../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import { describe, expect, test } from "@jest/globals";

/*
 * SNMP Fibre Channel Counter (per second): one of a port's counters,
 * per second, against a threshold - how "an interface losing credit"
 * (credit loss, timeout discards: a slow-draining device) fires its own
 * alert, apart from errors. It is met by the port with the highest rate in
 * the criteria's scope, and says which port that is.
 */

function filter(
  counter: FibreChannelCounter | string | undefined,
  filterType: FilterType,
  value: string | number,
): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpFibreChannelCounterPerSecond,
    filterType: filterType,
    value: value,
    snmpMonitorOptions: {
      interfaceName: "*",
      ...(counter !== undefined
        ? { fibreChannelCounter: counter as FibreChannelCounter }
        : {}),
    },
  } as CriteriaFilter;
}

function port(
  name: string,
  ratesPerSecond: FibreChannelCounterValues | undefined,
): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: name,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    fibreChannel: ratesPerSecond ? { ratesPerSecond: ratesPerSecond } : {},
  };
}

const PORTS: Array<SnmpInterface> = [
  port("fc1/1", {
    [FibreChannelCounter.CreditLoss]: 0,
    [FibreChannelCounter.CrcErrors]: 0,
  }),
  port("fc1/5", {
    [FibreChannelCounter.CreditLoss]: 0.05,
    [FibreChannelCounter.TimeoutDiscards]: 0.5,
  }),
  port("fc1/7", { [FibreChannelCounter.CreditLoss]: 0.0167 }),
];

describe("SnmpFibreChannelCriteria.evaluate", () => {
  test("met by the worst port, and says which and by how much", () => {
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: PORTS,
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          0,
        ),
      }),
    ).toBe(
      "Fibre Channel credit loss on fc1/5 is 0.05 per second, greater than 0.",
    );
  });

  test("a threshold keeps its decimals: 0.1 is not 0", () => {
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: PORTS,
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          "0.1",
        ),
      }),
    ).toBeNull();
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: PORTS,
        criteriaFilter: filter(
          FibreChannelCounter.TimeoutDiscards,
          FilterType.GreaterThan,
          "0.1",
        ),
      }),
    ).toContain("fc1/5");
  });

  test("every comparison a numeric criterion has", () => {
    const evaluate: (filterType: FilterType, value: string) => string | null = (
      filterType: FilterType,
      value: string,
    ): string | null => {
      return SnmpFibreChannelCriteria.evaluate({
        interfaces: PORTS,
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          filterType,
          value,
        ),
      });
    };

    expect(evaluate(FilterType.GreaterThanOrEqualTo, "0.05")).not.toBeNull();
    expect(evaluate(FilterType.LessThan, "1")).not.toBeNull();
    expect(evaluate(FilterType.LessThan, "0.05")).toBeNull();
    expect(evaluate(FilterType.EqualTo, "0.05")).not.toBeNull();
  });

  test("not met when no port in scope has a rate for the counter", () => {
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: [port("fc1/1", undefined), port("fc1/2", {})],
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThanOrEqualTo,
          0,
        ),
      }),
    ).toBeNull();
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: [],
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThanOrEqualTo,
          0,
        ),
      }),
    ).toBeNull();
  });

  test("not met with no counter chosen, an unknown one, or no threshold", () => {
    for (const counter of [undefined, "", "creditloss", "Credit Loss"]) {
      expect(
        SnmpFibreChannelCriteria.evaluate({
          interfaces: PORTS,
          criteriaFilter: filter(counter, FilterType.GreaterThan, 0),
        }),
      ).toBeNull();
    }

    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: PORTS,
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          "",
        ),
      }),
    ).toBeNull();
  });

  test("a port with no name is named by its ifIndex", () => {
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: [
          {
            interfaceIndex: 16793600,
            name: "",
            isOperationallyUp: true,
            isAdministrativelyUp: true,
            fibreChannel: {
              ratesPerSecond: { [FibreChannelCounter.CreditLoss]: 1 },
            },
          },
        ],
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          0,
        ),
      }),
    ).toContain("on ifIndex 16793600");
  });
});

describe("SnmpFibreChannelCriteria.describeObservation", () => {
  test("what it saw, matched or not", () => {
    expect(
      SnmpFibreChannelCriteria.describeObservation({
        interfaces: PORTS,
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          1,
        ),
      }),
    ).toBe("Fibre Channel credit loss: highest on fc1/5, 0.05 per second.");
  });

  test("why there is nothing to see", () => {
    expect(
      SnmpFibreChannelCriteria.describeObservation({
        interfaces: PORTS,
        criteriaFilter: filter(undefined, FilterType.GreaterThan, 1),
      }),
    ).toMatch(/No Fibre Channel counter is chosen/);
    expect(
      SnmpFibreChannelCriteria.describeObservation({
        interfaces: [
          {
            interfaceIndex: 1,
            name: "eth0",
            isOperationallyUp: true,
            isAdministrativelyUp: true,
          },
        ],
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          1,
        ),
      }),
    ).toBe("The device reported no Fibre Channel ports on this poll.");
    expect(
      SnmpFibreChannelCriteria.describeObservation({
        interfaces: [port("fc1/1", {})],
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          1,
        ),
      }),
    ).toMatch(/needs two polls/);
    expect(
      SnmpFibreChannelCriteria.describeObservation({
        interfaces: undefined,
        criteriaFilter: filter(
          FibreChannelCounter.CreditLoss,
          FilterType.GreaterThan,
          1,
        ),
      }),
    ).toBe("The device reported no Fibre Channel ports on this poll.");
  });
});

describe("worstPort and formatRate", () => {
  test("the highest rate wins; a tie keeps the first port", () => {
    expect(
      SnmpFibreChannelCriteria.worstPort({
        interfaces: [
          port("a", { [FibreChannelCounter.Discards]: 2 }),
          port("b", { [FibreChannelCounter.Discards]: 2 }),
          port("c", { [FibreChannelCounter.Discards]: NaN }),
        ],
        counter: FibreChannelCounter.Discards,
      }),
    ).toEqual({ name: "a", rate: 2 });
  });

  test.each([
    [0.0033333, "0.0033"],
    [2, "2"],
    [12.5, "12.5"],
    [0, "0"],
  ])("%s reads %s", (rate: number, text: string) => {
    expect(SnmpFibreChannelCriteria.formatRate(rate)).toBe(text);
  });
});
