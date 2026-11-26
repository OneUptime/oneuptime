import PrivateRecordReadFilter, {
  PAGES_OF_THE_PERSON_PAGED,
  PrivateRecordRelation,
} from "../../../../Server/Utils/Permission/PrivateRecordReadFilter";
import PrivateRecordPermission from "../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import RunnerJobService, {
  RUNNER_JOB_AI_RUN_KEY,
  RUNNER_JOB_READ_THROUGH,
  Service as RunnerJobServiceClass,
} from "../../../../Server/Services/RunnerJobService";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import PositiveNumber from "../../../../Types/PositiveNumber";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import EmailLog from "../../../../Models/DatabaseModels/EmailLog";
import FormSubmission from "../../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import RumSessionReplayView from "../../../../Models/DatabaseModels/RumSessionReplayView";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { FindOperator, Repository } from "typeorm";

/*
 * A RELATION TO A PRIVATE RECORD SHOWS IT ONLY TO THOSE WHO SEE IT (#9102).
 *
 * A Data Security issue, a security case, a form submission, a session
 * replay pinned to an incident, a public alert in a private episode: rows
 * that name a record that may be private, read by whoever may read them.
 * Through their relation a read could select the record's columns, filter
 * by them or sort by them, and the join ran none of the record's read rule.
 * The read rule of the parts of a private record (PrivateRecordReadFilter,
 * #8913) now holds through every relation to a record that is, or is a part
 * of, a private record:
 *
 *   - which relations it holds, for every model - and that a model linking
 *     to a record only its service keeps private, which the rule cannot
 *     read, fails here until its privacy is described;
 *   - that the read path asks it where selects, filters and sorts through a
 *     relation are resolved;
 *   - what it puts under a relation filter, what sort it refuses, and what
 *     a select keeps.
 *
 * PrivateRecordActionsPostgres runs the same rule on a migrated Postgres,
 * through the services and the API.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0c0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01",
);
const USER_ID: ObjectID = new ObjectID("0c0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b02");

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Services",
);

function person(
  permission: Permission,
  userId: ObjectID | null = USER_ID,
): DatabaseCommonInteractionProps {
  return {
    ...(userId ? { userId: userId } : {}),
    userType: userId ? UserType.User : UserType.API,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission,
        ],
      },
    },
  };
}

const member: DatabaseCommonInteractionProps = person(Permission.ProjectMember);

const workflowStep: DatabaseCommonInteractionProps =
  WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: ObjectID.generate(),
  });

// Those who see every private record, and so read every relation as before.
const SEE_EVERY_PRIVATE_RECORD: Array<
  [string, DatabaseCommonInteractionProps]
> = [
  ["a Project Owner", person(Permission.ProjectOwner)],
  ["a Project Admin", person(Permission.ProjectAdmin)],
  ["OneUptime itself", { isRoot: true }],
  ["a server admin", { isMasterAdmin: true }],
];

// Those who do not: they read a relation to a private record only where they see it.
const SEE_ONLY_THEIR_OWN: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a member", member],
  ["a viewer", person(Permission.Viewer)],
  [
    "an API key without Project Owner or Admin",
    person(Permission.ProjectMember, null),
  ],
  ["a workflow's step", workflowStep],
];

const modelName: (modelType: { new (): BaseModel }) => string = (modelType: {
  new (): BaseModel;
}): string => {
  return (modelType as unknown as { name: string }).name;
};

// The SQL a condition writes for a column `alias`: an And's last operand is the rule.
function sqlOf(condition: unknown): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  const raw: FindOperator<unknown> =
    operator.type === "and"
      ? (operator.value as unknown as Array<FindOperator<unknown>>)[
          (operator.value as unknown as Array<FindOperator<unknown>>).length - 1
        ]!
      : operator;

  return (raw.getSql as (alias: string) => string)("COLUMN");
}

function relationsOf(
  modelType: { new (): BaseModel },
  options?: { evenWhereItsReadKeepsThem?: boolean },
): Array<string> {
  return PrivateRecordReadFilter.getRelations(modelType, options)
    .map((relation: PrivateRecordRelation): string => {
      return `${relation.relation} -> ${modelName(relation.relatedModelType as { new (): BaseModel })}`;
    })
    .sort();
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * EVERY RELATION TO A RECORD THAT IS, OR IS A PART OF, A PRIVATE RECORD is
 * held to the rule, kept by the model's own read, or a person's own page.
 * The relations held are listed here: a model that comes to link to such a
 * record shows up as one more, to be looked at - what its pages and its
 * API show of the related record to someone who can't see it.
 */
const HELD_RELATIONS: Record<string, Array<string>> = {
  AIConversation: ["alert -> Alert", "incident -> Incident"],
  Alert: ["alertEpisode -> AlertEpisode"],
  AutoRemediationDecision: ["alert -> Alert", "incident -> Incident"],
  DataAlert: ["alert -> Alert", "causeAlert -> Alert"],
  DataSecurityIssue: ["alert -> Alert", "incident -> Incident"],
  // An incident or, since forms create alerts (#10760, PR #10888), an alert.
  FormSubmission: ["alert -> Alert", "incident -> Incident"],
  Incident: ["incidentEpisode -> IncidentEpisode"],
  OnCallDutyPolicyExecutionLogTimeline: [
    "onCallDutyPolicyExecutionLog -> OnCallDutyPolicyExecutionLog",
  ],
  PublicNoteApprovalRequest: [
    "incidentEpisodePublicNote -> IncidentEpisodePublicNote",
    "incidentPublicNote -> IncidentPublicNote",
  ],
  RumSessionPin: ["alert -> Alert", "incident -> Incident"],
  RumSessionReplayView: ["linkedIncident -> Incident"],
  RunnerJob: ["runbookExecution -> RunbookExecution"],
  SecurityCase: ["incident -> Incident"],
  WorkspacePublicNoteApprovalMessage: [
    "incidentEpisodePublicNote -> IncidentEpisodePublicNote",
    "incidentPublicNote -> IncidentPublicNote",
  ],
};

/*
 * Models whose service keeps a read of them to the private records they
 * name, though the rule's metadata does not say so - they are no part of a
 * record (PrivateRecordParts NAMES_BUT_IS_NO_PART) - so the rule cannot
 * hold a relation to them. No model may link to one: it would read the
 * private record's AI decision, data alert or Runner job through the link.
 */
const KEPT_PRIVATE_BY_THEIR_SERVICE_ONLY: Record<string, string> = {
  AutoRemediationDecision:
    "OneUptime AI's decision about an incident or alert, read through both privacy filters by its service",
  DataAlert:
    "what a data monitor's alert is about, read through its alerts' privacy filters by its service",
  RunnerJob:
    "a step of a runbook run or a command of a fix, with what it printed, read through the run's and the fix's records by its service",
};

// A service reads its model through a private record's privacy filter, or through a part of one.
const PRIVATE_RECORD_FILTER: RegExp =
  /apply(Optional)?(Incident|Alert|IncidentEpisode|AlertEpisode)(Self|RelatedRecord)PrivacyFilter|PrivateRecordReadFilter\.apply\(|PrivateRecordReadFilter\.applyToPartKeys\(|get(Optional)?(Incident|Alert|IncidentEpisode|AlertEpisode)RelatedRecordPrivacyRaw/;

function relationColumnsOf(modelType: {
  new (): BaseModel;
}): Array<{ column: string; metadata: TableColumnMetadata }> {
  const model: BaseModel = new modelType();

  return model
    .getTableColumns()
    .columns.map((column: string) => {
      return { column: column, metadata: model.getTableColumnMetadata(column) };
    })
    .filter((entry: { column: string; metadata: TableColumnMetadata }) => {
      return Boolean(
        entry.metadata &&
          entry.metadata.modelType &&
          (entry.metadata.type === TableColumnType.Entity ||
            entry.metadata.type === TableColumnType.EntityArray),
      );
    });
}

describe("every relation to a private record, or to a part of one", () => {
  test("is held to the rule, kept by its model's own read, or a person's own page - and the held ones are listed", () => {
    const held: Record<string, Array<string>> = {};
    const unaccounted: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const name: string = modelName(modelType);
      const model: BaseModel = new modelType();
      const relations: Array<string> = relationsOf(modelType);

      if (relations.length > 0) {
        held[name] = relations;
      }

      for (const { column, metadata } of relationColumnsOf(modelType)) {
        const relatedModelType: { new (): BaseModel } = metadata.modelType as {
          new (): BaseModel;
        };

        if (
          PrivateRecordPermission.getPrivateRecordColumns(relatedModelType)
            .length === 0
        ) {
          continue;
        }

        const isHeld: boolean = relations.includes(
          `${column} -> ${modelName(relatedModelType)}`,
        );

        // Kept by its own read: the key it is a part of that record by.
        const isKept: boolean =
          metadata.type === TableColumnType.Entity &&
          PrivateRecordPermission.getPrivateRecordColumns(modelType).some(
            (kept: { column: string; recordModelType: unknown }): boolean => {
              return (
                kept.column === metadata.manyToOneRelationColumn &&
                kept.recordModelType === relatedModelType
              );
            },
          );

        const isPersonsPage: boolean = PAGES_OF_THE_PERSON_PAGED.includes(
          model.tableName || "",
        );

        if ([isHeld, isKept, isPersonsPage].filter(Boolean).length !== 1) {
          unaccounted.push(`${name}.${column}`);
        }
      }
    }

    expect(unaccounted).toEqual([]);
    expect(held).toEqual(HELD_RELATIONS);
  });

  test("a person's own page is read by that person alone, who was paged about its record", () => {
    for (const tableName of PAGES_OF_THE_PERSON_PAGED) {
      const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
        (candidate: { new (): BaseModel }): boolean => {
          return new candidate().tableName === tableName;
        },
      );

      expect(modelType).toBeDefined();

      const model: BaseModel = new modelType!();

      expect({ tableName, read: model.getReadPermissions() }).toEqual({
        tableName,
        read: [Permission.CurrentUser],
      });
      expect(model.getUserColumn()).toBeTruthy();
    }
  });

  test("no model links to a record only its service keeps private, which the rule cannot read", () => {
    const keptByServiceOnly: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const servicePath: string = path.join(
        SERVICES_DIRECTORY,
        `${modelName(modelType)}Service.ts`,
      );

      if (
        !fs.existsSync(servicePath) ||
        !PRIVATE_RECORD_FILTER.test(fs.readFileSync(servicePath, "utf8")) ||
        PrivateRecordPermission.getPrivateRecordColumns(modelType).length > 0
      ) {
        continue;
      }

      keptByServiceOnly.push(modelName(modelType));
    }

    expect(keptByServiceOnly.sort()).toEqual(
      Object.keys(KEPT_PRIVATE_BY_THEIR_SERVICE_ONLY).sort(),
    );

    const links: Array<string> = [];

    for (const modelType of AllModelTypes) {
      for (const { column, metadata } of relationColumnsOf(modelType)) {
        const related: string = modelName(
          metadata.modelType as { new (): BaseModel },
        );

        if (KEPT_PRIVATE_BY_THEIR_SERVICE_ONLY[related]) {
          links.push(`${modelName(modelType)}.${column} -> ${related}`);
        }
      }
    }

    expect(links).toEqual([]);
  });
});

/*
 * THE READ PATH ASKS THE RULE where selects, filters and sorts through a
 * relation are resolved - for every model, not one at a time.
 */
describe("the read path asks the rule", () => {
  const read: (relative: string) => string = (relative: string): string => {
    return fs.readFileSync(
      path.join(__dirname, "../../../../Server", relative),
      "utf8",
    );
  };

  const methodBody: (source: string, signature: string) => string = (
    source: string,
    signature: string,
  ): string => {
    const start: number = source.indexOf(signature);

    expect(start).toBeGreaterThan(-1);

    // Up to the next member declared at the class's indentation.
    const end: number = source.indexOf("\n  }\n", start);

    return source.slice(start, end);
  };

  test("every read of rows keeps a related private record to those who see it, by who asked", () => {
    const body: string = methodBody(
      read("Services/DatabaseService.ts"),
      "private async _findBy(",
    );

    expect(body).toContain("PrivateRecordReadFilter.keepSeenRelatedRecords(");
    expect(body).toContain("props: narrowed.asker");
  });

  test("every read, count, update and delete keeps a filter through a relation to the records the caller sees", () => {
    const body: string = methodBody(
      read("Types/Database/Permissions/BasePermission.ts"),
      "public static async addRecordScopeToQuery<",
    );

    expect(body).toContain("PrivateRecordReadFilter.addToRelationFilters(");
    // A delete reaches its records by the same rule.
    expect(read("Types/Database/Permissions/DeletePermission.ts")).toContain(
      "BasePermission.addRecordScopeToQuery(",
    );
  });

  test("every sort is held to the rule before the columns it names are read", () => {
    const body: string = methodBody(
      read("Types/Database/Permissions/SortValidator.ts"),
      "public static checkSortPermission(",
    );

    expect(body).toContain("PrivateRecordReadFilter.checkRelationSort(");
  });

  test("every read of rows checks a sort through a relation against the rows it matches, by who asked, before it queries", () => {
    const body: string = methodBody(
      read("Services/DatabaseService.ts"),
      "private async _findBy(",
    );

    const check: number = body.indexOf(
      "PrivateRecordReadFilter.checkRelationSortOfRows(",
    );

    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf("PagedFind.find("));

    const call: string = body.slice(check, body.indexOf("});", check));

    expect(call).toContain("sort: onBeforeFind.sort");
    expect(call).toContain("where: onBeforeFind.query");
    expect(call).toContain("props: narrowed.asker");
  });
});

describe("which relations are held", () => {
  test("the five models #9102 names hold their links to an incident or an alert", () => {
    expect(relationsOf(DataSecurityIssue)).toEqual([
      "alert -> Alert",
      "incident -> Incident",
    ]);
    expect(relationsOf(SecurityCase)).toEqual(["incident -> Incident"]);
    expect(relationsOf(FormSubmission)).toEqual([
      "alert -> Alert",
      "incident -> Incident",
    ]);
    expect(relationsOf(RumSessionReplayView)).toEqual([
      "linkedIncident -> Incident",
    ]);
  });

  test("a public record holds its link to a private episode, and a runner job its run", () => {
    expect(relationsOf(Alert)).toEqual(["alertEpisode -> AlertEpisode"]);
    expect(relationsOf(Incident)).toEqual([
      "incidentEpisode -> IncidentEpisode",
    ]);
    expect(relationsOf(RunnerJob)).toEqual([
      "runbookExecution -> RunbookExecution",
    ]);
  });

  test("a part of a record holds none its own read keeps - but every one when the read runs no hook", () => {
    expect(relationsOf(IncidentInternalNote)).toEqual([]);
    expect(relationsOf(EmailLog)).toEqual([]);
    expect(relationsOf(RunbookExecution)).toEqual([]);

    expect(relationsOf(EmailLog, { evenWhereItsReadKeepsThem: true })).toEqual([
      "alert -> Alert",
      "incident -> Incident",
    ]);
    expect(
      relationsOf(IncidentInternalNote, { evenWhereItsReadKeepsThem: true }),
    ).toEqual(["incident -> Incident"]);
  });

  test("a person's own page and a model naming no private record hold none", () => {
    expect(relationsOf(UserOnCallLog)).toEqual([]);
    expect(
      relationsOf(UserOnCallLog, { evenWhereItsReadKeepsThem: true }),
    ).toEqual([]);
    expect(relationsOf(Monitor)).toEqual([]);
  });
});

describe("what a related record must meet to be one the caller sees", () => {
  test.each(SEE_EVERY_PRIVATE_RECORD)(
    "%s sees every one: nothing to meet",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(
        PrivateRecordReadFilter.getSeenConditions({
          relatedModelType: Incident,
          props: props,
        }),
      ).toBeNull();
    },
  );

  test.each(SEE_ONLY_THEIR_OWN)(
    "%s sees a record only when it is not private, or theirs",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      const conditions: Array<{
        column: string;
        condition: unknown;
      }> | null = PrivateRecordReadFilter.getSeenConditions({
        relatedModelType: Incident,
        props: props,
      });

      expect(
        conditions!.map((each: { column: string }) => {
          return each.column;
        }),
      ).toEqual(["_id"]);
      expect(sqlOf(conditions![0]!.condition)).toContain(
        `SELECT 1 FROM "Incident" pr WHERE pr."_id" = COLUMN AND pr."isPrivate" = TRUE`,
      );
    },
  );

  test("a part is seen where every private record it names is: a run by its incident and its alert", () => {
    const conditions: Array<{ column: string; condition: unknown }> =
      PrivateRecordReadFilter.getSeenConditions({
        relatedModelType: RunbookExecution,
        props: member,
      })!;

    expect(
      conditions.map((each: { column: string; condition: unknown }) => {
        return `${each.column}: ${sqlOf(each.condition).match(/FROM "(\w+)" pr/)![1]}`;
      }),
    ).toEqual(["incidentId: Incident", "alertId: Alert"]);
  });

  test("an episode by its own owners", () => {
    const conditions: Array<{ column: string; condition: unknown }> =
      PrivateRecordReadFilter.getSeenConditions({
        relatedModelType: AlertEpisode,
        props: member,
      })!;

    expect(sqlOf(conditions[0]!.condition)).toContain(
      `FROM "AlertEpisodeOwnerTeam" prot`,
    );
  });
});

describe("a filter through a relation", () => {
  test("matches only the related records the caller sees, the caller's own filter kept", () => {
    const filter: Record<string, unknown> = {
      incident: { title: new Search("outage") },
      severity: "High",
    };

    const query: Record<string, unknown> =
      PrivateRecordReadFilter.addToRelationFilters(
        DataSecurityIssue,
        filter,
        member,
      );

    // The caller's own query object is not written to.
    expect(filter).toEqual({
      incident: { title: new Search("outage") },
      severity: "High",
    });

    expect(query["severity"]).toBe("High");

    const incident: Record<string, unknown> = query["incident"] as Record<
      string,
      unknown
    >;

    expect(incident["title"]).toEqual(new Search("outage"));
    expect(sqlOf(incident["_id"])).toContain(
      `NOT EXISTS (SELECT 1 FROM "Incident" pr WHERE pr."_id" = COLUMN AND pr."isPrivate" = TRUE`,
    );
  });

  test("a filter of the related record's id is kept beside the rule, whatever its form", () => {
    const id: string = ObjectID.generate().toString();

    for (const ownFilter of [
      id,
      new ObjectID(id),
      new Includes([id]),
      new NotEqual(id),
    ]) {
      const query: Record<string, unknown> =
        PrivateRecordReadFilter.addToRelationFilters(
          SecurityCase,
          { incident: { _id: ownFilter } },
          member,
        );

      const condition: FindOperator<unknown> = (
        query["incident"] as Record<string, unknown>
      )["_id"] as FindOperator<unknown>;

      expect({ ownFilter: String(ownFilter), type: condition.type }).toEqual({
        ownFilter: String(ownFilter),
        type: "and",
      });
      expect(sqlOf(condition)).toContain(`FROM "Incident" pr`);
    }
  });

  test("a part's relation is held by the keys naming its records", () => {
    const query: Record<string, unknown> =
      PrivateRecordReadFilter.addToRelationFilters(
        RunnerJob,
        { runbookExecution: { status: "Running" } },
        member,
      );

    const run: Record<string, unknown> = query["runbookExecution"] as Record<
      string,
      unknown
    >;

    expect(run["status"]).toBe("Running");
    expect(sqlOf(run["incidentId"])).toContain(`FROM "Incident" pr`);
    expect(sqlOf(run["alertId"])).toContain(`FROM "Alert" pr`);
  });

  test("a level deeper, under a relation its model's read keeps, the related record's own relations are held", () => {
    const query: Record<string, unknown> =
      PrivateRecordReadFilter.addToRelationFilters(
        IncidentInternalNote,
        { incident: { incidentEpisode: { title: new Search("db") } } },
        member,
      );

    const incident: Record<string, unknown> = query["incident"] as Record<
      string,
      unknown
    >;

    // The note's incident is kept by the note's own read.
    expect(incident["_id"]).toBeUndefined();

    const episode: Record<string, unknown> = incident[
      "incidentEpisode"
    ] as Record<string, unknown>;

    expect(sqlOf(episode["_id"])).toContain(`FROM "IncidentEpisode" pr`);
  });

  test("a relation the model's read keeps is held when the read runs no hook", () => {
    const filter: Record<string, unknown> = {
      incident: { title: new Search("x") },
    };

    expect(
      PrivateRecordReadFilter.addToRelationFilters(EmailLog, filter, member),
    ).toBe(filter);

    const query: Record<string, unknown> =
      PrivateRecordReadFilter.addToRelationFilters(EmailLog, filter, {
        ...member,
        ignoreHooks: true,
      });

    expect(
      sqlOf((query["incident"] as Record<string, unknown>)["_id"]),
    ).toContain(`FROM "Incident" pr`);
  });

  test("a relation given by ids - its key's filter, not a filter of the record - is left as sent", () => {
    const id: string = ObjectID.generate().toString();
    const filter: Record<string, unknown> = {
      incident: id,
      alert: new Includes([id]),
    };

    expect(
      PrivateRecordReadFilter.addToRelationFilters(
        DataSecurityIssue,
        filter,
        member,
      ),
    ).toBe(filter);
  });

  test.each(SEE_EVERY_PRIVATE_RECORD)(
    "%s filters as before",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      const filter: Record<string, unknown> = {
        incident: { title: new Search("outage") },
      };

      expect(
        PrivateRecordReadFilter.addToRelationFilters(
          DataSecurityIssue,
          filter,
          props,
        ),
      ).toBe(filter);
    },
  );
});

/*
 * A SORT THROUGH A RELATION by the related record's fields says where each
 * row's record falls in that order. Before the read, a sort a level deeper
 * is refused to whoever does not see every private record; a sort by the
 * related record's own columns waits for the rows (checkRelationSortOfRows,
 * below; on a migrated Postgres in PrivateRecordActionsPostgres).
 */
describe("a sort through a relation", () => {
  test.each(SEE_ONLY_THEIR_OWN)(
    "%s may not sort a level deeper by a related private record's fields",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      let refusal: unknown = null;

      try {
        PrivateRecordReadFilter.checkRelationSort({
          modelType: IncidentInternalNote,
          sort: { incident: { incidentEpisode: { title: "ASC" } } },
          props: props,
        });
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        "You do not have permissions to sort on - title of Incident Episode through incident.incidentEpisode. An incident episode can be private, and only its owners, Project Owners and Project Admins may read a private one. Only Project Owners and Project Admins sort a list by its fields through more than one relation.",
      );
    },
  );

  test("nor through a held relation by the related record's own relation", () => {
    expect(() => {
      PrivateRecordReadFilter.checkRelationSort({
        modelType: DataSecurityIssue,
        sort: { incident: { incidentEpisode: { title: "ASC" } } },
        props: member,
      });
    }).toThrow(
      "You do not have permissions to sort on - incidentEpisode of Incident through incident. An incident can be private",
    );

    expect(() => {
      PrivateRecordReadFilter.checkRelationSort({
        modelType: DataSecurityIssue,
        sort: { incident: { title: "ASC", incidentSeverity: { name: "ASC" } } },
        props: member,
      });
    }).toThrow(NotAuthorizedException);
  });

  test.each(SEE_ONLY_THEIR_OWN)(
    "%s is not refused before the read a sort by a related record's own columns: the rows decide",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      for (const [modelType, sort] of [
        [DataSecurityIssue, { incident: { title: "ASC" } }],
        [SecurityCase, { incident: { title: "DESC" } }],
        // A list's column sorted descending, empty ones last (ColumnSort).
        [
          SecurityCase,
          { incident: { title: { direction: "DESC", nulls: "LAST" } } },
        ],
        [RunnerJob, { runbookExecution: { createdAt: "DESC" } }],
      ] as Array<[{ new (): BaseModel }, Record<string, unknown>]>) {
        expect(() => {
          PrivateRecordReadFilter.checkRelationSort({
            modelType: modelType,
            sort: sort,
            props: props,
          });
        }).not.toThrow();
      }
    },
  );

  test("by the related record's id, by the model's own fields, and through a relation its read keeps, as before", () => {
    for (const [modelType, sort] of [
      [DataSecurityIssue, { incident: { _id: "ASC" } }],
      [DataSecurityIssue, { createdAt: "DESC", incidentId: "ASC" }],
      [EmailLog, { incident: { title: "ASC" } }],
      [IncidentInternalNote, { incident: { title: "ASC" } }],
    ] as Array<[{ new (): BaseModel }, Record<string, unknown>]>) {
      expect(() => {
        PrivateRecordReadFilter.checkRelationSort({
          modelType: modelType,
          sort: sort,
          props: member,
        });
      }).not.toThrow();
    }
  });

  test.each(SEE_EVERY_PRIVATE_RECORD)(
    "%s sorts as before",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(() => {
        PrivateRecordReadFilter.checkRelationSort({
          modelType: DataSecurityIssue,
          sort: { incident: { title: "ASC" } },
          props: props,
        });
        PrivateRecordReadFilter.checkRelationSort({
          modelType: IncidentInternalNote,
          sort: { incident: { incidentEpisode: { title: "ASC" } } },
          props: props,
        });
      }).not.toThrow();
    },
  );
});

/*
 * A SORT BY A RELATED RECORD'S OWN COLUMNS, AGAINST THE ROWS: the read about
 * to run is asked for one row naming a related record the caller does not
 * see - beside every condition it has - and the sort is refused when there
 * is one. Against a repository whose answer the test gives.
 */
describe("a sort checked against the rows", () => {
  interface Asked {
    repository: Repository<BaseModel>;
    wheres: Array<unknown>;
  }

  function repositoryAnswering(row: BaseModel | null): Asked {
    const asked: Asked = {
      repository: Object.create(Repository.prototype) as Repository<BaseModel>,
      wheres: [],
    };

    (asked.repository as unknown as { findOne: unknown }).findOne = jest.fn(
      async (options: { where: unknown }): Promise<BaseModel | null> => {
        asked.wheres.push(options.where);
        return row;
      },
    );

    return asked;
  }

  async function refusalOf(data: {
    modelType: { new (): BaseModel };
    sort: Record<string, unknown>;
    where: unknown;
    props: DatabaseCommonInteractionProps;
    repository: unknown;
  }): Promise<Error | null> {
    try {
      await PrivateRecordReadFilter.checkRelationSortOfRows({
        ...data,
        withDeleted: false,
      });
    } catch (error) {
      return error as Error;
    }

    return null;
  }

  test.each(SEE_ONLY_THEIR_OWN)(
    "%s: refused where a row names a related record they do not see, sorted where none does",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const naming: Asked = repositoryAnswering(new DataSecurityIssue());

      const refusal: Error | null = await refusalOf({
        modelType: DataSecurityIssue,
        sort: { incident: { title: "ASC" }, _id: "ASC" },
        where: { projectId: PROJECT_ID.toString() },
        props: props,
        repository: naming.repository,
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal!.message).toBe(
        "You do not have permissions to sort on - title of Incident through incident. Some of these records name a private incident you may not read, and where they fall in the order would say what it holds. Only its owners, Project Owners and Project Admins sort them by its fields.",
      );

      // The read's own conditions, and the key naming a record that is gone or unseen.
      const where: Record<string, unknown> = (
        naming.wheres[0] as Array<Record<string, unknown>>
      )[0]!;

      expect(where["projectId"]).toBe(PROJECT_ID.toString());
      expect(sqlOf(where["incidentId"])).toMatch(
        /^\(COLUMN IS NOT NULL AND NOT \(COLUMN IN \(SELECT "record\w+"\."_id" FROM "Incident" "record\w+" WHERE /,
      );
      expect(sqlOf(where["incidentId"])).toContain(`FROM "Incident" pr`);

      const none: Asked = repositoryAnswering(null);

      expect(
        await refusalOf({
          modelType: DataSecurityIssue,
          sort: { incident: { title: "ASC" } },
          where: { projectId: PROJECT_ID.toString() },
          props: props,
          repository: none.repository,
        }),
      ).toBeNull();
      expect(none.wheres).toHaveLength(1);
    },
  );

  test("a part's rows the same way, said of the part", async () => {
    const naming: Asked = repositoryAnswering(new RunnerJob());

    const refusal: Error | null = await refusalOf({
      modelType: RunnerJob,
      sort: { runbookExecution: { createdAt: "DESC" } },
      where: {},
      props: member,
      repository: naming.repository,
    });

    expect(refusal!.message).toBe(
      "You do not have permissions to sort on - createdAt of Runbook Execution through runbookExecution. Some of these records name a runbook execution about a private incident, alert or episode you may not read, and where they fall in the order would say what it holds. Only those who may read it, Project Owners and Project Admins sort them by its fields.",
    );

    const run: string = sqlOf(
      (naming.wheres[0] as Array<Record<string, unknown>>)[0]![
        "runbookExecutionId"
      ],
    );

    expect(run).toContain(`FROM "RunbookExecution" "record`);
    expect(run).toContain(`FROM "Incident" pr`);
    expect(run).toContain(`FROM "Alert" pr`);
  });

  test("the caller's own filter on the key stays beside it, in each branch of a read across projects", async () => {
    const naming: Asked = repositoryAnswering(null);
    const incidentId: string = ObjectID.generate().toString();

    await refusalOf({
      modelType: DataSecurityIssue,
      sort: { incident: { title: "ASC" } },
      where: [{ projectId: "a", incidentId: incidentId }, { projectId: "b" }],
      props: member,
      repository: naming.repository,
    });

    const branches: Array<Record<string, unknown>> = naming.wheres[0] as Array<
      Record<string, unknown>
    >;

    expect(branches).toHaveLength(2);
    expect(branches[0]!["projectId"]).toBe("a");
    expect((branches[0]!["incidentId"] as FindOperator<unknown>).type).toBe(
      "and",
    );
    expect(branches[1]!["projectId"]).toBe("b");
    expect(sqlOf(branches[1]!["incidentId"])).toContain("IS NOT NULL AND NOT");
  });

  test("a repository that cannot be asked: refused, as a row naming one would be", async () => {
    expect(
      await refusalOf({
        modelType: DataSecurityIssue,
        sort: { incident: { title: "ASC" } },
        where: {},
        props: member,
        repository: { findOne: jest.fn() },
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("by the related record's id, by the model's own fields, or through a relation its read keeps: nothing is asked", async () => {
    for (const [modelType, sort] of [
      [DataSecurityIssue, { incident: { _id: "ASC" } }],
      [DataSecurityIssue, { createdAt: "DESC", incidentId: "ASC" }],
      [EmailLog, { incident: { title: "ASC" } }],
      [IncidentInternalNote, { incident: { title: "ASC" } }],
    ] as Array<[{ new (): BaseModel }, Record<string, unknown>]>) {
      const naming: Asked = repositoryAnswering(new DataSecurityIssue());

      expect(
        await refusalOf({
          modelType: modelType,
          sort: sort,
          where: {},
          props: member,
          repository: naming.repository,
        }),
      ).toBeNull();
      expect(naming.wheres).toEqual([]);
    }
  });

  test.each(SEE_EVERY_PRIVATE_RECORD)(
    "%s: nothing is asked",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const naming: Asked = repositoryAnswering(new DataSecurityIssue());

      expect(
        await refusalOf({
          modelType: DataSecurityIssue,
          sort: { incident: { title: "ASC" } },
          where: {},
          props: props,
          repository: naming.repository,
        }),
      ).toBeNull();
      expect(naming.wheres).toEqual([]);
    },
  );
});

/*
 * A RUNNER JOB carries what a runbook run's step, or a fix's command, ran and
 * printed: it is read only where its reader sees every private record the
 * run or the fix names - and a job of a fix that is gone, which it names by
 * a plain id, only by those who see every private record. A job of an AI
 * run is read only by those who may read the run, too (#9155:
 * AIRunOutputReadFilter.test).
 */
describe("a Runner job", () => {
  test("is read through the run and the fix it names, and the AI run it ran a command for", () => {
    expect(
      RUNNER_JOB_READ_THROUGH.map(
        (key: { column: string; partModelType: unknown }) => {
          return `${key.column} -> ${modelName(key.partModelType as { new (): BaseModel })}`;
        },
      ),
    ).toEqual([
      "runbookExecutionId -> RunbookExecution",
      "autoRemediationSuggestionId -> AutoRemediationSuggestion",
    ]);
    expect(RUNNER_JOB_AI_RUN_KEY).toBe("aiRunId");
    expect(RunnerJobService.getColumnsReadHooksNarrowBy()).toEqual([
      "runbookExecutionId",
      "autoRemediationSuggestionId",
      "aiRunId",
    ]);
  });

  test.each(SEE_ONLY_THEIR_OWN)(
    "%s reads one naming no run or fix, or one they see",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      const query: Record<string, unknown> =
        RunnerJobServiceClass.applyPrivacyFilters({}, props);

      const run: string = sqlOf(query["runbookExecutionId"]);
      const fix: string = sqlOf(query["autoRemediationSuggestionId"]);

      expect(run).toMatch(
        /^\(COLUMN IS NULL OR \(COLUMN IN \(SELECT "record\w+"\."_id" FROM "RunbookExecution" "record\w+" WHERE /,
      );
      expect(run).toContain(
        `."incidentId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Incident" pr`,
      );
      expect(run).toContain(
        `."alertId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Alert" pr`,
      );
      expect(fix).toContain(`FROM "AutoRemediationSuggestion" "record`);
      expect(fix).toContain(`FROM "Incident" pr`);
    },
  );

  test("the caller's own filter on the run stays beside the rule", () => {
    const runId: string = ObjectID.generate().toString();

    const query: Record<string, unknown> =
      RunnerJobServiceClass.applyPrivacyFilters(
        { runbookExecutionId: runId },
        member,
      );

    expect((query["runbookExecutionId"] as FindOperator<unknown>).type).toBe(
      "and",
    );
  });

  test.each(
    SEE_EVERY_PRIVATE_RECORD.filter(
      (reader: [string, DatabaseCommonInteractionProps]): boolean => {
        return Boolean(reader[1].isRoot || reader[1].isMasterAdmin);
      },
    ),
  )(
    "%s reads every job, unnarrowed",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(
        RunnerJobServiceClass.applyPrivacyFilters({ status: "Running" }, props),
      ).toEqual({
        status: "Running",
      });
    },
  );

  test.each(
    SEE_EVERY_PRIVATE_RECORD.filter(
      (reader: [string, DatabaseCommonInteractionProps]): boolean => {
        return !reader[1].isRoot && !reader[1].isMasterAdmin;
      },
    ),
  )(
    "%s reads every job of a run or a fix, and of an AI run only one they may read: not someone else's chat",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      const query: Record<string, unknown> =
        RunnerJobServiceClass.applyPrivacyFilters({ status: "Running" }, props);

      expect(Object.keys(query).sort()).toEqual(["aiRunId", "status"]);
      expect(sqlOf(query["aiRunId"])).toMatch(
        /^\(COLUMN IS NULL OR EXISTS \(SELECT 1 FROM "AIRun" "(aiRun\w+)" WHERE "\1"\."_id" = COLUMN AND /,
      );
      // No private record is out of their sight.
      expect(sqlOf(query["aiRunId"])).not.toContain(`FROM "Incident"`);
    },
  );

  test("its every read and count are narrowed", async () => {
    const find: { findBy: { query: Record<string, unknown> } } = await (
      RunnerJobService as unknown as {
        onBeforeFind: (findBy: unknown) => Promise<{
          findBy: { query: Record<string, unknown> };
        }>;
      }
    ).onBeforeFind({ query: {}, props: member, skip: 0, limit: 10 });

    expect(Object.keys(find.findBy.query).sort()).toEqual([
      "aiRunId",
      "autoRemediationSuggestionId",
      "runbookExecutionId",
    ]);

    const counted: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      DatabaseService.prototype,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(0) as never);

    await RunnerJobService.countBy({ query: {}, props: member });

    expect(
      Object.keys(
        (counted.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
      ).sort(),
    ).toEqual(["aiRunId", "autoRemediationSuggestionId", "runbookExecutionId"]);
  });
});

describe("a select through a relation", () => {
  const SEEN_INCIDENT: string = ObjectID.generate().toString();
  const UNSEEN_INCIDENT: string = ObjectID.generate().toString();
  const UNSEEN_ALERT: string = ObjectID.generate().toString();

  // Who sees which record: the incident only one of the two.
  function answerSeen(): ReturnType<typeof getJestSpyOn> {
    return getJestSpyOn(
      PrivateRecordReadFilter,
      "readSeenIds",
    ).mockImplementation((async (data: {
      relatedModelType: { new (): BaseModel };
      ids: Array<string>;
    }): Promise<Set<string>> => {
      return new Set<string>(
        data.ids.filter((id: string): boolean => {
          return id === SEEN_INCIDENT.toLowerCase();
        }),
      );
    }) as never);
  }

  function issue(incidentId: string, alertId?: string): DataSecurityIssue {
    const row: DataSecurityIssue = new DataSecurityIssue();
    row._id = ObjectID.generate().toString();
    row.incidentId = new ObjectID(incidentId);
    row.incident = {
      _id: incidentId,
      title: `Title of ${incidentId}`,
    } as never;

    if (alertId) {
      row.alertId = new ObjectID(alertId);
      row.alert = { _id: alertId, title: "An alert" } as never;
    }

    return row;
  }

  test("leaves out the related records the caller does not see, and keeps the row and its keys", async () => {
    const reads: ReturnType<typeof getJestSpyOn> = answerSeen();
    const seen: DataSecurityIssue = issue(SEEN_INCIDENT);
    const unseen: DataSecurityIssue = issue(UNSEEN_INCIDENT, UNSEEN_ALERT);

    await PrivateRecordReadFilter.keepSeenRelatedRecords({
      modelType: DataSecurityIssue,
      rows: [seen, unseen],
      select: {
        _id: true,
        incident: { _id: true, title: true },
        alert: { title: true },
      },
      props: member,
    });

    expect((seen.incident as unknown as { title: string }).title).toBe(
      `Title of ${SEEN_INCIDENT}`,
    );
    expect(unseen.incident).toBeUndefined();
    expect(unseen.alert).toBeUndefined();
    expect(unseen.incidentId?.toString()).toBe(UNSEEN_INCIDENT);
    expect(unseen.alertId?.toString()).toBe(UNSEEN_ALERT);

    // One read per related model, for the whole answer.
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("a list through a relation loses the entries the caller does not see", async () => {
    answerSeen();

    const row: Record<string, unknown> = {
      _id: ObjectID.generate().toString(),
      incident: [
        { _id: SEEN_INCIDENT, title: "seen" },
        { _id: UNSEEN_INCIDENT, title: "unseen" },
      ],
    };

    getJestSpyOn(PrivateRecordReadFilter, "getRelations").mockReturnValue([
      { relation: "incident", relatedModelType: Incident, isList: true },
    ]);

    await PrivateRecordReadFilter.keepSeenRelatedRecords({
      modelType: DataSecurityIssue,
      rows: [row as unknown as BaseModel],
      select: { incident: { title: true } },
      props: member,
    });

    expect(row["incident"]).toEqual([{ _id: SEEN_INCIDENT, title: "seen" }]);
  });

  test("reads nothing for a select of the related record's id alone, or of no relation", async () => {
    const reads: ReturnType<typeof getJestSpyOn> = answerSeen();
    const row: DataSecurityIssue = issue(UNSEEN_INCIDENT);

    for (const select of [
      { _id: true, incident: { _id: true } },
      { _id: true, incidentId: true },
      { _id: true, incident: { title: false } },
    ]) {
      await PrivateRecordReadFilter.keepSeenRelatedRecords({
        modelType: DataSecurityIssue,
        rows: [row],
        select: select,
        props: member,
      });
    }

    expect(reads).not.toHaveBeenCalled();
    expect(row.incident).toBeDefined();
  });

  test("leaves a relation its model's read keeps as read, unless the read ran no hook", async () => {
    answerSeen();

    const log: EmailLog = new EmailLog();
    log.incident = { _id: UNSEEN_INCIDENT, title: "x" } as never;

    await PrivateRecordReadFilter.keepSeenRelatedRecords({
      modelType: EmailLog,
      rows: [log],
      select: { incident: { title: true } },
      props: member,
    });

    expect(log.incident).toBeDefined();

    await PrivateRecordReadFilter.keepSeenRelatedRecords({
      modelType: EmailLog,
      rows: [log],
      select: { incident: { title: true } },
      props: { ...member, ignoreHooks: true },
    });

    expect(log.incident).toBeUndefined();
  });

  test.each(SEE_EVERY_PRIVATE_RECORD)(
    "%s reads every related record, asking nothing",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const reads: ReturnType<typeof getJestSpyOn> = answerSeen();
      const row: DataSecurityIssue = issue(UNSEEN_INCIDENT);

      await PrivateRecordReadFilter.keepSeenRelatedRecords({
        modelType: DataSecurityIssue,
        rows: [row],
        select: { incident: { title: true } },
        props: props,
      });

      expect(reads).not.toHaveBeenCalled();
      expect(row.incident).toBeDefined();
    },
  );

  test("with no database to ask who sees a related record, nobody but those who see every one is shown it", async () => {
    const row: DataSecurityIssue = issue(SEEN_INCIDENT);

    await PrivateRecordReadFilter.keepSeenRelatedRecords({
      modelType: DataSecurityIssue,
      rows: [row],
      select: { incident: { title: true } },
      props: member,
    });

    expect(row.incident).toBeUndefined();
  });
});
