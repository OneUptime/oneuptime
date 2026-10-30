import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import { REAL_TIME_DETECTION_JOB } from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import RealTimeDetectionJob, {
  readRealTimeJobData,
} from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetectionJob";
import { RealTimeJobData } from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetections";

/*
 * One real-time detection rule's confirmation, queued by every path that
 * writes security events when the rule's screen let some of them through
 * (RealTimeDetections.screen): the rule's own query, restricted to those
 * events, once they can be read. A job of an older shape names nothing and
 * is refused.
 */
export async function evaluateRealTimeDetection(job?: QueueJob): Promise<void> {
  const data: RealTimeJobData | null = readRealTimeJobData(job?.data);

  if (!data) {
    throw new BadDataException(
      "A real-time detection job needs a project, a rule and its events.",
    );
  }

  await RealTimeDetectionJob.evaluate(data);
}

JobDictionary.setJobFunction(REAL_TIME_DETECTION_JOB, evaluateRealTimeDetection);
// A count and one rule's query over a few hundred events.
JobDictionary.setTimeoutInMs(REAL_TIME_DETECTION_JOB, 5 * 60 * 1000);
