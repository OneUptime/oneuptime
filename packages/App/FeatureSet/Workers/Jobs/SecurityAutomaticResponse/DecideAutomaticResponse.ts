import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import SecurityAutomaticResponse, {
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB,
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_TIMEOUT_IN_MS,
  SecurityAutomaticResponseJobData,
  readSecurityAutomaticResponseJobData,
} from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponse";

/*
 * One automatic response decision (#10350), queued as a detection is
 * recorded (SecurityAutomaticResponse.screen): the policy's guardrails in
 * order under the project's lock, then what it does - records it in its
 * trial run, or blocks through the playbook engine.
 */
export async function decideAutomaticResponse(job?: QueueJob): Promise<void> {
  const data: SecurityAutomaticResponseJobData | null =
    readSecurityAutomaticResponseJobData(job?.data);

  if (!data) {
    throw new BadDataException(
      "An automatic response decision names its project, policy, case, detection and address.",
    );
  }

  await SecurityAutomaticResponse.decide(data);
}

JobDictionary.setJobFunction(
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB,
  decideAutomaticResponse,
);
JobDictionary.setTimeoutInMs(
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB,
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_TIMEOUT_IN_MS,
);
