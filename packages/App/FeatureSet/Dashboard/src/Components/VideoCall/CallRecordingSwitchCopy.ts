import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Record and transcribe incident calls, the project's one switch for it, on
 * Project Settings > Workspace > Video Calls (Project.recordAndTranscribeIncidentCalls).
 *
 * While it is on, the Zoom and Google Meet meetings OneUptime starts for
 * incidents are recorded and transcribed from the start, OneUptime gets each
 * call's transcript once the call is over, OneUptime AI posts what it read
 * to the incident's feed, and the automatic postmortem draft waits for it.
 *
 * It saves the moment it is flipped (ModelSwitchCard). Turning it ON asks
 * first: it records people, and everyone on those calls sees the provider
 * say so. Turning it off never asks.
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const CallRecordingSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch, whichever way it is set.
  switchDescription: string;
  // After it: the calls it cannot record.
  switchNote: string;
  // The dialog before recording is turned on.
  turnOnConfirmTitle: string;
  turnOnConfirmDescription: string;
  turnOnConfirmButton: string;
} = {
  cardTitle: translationKey("Call transcripts"),
  cardDescription: translationKey(
    "Keep what was said on every incident call, without anyone remembering to.",
  ),
  switchTitle: translationKey("Record and transcribe incident calls"),
  switchDescription: translationKey(
    "OneUptime asks Zoom and Google Meet to record and transcribe every incident call it starts, and adds the transcript to the incident once the call is over. OneUptime AI then posts what was said to the incident's feed, and the postmortem draft reads it.",
  ),
  switchNote: translationKey(
    "Microsoft Teams calls, Slack huddles and meeting links are not recorded: add their transcripts by hand.",
  ),
  turnOnConfirmTitle: translationKey("Record and transcribe incident calls?"),
  turnOnConfirmDescription: translationKey(
    "Everyone on an incident's Zoom or Google Meet call sees that it is recorded or transcribed. Check that your organization allows recording these calls. Zoom keeps a transcript when the account records to the cloud with its audio transcript on.",
  ),
  turnOnConfirmButton: translationKey("Turn on"),
};

// The Project column the switch writes.
export type CallRecordingSwitchColumn = "recordAndTranscribeIncidentCalls";

export const CALL_RECORDING_SWITCH_COLUMN: CallRecordingSwitchColumn =
  "recordAndTranscribeIncidentCalls";

// The data-testid of the "Record and transcribe incident calls" switch.
export const CALL_RECORDING_SWITCH_TEST_ID: string =
  "project-call-recording-switch";

export default CallRecordingSwitchCopy;
