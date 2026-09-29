import MobileReplayRecorder from "./MobileReplayRecorder";
import { defaultMobileReplayRecorder } from "./ReplayProvider";

export { default as MobileReplayRecorder } from "./MobileReplayRecorder";
export type {
  MobileReplayDiagnosticEvent,
  MobileReplayDiagnostics,
  MobileReplayRecorderDependencies,
  MobileReplaySessionChangeListener,
  MobileReplayStatus,
} from "./MobileReplayRecorder";
export type {
  MobileReplayStartOptions,
  ReplayFetch,
  ReplayFetchResponse,
} from "./Config";
export {
  OneUptimeReplayProvider,
  ReplayMask,
  ReplayProvider,
  useOneUptimeReplay,
} from "./ReplayProvider";
export type {
  OneUptimeReplayProviderProps,
  ReplayMaskProps,
} from "./ReplayProvider";
export type { RecordedTouch, TouchPhase } from "./Events";
export {
  MOBILE_RECORDER_KIND,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
  SessionReplayCaptureTrigger,
  SessionReplayConsentMode,
  SessionReplayFidelityNotice,
  SessionReplayMaskingMode,
  SessionReplayTriggerReason,
} from "./Contract";

/** Process-wide convenience client used by ReplayProvider by default. */
export const OneUptimeReplay: MobileReplayRecorder =
  defaultMobileReplayRecorder;

export default OneUptimeReplay;
