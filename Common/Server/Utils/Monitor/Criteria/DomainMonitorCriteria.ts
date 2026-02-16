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

export default class DomainMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const domainResponse: DomainMonitorResponse | undefined =
      dataToProcess.domainResponse;

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
