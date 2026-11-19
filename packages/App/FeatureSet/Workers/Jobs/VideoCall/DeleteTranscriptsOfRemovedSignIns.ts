import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentCallTranscriptRemoval from "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval";

/*
 * Someone removed OneUptime from their Zoom account, and Zoom asks apps to
 * delete a removed user's data (issue #9289). The event marks every
 * incident call whose transcript OneUptime read through that sign-in
 * (VideoCallConnectionService.removeSignIn); every minute this deletes what
 * was read through it - the transcript, what OneUptime AI read in it, and
 * its posts in the incident's feed and channels - call by call
 * (IncidentCallTranscriptRemoval.removeForRemovedSignIns).
 *
 * A call is marked until its deletion is done, so a run that stops part way
 * leaves the rest for the next, and a call taken on twice finds nothing
 * left the second time.
 */
RunCron(
  "VideoCall:DeleteTranscriptsOfRemovedSignIns",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(10),
  },
  async () => {
    await IncidentCallTranscriptRemoval.removeForRemovedSignIns();
  },
);
