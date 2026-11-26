import CompareCriteria from "./CompareCriteria";
import { CriteriaFilter } from "../../../../Types/Monitor/CriteriaFilter";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpFibreChannelUtil, {
  FIBRE_CHANNEL_COUNTER_TITLES,
  FibreChannelCounter,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";

/*
 * "SNMP Fibre Channel Counter (per second)": how fast one counter of a SAN
 * switch's Fibre Channel ports grew since the device's previous poll -
 * credit loss on an MDS, class 3 discards on a Brocade, CRC errors on
 * either. The port with the highest rate is compared, as for interface
 * errors, so "credit loss above 0" is met by any port losing credit, and a
 * "*" interface scope raises one alert per port (PerEntityCriteriaFanOut).
 *
 * Not evaluated - null - until a port in scope has a rate for the counter:
 * on a device with no Fibre Channel ports, on its first poll, and on a poll
 * whose counter went backwards (a wrap, or the switch's counters cleared).
 */

interface PortRate {
  name: string;
  rate: number;
}

export default class SnmpFibreChannelCriteria {
  public static evaluate(data: {
    // The interfaces in the criteria's scope.
    interfaces: Array<SnmpInterface>;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const counter: FibreChannelCounter | undefined =
      SnmpFibreChannelUtil.parseCounter(
        data.criteriaFilter.snmpMonitorOptions?.fibreChannelCounter,
      );

    // A rate is a fraction as often as not: the threshold keeps its decimals.
    const threshold: number | null =
      CompareCriteria.convertMetricThresholdToNumber(data.criteriaFilter.value);

    if (!counter || threshold === null) {
      return null;
    }

    const worst: PortRate | undefined = SnmpFibreChannelCriteria.worstPort({
      interfaces: data.interfaces,
      counter: counter,
    });

    if (!worst) {
      return null;
    }

    const matched: string | null = CompareCriteria.compareCriteriaNumbers({
      value: worst.rate,
      threshold: threshold,
      criteriaFilter: data.criteriaFilter,
    });

    if (!matched) {
      return null;
    }

    const comparison: string = (
      data.criteriaFilter.filterType || ""
    ).toLowerCase();

    return `Fibre Channel ${FIBRE_CHANNEL_COUNTER_TITLES[counter].toLowerCase()} on ${worst.name} is ${SnmpFibreChannelCriteria.formatRate(worst.rate)} per second, ${comparison} ${SnmpFibreChannelCriteria.formatRate(threshold)}.`;
  }

  // What the criteria saw, matched or not, for the evaluation's evidence.
  public static describeObservation(data: {
    interfaces: Array<SnmpInterface> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const counter: FibreChannelCounter | undefined =
      SnmpFibreChannelUtil.parseCounter(
        data.criteriaFilter.snmpMonitorOptions?.fibreChannelCounter,
      );

    if (!counter) {
      return "No Fibre Channel counter is chosen on this criteria. Pick one in the criteria editor.";
    }

    const title: string = FIBRE_CHANNEL_COUNTER_TITLES[counter].toLowerCase();

    const hasFibreChannelPorts: boolean = (data.interfaces || []).some(
      (snmpInterface: SnmpInterface) => {
        return Boolean(snmpInterface.fibreChannel);
      },
    );

    if (!hasFibreChannelPorts) {
      return "The device reported no Fibre Channel ports on this poll.";
    }

    const worst: PortRate | undefined = SnmpFibreChannelCriteria.worstPort({
      interfaces: data.interfaces || [],
      counter: counter,
    });

    if (!worst) {
      return `No port has a rate for Fibre Channel ${title} yet: it needs two polls, and a counter that went back (wrapped, or the switch's counters were cleared) starts again.`;
    }

    return `Fibre Channel ${title}: highest on ${worst.name}, ${SnmpFibreChannelCriteria.formatRate(worst.rate)} per second.`;
  }

  public static worstPort(data: {
    interfaces: Array<SnmpInterface>;
    counter: FibreChannelCounter;
  }): PortRate | undefined {
    let worst: PortRate | undefined = undefined;

    for (const snmpInterface of data.interfaces) {
      const rate: number | undefined =
        snmpInterface.fibreChannel?.ratesPerSecond?.[data.counter];

      if (typeof rate !== "number" || !Number.isFinite(rate)) {
        continue;
      }

      if (!worst || rate > worst.rate) {
        worst = {
          name: snmpInterface.name || `ifIndex ${snmpInterface.interfaceIndex}`,
          rate: rate,
        };
      }
    }

    return worst;
  }

  // Up to four decimals, without trailing zeros: 0.0033, 2, 12.5.
  public static formatRate(rate: number): string {
    return String(Math.round(rate * 10000) / 10000);
  }
}
