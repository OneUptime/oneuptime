import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityCaseValues from "../SecurityCase/SecurityCaseValues";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 *
 * Triaged as Likely Malicious is about the whole case, not one detection:
 * a playbook limited to a source or to rules runs when ANY of the case's
 * detections meets that (detections), and it runs once per case - a case
 * triaged again never runs it a second time.
 */
export interface PlaybookLaunchDetection {
  source: SecurityDetectionSource;
  detectionRuleId?: ObjectID | undefined;
}

export default class SecurityPlaybookLauncher {
  @CaptureSpan()
  public static async launchForCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    trigger:
      | SecurityPlaybookTrigger.CaseOpened
      | SecurityPlaybookTrigger.DetectionAdded
      | SecurityPlaybookTrigger.TriagedAsLikelyMalicious;
    detection?: PlaybookLaunchDetection | undefined;
    /*
     * For an event about the whole case (Triaged as Likely Malicious): the
     * case's detections, any one of which may meet a playbook's detection
     * conditions. Takes the place of detection.
     */
    detections?: Array<PlaybookLaunchDetection> | undefined;
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
          minimumSecurityCasePriorityId: true,
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
          securityCasePriorityId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!securityCase) {
      return 0;
    }

    let started: number = 0;

    // The project's priorities, which each playbook's minimum is compared through.
    const priorities: Array<SecurityCasePriority> =
      await SecurityCaseValues.getPriorities(data.projectId);

    /*
     * The detections each playbook's conditions are read against: the one
     * behind the event, or - for an event about the whole case - each of
     * the case's (none: a case opened by hand).
     */
    const candidates: Array<PlaybookLaunchDetection | undefined> =
      data.detections !== undefined
        ? data.detections.length > 0
          ? data.detections
          : [undefined]
        : [data.detection];

    for (const playbook of playbooks) {
      const matches: boolean = candidates.some(
        (detection: PlaybookLaunchDetection | undefined): boolean => {
          return doesPlaybookMatch(
            {
              isEnabled: playbook.isEnabled === true,
              trigger: playbook.trigger,
              minimumPriorityId: playbook.minimumSecurityCasePriorityId,
              detectionSource: playbook.detectionSource,
              detectionRuleIds: playbook.detectionRuleIds,
            },
            {
              trigger: data.trigger,
              priorities,
              casePriorityId: securityCase.securityCasePriorityId,
              detection: detection
                ? {
                    source: detection.source,
                    detectionRuleId: detection.detectionRuleId?.toString(),
                  }
                : undefined,
            },
          );
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

      // Once per case: a case triaged again never runs it a second time.
      if (
        data.trigger === SecurityPlaybookTrigger.TriagedAsLikelyMalicious &&
        (await this.hasRunOnCase({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          securityPlaybookId: playbook.id,
          trigger: data.trigger,
        }))
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

  // Whether the playbook already ran on the case for this trigger.
  private static async hasRunOnCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    securityPlaybookId: ObjectID;
    trigger: SecurityPlaybookTrigger;
  }): Promise<boolean> {
    const count: PositiveNumber = await SecurityPlaybookRunService.countBy({
      query: {
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        securityPlaybookId: data.securityPlaybookId,
        trigger: data.trigger,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber() > 0;
  }
}
