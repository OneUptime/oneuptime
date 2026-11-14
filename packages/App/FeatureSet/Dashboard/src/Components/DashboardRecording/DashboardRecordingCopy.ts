import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the two off switches for recording the Dashboard (issue
 * #6834): the person's, on User Profile beside "Ask me how things went",
 * and the project's, in Project Settings. Shown only on a server that
 * records at all (DashboardRecordingConfig) - on a self-hosted server
 * nobody is ever recorded, and a switch for it would only confuse.
 */

export interface DashboardRecordingSwitchCopy {
  cardTitle: string;
  cardDescription: string;
  title: string;
  onDescription: string;
  offDescription: string;
}

export const PERSON_RECORDING_COPY: DashboardRecordingSwitchCopy = {
  cardTitle: translationKey("Recordings of Setup Pages"),
  cardDescription: translationKey(
    "If you accepted analytics, OneUptime may record how you use the setup pages to see where people get stuck. What you type and what your team stores is hidden: only OneUptime's own words can be read.",
  ),
  title: translationKey("Record how I use setup pages"),
  onDescription: translationKey(
    "OneUptime may record your use of the setup pages, with your data hidden.",
  ),
  offDescription: translationKey(
    "OneUptime never records how you use the dashboard.",
  ),
};

export const PROJECT_RECORDING_COPY: DashboardRecordingSwitchCopy = {
  cardTitle: translationKey("Recordings of Setup Pages"),
  cardDescription: translationKey(
    "OneUptime may record how members who accepted analytics use the setup pages to see where people get stuck. What they type and what this project stores is hidden. Switch it off to record nobody in this project.",
  ),
  title: translationKey("Record setup pages in this project"),
  onDescription: translationKey(
    "Members who accepted analytics, and did not switch it off themselves, may be recorded on the setup pages.",
  ),
  offDescription: translationKey(
    "Nobody is recorded while working in this project.",
  ),
};
