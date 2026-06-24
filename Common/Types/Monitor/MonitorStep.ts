import HTTPMethod from "../API/HTTPMethod";
import Hostname from "../API/Hostname";
import URL from "../API/URL";
import DatabaseProperty from "../Database/DatabaseProperty";
import Dictionary from "../Dictionary";
import BadDataException from "../Exception/BadDataException";
import IP from "../IP/IP";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import Port from "../Port";
import MonitorCriteria from "./MonitorCriteria";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "./MonitorStepLogMonitor";
import MonitorType from "./MonitorType";
import BrowserType from "./SyntheticMonitors//BrowserType";
import ScreenSizeType from "./SyntheticMonitors/ScreenSizeType";
import { FindOperator } from "typeorm";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "./MonitorStepTraceMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "./MonitorStepMetricMonitor";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "./MonitorStepExceptionMonitor";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "./MonitorStepProfileMonitor";
import MonitorStepSnmpMonitor, {
  MonitorStepSnmpMonitorUtil,
} from "./MonitorStepSnmpMonitor";
import MonitorStepDnsMonitor, {
  MonitorStepDnsMonitorUtil,
} from "./MonitorStepDnsMonitor";
import MonitorStepDomainMonitor, {
  MonitorStepDomainMonitorUtil,
} from "./MonitorStepDomainMonitor";
import MonitorStepDnssecMonitor, {
  MonitorStepDnssecMonitorUtil,
} from "./MonitorStepDnssecMonitor";
import MonitorStepExternalStatusPageMonitor, {
  MonitorStepExternalStatusPageMonitorUtil,
} from "./MonitorStepExternalStatusPageMonitor";
import MonitorStepKubernetesMonitor, {
  MonitorStepKubernetesMonitorUtil,
} from "./MonitorStepKubernetesMonitor";
import MonitorStepDockerMonitor, {
  MonitorStepDockerMonitorUtil,
} from "./MonitorStepDockerMonitor";
import MonitorStepHostMonitor, {
  MonitorStepHostMonitorUtil,
} from "./MonitorStepHostMonitor";
import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "./MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
} from "./MonitorStepProxmoxMonitor";
import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
} from "./MonitorStepDockerSwarmMonitor";
import MonitorStepCephMonitor, {
  MonitorStepCephMonitorUtil,
} from "./MonitorStepCephMonitor";
import MonitorStepIoTMonitor, {
  MonitorStepIoTMonitorUtil,
} from "./MonitorStepIoTMonitor";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

/*
 * Caps and defaults for per-step request timeout and retry settings.
 * Users may lower these via the UI; values higher than the cap are clamped.
 */
export const MAX_MONITOR_REQUEST_TIMEOUT_IN_MS: number = 60000; // 60 seconds
export const DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS: number = 60000;
export const MAX_MONITOR_RETRY_COUNT: number = 3;
export const DEFAULT_MONITOR_RETRY_COUNT: number = 3;

export const clampMonitorRequestTimeoutInMs: (value: number) => number = (
  value: number,
): number => {
  if (!value || value <= 0) {
    return DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS;
  }
  if (value > MAX_MONITOR_REQUEST_TIMEOUT_IN_MS) {
    return MAX_MONITOR_REQUEST_TIMEOUT_IN_MS;
  }
  return value;
};

export const clampMonitorRetryCount: (value: number) => number = (
  value: number,
): number => {
  if (value === undefined || value === null || isNaN(value) || value < 0) {
    return DEFAULT_MONITOR_RETRY_COUNT;
  }
  if (value > MAX_MONITOR_RETRY_COUNT) {
    return MAX_MONITOR_RETRY_COUNT;
  }
  return value;
};

export interface MonitorStepType {
  id: string;
  monitorDestination?: URL | IP | Hostname | undefined;

  monitorCriteria: MonitorCriteria;

  // this is for API monitor.
  requestType: HTTPMethod;
  requestHeaders?: Dictionary<string> | undefined;
  requestBody?: string | undefined;

  // this is used for API and Website monitor
  doNotFollowRedirects?: boolean | undefined;
  allowSelfSignedCertificates?: boolean | undefined;

  /*
   * mTLS / client certificate authentication (API and Website monitors).
   * Values can be raw PEM strings or {{monitorSecrets.name}} references.
   */
  tlsClientCertificate?: string | undefined;
  tlsClientKey?: string | undefined;
  tlsClientKeyPassphrase?: string | undefined;

  // this is for port monitors.
  monitorDestinationPort?: Port | undefined;

  // this is for custom code monitors or synthetic monitors.
  customCode?: string | undefined;

  // this is for synthetic monitors.
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;

  // retry count for synthetic monitors - number of times to retry on error
  retryCountOnError?: number | undefined;

  /*
   * Per-step request timeout in milliseconds for probe-based monitors
   * (Website, API, Ping, IP, Port, SSLCertificate). Defaults to and is
   * capped at 60000 ms (60 seconds).
   */
  requestTimeoutInMs?: number | undefined;

  /*
   * Per-step retry count for probe-based monitors when a check fails.
   * Defaults to and is capped at 3.
   */
  retryCount?: number | undefined;

  // Log monitor type.
  logMonitor?: MonitorStepLogMonitor | undefined;

  // trace monitor type.
  traceMonitor?: MonitorStepTraceMonitor | undefined;

  // Metric Monitor
  metricMonitor: MonitorStepMetricMonitor | undefined;

  // Exception monitor
  exceptionMonitor?: MonitorStepExceptionMonitor | undefined;

  // Profile monitor
  profileMonitor?: MonitorStepProfileMonitor | undefined;

  // SNMP monitor
  snmpMonitor?: MonitorStepSnmpMonitor | undefined;

  // DNS monitor
  dnsMonitor?: MonitorStepDnsMonitor | undefined;

  // Domain monitor
  domainMonitor?: MonitorStepDomainMonitor | undefined;

  // DNSSEC monitor
  dnssecMonitor?: MonitorStepDnssecMonitor | undefined;

  // External Status Page monitor
  externalStatusPageMonitor?: MonitorStepExternalStatusPageMonitor | undefined;

  // Kubernetes monitor
  kubernetesMonitor?: MonitorStepKubernetesMonitor | undefined;

  // Docker monitor
  dockerMonitor?: MonitorStepDockerMonitor | undefined;

  // Host monitor
  hostMonitor?: MonitorStepHostMonitor | undefined;

  // Podman monitor
  podmanMonitor?: MonitorStepPodmanMonitor | undefined;

  // Proxmox monitor
  proxmoxMonitor?: MonitorStepProxmoxMonitor | undefined;

  // Docker Swarm monitor
  dockerSwarmMonitor?: MonitorStepDockerSwarmMonitor | undefined;

  // Ceph monitor
  cephMonitor?: MonitorStepCephMonitor | undefined;

  // IoT monitor
  iotMonitor?: MonitorStepIoTMonitor | undefined;
}

export default class MonitorStep extends DatabaseProperty {
  public data: MonitorStepType | undefined = undefined;

  public constructor() {
    super();

    this.data = {
      id: ObjectID.generate().toString(),
      monitorDestination: undefined,
      doNotFollowRedirects: undefined,
      allowSelfSignedCertificates: undefined,
      tlsClientCertificate: undefined,
      tlsClientKey: undefined,
      tlsClientKeyPassphrase: undefined,
      monitorDestinationPort: undefined,
      monitorCriteria: new MonitorCriteria(),
      requestType: HTTPMethod.GET,
      requestHeaders: undefined,
      requestBody: undefined,
      customCode: undefined,
      screenSizeTypes: undefined,
      browserTypes: undefined,
      retryCountOnError: undefined,
      requestTimeoutInMs: undefined,
      retryCount: undefined,
      logMonitor: undefined,
      traceMonitor: undefined,
      metricMonitor: undefined,
      exceptionMonitor: undefined,
      profileMonitor: undefined,
      snmpMonitor: undefined,
      dnsMonitor: undefined,
      domainMonitor: undefined,
      dnssecMonitor: undefined,
      externalStatusPageMonitor: undefined,
      kubernetesMonitor: undefined,
      dockerMonitor: undefined,
      hostMonitor: undefined,
      podmanMonitor: undefined,
      proxmoxMonitor: undefined,
      dockerSwarmMonitor: undefined,
      cephMonitor: undefined,
      iotMonitor: undefined,
    };
  }

  public static getDefaultMonitorStep(arg: {
    monitorName: string;
    monitorType: MonitorType;
    onlineMonitorStatusId: ObjectID;
    offlineMonitorStatusId: ObjectID;
    defaultIncidentSeverityId: ObjectID;
    defaultAlertSeverityId: ObjectID;
  }): MonitorStep {
    const monitorStep: MonitorStep = new MonitorStep();

    monitorStep.data = {
      id: ObjectID.generate().toString(),
      monitorDestination: undefined,
      doNotFollowRedirects: undefined,
      allowSelfSignedCertificates: undefined,
      tlsClientCertificate: undefined,
      tlsClientKey: undefined,
      tlsClientKeyPassphrase: undefined,
      monitorDestinationPort: undefined,
      monitorCriteria: MonitorCriteria.getDefaultMonitorCriteria(arg),
      requestType: HTTPMethod.GET,
      requestHeaders: undefined,
      requestBody: undefined,
      customCode: undefined,
      screenSizeTypes: undefined,
      browserTypes: undefined,
      retryCountOnError: undefined,
      requestTimeoutInMs: undefined,
      retryCount: undefined,
      logMonitor: undefined,
      traceMonitor: undefined,
      metricMonitor: undefined,
      exceptionMonitor: undefined,
      profileMonitor: undefined,
      snmpMonitor: undefined,
      dnsMonitor: undefined,
      domainMonitor: undefined,
      dnssecMonitor: undefined,
      externalStatusPageMonitor: undefined,
      kubernetesMonitor: undefined,
      dockerMonitor: undefined,
      hostMonitor: undefined,
      podmanMonitor: undefined,
      proxmoxMonitor: undefined,
      dockerSwarmMonitor: undefined,
      cephMonitor: undefined,
      iotMonitor: undefined,
    };

    return monitorStep;
  }

  public get id(): ObjectID {
    return new ObjectID(this.data?.id as string);
  }

  public set id(v: ObjectID) {
    this.data!.id = v.toString();
  }

  public setRequestType(requestType: HTTPMethod): MonitorStep {
    this.data!.requestType = requestType;
    return this;
  }

  public setRequestHeaders(requestHeaders: Dictionary<string>): MonitorStep {
    this.data!.requestHeaders = requestHeaders;
    return this;
  }

  public static clone(monitorStep: MonitorStep): MonitorStep {
    return MonitorStep.fromJSON(monitorStep.toJSON());
  }

  public setRequestBody(requestBody: string): MonitorStep {
    this.data!.requestBody = requestBody;
    return this;
  }

  public setMonitorDestination(
    monitorDestination: URL | IP | Hostname,
  ): MonitorStep {
    this.data!.monitorDestination = monitorDestination;
    return this;
  }

  public setDoNotFollowRedirects(doNotFollowRedirects: boolean): MonitorStep {
    this.data!.doNotFollowRedirects = doNotFollowRedirects;
    return this;
  }

  public setAllowSelfSignedCertificates(
    allowSelfSignedCertificates: boolean,
  ): MonitorStep {
    this.data!.allowSelfSignedCertificates = allowSelfSignedCertificates;
    return this;
  }

  public setTlsClientCertificate(
    tlsClientCertificate: string | undefined,
  ): MonitorStep {
    this.data!.tlsClientCertificate = tlsClientCertificate || undefined;
    return this;
  }

  public setTlsClientKey(tlsClientKey: string | undefined): MonitorStep {
    this.data!.tlsClientKey = tlsClientKey || undefined;
    return this;
  }

  public setTlsClientKeyPassphrase(
    tlsClientKeyPassphrase: string | undefined,
  ): MonitorStep {
    this.data!.tlsClientKeyPassphrase = tlsClientKeyPassphrase || undefined;
    return this;
  }

  public setPort(monitorDestinationPort: Port): MonitorStep {
    this.data!.monitorDestinationPort = monitorDestinationPort;
    return this;
  }

  public setScreenSizeTypes(
    screenSizeTypes: Array<ScreenSizeType>,
  ): MonitorStep {
    this.data!.screenSizeTypes = screenSizeTypes;
    return this;
  }

  public setBrowserTypes(browserTypes: Array<BrowserType>): MonitorStep {
    this.data!.browserTypes = browserTypes;
    return this;
  }

  public setRetryCountOnError(retryCountOnError: number): MonitorStep {
    this.data!.retryCountOnError = retryCountOnError;
    return this;
  }

  public setRequestTimeoutInMs(
    requestTimeoutInMs: number | undefined,
  ): MonitorStep {
    if (requestTimeoutInMs === undefined) {
      this.data!.requestTimeoutInMs = undefined;
      return this;
    }
    this.data!.requestTimeoutInMs =
      clampMonitorRequestTimeoutInMs(requestTimeoutInMs);
    return this;
  }

  public setRetryCount(retryCount: number | undefined): MonitorStep {
    if (retryCount === undefined) {
      this.data!.retryCount = undefined;
      return this;
    }
    this.data!.retryCount = clampMonitorRetryCount(retryCount);
    return this;
  }

  public setLogMonitor(logMonitor: MonitorStepLogMonitor): MonitorStep {
    this.data!.logMonitor = logMonitor;
    return this;
  }

  public setMetricMonitor(
    metricMonitor: MonitorStepMetricMonitor,
  ): MonitorStep {
    this.data!.metricMonitor = metricMonitor;
    return this;
  }

  public setTraceMonitor(traceMonitor: MonitorStepTraceMonitor): MonitorStep {
    this.data!.traceMonitor = traceMonitor;
    return this;
  }

  public setExceptionMonitor(
    exceptionMonitor: MonitorStepExceptionMonitor,
  ): MonitorStep {
    this.data!.exceptionMonitor = exceptionMonitor;
    return this;
  }

  public setProfileMonitor(
    profileMonitor: MonitorStepProfileMonitor,
  ): MonitorStep {
    this.data!.profileMonitor = profileMonitor;
    return this;
  }

  public setSnmpMonitor(snmpMonitor: MonitorStepSnmpMonitor): MonitorStep {
    this.data!.snmpMonitor = snmpMonitor;
    return this;
  }

  public setDnsMonitor(dnsMonitor: MonitorStepDnsMonitor): MonitorStep {
    this.data!.dnsMonitor = dnsMonitor;
    return this;
  }

  public setDomainMonitor(
    domainMonitor: MonitorStepDomainMonitor,
  ): MonitorStep {
    this.data!.domainMonitor = domainMonitor;
    return this;
  }

  public setDnssecMonitor(
    dnssecMonitor: MonitorStepDnssecMonitor,
  ): MonitorStep {
    this.data!.dnssecMonitor = dnssecMonitor;
    return this;
  }

  public setExternalStatusPageMonitor(
    externalStatusPageMonitor: MonitorStepExternalStatusPageMonitor,
  ): MonitorStep {
    this.data!.externalStatusPageMonitor = externalStatusPageMonitor;
    return this;
  }

  public setKubernetesMonitor(
    kubernetesMonitor: MonitorStepKubernetesMonitor,
  ): MonitorStep {
    this.data!.kubernetesMonitor = kubernetesMonitor;
    return this;
  }

  public setDockerMonitor(
    dockerMonitor: MonitorStepDockerMonitor,
  ): MonitorStep {
    this.data!.dockerMonitor = dockerMonitor;
    return this;
  }

  public setHostMonitor(hostMonitor: MonitorStepHostMonitor): MonitorStep {
    this.data!.hostMonitor = hostMonitor;
    return this;
  }

  public setPodmanMonitor(
    podmanMonitor: MonitorStepPodmanMonitor,
  ): MonitorStep {
    this.data!.podmanMonitor = podmanMonitor;
    return this;
  }

  public setProxmoxMonitor(
    proxmoxMonitor: MonitorStepProxmoxMonitor,
  ): MonitorStep {
    this.data!.proxmoxMonitor = proxmoxMonitor;
    return this;
  }

  public setDockerSwarmMonitor(
    dockerSwarmMonitor: MonitorStepDockerSwarmMonitor,
  ): MonitorStep {
    this.data!.dockerSwarmMonitor = dockerSwarmMonitor;
    return this;
  }

  public setCephMonitor(cephMonitor: MonitorStepCephMonitor): MonitorStep {
    this.data!.cephMonitor = cephMonitor;
    return this;
  }

  public setIoTMonitor(iotMonitor: MonitorStepIoTMonitor): MonitorStep {
    this.data!.iotMonitor = iotMonitor;
    return this;
  }

  public setCustomCode(customCode: string): MonitorStep {
    this.data!.customCode = customCode;
    return this;
  }

  public setMonitorCriteria(monitorCriteria: MonitorCriteria): MonitorStep {
    this.data!.monitorCriteria = monitorCriteria;
    return this;
  }

  public static getNewMonitorStepAsJSON(): JSONObject {
    return {
      _type: ObjectType.MonitorStep,
      value: {
        id: ObjectID.generate().toString(),
        monitorDestination: undefined,
        doNotFollowRedirects: undefined,
        allowSelfSignedCertificates: undefined,
        tlsClientCertificate: undefined,
        tlsClientKey: undefined,
        tlsClientKeyPassphrase: undefined,
        monitorDestinationPort: undefined,
        monitorCriteria: MonitorCriteria.getNewMonitorCriteriaAsJSON(),
        requestType: HTTPMethod.GET,
        requestHeaders: undefined,
        requestBody: undefined,
        customCode: undefined,
        screenSizeTypes: undefined,
        browserTypes: undefined,
        retryCountOnError: undefined,
        requestTimeoutInMs: undefined,
        retryCount: undefined,
        logMonitor: undefined,
        exceptionMonitor: undefined,
        kubernetesMonitor: undefined,
        dockerMonitor: undefined,
        hostMonitor: undefined,
        podmanMonitor: undefined,
        proxmoxMonitor: undefined,
        dockerSwarmMonitor: undefined,
        cephMonitor: undefined,
        iotMonitor: undefined,
      },
    };
  }

  public static getValidationError(
    value: MonitorStep,
    monitorType: MonitorType,
  ): string | null {
    if (!value.data) {
      return "Monitor Step is required.";
    }

    // If the monitor type is incoming request, then the monitor destination is not required
    if (
      !value.data.monitorDestination &&
      (monitorType === MonitorType.Port ||
        monitorType === MonitorType.API ||
        monitorType === MonitorType.Ping ||
        monitorType === MonitorType.Website ||
        monitorType === MonitorType.IP ||
        monitorType === MonitorType.SSLCertificate)
    ) {
      return "Monitor Destination is required.";
    }

    if (
      !value.data.customCode &&
      (monitorType === MonitorType.CustomJavaScriptCode ||
        monitorType === MonitorType.SyntheticMonitor)
    ) {
      if (monitorType === MonitorType.CustomJavaScriptCode) {
        return "Custom Code is required";
      }
      return "Playwright code is required.";
    }

    if (!value.data.monitorCriteria) {
      return "Monitor Criteria is required";
    }

    if (
      MonitorCriteria.getValidationError(
        value.data.monitorCriteria,
        monitorType,
      )
    ) {
      return MonitorCriteria.getValidationError(
        value.data.monitorCriteria,
        monitorType,
      );
    }

    if (!value.data.requestType && monitorType === MonitorType.API) {
      return "Request Type is required";
    }

    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website
    ) {
      const hasCert: boolean = Boolean(
        value.data.tlsClientCertificate &&
          value.data.tlsClientCertificate.trim(),
      );
      const hasKey: boolean = Boolean(
        value.data.tlsClientKey && value.data.tlsClientKey.trim(),
      );
      if (hasCert && !hasKey) {
        return "Client private key is required when a client certificate is provided";
      }
      if (hasKey && !hasCert) {
        return "Client certificate is required when a client private key is provided";
      }
    }

    if (
      monitorType === MonitorType.Port &&
      !value.data.monitorDestinationPort
    ) {
      return "Port is required";
    }

    if (monitorType === MonitorType.SNMP) {
      if (!value.data.snmpMonitor) {
        return "SNMP configuration is required";
      }

      if (!value.data.snmpMonitor.hostname) {
        return "SNMP hostname is required";
      }

      if (
        !value.data.snmpMonitor.oids ||
        value.data.snmpMonitor.oids.length === 0
      ) {
        return "At least one OID is required";
      }
    }

    if (monitorType === MonitorType.DNS) {
      if (!value.data.dnsMonitor) {
        return "DNS configuration is required";
      }

      if (!value.data.dnsMonitor.queryName) {
        return "DNS query name (domain) is required";
      }
    }

    if (monitorType === MonitorType.Domain) {
      if (!value.data.domainMonitor) {
        return "Domain configuration is required";
      }

      if (!value.data.domainMonitor.domainName) {
        return "Domain name is required";
      }
    }

    if (monitorType === MonitorType.DNSSEC) {
      if (!value.data.dnssecMonitor) {
        return "DNSSEC configuration is required";
      }

      if (!value.data.dnssecMonitor.domainName) {
        return "Domain name is required";
      }

      if (
        !value.data.dnssecMonitor.resolvers ||
        value.data.dnssecMonitor.resolvers.length === 0
      ) {
        return "At least one resolver is required";
      }
    }

    if (monitorType === MonitorType.ExternalStatusPage) {
      if (!value.data.externalStatusPageMonitor) {
        return "External status page configuration is required";
      }

      if (!value.data.externalStatusPageMonitor.statusPageUrl) {
        return "Status page URL is required";
      }
    }

    if (monitorType === MonitorType.Kubernetes) {
      if (!value.data.kubernetesMonitor) {
        return "Kubernetes monitor configuration is required";
      }

      if (!value.data.kubernetesMonitor.clusterIdentifier) {
        return "Kubernetes cluster is required";
      }
    }

    if (monitorType === MonitorType.Docker) {
      if (!value.data.dockerMonitor) {
        return "Docker monitor configuration is required";
      }

      if (!value.data.dockerMonitor.hostIdentifier) {
        return "Docker host is required";
      }
    }

    if (monitorType === MonitorType.Host) {
      if (!value.data.hostMonitor) {
        return "Host monitor configuration is required";
      }

      if (!value.data.hostMonitor.hostIdentifier) {
        return "Host is required";
      }
    }

    if (monitorType === MonitorType.Podman) {
      if (!value.data.podmanMonitor) {
        return "Podman monitor configuration is required";
      }

      if (!value.data.podmanMonitor.hostIdentifier) {
        return "Podman host is required";
      }
    }

    if (monitorType === MonitorType.Proxmox) {
      if (!value.data.proxmoxMonitor) {
        return "Proxmox monitor configuration is required";
      }

      if (!value.data.proxmoxMonitor.clusterIdentifier) {
        return "Proxmox cluster is required";
      }
    }

    if (monitorType === MonitorType.DockerSwarm) {
      if (!value.data.dockerSwarmMonitor) {
        return "Docker Swarm monitor configuration is required";
      }

      if (!value.data.dockerSwarmMonitor.clusterIdentifier) {
        return "Docker Swarm cluster is required";
      }
    }

    if (monitorType === MonitorType.Ceph) {
      if (!value.data.cephMonitor) {
        return "Ceph monitor configuration is required";
      }

      if (!value.data.cephMonitor.clusterIdentifier) {
        return "Ceph cluster is required";
      }
    }

    if (monitorType === MonitorType.IoTDevice) {
      if (!value.data.iotMonitor) {
        return "IoT monitor configuration is required";
      }

      if (!value.data.iotMonitor.fleetIdentifier) {
        return "IoT fleet is required";
      }
    }

    return null;
  }

  public override toJSON(): JSONObject {
    if (this.data) {
      return JSONFunctions.serialize({
        _type: ObjectType.MonitorStep,
        value: {
          id: this.data.id,
          monitorDestination:
            this.data?.monitorDestination?.toJSON() || undefined,
          doNotFollowRedirects: this.data.doNotFollowRedirects || undefined,
          allowSelfSignedCertificates:
            this.data.allowSelfSignedCertificates || undefined,
          tlsClientCertificate: this.data.tlsClientCertificate || undefined,
          tlsClientKey: this.data.tlsClientKey || undefined,
          tlsClientKeyPassphrase: this.data.tlsClientKeyPassphrase || undefined,
          monitorDestinationPort:
            this.data?.monitorDestinationPort?.toJSON() || undefined,
          monitorCriteria: this.data.monitorCriteria.toJSON(),
          requestType: this.data.requestType,
          requestHeaders: this.data.requestHeaders || undefined,
          requestBody: this.data.requestBody || undefined,
          customCode: this.data.customCode || undefined,
          screenSizeTypes: this.data.screenSizeTypes || undefined,
          browserTypes: this.data.browserTypes || undefined,
          retryCountOnError: this.data.retryCountOnError || undefined,
          requestTimeoutInMs: this.data.requestTimeoutInMs || undefined,
          retryCount:
            this.data.retryCount === undefined
              ? undefined
              : this.data.retryCount,
          logMonitor: this.data.logMonitor
            ? MonitorStepLogMonitorUtil.toJSON(
                this.data.logMonitor || MonitorStepLogMonitorUtil.getDefault(),
              )
            : undefined,
          metricMonitor: this.data.metricMonitor
            ? MonitorStepMetricMonitorUtil.toJSON(this.data.metricMonitor)
            : undefined,
          traceMonitor: this.data.traceMonitor
            ? MonitorStepTraceMonitorUtil.toJSON(
                this.data.traceMonitor ||
                  MonitorStepTraceMonitorUtil.getDefault(),
              )
            : undefined,
          exceptionMonitor: this.data.exceptionMonitor
            ? MonitorStepExceptionMonitorUtil.toJSON(
                this.data.exceptionMonitor ||
                  MonitorStepExceptionMonitorUtil.getDefault(),
              )
            : undefined,
          profileMonitor: this.data.profileMonitor
            ? MonitorStepProfileMonitorUtil.toJSON(
                this.data.profileMonitor ||
                  MonitorStepProfileMonitorUtil.getDefault(),
              )
            : undefined,
          snmpMonitor: this.data.snmpMonitor
            ? MonitorStepSnmpMonitorUtil.toJSON(this.data.snmpMonitor)
            : undefined,
          dnsMonitor: this.data.dnsMonitor
            ? MonitorStepDnsMonitorUtil.toJSON(this.data.dnsMonitor)
            : undefined,
          domainMonitor: this.data.domainMonitor
            ? MonitorStepDomainMonitorUtil.toJSON(this.data.domainMonitor)
            : undefined,
          dnssecMonitor: this.data.dnssecMonitor
            ? MonitorStepDnssecMonitorUtil.toJSON(this.data.dnssecMonitor)
            : undefined,
          externalStatusPageMonitor: this.data.externalStatusPageMonitor
            ? MonitorStepExternalStatusPageMonitorUtil.toJSON(
                this.data.externalStatusPageMonitor,
              )
            : undefined,
          kubernetesMonitor: this.data.kubernetesMonitor
            ? MonitorStepKubernetesMonitorUtil.toJSON(
                this.data.kubernetesMonitor,
              )
            : undefined,
          dockerMonitor: this.data.dockerMonitor
            ? MonitorStepDockerMonitorUtil.toJSON(this.data.dockerMonitor)
            : undefined,
          hostMonitor: this.data.hostMonitor
            ? MonitorStepHostMonitorUtil.toJSON(this.data.hostMonitor)
            : undefined,
          podmanMonitor: this.data.podmanMonitor
            ? MonitorStepPodmanMonitorUtil.toJSON(this.data.podmanMonitor)
            : undefined,
          proxmoxMonitor: this.data.proxmoxMonitor
            ? MonitorStepProxmoxMonitorUtil.toJSON(this.data.proxmoxMonitor)
            : undefined,
          dockerSwarmMonitor: this.data.dockerSwarmMonitor
            ? MonitorStepDockerSwarmMonitorUtil.toJSON(
                this.data.dockerSwarmMonitor,
              )
            : undefined,
          cephMonitor: this.data.cephMonitor
            ? MonitorStepCephMonitorUtil.toJSON(this.data.cephMonitor)
            : undefined,
          iotMonitor: this.data.iotMonitor
            ? MonitorStepIoTMonitorUtil.toJSON(this.data.iotMonitor)
            : undefined,
        },
      });
    }

    return MonitorStep.getNewMonitorStepAsJSON();
  }

  public static override fromJSON(json: JSONObject): MonitorStep {
    if (json instanceof MonitorStep) {
      return json;
    }

    if (!json || json["_type"] !== "MonitorStep") {
      throw new BadDataException("Invalid monitor step");
    }

    if (!json["value"]) {
      throw new BadDataException("Invalid monitor step");
    }

    json = json["value"] as JSONObject;

    let monitorDestination: URL | IP | Hostname | undefined = undefined;

    if (
      json &&
      json["monitorDestination"] &&
      (json["monitorDestination"] as JSONObject)["_type"] === ObjectType.URL
    ) {
      monitorDestination = URL.fromJSON(
        json["monitorDestination"] as JSONObject,
      );
    }

    if (
      json &&
      json["monitorDestination"] &&
      (json["monitorDestination"] as JSONObject)["_type"] ===
        ObjectType.Hostname
    ) {
      monitorDestination = Hostname.fromJSON(
        json["monitorDestination"] as JSONObject,
      );
    }

    if (
      json &&
      json["monitorDestination"] &&
      (json["monitorDestination"] as JSONObject)["_type"] === ObjectType.IP
    ) {
      monitorDestination = IP.fromJSON(
        json["monitorDestination"] as JSONObject,
      );
    }

    const monitorDestinationPort: Port | undefined = json[
      "monitorDestinationPort"
    ]
      ? Port.fromJSON(json["monitorDestinationPort"] as JSONObject)
      : undefined;

    if (!json["monitorCriteria"]) {
      throw new BadDataException("Invalid monitor criteria");
    }

    if (
      MonitorCriteria.isValid(json["monitorCriteria"] as JSONObject) === false
    ) {
      throw new BadDataException("Invalid monitor criteria");
    }

    const monitorStep: MonitorStep = new MonitorStep();

    monitorStep.data = JSONFunctions.deserialize({
      id: json["id"] as string,
      monitorDestination: monitorDestination || undefined,
      doNotFollowRedirects: json["doNotFollowRedirects"] || undefined,
      allowSelfSignedCertificates:
        json["allowSelfSignedCertificates"] || undefined,
      tlsClientCertificate:
        (json["tlsClientCertificate"] as string) || undefined,
      tlsClientKey: (json["tlsClientKey"] as string) || undefined,
      tlsClientKeyPassphrase:
        (json["tlsClientKeyPassphrase"] as string) || undefined,
      monitorDestinationPort: monitorDestinationPort || undefined,
      monitorCriteria: MonitorCriteria.fromJSON(
        json["monitorCriteria"] as JSONObject,
      ),
      requestType: (json["requestType"] as HTTPMethod) || HTTPMethod.GET,
      requestHeaders:
        (json["requestHeaders"] as Dictionary<string>) || undefined,
      requestBody: (json["requestBody"] as string) || undefined,
      customCode: (json["customCode"] as string) || undefined,
      screenSizeTypes:
        (json["screenSizeTypes"] as Array<ScreenSizeType>) || undefined,
      browserTypes: (json["browserTypes"] as Array<BrowserType>) || undefined,
      retryCountOnError: (json["retryCountOnError"] as number) || undefined,
      requestTimeoutInMs: (json["requestTimeoutInMs"] as number) || undefined,
      retryCount:
        json["retryCount"] === undefined || json["retryCount"] === null
          ? undefined
          : (json["retryCount"] as number),
      logMonitor: json["logMonitor"]
        ? (json["logMonitor"] as JSONObject)
        : undefined,
      metricMonitor: json["metricMonitor"]
        ? (json["metricMonitor"] as JSONObject)
        : undefined,
      traceMonitor: json["traceMonitor"]
        ? (json["traceMonitor"] as JSONObject)
        : undefined,
      exceptionMonitor: json["exceptionMonitor"]
        ? (json["exceptionMonitor"] as JSONObject)
        : undefined,
      profileMonitor: json["profileMonitor"]
        ? (json["profileMonitor"] as JSONObject)
        : undefined,
      snmpMonitor: json["snmpMonitor"]
        ? (json["snmpMonitor"] as JSONObject)
        : undefined,
      dnsMonitor: json["dnsMonitor"]
        ? (json["dnsMonitor"] as JSONObject)
        : undefined,
      domainMonitor: json["domainMonitor"]
        ? (json["domainMonitor"] as JSONObject)
        : undefined,
      dnssecMonitor: json["dnssecMonitor"]
        ? (json["dnssecMonitor"] as JSONObject)
        : undefined,
      externalStatusPageMonitor: json["externalStatusPageMonitor"]
        ? (json["externalStatusPageMonitor"] as JSONObject)
        : undefined,
      kubernetesMonitor: json["kubernetesMonitor"]
        ? (json["kubernetesMonitor"] as JSONObject)
        : undefined,
      dockerMonitor: json["dockerMonitor"]
        ? (json["dockerMonitor"] as JSONObject)
        : undefined,
      hostMonitor: json["hostMonitor"]
        ? (json["hostMonitor"] as JSONObject)
        : undefined,
      podmanMonitor: json["podmanMonitor"]
        ? (json["podmanMonitor"] as JSONObject)
        : undefined,
      proxmoxMonitor: json["proxmoxMonitor"]
        ? (json["proxmoxMonitor"] as JSONObject)
        : undefined,
      dockerSwarmMonitor: json["dockerSwarmMonitor"]
        ? (json["dockerSwarmMonitor"] as JSONObject)
        : undefined,
      cephMonitor: json["cephMonitor"]
        ? (json["cephMonitor"] as JSONObject)
        : undefined,
      iotMonitor: json["iotMonitor"]
        ? (json["iotMonitor"] as JSONObject)
        : undefined,
    }) as any;

    return monitorStep;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.MonitorStep),
      value: Zod.object({
        id: Zod.string(),
        monitorDestination: Zod.any().optional(),
        monitorCriteria: Zod.any(),
        requestType: Zod.any(),
        requestHeaders: Zod.any().optional(),
        requestBody: Zod.string().optional(),
        doNotFollowRedirects: Zod.boolean().optional(),
        allowSelfSignedCertificates: Zod.boolean().optional(),
        tlsClientCertificate: Zod.string().optional(),
        tlsClientKey: Zod.string().optional(),
        tlsClientKeyPassphrase: Zod.string().optional(),
        monitorDestinationPort: Zod.any().optional(),
        customCode: Zod.string().optional(),
        screenSizeTypes: Zod.any().optional(),
        browserTypes: Zod.any().optional(),
        retryCountOnError: Zod.number().optional(),
        requestTimeoutInMs: Zod.number().optional(),
        retryCount: Zod.number().optional(),
        logMonitor: Zod.any().optional(),
        traceMonitor: Zod.any().optional(),
        metricMonitor: Zod.any().optional(),
        profileMonitor: Zod.any().optional(),
        snmpMonitor: Zod.any().optional(),
        dnsMonitor: Zod.any().optional(),
        domainMonitor: Zod.any().optional(),
        dnssecMonitor: Zod.any().optional(),
        externalStatusPageMonitor: Zod.any().optional(),
        kubernetesMonitor: Zod.any().optional(),
        dockerMonitor: Zod.any().optional(),
        hostMonitor: Zod.any().optional(),
        podmanMonitor: Zod.any().optional(),
        proxmoxMonitor: Zod.any().optional(),
        dockerSwarmMonitor: Zod.any().optional(),
        cephMonitor: Zod.any().optional(),
        iotMonitor: Zod.any().optional(),
      }).openapi({
        type: "object",
        example: {
          id: "stepId",
          monitorDestination: undefined,
          monitorCriteria: {},
          requestType: "GET",
        },
      }),
    }).openapi({
      type: "object",
      description: "MonitorStep object",
      example: {
        _type: ObjectType.MonitorStep,
        value: {
          id: "stepId",
          monitorDestination: undefined,
          monitorCriteria: {},
          requestType: "GET",
        },
      },
    });
  }

  public isValid(): boolean {
    return true;
  }

  protected static override toDatabase(
    value: MonitorStep | FindOperator<MonitorStep>,
  ): JSONObject | null {
    if (value && value instanceof MonitorStep) {
      return (value as MonitorStep).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): MonitorStep | null {
    if (value) {
      return MonitorStep.fromJSON(value);
    }

    return null;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
