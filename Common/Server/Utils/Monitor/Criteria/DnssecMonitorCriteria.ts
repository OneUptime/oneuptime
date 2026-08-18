import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import DnssecMonitorResponse from "../../../../Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class DnssecMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const dnssecResponse: DnssecMonitorResponse | undefined =
      dataToProcess.dnssecResponse;

    /*
     * Reachability is read straight off the probe response and is meaningful
     * even when the DNSSEC query produced no result at all, so these are
     * answered before the dnssecResponse guard below.
     *
     * They were missing entirely, which made an "Is Online" filter on a DNSSEC
     * monitor silently inert - it could never match in either direction, and a
     * criteria that never matches leaves the monitor parked at its default
     * status with no timeline event and no error. The dashboard's "Add Filter"
     * button seeded exactly that filter.
     */
    if (input.criteriaFilter.checkOn === CheckOn.IsOnline) {
      if (dataToProcess.isOnline === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaBoolean({
        value: dataToProcess.isOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsRequestTimeout) {
      if (dataToProcess.isTimeout === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaBoolean({
        value: dataToProcess.isTimeout,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (!dnssecResponse) {
      return null;
    }

    const isTrue: boolean = input.criteriaFilter.filterType === FilterType.True;
    const isFalse: boolean =
      input.criteriaFilter.filterType === FilterType.False;

    if (input.criteriaFilter.checkOn === CheckOn.DnssecChainValid) {
      if (dnssecResponse.isChainValid && isTrue) {
        return `DNSSEC chain is valid for ${dnssecResponse.domainName}.`;
      }
      if (!dnssecResponse.isChainValid && isFalse) {
        return `DNSSEC chain validation failed for ${dnssecResponse.domainName}.`;
      }
      return null;
    }

    if (input.criteriaFilter.checkOn === CheckOn.DnssecDnskeyExists) {
      const exists: boolean = dnssecResponse.dnskeys.length > 0;
      if (exists && isTrue) {
        return `DNSKEY records present for ${dnssecResponse.domainName}.`;
      }
      if (!exists && isFalse) {
        return `No DNSKEY records found for ${dnssecResponse.domainName}.`;
      }
      return null;
    }

    if (input.criteriaFilter.checkOn === CheckOn.DnssecDsExists) {
      const exists: boolean = dnssecResponse.isParentDsPresent;
      if (exists && isTrue) {
        return `DS records present at parent zone for ${dnssecResponse.domainName}.`;
      }
      if (!exists && isFalse) {
        return `No DS records found at the parent zone for ${dnssecResponse.domainName}.`;
      }
      return null;
    }

    if (input.criteriaFilter.checkOn === CheckOn.DnssecResolverConsensus) {
      const consensus: boolean = dnssecResponse.resolverConsensusAd;
      if (consensus && isTrue) {
        return `All resolvers report DNSSEC-valid (AD flag) for ${dnssecResponse.domainName}.`;
      }
      if (!consensus && isFalse) {
        return `Resolvers do not agree on DNSSEC validity for ${dnssecResponse.domainName}.`;
      }
      return null;
    }

    if (input.criteriaFilter.checkOn === CheckOn.DnssecNameserverConsistent) {
      const consistent: boolean = dnssecResponse.isNameserverConsistent;
      if (consistent && isTrue) {
        return `Authoritative nameservers are consistent for ${dnssecResponse.domainName}.`;
      }
      if (!consistent && isFalse) {
        return `Authoritative nameservers are inconsistent for ${dnssecResponse.domainName}.`;
      }
      return null;
    }

    if (input.criteriaFilter.checkOn === CheckOn.DnssecSignatureExpiresInDays) {
      const threshold: number | null = CompareCriteria.convertToNumber(
        input.criteriaFilter.value,
      );

      if (threshold === null || threshold === undefined) {
        return null;
      }

      if (dnssecResponse.daysUntilSignatureExpiry === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: dnssecResponse.daysUntilSignatureExpiry,
        threshold: threshold,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
