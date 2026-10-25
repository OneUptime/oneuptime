import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
  SECURITY_CASE_PRIORITY_LEVELS,
} from "../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
  SECURITY_CASE_STAGE_FLAGS,
} from "../../Types/SecurityCase/SecurityCaseStage";
import {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "../../Utils/SecurityCase/SecurityCasePriorities";
import {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
} from "../../Utils/SecurityCase/SecurityCaseStatuses";

/*
 * A project's case priorities and statuses as the tests hold them: the
 * defaults every project starts with (DEFAULT_SECURITY_CASE_PRIORITIES and
 * DEFAULT_SECURITY_CASE_STATUSES), each with a fixed id, so a test names
 * "the high priority" or "the closed status" by what it means and reads its
 * id back. React-free and server-free: the UI and the server suites share it
 * (stubbing the server's reads is SecurityCaseValuesStub's).
 */

// The id of each built-in priority and status in the tests.
export const TEST_PRIORITY_IDS: Readonly<
  Record<SecurityCasePriorityLevel, string>
> = {
  [SecurityCasePriorityLevel.Critical]: "c1000000-0000-4000-8000-000000000001",
  [SecurityCasePriorityLevel.High]: "c1000000-0000-4000-8000-000000000002",
  [SecurityCasePriorityLevel.Medium]: "c1000000-0000-4000-8000-000000000003",
  [SecurityCasePriorityLevel.Low]: "c1000000-0000-4000-8000-000000000004",
  [SecurityCasePriorityLevel.Informational]:
    "c1000000-0000-4000-8000-000000000005",
};

export const TEST_STATUS_IDS: Readonly<Record<SecurityCaseStage, string>> = {
  [SecurityCaseStage.New]: "c2000000-0000-4000-8000-000000000001",
  [SecurityCaseStage.Acknowledged]: "c2000000-0000-4000-8000-000000000002",
  [SecurityCaseStage.Contained]: "c2000000-0000-4000-8000-000000000003",
  [SecurityCaseStage.Closed]: "c2000000-0000-4000-8000-000000000004",
};

export function buildTestPriority(data: {
  id: string;
  name: string;
  order: number;
  color?: string | undefined;
  level?: SecurityCasePriorityLevel | undefined;
  isArchived?: boolean | undefined;
  projectId?: ObjectID | undefined;
}): SecurityCasePriority {
  const priority: SecurityCasePriority = new SecurityCasePriority();
  priority._id = data.id;
  priority.name = data.name;
  priority.order = data.order;
  priority.isArchived = data.isArchived === true;
  priority.createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, data.order));

  if (data.projectId) {
    priority.projectId = data.projectId;
  }

  const fallback: DefaultSecurityCasePriority | undefined =
    DEFAULT_SECURITY_CASE_PRIORITIES.find(
      (value: DefaultSecurityCasePriority): boolean => {
        return value.level === data.level;
      },
    );
  const color: string | undefined =
    data.color || fallback?.color.toString() || undefined;

  if (color) {
    priority.color = new Color(color);
  }

  for (const level of SECURITY_CASE_PRIORITY_LEVELS) {
    priority.setColumnValue(
      SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level],
      level === data.level,
    );
  }

  return priority;
}

export function buildTestStatus(data: {
  id: string;
  name: string;
  order: number;
  color?: string | undefined;
  stage?: SecurityCaseStage | undefined;
  isArchived?: boolean | undefined;
  description?: string | undefined;
  projectId?: ObjectID | undefined;
}): SecurityCaseStatus {
  const status: SecurityCaseStatus = new SecurityCaseStatus();
  status._id = data.id;
  status.name = data.name;
  status.order = data.order;
  status.isArchived = data.isArchived === true;
  status.createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, data.order));

  if (data.description) {
    status.description = data.description;
  }

  if (data.projectId) {
    status.projectId = data.projectId;
  }

  const fallback: DefaultSecurityCaseStatus | undefined =
    DEFAULT_SECURITY_CASE_STATUSES.find(
      (value: DefaultSecurityCaseStatus): boolean => {
        return value.stage === data.stage;
      },
    );
  const color: string | undefined =
    data.color || fallback?.color.toString() || undefined;

  if (color) {
    status.color = new Color(color);
  }

  for (const stage of SECURITY_CASE_STAGES) {
    status.setColumnValue(
      SECURITY_CASE_STAGE_FLAGS[stage],
      stage === data.stage,
    );
  }

  return status;
}

// A new project's five priorities, most urgent first.
export function buildDefaultTestPriorities(
  projectId?: ObjectID | undefined,
): Array<SecurityCasePriority> {
  return DEFAULT_SECURITY_CASE_PRIORITIES.map(
    (value: DefaultSecurityCasePriority): SecurityCasePriority => {
      return buildTestPriority({
        id: TEST_PRIORITY_IDS[value.level],
        name: value.name,
        order: value.order,
        level: value.level,
        projectId,
      });
    },
  );
}

// A new project's four statuses, in the order a case comes through them.
export function buildDefaultTestStatuses(
  projectId?: ObjectID | undefined,
): Array<SecurityCaseStatus> {
  return DEFAULT_SECURITY_CASE_STATUSES.map(
    (value: DefaultSecurityCaseStatus): SecurityCaseStatus => {
      return buildTestStatus({
        id: TEST_STATUS_IDS[value.stage],
        name: value.name,
        order: value.order,
        stage: value.stage,
        description: value.description,
        projectId,
      });
    },
  );
}

export function testPriorityId(level: SecurityCasePriorityLevel): ObjectID {
  return new ObjectID(TEST_PRIORITY_IDS[level]);
}

export function testStatusId(stage: SecurityCaseStage): ObjectID {
  return new ObjectID(TEST_STATUS_IDS[stage]);
}
