import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import AIIncidentPostmortemRunner from "Common/Server/Utils/AI/SRE/IncidentPostmortemRunner";
import IncidentCallTranscriptFetch from "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptFetch";

/*
 * Record and transcribe incident calls (Project Settings > Workspace >
 * Video Calls): once an incident's Zoom or Google Meet call is over,
 * OneUptime gets its transcript by itself, and OneUptime AI reads it and
 * posts what it read to the incident's feed. Every five minutes this asks
 * the provider about each call that is due (IncidentCallTranscriptFetch),
 * then writes the postmortem drafts that waited for their incident's calls
 * and need wait no longer (AIIncidentPostmortemRunner).
 *
 * A run takes each call before asking about it, so a run that overlaps the
 * next never asks about the same call twice.
 */
RunCron(
  "VideoCall:GetIncidentCallTranscripts",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  async () => {
    await IncidentCallTranscriptFetch.fetchDue();
    await AIIncidentPostmortemRunner.draftWaitingPostmortems();
  },
);
