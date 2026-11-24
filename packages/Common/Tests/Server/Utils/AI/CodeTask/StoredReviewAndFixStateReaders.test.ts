import AIRunService from "../../../../../Server/Services/AIRunService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import CodeTaskThread from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import TelemetryAiFix from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiFix";
import ProductionReviewReadFilter from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewReadFilter";
import { applyIncidentSelfPrivacyFilter } from "../../../../../Server/Utils/Incident/IncidentPrivacyFilter";
import logger from "../../../../../Server/Utils/Logger";
import { shouldBypassRecordPrivacy } from "../../../../../Server/Utils/PrivacyFilterUtil";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import { CodeTaskOutcome } from "../../../../../Types/AI/CodeTask";
import { ProductionReviewReport } from "../../../../../Types/CodeRepository/ProductionReview";
import {
  ProductionReviewLeakJSON,
  SensitiveDataLeakKind,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import {
  HIDDEN_TELEMETRY_AI_FIX_SUGGESTION,
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixSuggestion,
  telemetryAiFixSuggestionToJSON,
} from "../../../../../Utils/Suggestions/TelemetryAiFixSuggestion";
import { fullReport } from "../../CodeRepository/ProductionReview/ProductionReviewFixtures";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * THE TWO READS THE CODE PAGES AND THE FIX PANELS MAKE FOR A PERSON, FOR
 * EVERY KIND OF READER.
 *
 *   - A stored production review's incidents (#9241,
 *     ProductionReviewReadFilter.readReadableIncidentIds) are asked of the
 *     incidents themselves, as the reader: IncidentService's own rule
 *     (applyIncidentSelfPrivacyFilter) then keeps a private incident to its
 *     owners - the members of its owner teams, the people named on it -
 *     and to Project Owners and Project Admins, and keeps every private one
 *     from an API key without either role and from a workflow's step.
 *   - The tasks a fix panel shows (CodeTaskThread.findTasksHiddenFrom) are
 *     asked by the rule the task's own page reads them by
 *     (AIRunOutputReadFilter.applyToRunRow): those who see every private
 *     record are not narrowed and nothing is read for them; everyone else
 *     reads only the tasks whose every record they see.
 *
 * CodeFixRunReadPostgres runs both on a migrated Postgres, where the SQL is
 * answered; these hold each reader to the read it gets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1a2b3c4d-0000-4000-8000-000000000001",
);
const OWNING_TEAM_ID: ObjectID = new ObjectID(
  "1a2b3c4d-0000-4000-8000-000000000002",
);
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "1a2b3c4d-0000-4000-8000-000000000003",
);
const PERSON_ID: ObjectID = new ObjectID(
  "1a2b3c4d-0000-4000-8000-000000000004",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "1a2b3c4d-0000-4000-8000-000000000005",
);
const TASK_ID: string = "1a2b3c4d-0000-4000-8000-0000000000a1";
const OTHER_TASK_ID: string = "1a2b3c4d-0000-4000-8000-0000000000a2";

function grant(permission: Permission, teamId?: ObjectID): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
    ...(teamId ? { teamId } : {}),
  };
}

function propsOf(
  permissions: Array<UserPermission>,
  userType: UserType,
): DatabaseCommonInteractionProps {
  return {
    ...(userType === UserType.User ? { userId: PERSON_ID } : {}),
    ...(userType === UserType.API ? { apiKeyId: API_KEY_ID } : {}),
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Scale,
    userType,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.User, Permission.CurrentUser],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions,
      },
    },
  } as DatabaseCommonInteractionProps;
}

interface Reader {
  name: string;
  props: DatabaseCommonInteractionProps;
  // Sees every private record of the project.
  seesEveryPrivateRecord: boolean;
  // A person: the rule asks which private records are theirs.
  isPerson: boolean;
}

/*
 * Who an owner is - a member of an owner team, or a person named on the
 * record - is the owner tables' to say, in the SQL: to the rule, each of
 * them is a person of the project who does not see every private record.
 */
const READERS: Array<Reader> = [
  {
    name: "a member of the team that owns the record",
    props: propsOf(
      [grant(Permission.ProjectMember, OWNING_TEAM_ID)],
      UserType.User,
    ),
    seesEveryPrivateRecord: false,
    isPerson: true,
  },
  {
    name: "the person named as its owner",
    props: propsOf([grant(Permission.ProjectMember)], UserType.User),
    seesEveryPrivateRecord: false,
    isPerson: true,
  },
  {
    name: "another member",
    props: propsOf(
      [grant(Permission.ProjectMember, OTHER_TEAM_ID)],
      UserType.User,
    ),
    seesEveryPrivateRecord: false,
    isPerson: true,
  },
  {
    name: "a Project Owner",
    props: propsOf([grant(Permission.ProjectOwner)], UserType.User),
    seesEveryPrivateRecord: true,
    isPerson: true,
  },
  {
    name: "a Project Admin",
    props: propsOf([grant(Permission.ProjectAdmin)], UserType.User),
    seesEveryPrivateRecord: true,
    isPerson: true,
  },
  {
    name: "an API key that may read incidents and Code",
    props: propsOf([grant(Permission.ProjectMember)], UserType.API),
    seesEveryPrivateRecord: false,
    isPerson: false,
  },
  {
    name: "an API key with Project Admin",
    props: propsOf([grant(Permission.ProjectAdmin)], UserType.API),
    seesEveryPrivateRecord: true,
    isPerson: false,
  },
  {
    name: "a workflow's step",
    props: {
      ...WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: ObjectID.generate(),
      }),
      currentPlan: PlanType.Scale,
    },
    seesEveryPrivateRecord: false,
    isPerson: false,
  },
];

// The SQL a Raw operator writes for a column, and what it binds.
function sqlOf(operator: unknown): { sql: string; values: Array<unknown> } {
  const raw: FindOperator<unknown> = operator as FindOperator<unknown>;

  return {
    sql: (raw.getSql as (alias: string) => string)("c"),
    values: Object.values(
      (raw.objectLiteralParameters || {}) as Record<string, unknown>,
    ),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the readers, as the rule tells them apart", () => {
  test.each(READERS)("$name", (reader: Reader) => {
    expect(shouldBypassRecordPrivacy(reader.props)).toBe(
      reader.seesEveryPrivateRecord,
    );
  });
});

describe("a stored review's incidents, read as each reader (#9241)", () => {
  const report: ProductionReviewReport = fullReport();
  const ids: Array<string> = report.incidents.items.map(
    (item: { incidentId: string }): string => {
      return item.incidentId;
    },
  );

  test.each(READERS)(
    "$name: asked of the incidents as themselves, and the incidents' own rule narrows it as it should",
    async (reader: Reader) => {
      const read: SpyInstance<typeof IncidentService.findBy> = jest
        .spyOn(IncidentService, "findBy")
        .mockImplementation((async () => {
          // The service answers what its rule lets the reader read.
          const incident: Incident = new Incident();
          incident._id = ids[1]!;
          return [incident];
        }) as never);

      const readable: Set<string> =
        await ProductionReviewReadFilter.readReadableIncidentIds({
          projectId: PROJECT_ID,
          reports: [report, report],
          props: reader.props,
        });

      // Whatever the service lets them read, and nothing more.
      expect(Array.from(readable)).toEqual([ids[1]]);

      // One read, of each incident once, as the reader - never as OneUptime.
      expect(read).toHaveBeenCalledTimes(1);
      const asked: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
        limit: number;
      } = read.mock.calls[0]![0] as never;
      expect(asked.props).toBe(reader.props);
      expect(asked.select).toEqual({ _id: true });
      expect(asked.limit).toBe(ids.length);
      expect(asked.query["projectId"]).toBe(PROJECT_ID);

      /*
       * The rule the service then puts on that read (IncidentService
       * .onBeforeFind): none for those who see every private record; a
       * person's own owner rows for a person; no private incident at all
       * for an API key or a workflow's step without either role.
       */
      const narrowed: Record<string, unknown> = applyIncidentSelfPrivacyFilter(
        { ...asked.query },
        reader.props,
      );

      if (reader.seesEveryPrivateRecord) {
        expect(narrowed["isPrivate"]).toBeUndefined();
        return;
      }

      const rule: { sql: string; values: Array<unknown> } = sqlOf(
        narrowed["isPrivate"],
      );

      expect(rule.sql).toContain("c IS NULL OR c = FALSE");

      if (reader.isPerson) {
        expect(rule.sql).toContain('"IncidentOwnerUser"');
        expect(rule.sql).toContain('"IncidentOwnerTeam"');
        expect(rule.sql).toContain('"hasAcceptedInvitation" = TRUE');
        expect(rule.values).toEqual([PERSON_ID.toString()]);
      } else {
        expect(rule.sql).not.toContain("IncidentOwner");
        expect(rule.values).toEqual([]);
      }
    },
  );

  test("root reads every incident, with no read of them", async () => {
    const read: SpyInstance<typeof IncidentService.findBy> = jest.spyOn(
      IncidentService,
      "findBy",
    );

    expect(
      Array.from(
        await ProductionReviewReadFilter.readReadableIncidentIds({
          projectId: PROJECT_ID,
          reports: [report],
          props: { isRoot: true },
        }),
      ),
    ).toEqual(ids);
    expect(read).not.toHaveBeenCalled();
  });

  test("a reader who may read no incident reads none of them", async () => {
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No permission."));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    expect(
      (
        await ProductionReviewReadFilter.readReadableIncidentIds({
          projectId: PROJECT_ID,
          reports: [report],
          props: READERS[2]!.props,
        })
      ).size,
    ).toBe(0);
    expect(logged).not.toHaveBeenCalled();
  });

  test("incidents that cannot be read are none of the reader's: what is not known to be theirs is left out", async () => {
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(new Error("Postgres is down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    expect(
      (
        await ProductionReviewReadFilter.readReadableIncidentIds({
          projectId: PROJECT_ID,
          reports: [report],
          props: READERS[2]!.props,
        })
      ).size,
    ).toBe(0);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Postgres is down"),
    );
  });

  test("a review with no incident, or no review, asks nothing", async () => {
    const read: SpyInstance<typeof IncidentService.findBy> = jest.spyOn(
      IncidentService,
      "findBy",
    );

    expect(
      (
        await ProductionReviewReadFilter.readReadableIncidentIds({
          projectId: PROJECT_ID,
          reports: [
            fullReport({ incidents: { total: 3, open: 0, items: [] } }),
            undefined,
            null,
          ],
          props: READERS[2]!.props,
        })
      ).size,
    ).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  test("an outcome is kept as it is when nothing in it is hidden, and rewritten when something is", () => {
    const outcome: CodeTaskOutcome = {
      summary: "Production review: kept as it is.",
      filesChanged: [],
      productionReview: report,
    };

    expect(
      ProductionReviewReadFilter.keepOutcome(outcome, new Set<string>(ids)),
    ).toBe(outcome);

    const kept: CodeTaskOutcome = ProductionReviewReadFilter.keepOutcome(
      outcome,
      new Set<string>([ids[1]!.toUpperCase().toLowerCase()]),
      "merge request",
    );

    expect(kept).not.toBe(outcome);
    expect(kept.productionReview!.incidents.items).toHaveLength(1);
    expect(kept.summary).toContain("1 incident");
    // The stored outcome is not changed: a copy is.
    expect(outcome.productionReview!.incidents.items).toHaveLength(2);

    const none: CodeTaskOutcome = {
      summary: "Added a retry.",
      filesChanged: [],
    };
    expect(ProductionReviewReadFilter.keepOutcome(none, new Set())).toBe(none);
    expect(
      ProductionReviewReadFilter.keepOutcome(undefined, new Set()),
    ).toBeUndefined();
  });
});

describe("a stored review's sensitive data, read as each reader (#10376)", () => {
  const point: ProductionReviewLeakJSON = {
    key: "bucket-key",
    kind: SensitiveDataLeakKind.Infrastructure,
    checkId: "public-read",
    path: "infra/s3.tf",
    line: 3,
    subject: "acl",
    dataTypeIds: [],
    dataTypeNames: [],
    sensitivity: DataSensitivity.Confidential,
    severity: SecuritySeverity.Critical,
    isBlocking: true,
    failsCheck: false,
    text: "Sets `acl` to `public-read`.",
    fix: "Set it to `private`.",
    isAiWorded: false,
    production: {
      store: {
        dataStoreId: "5d1c2b3a-0000-4000-8000-0000000000b1",
        name: "acme-card-exports",
        sensitivity: DataSensitivity.Restricted,
        dataTypeNames: ["Card number"],
      },
    },
  };
  const knowing: ProductionReviewReport = fullReport({
    sensitiveData: {
      points: [point],
      moreCount: 0,
      droppedCount: 0,
      isFailOn: false,
      isAiRead: false,
    },
  });
  const plain: ProductionReviewReport = fullReport({
    sensitiveData: {
      points: [{ ...point, production: undefined }],
      moreCount: 0,
      droppedCount: 0,
      isFailOn: false,
      isAiRead: false,
    },
  });
  const reader: DatabaseCommonInteractionProps = READERS[2]!.props;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a reader whose role reads Data Security's findings reads what production knows - asked as themselves", async () => {
    const read: SpyInstance<typeof DataStoreFindingService.findBy> = jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockResolvedValue([]);

    expect(
      await ProductionReviewReadFilter.canReadDataSecurity({
        projectId: PROJECT_ID,
        reports: [knowing],
        props: reader,
      }),
    ).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      limit: 1,
      props: reader,
    });
  });

  test.each([
    new NotAuthorizedException("You may not read findings."),
    new PaymentRequiredException("Data Security is not on your plan."),
    new Error("Postgres is away"),
  ])(
    "a reader the read refuses (%s) reads each point without it",
    async (refusal: Error) => {
      jest.spyOn(DataStoreFindingService, "findBy").mockRejectedValue(refusal);

      const canRead: boolean =
        await ProductionReviewReadFilter.canReadDataSecurity({
          projectId: PROJECT_ID,
          reports: [knowing],
          props: reader,
        });

      expect(canRead).toBe(false);

      const outcome: CodeTaskOutcome = {
        summary: "Production review: a public bucket.",
        filesChanged: [],
        productionReview: knowing,
      };
      const ids: Set<string> = new Set<string>(
        knowing.incidents.items.map((item: { incidentId: string }): string => {
          return item.incidentId;
        }),
      );
      const kept: CodeTaskOutcome = ProductionReviewReadFilter.keepOutcome(
        outcome,
        ids,
        undefined,
        canRead,
      );

      expect(JSON.stringify(kept)).not.toContain("acme-card-exports");
      expect(kept.productionReview!.sensitiveData!.points[0]!.production).toBe(
        undefined,
      );
      // The stored outcome is not changed: a copy is.
      expect(
        outcome.productionReview!.sensitiveData!.points[0]!.production,
      ).toBeDefined();
    },
  );

  test("root reads it all, and a review with nothing of production asks nothing", async () => {
    const read: SpyInstance<typeof DataStoreFindingService.findBy> = jest.spyOn(
      DataStoreFindingService,
      "findBy",
    );

    expect(
      await ProductionReviewReadFilter.canReadDataSecurity({
        projectId: PROJECT_ID,
        reports: [knowing],
        props: { isRoot: true },
      }),
    ).toBe(true);
    expect(
      await ProductionReviewReadFilter.canReadDataSecurity({
        projectId: PROJECT_ID,
        reports: [plain, undefined, null],
        props: reader,
      }),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the tasks a fix panel shows, read as each reader", () => {
  test.each(READERS)(
    "$name: the rule the task's own page reads it by",
    async (reader: Reader) => {
      const read: SpyInstance<typeof AIRunService.findBy> = jest
        .spyOn(AIRunService, "findBy")
        .mockImplementation((async () => {
          // The rule lets the reader read the other task only.
          const run: AIRun = new AIRun();
          run._id = OTHER_TASK_ID;
          return [run];
        }) as never);

      const hidden: Set<string> = await CodeTaskThread.findTasksHiddenFrom({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID, OTHER_TASK_ID.toUpperCase(), TASK_ID, "not-an-id"],
        reader: reader.props,
      });

      if (reader.seesEveryPrivateRecord) {
        // Not narrowed: nothing is hidden, and nothing is read for it.
        expect(hidden.size).toBe(0);
        expect(read).not.toHaveBeenCalled();
        return;
      }

      expect(Array.from(hidden)).toEqual([TASK_ID]);
      expect(read).toHaveBeenCalledTimes(1);

      const asked: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
        limit: number;
      } = read.mock.calls[0]![0] as never;

      // Read as OneUptime, held to the rule: each task once, in the project.
      expect(asked.props).toEqual({ isRoot: true });
      expect(asked.select).toEqual({ _id: true });
      expect(asked.limit).toBe(2);
      expect(asked.query["projectId"]).toBe(PROJECT_ID);

      for (const key of [
        "triggeredByIncidentId",
        "triggeredByAlertId",
        "triggeredByAutoRemediationSuggestionId",
        "carriedIncidentIds",
        "carriedAlertIds",
        "codeTaskId",
      ]) {
        expect({ key, isNarrowed: Boolean(asked.query[key]) }).toEqual({
          key,
          isNarrowed: true,
        });
      }

      const carried: { sql: string; values: Array<unknown> } = sqlOf(
        asked.query["carriedIncidentIds"],
      );

      expect(carried.sql).toContain("jsonb_array_elements_text");

      if (reader.isPerson) {
        expect(carried.values).toContain(PERSON_ID.toString());
      } else {
        expect(carried.values).not.toContain(PERSON_ID.toString());
        expect(carried.sql).not.toContain("prou");
      }
    },
  );

  test("no tasks, or none that is a task's id: nothing is read", async () => {
    const read: SpyInstance<typeof AIRunService.findBy> = jest.spyOn(
      AIRunService,
      "findBy",
    );

    expect(
      (
        await CodeTaskThread.findTasksHiddenFrom({
          projectId: PROJECT_ID,
          taskIds: ["not-an-id"],
          reader: READERS[2]!.props,
        })
      ).size,
    ).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
});

/*
 * A finding's Fix with AI says what of the task already on its way, for
 * each reader, when the rule lets them read none of the tasks: a link to it
 * for those who see every private record, and for everyone else only that a
 * fix is there.
 */
describe("a finding's fix on its way, read as each reader", () => {
  test.each(READERS)(
    "$name: the task, or only that it is there",
    async (reader: Reader) => {
      const read: SpyInstance<typeof AIRunService.findBy> = jest
        .spyOn(AIRunService, "findBy")
        .mockResolvedValue([]);

      const suggestion: TelemetryAiFixSuggestion =
        await TelemetryAiFix.getInProgressSuggestion({
          projectId: PROJECT_ID,
          taskId: TASK_ID,
          reader: reader.props,
        });

      if (reader.seesEveryPrivateRecord) {
        expect(suggestion).toEqual({
          ...NO_TELEMETRY_AI_FIX_SUGGESTION,
          offer: SuggestionOffer.InProgress,
          taskId: TASK_ID,
        });
        expect(read).not.toHaveBeenCalled();
        return;
      }

      expect(suggestion).toEqual(HIDDEN_TELEMETRY_AI_FIX_SUGGESTION);
      expect(
        JSON.stringify(telemetryAiFixSuggestionToJSON(suggestion)),
      ).not.toContain(TASK_ID);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
});
