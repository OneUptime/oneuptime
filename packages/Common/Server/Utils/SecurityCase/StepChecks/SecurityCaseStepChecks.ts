import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Queue, { QueueName } from "../../../Infrastructure/Queue";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SecurityCaseStepCheckRunner from "./SecurityCaseStepCheckRunner";

/*
 * CHECKING A CASE'S STEPS AT ONCE, WHEN SOMETHING ON IT CHANGES (#10340): a
 * step ticked off or opened again, a playbook step that finished, a block
 * applied or lifted (the blocklist, #10338). The writer calls requestCheck,
 * which never waits on the check nor fails because of it: the case's next
 * check moves to now - so the every-minute run reads it even if the queue
 * is gone - and a job runs the check a moment later, every step of it.
 * A burst of changes - a playbook's several steps - is one check: the jobs
 * of one case are coalesced.
 */
export const SECURITY_CASE_STEP_CHECK_JOB: string =
  "SecurityCases:CheckResponseStepsNow";

// How long a change waits for the changes around it before its case is checked.
export const SECURITY_CASE_STEP_CHECK_DELAY_MS: number = 5 * 1000;

function readId(data: JSONObject, key: string): ObjectID | undefined {
  const value: JSONValue | undefined = data[key];

  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : undefined;
}

export default class SecurityCaseStepChecks {
  // Never throws: the change that asked must not fail because its case could not be checked.
  @CaptureSpan()
  public static async requestCheck(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<void> {
    try {
      // An open case only: a closed one's steps are not checked.
      await SecurityCaseService.updateColumnsByIdWithoutHooks({
        id: data.securityCaseId,
        data: {
          nextStepCheckAt: OneUptimeDate.getCurrentDate(),
        } as unknown as PartialEntity<SecurityCase>,
        expectedData: {
          projectId: data.projectId,
          closedAt: null,
        } as unknown as PartialEntity<SecurityCase>,
        skipUpdateDateColumn: true,
      });

      await Queue.addJob(
        QueueName.Worker,
        `security-case-step-check-${ObjectID.generate().toString()}`,
        SECURITY_CASE_STEP_CHECK_JOB,
        {
          projectId: data.projectId.toString(),
          securityCaseId: data.securityCaseId.toString(),
        },
        {
          delayInMs: SECURITY_CASE_STEP_CHECK_DELAY_MS,
          skipExistenceCheck: true,
          removeWhenDone: true,
          deduplication: {
            id: `security-case-step-check-${data.securityCaseId.toString()}`,
            keepLastIfActive: true,
          },
        },
      );
    } catch (error) {
      logger.error(
        `SecurityCaseStepChecks: could not ask for case ${data.securityCaseId.toString()}'s steps to be checked:`,
      );
      logger.error(error);
    }
  }

  // The job: every step of the case, now.
  @CaptureSpan()
  public static async runJob(data: JSONObject): Promise<void> {
    const projectId: ObjectID | undefined = readId(data, "projectId");
    const securityCaseId: ObjectID | undefined = readId(data, "securityCaseId");

    if (!projectId || !securityCaseId) {
      logger.warn(
        "SecurityCaseStepChecks: a step check job without its project or case was dropped.",
      );
      return;
    }

    await SecurityCaseStepCheckRunner.checkCaseNow({
      projectId,
      securityCaseId,
    });
  }
}
