import { DashboardRecordingConfig } from "./DashboardRecordingConfig";

/*
 * WHETHER THIS MOMENT MAY BE RECORDED (issue #6834).
 *
 * Every gate must pass, in this order, and the first that does not names
 * the reason:
 *
 *   1. not-configured   OneUptime Cloud's configuration is present and on
 *                       (DashboardRecordingConfig). A self-hosted server
 *                       stops here, before anything is asked or loaded.
 *   2. no-consent       the person pressed "Accept all", and the browser
 *                       sends neither Global Privacy Control nor Do Not
 *                       Track (Common/Utils/Analytics.isSessionRecordingAllowed).
 *   3. person-off       the person has not switched it off
 *                       (User.disableDashboardRecording). Unknown - not read
 *                       yet, or the read failed - counts as off.
 *   4. project-off      the project they are working in has not switched it
 *                       off (Project.disableDashboardRecording). A page with
 *                       no project (Welcome) has none to ask. Unknown is off.
 *   5. page-not-recorded the page is one of the first-run pages
 *                       (RecordedPages).
 *
 * 1 to 4 decide whether the recorder is loaded at all; 5 decides whether it
 * records or holds still (pause) on the page the person is on now. Pure, so
 * the tests can walk every gate.
 */

export enum DashboardRecordingDecision {
  Record = "record",
  NotConfigured = "not-configured",
  NoConsent = "no-consent",
  PersonOff = "person-off",
  ProjectOff = "project-off",
  PageNotRecorded = "page-not-recorded",
}

export interface DashboardRecordingGateInput {
  config: DashboardRecordingConfig | null;
  isConsentGiven: boolean;
  // User.disableDashboardRecording; null while unknown.
  isPersonOff: boolean | null;
  // Whether the page is inside a project at all.
  hasProject: boolean;
  // Project.disableDashboardRecording; null while unknown.
  isProjectOff: boolean | null;
  isRecordedPage: boolean;
}

export const decideDashboardRecording: (
  input: DashboardRecordingGateInput,
) => DashboardRecordingDecision = (
  input: DashboardRecordingGateInput,
): DashboardRecordingDecision => {
  if (!input.config) {
    return DashboardRecordingDecision.NotConfigured;
  }

  if (!input.isConsentGiven) {
    return DashboardRecordingDecision.NoConsent;
  }

  if (input.isPersonOff !== false) {
    return DashboardRecordingDecision.PersonOff;
  }

  if (input.hasProject && input.isProjectOff !== false) {
    return DashboardRecordingDecision.ProjectOff;
  }

  if (!input.isRecordedPage) {
    return DashboardRecordingDecision.PageNotRecorded;
  }

  return DashboardRecordingDecision.Record;
};

/*
 * Whether the switches have to be read: only once the first two gates have
 * passed. A server that records nobody, and a person who did not accept,
 * cost the server no request for them.
 */
export const shouldReadSwitches: (input: {
  config: DashboardRecordingConfig | null;
  isConsentGiven: boolean;
}) => boolean = (input: {
  config: DashboardRecordingConfig | null;
  isConsentGiven: boolean;
}): boolean => {
  return Boolean(input.config) && input.isConsentGiven;
};
