import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeReportedVersionUtil, {
  ProbeFeature,
  ProbeFeatureSupport,
} from "Common/Types/Probe/ProbeReportedVersion";
import { translationKey } from "Common/Types/Translator";
import MonitorRequestBody from "Common/Utils/Monitor/MonitorRequestBody";
import {
  doStepsNeedOneTimeCodes,
  getStepTotpReferences,
} from "Common/Utils/Monitor/MonitorSecretReferences";

/*
 * WHICH OF A MONITOR'S PROBES ARE TOO OLD FOR WHAT ITS STEPS NEED
 * (OneUptime issues #9759, #10788), and the words that say so - kept
 * React-free, so tests read them without the Dashboard's React.
 *
 * Some steps need a feature only a newer custom probe has
 * (ProbeReportedVersion's ProbeFeature):
 *
 *   - a one-time code (TOTP) secret's code, which a probe older than
 *     FIRST_PROBE_VERSION_WITH_TOTP_CODES cannot make (TotpProbeGate);
 *   - an API step's request body that is a JSON array, a single value or
 *     text, which a probe older than FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY
 *     cannot send (RequestBodyProbeGate).
 *
 * OneUptime fails such a check on such a probe, with a sentence saying to
 * update it. The monitor forms say so before that happens, where the
 * probes are picked and where the steps are written (ProbesTooOldWarning),
 * one list of probes for each feature the steps need; the probe's own page
 * says what the probe cannot run (Components/Probe/ProbeVersion). A global
 * probe is never one: OneUptime's own probes are always current. A new
 * ProbeFeature needs its sentence here and a way to tell a step needs it.
 */

// The docs section that says how to update a custom probe.
export const UPDATE_A_PROBE_DOCS_PATH: string =
  "/probe/custom-probe#update-a-probe";

export const PROBES_TOO_OLD_WARNING_TEST_ID: string = "probes-too-old-warning";

export const PROBES_TOO_OLD_COPY: {
  howToUpdate: string;
  updateLink: string;
  olderThan: string;
} = {
  /*
   * Under the lists, in the monitor forms. It names no release: the first
   * release of a feature is not known until it ships (ProbeCapability), and
   * the latest image has every one.
   */
  howToUpdate: translationKey(
    "To update a probe, start it again with the latest probe image.",
  ),
  updateLink: translationKey("How to update a custom probe"),
  // A probe's version, on its page, when it says no release at all.
  olderThan: translationKey("Older than {{version}}"),
};

/*
 * Above each list of probes, in the monitor forms: what the probes listed
 * cannot do, and that the monitor's check fails on them.
 */
export const PROBES_TOO_OLD_FOR_FEATURE_COPY: Readonly<
  Record<ProbeFeature, string>
> = {
  [ProbeFeature.OneTimeCodes]: translationKey(
    "These probes are too old to make one-time codes, so this monitor's check fails on them:",
  ),
  [ProbeFeature.AnyRequestBody]: translationKey(
    "These probes are too old to send a request body that is a JSON array, a single value or text, so this monitor's check fails on them:",
  ),
};

// What the steps are read for here: the steps as the form holds them, and their monitor's type.
export interface MonitorStepsRead {
  monitorSteps: MonitorSteps | undefined | null;
  monitorType: MonitorType | undefined;
}

function stepsOf(data: MonitorStepsRead): Array<MonitorStep> {
  return (data.monitorSteps?.data?.monitorStepsInstanceArray || []).filter(
    (monitorStep: MonitorStep | undefined): boolean => {
      return Boolean(monitorStep);
    },
  );
}

/*
 * Whether any step references a secret where a one-time code goes, or asks
 * for a code: only then is it worth reading the project's secrets to tell.
 */
export const doStepsReferenceSecretsWhereCodesGo: (
  data: MonitorStepsRead,
) => boolean = (data: MonitorStepsRead): boolean => {
  return stepsOf(data).some((monitorStep: MonitorStep): boolean => {
    return Boolean(getStepTotpReferences(monitorStep, data.monitorType));
  });
};

/*
 * Whether an API step's body is one only a newer probe sends: a JSON array,
 * a single value or text (MonitorRequestBody.needsProbeThatSendsAnyBody).
 * Read as the form holds it, before the server fills the monitor's secrets
 * in: a {{monitorSecrets.NAME}} stands for a value, so [{{monitorSecrets.Ids}}]
 * is an array, and a body that is one secret alone a single value.
 */
export const doStepsNeedProbeThatSendsAnyBody: (
  data: MonitorStepsRead,
) => boolean = (data: MonitorStepsRead): boolean => {
  if (data.monitorType !== MonitorType.API) {
    return false;
  }

  return stepsOf(data).some((monitorStep: MonitorStep): boolean => {
    return MonitorRequestBody.needsProbeThatSendsAnyBody(
      monitorStep.data?.requestBody,
      monitorStep.data?.requestBodyFormat,
    );
  });
};

/*
 * The features the steps may need, told from the steps alone: only then is
 * it worth reading the project's probes. A step that references a secret
 * where a code goes needs a code only when the secret is a one-time code
 * secret, which getNeededFeatures tells once the secrets are read.
 */
export const getFeaturesStepsMayNeed: (
  data: MonitorStepsRead,
) => Array<ProbeFeature> = (data: MonitorStepsRead): Array<ProbeFeature> => {
  const features: Array<ProbeFeature> = [];

  if (doStepsReferenceSecretsWhereCodesGo(data)) {
    features.push(ProbeFeature.OneTimeCodes);
  }

  if (doStepsNeedProbeThatSendsAnyBody(data)) {
    features.push(ProbeFeature.AnyRequestBody);
  }

  return features;
};

/*
 * The features the steps need, in ProbeFeature's order: a one-time code
 * when a step asks for one or references a one-time code secret among
 * these names (null: unread, so a reference alone says nothing), a body
 * only a newer probe sends when a step has one.
 */
export const getNeededFeatures: (
  data: MonitorStepsRead & { totpSecretNames: Array<string> | null },
) => Array<ProbeFeature> = (
  data: MonitorStepsRead & { totpSecretNames: Array<string> | null },
): Array<ProbeFeature> => {
  return Object.values(ProbeFeature).filter(
    (feature: ProbeFeature): boolean => {
      switch (feature) {
        case ProbeFeature.OneTimeCodes:
          return doStepsNeedOneTimeCodes({
            monitorSteps: data.monitorSteps,
            monitorType: data.monitorType,
            totpSecretNames: data.totpSecretNames,
          });
        case ProbeFeature.AnyRequestBody:
          return doStepsNeedProbeThatSendsAnyBody(data);
        default:
          return false;
      }
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
 * Of the project's probes, the ones among these ids too old for a
 * feature, in the order the ids give them, each once. A probe that is not
 * among the project's - a global probe - is never one, nor is one whose
 * release cannot be told.
 */
export const getProbesTooOldFor: (data: {
  projectProbes: Array<ProbeRead>;
  probeIds: Array<string>;
  feature: ProbeFeature;
}) => Array<{ id: string; name: string }> = (data: {
  projectProbes: Array<ProbeRead>;
  probeIds: Array<string>;
  feature: ProbeFeature;
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
      ProbeReportedVersionUtil.getFeatureSupport(
        {
          isGlobalProbe: read.isGlobalProbe,
          reportedVersion: read.reportedVersion,
          lastAlive: read.lastAlive,
        },
        data.feature,
      ) === ProbeFeatureSupport.TooOld
    ) {
      tooOld.push({ id: read.id, name: read.name });
    }
  }

  return tooOld;
};
