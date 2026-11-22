import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import SignInSettingsClearedEmail, {
  EMAIL_JOB_TIMEOUT_IN_MS,
  SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB,
} from "Common/Server/Utils/SignInSettingsClearedEmail";

/*
 * One email to a person whose sign-in settings were cleared (#9818, #9991):
 * queued by the clear - a server admin's, for one person or for everyone
 * the server's SSO requirement covers, or a project owner's - and sent here,
 * by whichever worker takes it, now or after a restart. A failed send
 * throws, and the queue tries it again; the same email queued twice, or a
 * job run again after its email went, is sent once
 * (Common/Server/Utils/SignInSettingsClearedEmail says how).
 */
export async function sendSignInSettingsClearedEmail(
  job?: QueueJob,
): Promise<void> {
  await SignInSettingsClearedEmail.runJob(job?.data, {
    // BullMQ counts the attempts that failed before this one.
    attempt: (job?.attemptsMade || 0) + 1,
    maxAttempts: job?.opts?.attempts || 1,
  });
}

JobDictionary.setJobFunction(
  SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB,
  sendSignInSettingsClearedEmail,
);

JobDictionary.setTimeoutInMs(
  SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB,
  EMAIL_JOB_TIMEOUT_IN_MS,
);
