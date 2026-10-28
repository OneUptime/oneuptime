/*
 * A case's response targets, tasks and evidence on the fixture's synthetic
 * month.
 *
 * ?targets=on: the project's priorities carry a new project's response
 * targets (DEFAULT_SECURITY_CASE_PRIORITIES), and every case the due times
 * they gave it as it opened - the stamps the every-minute check would have
 * written by now with them. Left out, the project is one from before
 * response targets: no targets, no due times, no Due column, and the pages
 * read as they always did. With targets, at the fixture's NOW:
 *
 *   CASE-142  Critical, taken on in 14 minutes (Met); contain due in 48
 *             minutes: in its last fifth (AtRisk, amber)
 *   CASE-141  High, nobody on it, 48 minutes old: acknowledge due in 12
 *             minutes (AtRisk, amber)
 *   CASE-140  Critical, taken on in 20 minutes (5 over: MetLate), contained
 *             in 1 h 45 min (Met): nothing left due
 *   CASE-139  Medium, taken on in an hour: contain due in 2 d 17 h (OnTrack)
 *   CASE-138  High, nobody on it, two hours old: acknowledge due an hour ago
 *             (Missed, red)
 *   CASE-137  Medium, 5 hours old: acknowledge due in 7 h (OnTrack)
 *
 * The spray case's (CASE-142) checklist and evidence, every state a row can
 * be in:
 *
 *   Tasks
 *     Block 203.0.113.47 at the edge          Diego's, done by Diego 40 min ago
 *     Reset the sprayed accounts' passwords   Maya's (the reader's), open
 *     Ask the help desk who called in         nobody's, open
 *   Evidence
 *     Okta System Log export    a JSON file Maya uploaded, with its SHA-256
 *     Okta admin console: ...   a link Diego added
 *
 * Ticking a task off stamps who did it and when, as the server does
 * (SecurityCaseTaskService); a task or evidence added is the reader's; a
 * deleted one is gone.
 */
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import { SECURITY_CASE_PRIORITY_LEVEL_FLAGS } from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import { DEFAULT_SECURITY_CASE_PRIORITIES } from "Common/Utils/SecurityCase/SecurityCasePriorities";
import {
  SECURITY_CASE_TARGETS,
  SECURITY_CASE_TARGET_COLUMNS,
  getAtRiskAt,
  getTargetBookkeeping,
  getTargetMetAt,
  getTargetMinutes,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";

export const TARGET_SCENARIOS = ["on"];

const MINUTE = 60 * 1000;

// The SHA-256 of the Okta export, as the server recorded it on upload.
export const OKTA_EXPORT_SHA256 =
  "9f2c1a7e4b8d3f60c5e1a2b7d9083e4f6a1c5b2d8e7f9a0b3c4d5e6f7a8b9c0d";

export function createCaseWorkFixture(options) {
  const { insert, table, ID, ago, now, people, isEmpty, hasHistory, scenario } =
    options;
  const hasTargets = scenario === "on";

  function minutesAfter(date, minutes) {
    return new Date(new Date(date).getTime() + minutes * MINUTE);
  }

  // The priorities' targets, and each case's due times and stamps from them.
  function seedTargets() {
    if (!hasTargets) {
      return;
    }

    for (const priority of table(SecurityCasePriority)) {
      const defaults = DEFAULT_SECURITY_CASE_PRIORITIES.find((value) => {
        return (
          priority[SECURITY_CASE_PRIORITY_LEVEL_FLAGS[value.level]] === true
        );
      });

      if (defaults) {
        priority.acknowledgeWithinInMinutes =
          defaults.acknowledgeWithinInMinutes;
        priority.containWithinInMinutes = defaults.containWithinInMinutes;
      }
    }

    for (const securityCase of table(SecurityCase)) {
      const priority = table(SecurityCasePriority).find((row) => {
        return String(row._id) === String(securityCase.securityCasePriorityId);
      });

      if (!priority || !securityCase.createdAt) {
        continue;
      }

      for (const target of SECURITY_CASE_TARGETS) {
        const minutes = getTargetMinutes(priority, target);
        const columns = SECURITY_CASE_TARGET_COLUMNS[target];

        if (minutes === null) {
          continue;
        }

        const dueAt = minutesAfter(securityCase.createdAt, minutes);
        securityCase[columns.dueColumn] = dueAt;

        // What the every-minute check said by now: until the target was met.
        const metAt = getTargetMetAt(securityCase, target);
        const until = metAt && metAt < now ? metAt : now;
        const atRiskAt = getAtRiskAt({
          dueAt,
          targetInMinutes: minutes,
          openedAt: securityCase.createdAt,
        });

        if (dueAt <= until) {
          securityCase[columns.missedColumn] = dueAt;
        } else if (atRiskAt && atRiskAt <= until) {
          securityCase[columns.warnedColumn] = atRiskAt;
        }
      }

      Object.assign(
        securityCase,
        getTargetBookkeeping({ securityCase, priority }),
      );
    }
  }

  function seed() {
    if (isEmpty || !hasHistory) {
      return;
    }

    const sprayCaseId = new ObjectID(ID.case(142));

    insert(SecurityCaseTask, {
      _id: ID.task(1),
      securityCaseId: sprayCaseId,
      title: "Block 203.0.113.47 at the edge",
      assignedToUserId: new ObjectID(people.diego._id),
      isDone: true,
      doneAt: ago(40 * MINUTE),
      doneByUserId: new ObjectID(people.diego._id),
      createdByUserId: new ObjectID(people.maya._id),
      createdAt: ago(2 * 60 * MINUTE + 50 * MINUTE),
    });
    insert(SecurityCaseTask, {
      _id: ID.task(2),
      securityCaseId: sprayCaseId,
      title: "Reset the sprayed accounts' passwords",
      assignedToUserId: new ObjectID(people.maya._id),
      isDone: false,
      createdByUserId: new ObjectID(people.maya._id),
      createdAt: ago(2 * 60 * MINUTE + 48 * MINUTE),
    });
    insert(SecurityCaseTask, {
      _id: ID.task(3),
      securityCaseId: sprayCaseId,
      title: "Ask the help desk who called in",
      isDone: false,
      createdByUserId: new ObjectID(people.diego._id),
      createdAt: ago(2 * 60 * MINUTE + 10 * MINUTE),
    });

    insert(SecurityCaseEvidence, {
      _id: ID.evidence(1),
      securityCaseId: sprayCaseId,
      kind: SecurityCaseEvidenceKind.File,
      name: "Okta System Log export",
      description:
        "Every sign-in from the spraying address in the hour around the success.",
      fileName: "okta-system-log-2026-10-14.json",
      fileType: "application/json",
      fileSizeInBytes: 482133,
      sha256: OKTA_EXPORT_SHA256,
      fileId: new ObjectID(ID.evidence(101)),
      createdByUserId: new ObjectID(people.maya._id),
      createdAt: ago(2 * 60 * MINUTE + 30 * MINUTE),
    });
    insert(SecurityCaseEvidence, {
      _id: ID.evidence(2),
      securityCaseId: sprayCaseId,
      kind: SecurityCaseEvidenceKind.Link,
      name: "Okta admin console: the sprayed accounts",
      url: URL.fromString(
        "https://acme-commerce.okta.example/admin/users?filter=sprayed",
      ),
      createdByUserId: new ObjectID(people.diego._id),
      createdAt: ago(70 * MINUTE),
    });
  }

  function personById(id) {
    if (!id) {
      return undefined;
    }

    return Object.values(people).find((member) => {
      return member._id === String(id);
    });
  }

  // The relations the pages read, joined as a read joins them.
  function withRelations(modelName, record) {
    if (modelName === new SecurityCaseTask().tableName) {
      return {
        ...record,
        assignedToUser: personById(record.assignedToUserId),
        doneByUser: personById(record.doneByUserId),
      };
    }

    if (modelName === new SecurityCaseEvidence().tableName) {
      return {
        ...record,
        createdByUser: personById(record.createdByUserId),
      };
    }

    return record;
  }

  function isCaseWorkTable(modelName) {
    return (
      modelName === new SecurityCaseTask().tableName ||
      modelName === new SecurityCaseEvidence().tableName
    );
  }

  /*
   * A change, as the server makes it: ticking a task off stamps who did it
   * and when, opening it again clears both.
   */
  function onUpdate(modelName, record, data) {
    if (modelName !== new SecurityCaseTask().tableName) {
      return;
    }

    if (data.isDone === true && record.doneAt === undefined) {
      record.doneAt = now;
      record.doneByUserId = new ObjectID(people.maya._id);
    }

    if (data.isDone === false) {
      record.doneAt = undefined;
      record.doneByUserId = undefined;
    }

    if (data.assignedToUserId === null) {
      record.assignedToUserId = undefined;
    } else if (data.assignedToUserId) {
      record.assignedToUserId = new ObjectID(String(data.assignedToUserId));
    }
  }

  // What is added is the reader's; a task starts open.
  function onCreate(modelName, record) {
    if (!isCaseWorkTable(modelName)) {
      return;
    }

    record.createdByUserId = new ObjectID(people.maya._id);

    if (modelName === new SecurityCaseTask().tableName) {
      record.isDone = record.isDone === true;
    }
  }

  return {
    seed,
    seedTargets,
    withRelations,
    isCaseWorkTable,
    onUpdate,
    onCreate,
  };
}
