import SecurityCasePriorityService from "../../Services/SecurityCasePriorityService";
import SecurityCaseStatusService from "../../Services/SecurityCaseStatusService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
  SECURITY_CASE_PRIORITY_LEVELS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  SECURITY_CASE_STAGE_FLAGS,
  SECURITY_CASE_STAGES,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "../../../Utils/SecurityCase/SecurityCasePriorities";
import {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
} from "../../../Utils/SecurityCase/SecurityCaseStatuses";

/*
 * A project's case priorities and statuses as it starts with them: the five
 * priorities and four statuses every project had before they became its own
 * (DEFAULT_SECURITY_CASE_PRIORITIES, DEFAULT_SECURITY_CASE_STATUSES), each
 * the built-in one of its level or stage.
 *
 * Made when a project is created (ProjectService), and again whenever a
 * project is found with none of a kind (SecurityCaseValues): a case is never
 * refused for want of somewhere to start. Idempotent: a value whose name the
 * project has is not made again, nor a built-in one the project has under
 * another name. Made one after another, top first, so each takes its place.
 */
export default class SecurityCaseDefaultValues {
  @CaptureSpan()
  public static async addDefaultPriorities(projectId: ObjectID): Promise<void> {
    const existing: Array<SecurityCasePriority> =
      await SecurityCasePriorityService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          name: true,
          isCriticalPriority: true,
          isHighPriority: true,
          isMediumPriority: true,
          isLowPriority: true,
          isInformationalPriority: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const names: Set<string> = this.getNames(existing);
    const flags: Set<string> = this.getFlags(
      existing,
      Object.values(SECURITY_CASE_PRIORITY_LEVEL_FLAGS),
    );

    for (const value of DEFAULT_SECURITY_CASE_PRIORITIES) {
      const flag: string = SECURITY_CASE_PRIORITY_LEVEL_FLAGS[value.level];

      if (names.has(value.name.toLowerCase()) || flags.has(flag)) {
        continue;
      }

      await SecurityCasePriorityService.create({
        data: this.buildPriority(projectId, value),
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public static async addDefaultStatuses(projectId: ObjectID): Promise<void> {
    const existing: Array<SecurityCaseStatus> =
      await SecurityCaseStatusService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          name: true,
          isNewStatus: true,
          isAcknowledgedStatus: true,
          isContainedStatus: true,
          isClosedStatus: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const names: Set<string> = this.getNames(existing);
    const flags: Set<string> = this.getFlags(
      existing,
      Object.values(SECURITY_CASE_STAGE_FLAGS),
    );

    for (const value of DEFAULT_SECURITY_CASE_STATUSES) {
      const flag: string = SECURITY_CASE_STAGE_FLAGS[value.stage];

      if (names.has(value.name.toLowerCase()) || flags.has(flag)) {
        continue;
      }

      await SecurityCaseStatusService.create({
        data: this.buildStatus(projectId, value),
        props: {
          isRoot: true,
        },
      });
    }
  }

  public static buildPriority(
    projectId: ObjectID,
    value: DefaultSecurityCasePriority,
  ): SecurityCasePriority {
    const priority: SecurityCasePriority = new SecurityCasePriority();
    priority.projectId = projectId;
    priority.name = value.name;
    priority.description = value.description;
    priority.color = value.color;
    priority.order = value.order;

    // Its response targets; a priority without one stays empty.
    if (value.acknowledgeWithinInMinutes !== null) {
      priority.acknowledgeWithinInMinutes = value.acknowledgeWithinInMinutes;
    }

    if (value.containWithinInMinutes !== null) {
      priority.containWithinInMinutes = value.containWithinInMinutes;
    }

    for (const level of SECURITY_CASE_PRIORITY_LEVELS) {
      priority.setColumnValue(
        SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level],
        level === value.level,
      );
    }

    return priority;
  }

  public static buildStatus(
    projectId: ObjectID,
    value: DefaultSecurityCaseStatus,
  ): SecurityCaseStatus {
    const status: SecurityCaseStatus = new SecurityCaseStatus();
    status.projectId = projectId;
    status.name = value.name;
    status.description = value.description;
    status.color = value.color;
    status.order = value.order;

    for (const stage of SECURITY_CASE_STAGES) {
      status.setColumnValue(
        SECURITY_CASE_STAGE_FLAGS[stage],
        stage === value.stage,
      );
    }

    return status;
  }

  private static getNames(
    rows: Array<{ name?: string | undefined }>,
  ): Set<string> {
    return new Set(
      rows.map((row: { name?: string | undefined }): string => {
        return (row.name || "").trim().toLowerCase();
      }),
    );
  }

  private static getFlags(
    rows: Array<unknown>,
    flags: Array<string>,
  ): Set<string> {
    const found: Set<string> = new Set();

    for (const row of rows) {
      for (const flag of flags) {
        if ((row as Record<string, unknown>)[flag] === true) {
          found.add(flag);
        }
      }
    }

    return found;
  }
}
