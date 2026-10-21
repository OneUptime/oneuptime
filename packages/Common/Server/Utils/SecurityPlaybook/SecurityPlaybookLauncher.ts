import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../Services/SecurityPlaybookService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { doesPlaybookMatch } from "./SecurityPlaybookConditions";
import { doStepsStayInsideOneUptime } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";

/*
 * Starts the playbooks a case event calls for: every enabled playbook of the
 * project whose trigger is the event and whose conditions the case and the
 * detection behind it meet (SecurityPlaybookConditions). Each becomes a run,
 * which SecurityPlaybookRunService copies the steps onto and queues.
 *
 * One playbook failing to start - a run that cannot be created, a queue that
 * is down - is logged and the next is started: the case is real, and the
 * other playbooks still owe it their response.
 */
export default class SecurityPlaybookLauncher {
  @CaptureSpan()
  public static async launchForCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    trigger:
      | SecurityPlaybookTrigger.CaseOpened
      | SecurityPlaybookTrigger.DetectionAdded;
    detection?:
      | {
          source: SecurityDetectionSource;
          detectionRuleId?: ObjectID | undefined;
        }
      | undefined;
    /*
     * Only playbooks whose every step stays inside OneUptime (the case and
     * investigate steps): for the setup test's case, so a test never
     * notifies, pages, escalates or contains anything.
     */
    onlyPlaybooksThatStayInside?: boolean | undefined;
  }): Promise<number> {
    const playbooks: Array<SecurityPlaybook> =
      await SecurityPlaybookService.findBy({
        query: {
          projectId: data.projectId,
          isEnabled: true,
          trigger: data.trigger,
        },
        select: {
          _id: true,
          name: true,
          isEnabled: true,
          trigger: true,
          minimumPriority: true,
          detectionSource: true,
          detectionRuleIds: true,
          steps: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    if (playbooks.length === 0) {
      return 0;
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: {
          _id: data.securityCaseId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          priority: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!securityCase) {
      return 0;
    }

    let started: number = 0;

    for (const playbook of playbooks) {
      const matches: boolean = doesPlaybookMatch(
        {
          isEnabled: playbook.isEnabled === true,
          trigger: playbook.trigger,
          minimumPriority: playbook.minimumPriority,
          detectionSource: playbook.detectionSource,
          detectionRuleIds: playbook.detectionRuleIds,
        },
        {
          trigger: data.trigger,
          casePriority: securityCase.priority,
          detection: data.detection
            ? {
                source: data.detection.source,
                detectionRuleId: data.detection.detectionRuleId?.toString(),
              }
            : undefined,
        },
      );

      if (!matches || !playbook.id) {
        continue;
      }

      if (
        data.onlyPlaybooksThatStayInside &&
        !doStepsStayInsideOneUptime(playbook.steps)
      ) {
        continue;
      }

      try {
        const run: SecurityPlaybookRun = new SecurityPlaybookRun();
        run.projectId = data.projectId;
        run.securityCaseId = data.securityCaseId;
        run.securityPlaybookId = playbook.id;
        run.trigger = data.trigger;

        await SecurityPlaybookRunService.create({
          data: run,
          props: {
            isRoot: true,
          },
        });

        started++;
      } catch (error) {
        logger.error(
          `SecurityPlaybookLauncher: could not start playbook ${playbook.id.toString()} on case ${data.securityCaseId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return started;
  }
}
