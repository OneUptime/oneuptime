import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_DAY } from "Common/Utils/CronTime";
import VideoCallOAuthTokenStore from "Common/Server/Utils/VideoCall/OAuth/VideoCallOAuthTokenStore";

/*
 * A video call connection made by signing in to Zoom, Google or Microsoft
 * holds a refresh token that expires when it goes unused - after 90 days
 * for Zoom and Microsoft, six months for Google - and a project can easily
 * go that long without an incident. So every sign-in not refreshed for a
 * week is refreshed here, and one that can no longer be shows its error on
 * its connections today rather than at the next incident.
 */
RunCron(
  "VideoCall:KeepVideoCallSignInsAlive",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  async () => {
    await VideoCallOAuthTokenStore.keepAllAlive();
  },
);
