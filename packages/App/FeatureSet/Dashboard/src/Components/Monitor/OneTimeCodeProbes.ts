import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeReportedVersionUtil from "Common/Types/Probe/ProbeReportedVersion";
import { translationKey } from "Common/Types/Translator";
import { getStepTotpReferences } from "Common/Utils/Monitor/MonitorSecretReferences";

/*
 * WHICH OF A MONITOR'S PROBES ARE TOO OLD TO MAKE ITS ONE-TIME CODES
 * (OneUptime issue #9759), and the words that say so - kept React-free, so
 * tests read them without the Dashboard's React.
 *
 * A custom probe older than FIRST_PROBE_VERSION_WITH_TOTP_CODES cannot make
 * the code of a one-time code (TOTP) secret: OneUptime fails such a check
 * on it with a sentence saying to update it (TotpProbeGate). The monitor
 * forms say so before that happens, where the probes are picked and where
 * the steps that use the code are written, and the probe's own page says
 * what the probe cannot run. A global probe is never one: OneUptime's own
 * probes are always current.
 */

// The docs section that says how to update a custom probe.
export const UPDATE_A_PROBE_DOCS_PATH: string =
  "/probe/custom-probe#update-a-probe";

export const ONE_TIME_CODE_PROBES_WARNING_TEST_ID: string =
  "one-time-code-probes-warning";

export const ONE_TIME_CODE_PROBES_COPY: {
  probesTooOld: string;
  howToUpdate: string;
  updateLink: string;
  olderThan: string;
  probeTooOld: string;
} = {
  // Above the list of the probes, in the monitor forms.
  probesTooOld: translationKey(
    "These probes are too old to make one-time codes, so this monitor's check fails on them:",
  ),
  howToUpdate: translationKey(
    "To update a probe, start it again with the latest probe image (OneUptime {{version}} or later).",
  ),
  updateLink: translationKey("How to update a custom probe"),
  // A probe's version, on its page, when it says no release at all.
  olderThan: translationKey("Older than {{version}}"),
  // Under that version.
  probeTooOld: translationKey(
    "Too old to make one-time codes. Monitors that use a one-time code secret fail their check on this probe until it is updated.",
  ),
};

/*
 * Whether any step references a secret where a one-time code goes, or asks
 * for a code: only then is it worth reading the project's secrets and
 * probes to tell.
 */
export const doStepsReferenceSecretsWhereCodesGo: (data: {
  monitorSteps: MonitorSteps | undefined | null;
  monitorType: MonitorType | undefined;
}) => boolean = (data: {
  monitorSteps: MonitorSteps | undefined | null;
  monitorType: MonitorType | undefined;
}): boolean => {
  return (data.monitorSteps?.data?.monitorStepsInstanceArray || []).some(
    (monitorStep: MonitorStep): boolean => {
      return Boolean(getStepTotpReferences(monitorStep, data.monitorType));
    },
  );
};

// What a probe is read for here.
export type ProbeRead = Probe | JSONObject;

function readOf(probe: ProbeRead): {
  id: string;
  name: string;
  isGlobalProbe: boolean;
  reportedVersion: string | null;
  lastAlive: Date | string | null;
} {
  const record: JSONObject = probe as JSONObject;
  const id: unknown = (probe as Probe).id || record["_id"];

  return {
    id: id ? String(id) : "",
    name: typeof record["name"] === "string" ? (record["name"] as string) : "",
    isGlobalProbe: Boolean(record["isGlobalProbe"]),
    reportedVersion:
      typeof record["reportedVersion"] === "string"
        ? (record["reportedVersion"] as string)
        : null,
    lastAlive: (record["lastAlive"] as Date | string | undefined) || null,
  };
}

/*
 * Of the project's probes, the ones among these ids too old to make
 * one-time codes, in the order the ids give them. A probe that is not among
 * the project's - a global probe - is never one.
 */
export const getProbesTooOldForOneTimeCodes: (data: {
  projectProbes: Array<ProbeRead>;
  probeIds: Array<string>;
}) => Array<{ id: string; name: string }> = (data: {
  projectProbes: Array<ProbeRead>;
  probeIds: Array<string>;
}): Array<{ id: string; name: string }> => {
  const tooOld: Array<{ id: string; name: string }> = [];

  for (const probeId of data.probeIds) {
    const probe: ProbeRead | undefined = data.projectProbes.find(
      (candidate: ProbeRead): boolean => {
        return readOf(candidate).id === probeId;
      },
    );

    if (!probe) {
      continue;
    }

    const read: ReturnType<typeof readOf> = readOf(probe);

    if (
      !tooOld.some((entry: { id: string }): boolean => {
        return entry.id === read.id;
      }) &&
      ProbeReportedVersionUtil.isTooOldForOneTimeCodes({
        isGlobalProbe: read.isGlobalProbe,
        reportedVersion: read.reportedVersion,
        lastAlive: read.lastAlive,
      })
    ) {
      tooOld.push({ id: read.id, name: read.name });
    }
  }

  return tooOld;
};
