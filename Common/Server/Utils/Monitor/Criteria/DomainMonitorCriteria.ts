import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import DomainMonitorResponse from "../../../../Types/Monitor/DomainMonitor/DomainMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";

export default class DomainMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor's monitoringInterval cron. Over-time filters use it to
     * work out how many samples a fully covered window should hold, so a
     * monitor that has only just started is not mistaken for one whose
     * whole window is breaching.
     */
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const domainResponse: DomainMonitorResponse | undefined =
      dataToProcess.domainResponse;

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: dataToProcess.projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });

    /*
     * The window could not back this over-time filter (nothing recorded yet,
     * or the monitor has not been running long enough to cover it). Return
     * the decision the no-data policy already made instead of falling
     * through to the value that arrived with this one check - that fallback
     * is what let "all values over the last N minutes" fire off a single
     * bad reading.
     */
    if (overTime.earlyReturn) {
      return overTime.earlyReturn.result;
    }

    const overTimeValue:
      | Array<number | boolean>
      | number
      | boolean
      | undefined = overTime.value;

    /*
     * Whether the registration lookup itself succeeded. Without this, a
     * domain whose TLD has no working WHOIS or RDAP service produces a
     * response with no expiry date, every Domain* filter below returns null,
     * and the monitor silently keeps its previous status - which is what
     * made an unsupported TLD look healthy.
     */
    if (input.criteriaFilter.checkOn === CheckOn.IsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ?? dataToProcess.isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsRequestTimeout) {
      const currentIsTimeout: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ?? dataToProcess.isTimeout;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsTimeout,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check domain expires in days
    if (input.criteriaFilter.checkOn === CheckOn.DomainExpiresDaysIn) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      if (!domainResponse?.expiresDate) {
        return null;
      }

      const expiresDate: Date = new Date(domainResponse.expiresDate);
      const now: Date = new Date();
      const diffMs: number = expiresDate.getTime() - now.getTime();
      const diffDays: number = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      return CompareCriteria.compareCriteriaNumbers({
        value: diffDays,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check domain registrar
    if (input.criteriaFilter.checkOn === CheckOn.DomainRegistrar) {
      if (!domainResponse?.registrar) {
        return null;
      }

      return CompareCriteria.compareCriteriaStrings({
        value: domainResponse.registrar,
        threshold: String(threshold),
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check domain name server
    if (input.criteriaFilter.checkOn === CheckOn.DomainNameServer) {
      if (
        !domainResponse?.nameServers ||
        domainResponse.nameServers.length === 0
      ) {
        return null;
      }

      // Check if any name server matches the criteria
      for (const nameServer of domainResponse.nameServers) {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: nameServer,
          threshold: String(threshold),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return `Domain name server: ${result}`;
        }
      }

      return null;
    }

    // Check domain status code
    if (input.criteriaFilter.checkOn === CheckOn.DomainStatusCode) {
      if (
        !domainResponse?.domainStatus ||
        domainResponse.domainStatus.length === 0
      ) {
        return null;
      }

      // Check if any status matches the criteria
      for (const status of domainResponse.domainStatus) {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: status,
          threshold: String(threshold),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return `Domain status: ${result}`;
        }
      }

      return null;
    }

    // Check if domain is expired
    if (input.criteriaFilter.checkOn === CheckOn.DomainIsExpired) {
      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;
      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (!domainResponse?.expiresDate) {
        return null;
      }

      const expiresDate: Date = new Date(domainResponse.expiresDate);
      const now: Date = new Date();
      const isExpired: boolean = expiresDate.getTime() < now.getTime();

      if (isExpired && isTrue) {
        return `Domain is expired (expired on ${domainResponse.expiresDate}).`;
      }

      if (!isExpired && isFalse) {
        return `Domain is not expired (expires on ${domainResponse.expiresDate}).`;
      }

      return null;
    }

    return null;
  }
}
