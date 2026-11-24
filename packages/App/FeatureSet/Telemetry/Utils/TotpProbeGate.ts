import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import {
  ProbeFailureCause,
  writeProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";
import ProbeStepGate, {
  ItemForProbe,
  ItemForProbeKind,
  ProbeStepNeed,
} from "./ProbeStepGate";

export { ItemForProbeKind };
export type { ItemForProbe };

/*
 * A STEP THAT NEEDS A ONE-TIME CODE GOES ONLY TO A PROBE THAT MAKES ONE
 * (OneUptime issue #9759).
 *
 * The server never fills a one-time code (TOTP) secret into a monitor: it
 * hands the probe the code's parameters beside the step
 * (MonitorStep.totpSecrets, MonitorUtil.attachTotpSecrets), and the probe
 * makes the code when the check uses it. A custom probe older than
 * FIRST_PROBE_VERSION_WITH_TOTP_CODES drops those parameters and sends
 * {{monitorSecrets.NAME}} as written, so the site refuses the sign-in, and
 * the check failed with a login error that said nothing of why.
 *
 * None from before FIRST_PROBE_VERSION_WITH_TOTP_CODES (17.1.0) declares
 * ProbeCapability.TotpCodes, so such a probe is not handed a step that
 * carries code parameters: its result is written for it, a failed check
 * whose error says the probe is too old to make one-time codes and to
 * update it to the latest release
 * (ProbeFailureCause.ProbeTooOldForOneTimeCodes). How a step is kept and
 * its result written is ProbeStepGate's, shared with the request bodies
 * only a newer probe sends (RequestBodyProbeGate, #10737).
 */

// The error a step kept from a probe too old to make one-time codes says.
export const ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE: string =
  writeProbeFailureCause(ProbeFailureCause.ProbeTooOldForOneTimeCodes);

/*
 * A step needs a probe that makes one-time codes when the server handed it
 * code parameters while it filled in the item's secrets.
 */
export const ONE_TIME_CODE_NEED: ProbeStepNeed = {
  capability: ProbeCapability.TotpCodes,
  isNeededBy: (data: { step: MonitorStep }): boolean => {
    return Object.keys(data.step?.data?.totpSecrets || {}).length > 0;
  },
  message: ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
  cannot: "make one-time codes",
};

export default class TotpProbeGate {
  /*
   * The steps of an item that need a one-time code: those the server
   * handed code parameters to while it filled in the item's secrets.
   */
  public static getStepsNeedingCodes(item: ItemForProbe): Array<MonitorStep> {
    return ProbeStepGate.getStepsNeeding(item, ONE_TIME_CODE_NEED);
  }

  // Whether the probe's request declares that it makes one-time codes.
  public static isDeclaredByRequest(requestBody: unknown): boolean {
    return ProbeStepGate.isDeclaredByRequest(
      requestBody,
      ProbeCapability.TotpCodes,
    );
  }

  /*
   * The items to hand the probe that sent `requestBody`: all of them, when
   * it makes one-time codes, is a global probe, or none of them needs a
   * code; otherwise each without its steps that need a code - whose
   * results are written for the probe - and none that has no step left.
   * Called after the items' secrets are filled in, so the steps carry
   * their code parameters.
   */
  public static async keepStepsFromProbesTooOld<T extends ItemForProbe>(data: {
    items: Array<T>;
    probeId: ObjectID;
    requestBody: unknown;
    kind: ItemForProbeKind;
  }): Promise<Array<T>> {
    return await ProbeStepGate.keepStepsFromProbesTooOld({
      ...data,
      needs: [ONE_TIME_CODE_NEED],
    });
  }

  /*
   * The result of a step kept from a probe too old to make one-time codes,
   * as the probe would report a check that failed (ProbeStepGate).
   */
  public static buildStepNotRun(data: {
    monitorType: MonitorType | undefined;
    step: MonitorStep;
    // The monitor's id, or a monitor test's, as the probe names it.
    monitorId: ObjectID;
    projectId: ObjectID;
    probeId: ObjectID;
    at: Date;
  }): ProbeMonitorResponse {
    return ProbeStepGate.buildStepNotRun({
      ...data,
      message: ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
    });
  }
}
