import { JSONObject } from "../../Types/JSON";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OPENSTACK_CHECK_FAULT_SOURCE_TITLES,
  OPENSTACK_LIFECYCLE_STEP_TITLES,
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
  OpenStackCertificateResult,
  OpenStackCheckFault,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRegionRecord,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
  OpenStackLifecycleStepResult,
} from "../../Types/OpenStack/OpenStackCheck";
import FeedMarkdown, { MarkdownText, mdText } from "../Markdown/FeedMarkdown";
import { OpenStackCheckMetric } from "./OpenStackCheckMetrics";

/*
 * WHAT A CHECK'S INCIDENT SAYS IT MET.
 *
 * An alert template is the same words every time, and what makes this one worth waking someone for
 * is what the run actually met: the step, and the fault in Nova's or Cinder's own words. That is
 * what a probe reported, and it is read from there rather than from a label on a series, because a
 * fault is free text, and one incident per region should not become one per way of failing.
 *
 * What a service wrote is text from outside OneUptime. It goes in as FeedMarkdown.writtenOutside,
 * where nothing in it can act.
 */

export interface OpenStackCheckFaultFinding {
  // The step, in words: "Wait for ACTIVE".
  title: string;
  fault?: OpenStackCheckFault | undefined;
}

export interface OpenStackCheckFindings {
  lines: Array<OpenStackCheckFaultFinding>;
  // When the run it is from finished, for a lifecycle check.
  finishedAt?: string | undefined;
  // The trace of the run's boot, when it was signed.
  traceId?: string | undefined;
  regionName?: string | undefined;
}

function readLabel(labels: JSONObject | undefined, key: string): string | null {
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = labels?.[candidate];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function lifecycleFindings(data: {
  regionName: string;
  records: OpenStackLifecycleRecords | undefined;
  metricNames: ReadonlyArray<string>;
}): OpenStackCheckFindings | null {
  const record: OpenStackLifecycleRegionRecord | undefined =
    data.records?.[data.regionName];
  const run: OpenStackLifecycleRun | undefined = record?.lastVerdict;

  if (!run) {
    return null;
  }

  const lines: Array<OpenStackCheckFaultFinding> = [];
  // On a step's duration: how long it took is what this fired on, whatever else the run met.
  const isOnDuration: boolean = data.metricNames.includes(
    OpenStackCheckMetric.LifecycleStepDuration,
  );

  if (!isOnDuration) {
    for (const step of run.steps as Array<OpenStackLifecycleStepResult>) {
      if (step.status === "Failed") {
        lines.push({
          title: OPENSTACK_LIFECYCLE_STEP_TITLES[step.step] || step.step,
          fault: step.fault,
        });
      }
    }
  }

  // Passed, and this monitor fired: how long the boot took is what it fired on.
  if (lines.length === 0) {
    const boot: OpenStackLifecycleStepResult | undefined = run.steps.find(
      (step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.ServerActive;
      },
    );

    if (!boot) {
      return null;
    }

    lines.push({
      title: `${OPENSTACK_LIFECYCLE_STEP_TITLES[boot.step]} took ${Math.round(
        boot.durationInMs / 1000,
      )} seconds`,
    });
  }

  return {
    lines: lines,
    finishedAt: run.finishedAt,
    traceId: run.traceId,
    regionName: data.regionName,
  };
}

function apiFindings(data: {
  regionName: string;
  labels: JSONObject | undefined;
  result: OpenStackApiCheckResult | undefined;
  metricNames: ReadonlyArray<string>;
}): OpenStackCheckFindings | null {
  const { result } = data;

  if (!result) {
    return null;
  }

  if (data.metricNames.includes(OpenStackCheckMetric.TokenSuccess)) {
    return result.token.message
      ? {
          lines: [
            {
              title: "Keystone issues a token",
              fault: { source: "keystone", message: result.token.message },
            },
          ],
          regionName: data.regionName,
        }
      : null;
  }

  if (data.metricNames.includes(OpenStackCheckMetric.ApiSuccess)) {
    const serviceType: string | null = readLabel(data.labels, "service_type");
    const service: OpenStackApiServiceResult | undefined = result.services.find(
      (candidate: OpenStackApiServiceResult): boolean => {
        return (
          candidate.regionName === data.regionName &&
          candidate.serviceType === serviceType
        );
      },
    );

    return service?.message
      ? {
          lines: [
            {
              title: `${service.read} on ${service.serviceName || service.serviceType}`,
              fault: {
                source: "probe",
                ...(service.status ? { code: service.status } : {}),
                message: service.message,
              },
            },
          ],
          regionName: data.regionName,
        }
      : null;
  }

  if (data.metricNames.includes(OpenStackCheckMetric.CertificateExpiry)) {
    const host: string | null = readLabel(data.labels, "host");
    const port: string | null = readLabel(data.labels, "port");
    const certificate: OpenStackCertificateResult | undefined =
      result.certificates.find(
        (candidate: OpenStackCertificateResult): boolean => {
          return (
            candidate.host === host && String(candidate.port) === String(port)
          );
        },
      );

    return certificate
      ? {
          lines: [
            {
              title: `The certificate on ${certificate.host}:${certificate.port} ends on ${certificate.validTo.substring(0, 10)}. It is issued to ${certificate.subject || "an unnamed subject"} by ${certificate.issuer || "an unnamed issuer"}, and serves ${certificate.serviceTypes.join(", ") || "the catalog's endpoints"}`,
            },
          ],
          regionName: data.regionName,
        }
      : null;
  }

  return null;
}

// What a monitor's series were last found to have met, or null when it is not a check's.
export function getOpenStackCheckFindings(data: {
  labels: JSONObject | undefined;
  metricNames: ReadonlyArray<string>;
  apiCheckResult?: OpenStackApiCheckResult | undefined;
  lifecycleRecords?: OpenStackLifecycleRecords | undefined;
}): OpenStackCheckFindings | null {
  const regionName: string | null = readLabel(
    data.labels,
    OPENSTACK_REGION_ATTRIBUTE,
  );

  if (!regionName) {
    return null;
  }

  const isLifecycle: boolean =
    data.metricNames.includes(OpenStackCheckMetric.LifecyclePhaseSuccess) ||
    data.metricNames.includes(OpenStackCheckMetric.LifecycleStepDuration) ||
    data.metricNames.includes(OpenStackCheckMetric.LifecycleStepSuccess) ||
    data.metricNames.includes(OpenStackCheckMetric.LifecycleSuccess);

  return isLifecycle
    ? lifecycleFindings({
        regionName: regionName,
        records: data.lifecycleRecords,
        metricNames: data.metricNames,
      })
    : apiFindings({
        regionName: regionName,
        labels: data.labels,
        result: data.apiCheckResult,
        metricNames: data.metricNames,
      });
}

// What a monitor's series are, for whether it is worth reading a check's row at all.
export function isOpenStackCheckMonitor(
  metricNames: ReadonlyArray<string>,
): boolean {
  return metricNames.some((metricName: string): boolean => {
    return metricName.startsWith("openstack_check_");
  });
}

// The lines for an incident: which step, and who said what, in their words.
export function openStackCheckFindingsToMarkdown(
  findings: OpenStackCheckFindings,
): MarkdownText {
  const lines: Array<MarkdownText> = findings.lines.map(
    (line: OpenStackCheckFaultFinding): MarkdownText => {
      if (!line.fault) {
        return mdText`${line.title}.`;
      }

      const source: string =
        OPENSTACK_CHECK_FAULT_SOURCE_TITLES[line.fault.source] ||
        line.fault.source;
      const code: MarkdownText = line.fault.code
        ? mdText` (${FeedMarkdown.code(String(line.fault.code))})`
        : FeedMarkdown.empty();

      return mdText`${line.title}: ${source} said${code}: ${FeedMarkdown.writtenOutside(line.fault.message)}`;
    },
  );

  const sections: Array<MarkdownText> = [
    mdText`**What the check met${
      findings.regionName ? ` in ${findings.regionName}` : ""
    }:**`,
    FeedMarkdown.bulletList(lines),
  ];

  if (findings.finishedAt) {
    sections.push(
      mdText`From the run that finished at ${FeedMarkdown.code(findings.finishedAt)}.`,
    );
  }

  if (findings.traceId) {
    sections.push(
      mdText`This run's boot has a trace: ${FeedMarkdown.code(findings.traceId)}.`,
    );
  }

  return FeedMarkdown.join(sections, "\n\n");
}
