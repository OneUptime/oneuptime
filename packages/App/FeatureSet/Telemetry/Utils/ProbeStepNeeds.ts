import { ProbeStepNeed } from "./ProbeStepGate";
import { ANY_REQUEST_BODY_NEED } from "./RequestBodyProbeGate";
import { ONE_TIME_CODE_NEED } from "./TotpProbeGate";

/*
 * Everything a step can need of the probe it is handed to (ProbeStepGate),
 * the need of the newest release first: a step that needs both a one-time
 * code and a body only 17.2.0 sends, on a probe older than both, says to
 * update to the release that runs it.
 */
const PROBE_STEP_NEEDS: ReadonlyArray<ProbeStepNeed> = [
  ANY_REQUEST_BODY_NEED,
  ONE_TIME_CODE_NEED,
];

export default PROBE_STEP_NEEDS;
