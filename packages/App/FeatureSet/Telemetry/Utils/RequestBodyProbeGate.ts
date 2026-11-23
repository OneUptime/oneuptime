import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeCapability, {
  FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
} from "Common/Types/Probe/ProbeCapability";
import MonitorRequestBody from "Common/Utils/Monitor/MonitorRequestBody";
import {
  ProbeFailureCause,
  writeProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";
import { ProbeStepNeed } from "./ProbeStepGate";

/*
 * AN API STEP WHOSE BODY ONLY A NEWER PROBE SENDS GOES ONLY TO SUCH A
 * PROBE (OneUptime issue #10737).
 *
 * Since #9737 an API monitor's body can be any JSON value, and since
 * #10736 text sent as written. A custom probe from before
 * FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY reads every body as a JSON
 * object (JSONFunctions.parseJSONObject): it fails a check whose body is an
 * array or a single value with "Expected JSONObject, but got JSONArray",
 * which says nothing of the probe being too old, and sends a text body as
 * JSON, if at all.
 *
 * None of those probes declares ProbeCapability.AnyRequestBody, so such a
 * probe is not handed the step (ProbeStepGate): its result is written for
 * it, offline, with a sentence saying the probe is too old to send such a
 * body and to update it (ProbeFailureCause.ProbeTooOldForRequestBody).
 * Which body needs a newer probe is MonitorRequestBody's to say, read as
 * the step is handed over, its secrets filled in.
 */

// The error a step kept from a probe too old to send its body says.
export const REQUEST_BODY_STEP_NOT_RUN_MESSAGE: string = writeProbeFailureCause(
  ProbeFailureCause.ProbeTooOldForRequestBody,
  { version: FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY },
);

export const ANY_REQUEST_BODY_NEED: ProbeStepNeed = {
  capability: ProbeCapability.AnyRequestBody,
  isNeededBy: (data: {
    step: MonitorStep;
    monitorType: MonitorType | undefined;
  }): boolean => {
    return (
      data.monitorType === MonitorType.API &&
      MonitorRequestBody.needsProbeThatSendsAnyBody(
        data.step?.data?.requestBody,
      )
    );
  },
  message: REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
  cannot: "send a request body that is a JSON array, a single value or text",
};
