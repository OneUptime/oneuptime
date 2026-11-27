import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudCostRecommendation from "../../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudOffHoursSchedule from "../../../../Models/DatabaseModels/CloudOffHoursSchedule";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudSavingsAction from "../../../../Models/DatabaseModels/CloudSavingsAction";
import Label from "../../../../Models/DatabaseModels/Label";
import Project from "../../../../Models/DatabaseModels/Project";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import CloudAccountFeedService from "../../../../Server/Services/CloudAccountFeedService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudCostRecommendationService from "../../../../Server/Services/CloudCostRecommendationService";
import CloudOffHoursScheduleService from "../../../../Server/Services/CloudOffHoursScheduleService";
import CloudResourceFeedService from "../../../../Server/Services/CloudResourceFeedService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import CloudSavingsActionService from "../../../../Server/Services/CloudSavingsActionService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudOffHoursScheduler, {
  CloudOffHoursRunSummary,
} from "../../../../Server/Utils/CloudSavings/CloudOffHoursScheduler";
import CloudSavingsActionRunner, {
  CLOUD_OFF_HOURS_STOP_HELD_SUMMARIES,
  CloudSavingsRunnerOptions,
  hasTakenAStep,
  isMadeByNobody,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsActionRunner";
import CloudSavingsActions from "../../../../Server/Utils/CloudSavings/CloudSavingsActions";
import CloudSavingsAiEngine, {
  CloudSavingsAiOutcome,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsAiEngine";
import CloudSavingsOwners, {
  CloudResourceOwners,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsOwners";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { CloudSavingKind } from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import * as CloudResourceEnvironmentModule from "../../../../Types/Cloud/CloudResourceEnvironment";
import {
  CloudEnvironmentSource,
  CloudResourceEnvironment,
  CloudResourceEnvironmentReading,
  CloudResourceEnvironmentReadings,
  CloudResourceEnvironmentSigns,
  getCloudResourceEnvironment,
} from "../../../../Types/Cloud/CloudResourceEnvironment";
import {
  CloudSavingsActionGroup,
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsActionsAccess,
} from "../../../../Types/Cloud/CloudSavingsAction";
import {
  CLOUD_SAVINGS_AI_REASON_SENTENCES,
  CloudSavingsAiAutonomy,
  CloudSavingsAiReason,
} from "../../../../Types/Cloud/CloudSavingsAi";
import {
  CloudOffHoursPreview,
  CloudOffHoursPreviewResource,
  CloudOffHoursSkipReason,
  CloudSavingsActionResult,
  CloudSavingsOffer,
} from "../../../../Types/Cloud/CloudSavingsApiTypes";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { createFakeAwsSavings, FakeAwsSavings } from "./FakeAwsSavings";

/*
 * A LABEL NEVER MAKES A RESOURCE NON-PRODUCTION FOR WHAT NOBODY APPROVES
 * (#11347), THROUGH THE ENGINE, THE RUNNER AND THE SCHEDULER, AGAINST A
 * FAKE EC2.
 *
 * A resource's environment was read from its cloud tags, its account's
 * setting and the names of its OneUptime labels, alike for every change.
 * Renaming one label - an ordinary edit, in the Dashboard, the API or the
 * MCP server's update_label - changed what OneUptime believed of every
 * resource that carried it, so "Production" renamed to "dev", or any
 * label to "dev", let an AI rule stop those resources without asking and
 * an off-hours schedule stop them at night.
 *
 * Here the real CloudSavingsAiEngine, CloudSavingsActionRunner,
 * CloudOffHoursScheduler and CloudSavingsActions run over an in-memory
 * stand-in for their tables (every service call they make is answered
 * from it: a label is one row, read through every resource that carries
 * it, so renaming it is one edit that reaches them all, as in Postgres),
 * and change the fake EC2 of #11091 (FakeAwsSavings). Each gap is shown as
 * the code read it before - every sign's environment for every change,
 * stood in for by the one reading - and then closed:
 *
 *   - a label renamed to dev no longer lets a rule stop a production
 *     instance without asking, nor a schedule stop it at night: the rule
 *     proposes it, and the schedule leaves it running and says why;
 *   - no edit of a label, a resource's labels or a rule makes a resource
 *     its tags call production, or one nothing says of, eligible;
 *   - production from any sign still wins, a label's included;
 *   - an unattended change is read again at the moment it acts: a rule's
 *     becomes a proposal, a schedule's stop is left; one under way is
 *     finished; a read that fails makes nothing;
 *   - Apply, and an owner's approval, still read labels and make the
 *     change, as before.
 *
 * CloudSavingsActionsPostgres runs the same flows against a migrated
 * Postgres, where it is set up to.
 */

const ACCOUNT: string = "123456789012";
const REGION: string = "eu-west-1";
const PROD_INSTANCE: string = "i-0def1234abc567890";
const DEV_INSTANCE: string = "i-0abc1234def567890";
const OTHER_INSTANCE: string = "i-0fed1234cba567890";

function arn(id: string): string {
  return `arn:aws:ec2:${REGION}:${ACCOUNT}:instance/${id}`;
}

type Row = Record<string, unknown>;

// A value as a query compares it: an id, a switch or a word, as text.
function textOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function timeOf(value: unknown): number {
  return value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : new Date(String(value)).getTime();
}

// Whether a row meets a query, as the services' queries are written.
function meets(row: Row, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(
    ([key, condition]: [string, unknown]): boolean => {
      const value: unknown = row[key];

      if (condition instanceof Includes) {
        return (condition.values as Array<unknown>)
          .map(textOf)
          .includes(textOf(value));
      }

      if (condition instanceof IsNull) {
        return value === null || value === undefined;
      }

      if (condition instanceof GreaterThanOrEqual) {
        return (
          value !== null &&
          value !== undefined &&
          timeOf(value) >= timeOf(condition.value)
        );
      }

      if (condition instanceof LessThanOrEqual) {
        return (
          value !== null &&
          value !== undefined &&
          timeOf(value) <= timeOf(condition.value)
        );
      }

      return textOf(value) === textOf(condition);
    },
  );
}

function sorted(
  rows: Array<Row>,
  sort: Record<string, unknown> | undefined,
): Array<Row> {
  const [key, order] = Object.entries(sort || {})[0] || [];

  if (!key) {
    return rows;
  }

  return [...rows].sort((a: Row, b: Row): number => {
    const left: unknown = a[key];
    const right: unknown = b[key];
    const compared: number =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : left instanceof Date || right instanceof Date
          ? timeOf(left) - timeOf(right)
          : textOf(left).localeCompare(textOf(right));

    return order === SortOrder.Descending ? -compared : compared;
  });
}

// A model with a row's values, as a service hands one back.
function modelOf<T>(ModelClass: { new (): T }, row: Row): T {
  const model: T = new ModelClass();

  Object.assign(model as unknown as Row, row);

  return model;
}

// Every service call the flows make, answered from rows held here.
class SavingsTables {
  public rows: Map<string, Array<Row>> = new Map();
  public feed: Array<{ table: string; markdown: string }> = [];
  // What a resource's read throws, once each: a database that failed.
  public failResourceReads: number = 0;
  // Run as each change is written, before it acts: someone's edit in between.
  public onActionCreated: ((action: Row) => void) | null = null;
  public clock: () => Date = (): Date => {
    return new Date();
  };

  public table(name: string): Array<Row> {
    if (!this.rows.has(name)) {
      this.rows.set(name, []);
    }

    return this.rows.get(name)!;
  }

  public insert(name: string, row: Row): string {
    const id: string = textOf(row["_id"]) || ObjectID.generate().toString();

    this.table(name).push({ ...row, _id: id });

    return id;
  }

  public get(name: string, id: unknown): Row | undefined {
    return this.table(name).find((row: Row): boolean => {
      return textOf(row["_id"]) === textOf(id);
    });
  }

  public update(name: string, id: unknown, values: Row): void {
    Object.assign(this.get(name, id)!, values);
  }

  public find(
    name: string,
    data: {
      query?: Record<string, unknown> | undefined;
      sort?: Record<string, unknown> | undefined;
      skip?: unknown;
      limit?: unknown;
    },
  ): Array<Row> {
    const skip: number = Number(data.skip) || 0;
    const limit: number = Number(data.limit) || Number.MAX_SAFE_INTEGER;

    return sorted(
      this.table(name).filter((row: Row): boolean => {
        return !row["deletedAt"] && meets(row, data.query || {});
      }),
      data.sort,
    ).slice(skip, skip + limit);
  }

  // A resource as it is read: its labels as they are named now.
  public resourceOf(row: Row): CloudResource {
    return modelOf(CloudResource, {
      ...row,
      labels: ((row["labelIds"] as Array<string>) || [])
        .map((id: string): Row | undefined => {
          return this.get("Label", id);
        })
        .filter((label: Row | undefined): label is Row => {
          return Boolean(label);
        })
        .map((label: Row): Label => {
          return modelOf(Label, label);
        }),
    });
  }

  public install(): void {
    type Read = {
      query?: Record<string, unknown>;
      sort?: Record<string, unknown>;
      skip?: unknown;
      limit?: unknown;
    };
    const one: <T>(
      ModelClass: { new (): T },
      name: string,
    ) => (data: Read) => Promise<T | null> = <T>(
      ModelClass: { new (): T },
      name: string,
    ): ((data: Read) => Promise<T | null>) => {
      return async (data: Read): Promise<T | null> => {
        const row: Row | undefined = this.find(name, {
          ...data,
          limit: 1,
        })[0];

        return row ? modelOf(ModelClass, row) : null;
      };
    };
    const many: <T>(
      ModelClass: { new (): T },
      name: string,
    ) => (data: Read) => Promise<Array<T>> = <T>(
      ModelClass: { new (): T },
      name: string,
    ): ((data: Read) => Promise<Array<T>>) => {
      return async (data: Read): Promise<Array<T>> => {
        return this.find(name, data).map((row: Row): T => {
          return modelOf(ModelClass, row);
        });
      };
    };
    const byId: <T>(
      ModelClass: { new (): T },
      name: string,
    ) => (data: { id: unknown }) => Promise<T | null> = <T>(
      ModelClass: { new (): T },
      name: string,
    ): ((data: { id: unknown }) => Promise<T | null>) => {
      return async (data: { id: unknown }): Promise<T | null> => {
        const row: Row | undefined = this.get(name, data.id);

        return row && !row["deletedAt"] ? modelOf(ModelClass, row) : null;
      };
    };

    jest
      .spyOn(CloudCostRecommendationService, "findBy")
      .mockImplementation(
        many(CloudCostRecommendation, "CloudCostRecommendation") as never,
      );
    jest
      .spyOn(CloudCostRecommendationService, "findOneBy")
      .mockImplementation(
        one(CloudCostRecommendation, "CloudCostRecommendation") as never,
      );
    jest
      .spyOn(CloudAccountService, "findOneBy")
      .mockImplementation(one(CloudAccount, "CloudAccount") as never);
    jest
      .spyOn(CloudAccountService, "findBy")
      .mockImplementation(many(CloudAccount, "CloudAccount") as never);
    jest
      .spyOn(CloudConnectionService, "findOneBy")
      .mockImplementation(one(CloudConnection, "CloudConnection") as never);
    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockImplementation(byId(CloudConnection, "CloudConnection") as never);
    jest
      .spyOn(CloudConnectionService, "getConnectorSettings")
      .mockImplementation(async (): Promise<CloudConnectionSettings> => {
        return settings();
      });
    jest.spyOn(CloudResourceService, "findOneBy").mockImplementation((async (
      data: Read,
    ): Promise<CloudResource | null> => {
      if (this.failResourceReads > 0) {
        this.failResourceReads--;
        throw new Error("The database could not be read.");
      }

      const row: Row | undefined = this.find("CloudResource", {
        ...data,
        limit: 1,
      })[0];

      return row ? this.resourceOf(row) : null;
    }) as never);
    jest.spyOn(CloudResourceService, "findBy").mockImplementation((async (
      data: Read,
    ): Promise<Array<CloudResource>> => {
      return this.find("CloudResource", data).map((row: Row) => {
        return this.resourceOf(row);
      });
    }) as never);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation(byId(Project, "Project") as never);
    jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation(
        many(AutoRemediationRule, "AutoRemediationRule") as never,
      );
    jest
      .spyOn(CloudOffHoursScheduleService, "findBy")
      .mockImplementation(
        many(CloudOffHoursSchedule, "CloudOffHoursSchedule") as never,
      );
    jest
      .spyOn(CloudOffHoursScheduleService, "findOneBy")
      .mockImplementation(
        one(CloudOffHoursSchedule, "CloudOffHoursSchedule") as never,
      );
    jest
      .spyOn(CloudOffHoursScheduleService, "updateOneById")
      .mockImplementation((async (data: {
        id: unknown;
        data: Row;
      }): Promise<void> => {
        this.update("CloudOffHoursSchedule", data.id, data.data);
      }) as never);
    jest
      .spyOn(CloudSavingsActionService, "findBy")
      .mockImplementation(
        many(CloudSavingsAction, "CloudSavingsAction") as never,
      );
    jest
      .spyOn(CloudSavingsActionService, "findOneBy")
      .mockImplementation(
        one(CloudSavingsAction, "CloudSavingsAction") as never,
      );
    jest
      .spyOn(CloudSavingsActionService, "findOneById")
      .mockImplementation(
        byId(CloudSavingsAction, "CloudSavingsAction") as never,
      );
    jest.spyOn(CloudSavingsActionService, "countBy").mockImplementation((async (
      data: Read,
    ): Promise<PositiveNumber> => {
      return new PositiveNumber(this.find("CloudSavingsAction", data).length);
    }) as never);
    jest
      .spyOn(CloudSavingsActionService, "create")
      .mockImplementation((async (data: {
        data: CloudSavingsAction;
      }): Promise<CloudSavingsAction> => {
        const id: string = this.insert("CloudSavingsAction", {
          ...data.data,
          createdAt: this.clock(),
        });
        const row: Row = this.get("CloudSavingsAction", id)!;

        this.onActionCreated?.(row);

        return modelOf(CloudSavingsAction, row);
      }) as never);
    jest
      .spyOn(CloudSavingsActionService, "attemptTransition")
      .mockImplementation((async (data: {
        actionId: ObjectID;
        fromStatuses: ReadonlyArray<CloudSavingsActionStatus>;
        set: Row;
        whileFirstApprovedBy?: string | null | undefined;
        whileNextStepAtOrBefore?: Date | undefined;
      }): Promise<number> => {
        const row: Row | undefined = this.get(
          "CloudSavingsAction",
          data.actionId,
        );

        if (
          !row ||
          row["deletedAt"] ||
          !data.fromStatuses.includes(row["status"] as CloudSavingsActionStatus)
        ) {
          return 0;
        }

        if (
          data.whileFirstApprovedBy !== undefined &&
          textOf(row["firstApprovedByUserId"]) !==
            textOf(data.whileFirstApprovedBy)
        ) {
          return 0;
        }

        if (
          data.whileNextStepAtOrBefore &&
          (!row["nextStepAt"] ||
            timeOf(row["nextStepAt"]) > data.whileNextStepAtOrBefore.getTime())
        ) {
          return 0;
        }

        Object.assign(row, data.set);

        return 1;
      }) as never);
    jest
      .spyOn(CloudResourceFeedService, "createCloudResourceFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
      }): Promise<void> => {
        this.feed.push({
          table: "CloudResourceFeed",
          markdown: data.feedInfoInMarkdown,
        });
      }) as never);
    jest
      .spyOn(CloudAccountFeedService, "createCloudAccountFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
      }): Promise<void> => {
        this.feed.push({
          table: "CloudAccountFeed",
          markdown: data.feedInfoInMarkdown,
        });
      }) as never);
    jest
      .spyOn(CloudSavingsOwners, "getOwners")
      .mockImplementation((async (data: {
        cloudResourceId?: ObjectID | undefined;
      }): Promise<CloudResourceOwners> => {
        const owners: Array<string> =
          (this.get("CloudResource", data.cloudResourceId)?.[
            "ownerUserIds"
          ] as Array<string>) || [];

        return {
          userIds: new Set(owners),
          users: owners.map((userId: string) => {
            return { userId, name: "Owner" };
          }),
          teams: [],
        } as unknown as CloudResourceOwners;
      }) as never);
    jest
      .spyOn(CloudSavingsOwners, "mayChangeResource")
      .mockResolvedValue(true as never);
    jest
      .spyOn(CloudSavingsOwners, "assertMayChangeResource")
      .mockResolvedValue(undefined as never);
  }
}

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

interface Person {
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

function person(projectId: ObjectID, permission: Permission): Person {
  const userId: ObjectID = ObjectID.generate();
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId,
    props: {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    },
  };
}

interface World {
  projectId: ObjectID;
  accountId: string;
  owner: Person;
}

let tables: SavingsTables;

function seedWorld(
  data: {
    accountEnvironment?: CloudResourceEnvironment | undefined;
    savingsActions?: CloudSavingsActionsAccess | undefined;
  } = {},
): World {
  const projectId: ObjectID = ObjectID.generate();
  const connectionId: string = tables.insert("CloudConnection", {
    projectId,
    name: "AWS",
    provider: CloudProvider.AWS,
    isEnabled: true,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      savingsActions: data.savingsActions ?? CloudSavingsActionsAccess.Resize,
    },
  });

  tables.insert("Project", {
    _id: projectId.toString(),
    name: "Savings",
    enableAi: true,
    requireTwoApprovalsForRiskierFixes: false,
  });

  return {
    projectId,
    accountId: tables.insert("CloudAccount", {
      projectId,
      name: "Shop",
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
      environment: data.accountEnvironment ?? CloudResourceEnvironment.Unknown,
      cloudConnectionId: new ObjectID(connectionId),
    }),
    owner: person(projectId, Permission.ProjectMember),
  };
}

function seedLabel(world: World, name: string): string {
  return tables.insert("Label", { projectId: world.projectId, name });
}

function seedInstance(
  world: World,
  data: {
    id: string;
    name: string;
    tags?: Record<string, string> | undefined;
    labelIds?: Array<string> | undefined;
  },
): string {
  return tables.insert("CloudResource", {
    projectId: world.projectId,
    name: data.name,
    cloudProvider: CloudProvider.AWS,
    cloudResourceType: "AWS::EC2::Instance",
    cloudAccountId: ACCOUNT,
    cloudRegion: REGION,
    providerResourceId: data.id,
    cloudTags: data.tags || {},
    labelIds: data.labelIds || [],
    ownerUserIds: [world.owner.userId.toString()],
    isArchived: false,
  });
}

// An idle instance: stopping it saves `monthly` a month.
function seedIdleSaving(
  world: World,
  resourceId: string,
  instanceId: string,
  monthly: number = 40,
): ObjectID {
  return new ObjectID(
    tables.insert("CloudCostRecommendation", {
      projectId: world.projectId,
      cloudAccountId: new ObjectID(world.accountId),
      cloudResourceId: new ObjectID(resourceId),
      provider: CloudProvider.AWS,
      recommendationId: `idle-${instanceId}`,
      region: REGION,
      resourceId: arn(instanceId),
      resourceType: "AWS::EC2::Instance",
      resourceName: instanceId,
      kind: CloudSavingKind.Idle,
      action: "Stop",
      monthlySavings: monthly,
      currency: "USD",
    }),
  );
}

// A rightsized instance: m5.large to m5.medium.
function seedResizeSaving(
  world: World,
  resourceId: string,
  instanceId: string,
): ObjectID {
  return new ObjectID(
    tables.insert("CloudCostRecommendation", {
      projectId: world.projectId,
      cloudAccountId: new ObjectID(world.accountId),
      cloudResourceId: new ObjectID(resourceId),
      provider: CloudProvider.AWS,
      recommendationId: `rightsize-${instanceId}`,
      region: REGION,
      resourceId: arn(instanceId),
      resourceType: "AWS::EC2::Instance",
      resourceName: instanceId,
      kind: CloudSavingKind.Rightsize,
      action: "Rightsize",
      currentConfiguration: "m5.large",
      recommendedConfiguration: "m5.medium",
      monthlySavings: 60,
      currency: "USD",
    }),
  );
}

function seedRule(
  world: World,
  data: {
    name: string;
    autonomy?: CloudSavingsAiAutonomy | undefined;
    environments?: Array<CloudResourceEnvironment> | undefined;
    groups?: Array<CloudSavingsActionGroup> | undefined;
  },
): void {
  tables.insert("AutoRemediationRule", {
    projectId: world.projectId,
    name: data.name,
    isEnabled: true,
    triggerEntityType: AutoRemediationTriggerEntity.CloudSaving,
    cloudSavingAutonomy: data.autonomy ?? CloudSavingsAiAutonomy.WithoutAsking,
    cloudSavingMonthlyLimit: 500,
    cloudSavingActionGroups: data.groups || [],
    cloudSavingEnvironments: data.environments || [],
    cloudSavingProviders: [],
  });
}

function seedSchedule(world: World): string {
  return tables.insert("CloudOffHoursSchedule", {
    projectId: world.projectId,
    name: "Office hours",
    isEnabled: true,
    tagKey: "Schedule",
    tagValue: "office-hours",
    timezone: "UTC",
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    startTime: "08:00",
    stopTime: "19:00",
    stopsInstances: true,
    stopsDatabases: true,
  });
}

function fakeEc2(
  instances: Array<{ id: string; type?: string; transitionReads?: number }>,
): FakeAwsSavings {
  return createFakeAwsSavings({
    instances: instances.map(
      (instance: { id: string; type?: string; transitionReads?: number }) => {
        return {
          id: instance.id,
          type: instance.type || "m5.large",
          state: "running" as const,
          ...(instance.transitionReads
            ? { transitionReads: instance.transitionReads }
            : {}),
        };
      },
    ),
  });
}

function runner(fake: FakeAwsSavings, now: Date): CloudSavingsRunnerOptions {
  return {
    transport: fake.transport,
    now,
    sleep: async (): Promise<void> => {},
  };
}

function actionsOf(world: World): Array<Row> {
  return tables.find("CloudSavingsAction", {
    query: { projectId: world.projectId },
  });
}

function actionOn(world: World, instanceId: string): Row | undefined {
  return actionsOf(world).find((row: Row): boolean => {
    return row["resourceId"] === arn(instanceId);
  });
}

async function evaluate(
  world: World,
  now: Date = new Date(),
): Promise<CloudSavingsAiOutcome> {
  return await CloudSavingsAiEngine.evaluateAccounts({
    projectId: world.projectId,
    cloudAccountIds: [new ObjectID(world.accountId)],
    now,
  });
}

/*
 * The code as it read the environment before #11347: one reading, labels'
 * names included, for every change - a person's and nobody's alike.
 */
function readAsBefore(): void {
  jest
    .spyOn(
      CloudResourceEnvironmentModule,
      "getCloudResourceEnvironmentReadings",
    )
    .mockImplementation(
      (
        signs: CloudResourceEnvironmentSigns,
      ): CloudResourceEnvironmentReadings => {
        const reading: CloudResourceEnvironmentReading =
          getCloudResourceEnvironment(signs);

        return { reading, unattended: reading };
      },
    );
}

beforeEach(() => {
  tables = new SavingsTables();
  tables.install();
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an AI rule that acts without asking, and a label renamed", () => {
  // The issue's first rename: "Production" to "dev".
  function seedProductionByLabel(world: World): {
    labelId: string;
    resourceId: string;
  } {
    const labelId: string = seedLabel(world, "Production");
    const resourceId: string = seedInstance(world, {
      id: PROD_INSTANCE,
      name: "orders-prod",
      tags: { team: "orders" },
      labelIds: [labelId],
    });

    seedIdleSaving(world, resourceId, PROD_INSTANCE);
    seedRule(world, { name: "Stop idle non-production" });

    return { labelId, resourceId };
  }

  test("before the rename, the instance its label calls production waits for a person", async () => {
    const world: World = seedWorld();
    seedProductionByLabel(world);

    expect(await evaluate(world)).toEqual({
      proposed: 1,
      madeWithoutAsking: 0,
      expired: 0,
    });
    expect(actionOn(world, PROD_INSTANCE)).toMatchObject({
      status: CloudSavingsActionStatus.Proposed,
      environment: CloudResourceEnvironment.Production,
      summary:
        CLOUD_SAVINGS_AI_REASON_SENTENCES[CloudSavingsAiReason.Production],
    });
  });

  test("the gap, as read before #11347: renamed Production to dev, the rule stopped the production instance with nobody asked", async () => {
    readAsBefore();

    const world: World = seedWorld();
    const { labelId } = seedProductionByLabel(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: PROD_INSTANCE }]);
    const now: Date = new Date();

    // One edit of one label: every resource that carries it reads as dev.
    tables.update("Label", labelId, { name: "dev" });

    expect(await evaluate(world, now)).toEqual({
      proposed: 0,
      madeWithoutAsking: 1,
      expired: 0,
    });
    expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(1);
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
    expect(fake.instances.get(PROD_INSTANCE)?.state).not.toBe("running");
    expect(actionOn(world, PROD_INSTANCE)?.["status"]).toBe(
      CloudSavingsActionStatus.AppliedWithoutAsking,
    );
  });

  test("now, renamed Production to dev, it is proposed to its owner, saying why, and the instance keeps running", async () => {
    const world: World = seedWorld();
    const { labelId } = seedProductionByLabel(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: PROD_INSTANCE }]);
    const now: Date = new Date();

    tables.update("Label", labelId, { name: "dev" });

    expect(await evaluate(world, now)).toEqual({
      proposed: 1,
      madeWithoutAsking: 0,
      expired: 0,
    });
    expect(actionOn(world, PROD_INSTANCE)).toMatchObject({
      status: CloudSavingsActionStatus.Proposed,
      origin: CloudSavingsActionOrigin.Rule,
      autoRemediationRuleName: "Stop idle non-production",
      // The card shows what every sign says, and why it was not made.
      environment: CloudResourceEnvironment.NonProduction,
      summary:
        CLOUD_SAVINGS_AI_REASON_SENTENCES[
          CloudSavingsAiReason.OnlyLabelsSayNonProduction
        ],
    });
    expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(fake.instances.get(PROD_INSTANCE)?.state).toBe("running");
  });

  test("the issue's second rename: any label renamed to dev, on an instance nothing said was not production", async () => {
    const world: World = seedWorld();
    const labelId: string = seedLabel(world, "team-a");
    const resourceId: string = seedInstance(world, {
      id: OTHER_INSTANCE,
      name: "orders-misc",
      labelIds: [labelId],
    });

    seedIdleSaving(world, resourceId, OTHER_INSTANCE);
    seedRule(world, { name: "Stop idle non-production" });
    tables.update("Label", labelId, { name: "dev" });

    const fake: FakeAwsSavings = fakeEc2([{ id: OTHER_INSTANCE }]);
    const now: Date = new Date();

    expect((await evaluate(world, now)).madeWithoutAsking).toBe(0);
    await CloudSavingsActionRunner.runDue(runner(fake, now));
    expect(fake.calls).toEqual([]);
    expect(actionOn(world, OTHER_INSTANCE)?.["summary"]).toBe(
      CLOUD_SAVINGS_AI_REASON_SENTENCES[
        CloudSavingsAiReason.OnlyLabelsSayNonProduction
      ],
    );
  });

  test("whatever its labels are named, an instance its tags call production, or that nothing is said of, is never stopped without asking", async () => {
    const names: Array<string> = [
      "dev",
      "Staging",
      "env: dev",
      "environment=qa",
      "sandbox",
      "non-prod",
      "Production EU",
      "team-a",
    ];

    for (const tags of [{ environment: "production" }, { team: "orders" }]) {
      for (const name of names) {
        tables = new SavingsTables();
        jest.restoreAllMocks();
        tables.install();

        const world: World = seedWorld();
        const labelId: string = seedLabel(world, "team-b");
        const resourceId: string = seedInstance(world, {
          id: PROD_INSTANCE,
          name: "orders",
          tags,
          labelIds: [labelId, seedLabel(world, "orders")],
        });

        seedIdleSaving(world, resourceId, PROD_INSTANCE);
        seedRule(world, { name: "Stop idle non-production" });
        // The edits a person or an agent can make of the labels: a rename, and more attached.
        tables.update("Label", labelId, { name });
        tables.update("CloudResource", resourceId, {
          labelIds: [labelId, seedLabel(world, name), seedLabel(world, "QA")],
        });

        const fake: FakeAwsSavings = fakeEc2([{ id: PROD_INSTANCE }]);
        const now: Date = new Date();
        const outcome: CloudSavingsAiOutcome = await evaluate(world, now);

        await CloudSavingsActionRunner.runDue(runner(fake, now));

        expect({ tags, name, made: outcome.madeWithoutAsking }).toEqual({
          tags,
          name,
          made: 0,
        });
        expect({ tags, name, writes: fake.writes() }).toEqual({
          tags,
          name,
          writes: [],
        });
      }
    }
  });

  test("a rule for non-production still covers what only a label calls so: proposed, never left unsaid", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: OTHER_INSTANCE,
      name: "orders-staging",
      labelIds: [seedLabel(world, "Staging")],
    });

    seedIdleSaving(world, resourceId, OTHER_INSTANCE);
    seedRule(world, {
      name: "Stop non-production",
      environments: [CloudResourceEnvironment.NonProduction],
    });

    expect(await evaluate(world)).toEqual({
      proposed: 1,
      madeWithoutAsking: 0,
      expired: 0,
    });
  });

  test("the tags and the account still say non-production to a rule, as before", async () => {
    for (const data of [
      { tags: { environment: "dev" }, accountEnvironment: undefined },
      {
        tags: { team: "orders" },
        accountEnvironment: CloudResourceEnvironment.NonProduction,
      },
    ]) {
      tables = new SavingsTables();
      jest.restoreAllMocks();
      tables.install();

      const world: World = seedWorld({
        accountEnvironment: data.accountEnvironment,
      });
      const resourceId: string = seedInstance(world, {
        id: DEV_INSTANCE,
        name: "orders-dev",
        tags: data.tags,
      });

      seedIdleSaving(world, resourceId, DEV_INSTANCE);
      seedRule(world, { name: "Stop idle non-production" });

      const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
      const now: Date = new Date();

      expect((await evaluate(world, now)).madeWithoutAsking).toBe(1);
      expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(1);
      expect(fake.writes()).toEqual(["ec2:StopInstances"]);
      expect(actionOn(world, DEV_INSTANCE)?.["status"]).toBe(
        CloudSavingsActionStatus.AppliedWithoutAsking,
      );
    }
  });

  test("production from any sign still wins: a label that says production holds an instance its tags and account call non-production", async () => {
    const world: World = seedWorld({
      accountEnvironment: CloudResourceEnvironment.NonProduction,
    });
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { environment: "dev" },
      labelIds: [seedLabel(world, "env: prod")],
    });

    seedIdleSaving(world, resourceId, DEV_INSTANCE);
    seedRule(world, { name: "Stop idle non-production" });

    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    expect((await evaluate(world, now)).madeWithoutAsking).toBe(0);
    await CloudSavingsActionRunner.runDue(runner(fake, now));
    expect(fake.calls).toEqual([]);
    expect(actionOn(world, DEV_INSTANCE)).toMatchObject({
      status: CloudSavingsActionStatus.Proposed,
      environment: CloudResourceEnvironment.Production,
    });
  });

  test("an archived production label still holds its resources", async () => {
    const world: World = seedWorld();
    const labelId: string = seedLabel(world, "Production");
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { environment: "dev" },
      labelIds: [labelId],
    });

    tables.update("Label", labelId, { isArchived: true });
    seedIdleSaving(world, resourceId, DEV_INSTANCE);
    seedRule(world, { name: "Stop idle non-production" });

    expect((await evaluate(world)).madeWithoutAsking).toBe(0);
  });
});

describe("an unattended change is read again at the moment it acts", () => {
  function seedDevSaving(world: World): { resourceId: string } {
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { environment: "dev" },
    });

    seedIdleSaving(world, resourceId, DEV_INSTANCE);
    seedRule(world, { name: "Stop idle non-production" });

    return { resourceId };
  }

  test("a label that says production put on it after the rule decided: proposed instead, saying why, on its timeline", async () => {
    const world: World = seedWorld();
    const { resourceId } = seedDevSaving(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    expect((await evaluate(world, now)).madeWithoutAsking).toBe(1);
    expect(actionOn(world, DEV_INSTANCE)?.["status"]).toBe(
      CloudSavingsActionStatus.Applying,
    );

    tables.update("CloudResource", resourceId, {
      labelIds: [seedLabel(world, "Production")],
    });

    // The worker steps it, and reads the instance again first.
    expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(actionOn(world, DEV_INSTANCE)).toMatchObject({
      status: CloudSavingsActionStatus.Proposed,
      environment: CloudResourceEnvironment.Production,
      nextStepAt: null,
      summary:
        CLOUD_SAVINGS_AI_REASON_SENTENCES[CloudSavingsAiReason.Production],
    });
    expect(
      tables.feed.map((line: { markdown: string }): string => {
        return line.markdown;
      }),
    ).toEqual([
      expect.stringContaining("proposed for orders-dev"),
      expect.stringContaining("proposed for orders-dev"),
    ]);

    // It waits for an owner now: later runs leave it.
    await CloudSavingsActionRunner.runDue(
      runner(fake, new Date(now.getTime() + 60 * 60 * 1000)),
    );
    expect(fake.calls).toEqual([]);
  });

  test("its account marked production after the rule decided: proposed instead", async () => {
    const world: World = seedWorld();
    seedDevSaving(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    await evaluate(world, now);
    tables.update("CloudAccount", world.accountId, {
      environment: CloudResourceEnvironment.Production,
    });
    await CloudSavingsActionRunner.runDue(runner(fake, now));

    expect(fake.calls).toEqual([]);
    expect(actionOn(world, DEV_INSTANCE)).toMatchObject({
      status: CloudSavingsActionStatus.Proposed,
      environment: CloudResourceEnvironment.Production,
    });
  });

  test("its tag changed in the cloud to production, or taken off, after the rule decided: proposed instead", async () => {
    for (const [tags, reason] of [
      [{ environment: "production" }, CloudSavingsAiReason.Production],
      [{ team: "orders" }, CloudSavingsAiReason.EnvironmentNotKnown],
    ] as Array<[Record<string, string>, CloudSavingsAiReason]>) {
      tables = new SavingsTables();
      jest.restoreAllMocks();
      tables.install();

      const world: World = seedWorld();
      const { resourceId } = seedDevSaving(world);
      const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
      const now: Date = new Date();

      await evaluate(world, now);
      tables.update("CloudResource", resourceId, { cloudTags: tags });
      await CloudSavingsActionRunner.runDue(runner(fake, now));

      expect(fake.calls).toEqual([]);
      expect(actionOn(world, DEV_INSTANCE)?.["summary"]).toBe(
        CLOUD_SAVINGS_AI_REASON_SENTENCES[reason],
      );
    }
  });

  test("its tag taken off and a label that says dev put on, after the rule decided: only the label says so, so proposed", async () => {
    const world: World = seedWorld();
    const { resourceId } = seedDevSaving(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    await evaluate(world, now);
    tables.update("CloudResource", resourceId, {
      cloudTags: {},
      labelIds: [seedLabel(world, "dev")],
    });
    await CloudSavingsActionRunner.runDue(runner(fake, now));

    expect(fake.calls).toEqual([]);
    expect(actionOn(world, DEV_INSTANCE)).toMatchObject({
      status: CloudSavingsActionStatus.Proposed,
      environment: CloudResourceEnvironment.NonProduction,
      summary:
        CLOUD_SAVINGS_AI_REASON_SENTENCES[
          CloudSavingsAiReason.OnlyLabelsSayNonProduction
        ],
    });
  });

  test("its resource gone from OneUptime after the rule decided: nothing says it is not production, so proposed", async () => {
    const world: World = seedWorld();
    const { resourceId } = seedDevSaving(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    await evaluate(world, now);
    tables.update("CloudResource", resourceId, { deletedAt: now });
    await CloudSavingsActionRunner.runDue(runner(fake, now));

    expect(fake.calls).toEqual([]);
    expect(actionOn(world, DEV_INSTANCE)?.["summary"]).toBe(
      CLOUD_SAVINGS_AI_REASON_SENTENCES[
        CloudSavingsAiReason.EnvironmentNotKnown
      ],
    );
  });

  test("still non-production when it acts: it is made, as before", async () => {
    const world: World = seedWorld();
    seedDevSaving(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    await evaluate(world, now);
    expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(1);
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
    expect(actionOn(world, DEV_INSTANCE)?.["status"]).toBe(
      CloudSavingsActionStatus.AppliedWithoutAsking,
    );
  });

  test("a read of the resource that fails makes nothing: the worker tries again once its lease ends", async () => {
    const world: World = seedWorld();
    seedDevSaving(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);
    const now: Date = new Date();

    await evaluate(world, now);
    tables.failResourceReads = 1;

    expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(actionOn(world, DEV_INSTANCE)?.["status"]).toBe(
      CloudSavingsActionStatus.Applying,
    );

    // Leased for five minutes: a run within them leaves it.
    await CloudSavingsActionRunner.runDue(
      runner(fake, new Date(now.getTime() + 60 * 1000)),
    );
    expect(fake.calls).toEqual([]);

    // After the lease, read again and made.
    expect(
      await CloudSavingsActionRunner.runDue(
        runner(fake, new Date(now.getTime() + 6 * 60 * 1000)),
      ),
    ).toBe(1);
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
  });

  test("a change already under way is finished: an instance stopped to be resized is not left stopped", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { environment: "dev" },
    });

    seedResizeSaving(world, resourceId, DEV_INSTANCE);
    seedRule(world, {
      name: "Resize idle non-production",
      groups: [CloudSavingsActionGroup.Resize],
    });

    const fake: FakeAwsSavings = fakeEc2([
      { id: DEV_INSTANCE, type: "m5.large", transitionReads: 1 },
    ]);
    const now: Date = new Date();

    expect((await evaluate(world, now)).madeWithoutAsking).toBe(1);
    await CloudSavingsActionRunner.runDue(runner(fake, now));
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
    expect(
      hasTakenAStep(actionOn(world, DEV_INSTANCE)?.["progress"] as never),
    ).toBe(true);

    // A label that says production, between the stop and the resize.
    tables.update("CloudResource", resourceId, {
      labelIds: [seedLabel(world, "Production")],
    });

    // The worker's runs, two minutes apart, while the instance stops.
    for (let run: number = 1; run <= 4; run++) {
      await CloudSavingsActionRunner.runDue(
        runner(fake, new Date(now.getTime() + run * 2 * 60 * 1000)),
      );
    }

    expect(fake.writes()).toEqual([
      "ec2:StopInstances",
      "ec2:ModifyInstanceAttribute",
      "ec2:StartInstances",
    ]);
    expect(fake.instances.get(DEV_INSTANCE)).toMatchObject({
      type: "m5.medium",
    });
    expect(actionOn(world, DEV_INSTANCE)?.["status"]).toBe(
      CloudSavingsActionStatus.AppliedWithoutAsking,
    );
  });

  test("whose change it is decides whether it is read again: nobody's, never a person's", () => {
    const of: (values: Row) => CloudSavingsAction = (
      values: Row,
    ): CloudSavingsAction => {
      return modelOf(CloudSavingsAction, values);
    };

    expect(isMadeByNobody(of({ origin: CloudSavingsActionOrigin.Rule }))).toBe(
      true,
    );
    expect(
      isMadeByNobody(of({ origin: CloudSavingsActionOrigin.Schedule })),
    ).toBe(true);
    expect(
      isMadeByNobody(
        of({
          origin: CloudSavingsActionOrigin.Rule,
          approvedByUserId: ObjectID.generate().toString(),
        }),
      ),
    ).toBe(false);
    expect(
      isMadeByNobody(of({ origin: CloudSavingsActionOrigin.Person })),
    ).toBe(false);
    expect(hasTakenAStep({})).toBe(false);
    expect(hasTakenAStep(undefined)).toBe(false);
    expect(hasTakenAStep({ step: "wait-stopped" })).toBe(true);
  });
});

describe("an off-hours schedule, and a label renamed", () => {
  // Monday 23 November 2026, in UTC: working hours 08:00 to 19:00.
  const MONDAY_EVENING: Date = new Date("2026-11-23T19:05:00Z");
  const TUESDAY_MORNING: Date = new Date("2026-11-24T08:05:00Z");

  function lastRun(scheduleId: string): CloudOffHoursRunSummary {
    return tables.get("CloudOffHoursSchedule", scheduleId)?.[
      "lastRunSummary"
    ] as unknown as CloudOffHoursRunSummary;
  }

  function seedLabelledInstance(world: World, labelName: string): string {
    const labelId: string = seedLabel(world, labelName);

    seedInstance(world, {
      id: PROD_INSTANCE,
      name: "orders-prod",
      tags: { Schedule: "office-hours" },
      labelIds: [labelId],
    });

    return labelId;
  }

  test("the gap, as read before #11347: renamed Production to dev, the schedule stopped the production instance at night", async () => {
    readAsBefore();

    const world: World = seedWorld();
    const labelId: string = seedLabelledInstance(world, "Production");
    seedSchedule(world);
    tables.update("Label", labelId, { name: "dev" });

    const fake: FakeAwsSavings = fakeEc2([{ id: PROD_INSTANCE }]);

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
  });

  test("now, renamed Production to dev, it is left running, and See Resources says only its labels call it non-production", async () => {
    const world: World = seedWorld();
    const labelId: string = seedLabelledInstance(world, "Production");
    const scheduleId: string = seedSchedule(world);
    tables.update("Label", labelId, { name: "dev" });

    const fake: FakeAwsSavings = fakeEc2([{ id: PROD_INSTANCE }]);
    const preview: CloudOffHoursPreview = await CloudOffHoursScheduler.preview({
      projectId: world.projectId,
      scheduleId: new ObjectID(scheduleId),
      now: MONDAY_EVENING,
    });

    expect(
      preview.resources.map((resource: CloudOffHoursPreviewResource) => {
        return {
          name: resource.name,
          environment: resource.environment,
          skipReason: resource.skipReason,
        };
      }),
    ).toEqual([
      {
        name: "orders-prod",
        environment: CloudResourceEnvironment.NonProduction,
        skipReason: CloudOffHoursSkipReason.OnlyLabelsSayNonProduction,
      },
    ]);

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

    expect(fake.calls).toEqual([]);
    expect(lastRun(scheduleId)).toMatchObject({
      matched: 1,
      stopped: 0,
      skippedNotKnown: 1,
      skippedProduction: 0,
    });
    expect(actionsOf(world)).toEqual([]);
  });

  test("a label that says production keeps running an instance its tag calls dev", async () => {
    const world: World = seedWorld();
    seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { Schedule: "office-hours", environment: "dev" },
      labelIds: [seedLabel(world, "Production")],
    });
    const scheduleId: string = seedSchedule(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

    expect(fake.calls).toEqual([]);
    expect(lastRun(scheduleId)).toMatchObject({
      stopped: 0,
      skippedProduction: 1,
    });
  });

  test("an instance its tag calls dev is stopped, and started in the morning, as before", async () => {
    const world: World = seedWorld();
    seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { Schedule: "office-hours", environment: "dev" },
      labelIds: [seedLabel(world, "team-a")],
    });
    seedSchedule(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);

    await CloudOffHoursScheduler.runAll(runner(fake, TUESDAY_MORNING));
    expect(fake.writes()).toEqual(["ec2:StopInstances", "ec2:StartInstances"]);
  });

  test("a stop is read again as it is made: a label that says production put on between the pick and the stop leaves it running", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { Schedule: "office-hours", environment: "dev" },
    });
    const scheduleId: string = seedSchedule(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);

    // The stop is written; before it acts, someone labels the instance.
    tables.onActionCreated = (): void => {
      tables.update("CloudResource", resourceId, {
        labelIds: [seedLabel(world, "Production")],
      });
    };

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

    expect(fake.calls).toEqual([]);
    expect(actionsOf(world)).toEqual([
      expect.objectContaining({
        origin: CloudSavingsActionOrigin.Schedule,
        status: CloudSavingsActionStatus.Expired,
        environment: CloudResourceEnvironment.Production,
        summary:
          CLOUD_OFF_HOURS_STOP_HELD_SUMMARIES[CloudSavingsAiReason.Production],
      }),
    ]);
    expect(lastRun(scheduleId)).toMatchObject({
      matched: 1,
      stopped: 0,
      skippedProduction: 1,
      failed: 0,
    });
  });

  test("a stop read again as it is made, when only a label now says dev: left running, and counted as not known", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { Schedule: "office-hours", environment: "dev" },
    });
    const scheduleId: string = seedSchedule(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);

    // Its environment tag taken off in the cloud, and a label put on that says dev.
    tables.onActionCreated = (): void => {
      tables.update("CloudResource", resourceId, {
        cloudTags: { Schedule: "office-hours" },
        labelIds: [seedLabel(world, "dev")],
      });
    };

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

    expect(fake.calls).toEqual([]);
    expect(actionsOf(world)[0]).toMatchObject({
      status: CloudSavingsActionStatus.Expired,
      environment: CloudResourceEnvironment.Unknown,
      summary:
        CLOUD_OFF_HOURS_STOP_HELD_SUMMARIES[
          CloudSavingsAiReason.OnlyLabelsSayNonProduction
        ],
    });
    expect(lastRun(scheduleId)).toMatchObject({
      stopped: 0,
      skippedNotKnown: 1,
    });
  });

  test("what a schedule stopped is started in the morning whatever its labels say by then: a start is never held", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      tags: { Schedule: "office-hours", environment: "dev" },
    });
    seedSchedule(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: DEV_INSTANCE }]);

    await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));
    tables.update("CloudResource", resourceId, {
      labelIds: [seedLabel(world, "Production")],
    });
    await CloudOffHoursScheduler.runAll(runner(fake, TUESDAY_MORNING));

    expect(fake.writes()).toEqual(["ec2:StopInstances", "ec2:StartInstances"]);
    expect(actionsOf(world)[0]?.["status"]).toBe(
      CloudSavingsActionStatus.Ended,
    );
  });
});

describe("changes a person approves still read labels, as before", () => {
  function seedLabelOnlyDev(world: World): {
    resourceId: string;
    savingId: ObjectID;
  } {
    const resourceId: string = seedInstance(world, {
      id: OTHER_INSTANCE,
      name: "orders-staging",
      labelIds: [seedLabel(world, "Staging")],
    });

    return {
      resourceId,
      savingId: seedIdleSaving(world, resourceId, OTHER_INSTANCE),
    };
  }

  test("Apply's dialog says the resource is non-production, from its labels", async () => {
    const world: World = seedWorld();
    const { savingId } = seedLabelOnlyDev(world);

    const offer: CloudSavingsOffer = await CloudSavingsActions.offer({
      props: world.owner.props,
      projectId: world.projectId,
      cloudCostRecommendationId: savingId,
    });

    expect(offer).toMatchObject({
      environment: CloudResourceEnvironment.NonProduction,
      environmentSource: CloudEnvironmentSource.Label,
      canApprove: true,
    });
  });

  test("an owner's Apply of a resource only its labels call non-production is made at once, as them", async () => {
    const world: World = seedWorld();
    const { savingId } = seedLabelOnlyDev(world);
    const fake: FakeAwsSavings = fakeEc2([{ id: OTHER_INSTANCE }]);

    const result: CloudSavingsActionResult = await CloudSavingsActions.apply({
      props: world.owner.props,
      projectId: world.projectId,
      cloudCostRecommendationId: savingId,
      runner: runner(fake, new Date()),
    });

    expect(result.status).toBe(CloudSavingsActionStatus.Applied);
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
    expect(actionOn(world, OTHER_INSTANCE)).toMatchObject({
      origin: CloudSavingsActionOrigin.Person,
      environment: CloudResourceEnvironment.NonProduction,
      approvedByUserId: world.owner.userId.toString(),
    });
  });

  test("a rule's proposal of it, approved by its owner, is made: a person approved it", async () => {
    const world: World = seedWorld();
    seedLabelOnlyDev(world);
    seedRule(world, { name: "Stop idle non-production" });
    const fake: FakeAwsSavings = fakeEc2([{ id: OTHER_INSTANCE }]);
    const now: Date = new Date();

    expect((await evaluate(world, now)).proposed).toBe(1);

    const proposal: Row = actionOn(world, OTHER_INSTANCE)!;
    const result: CloudSavingsActionResult = await CloudSavingsActions.approve({
      props: world.owner.props,
      projectId: world.projectId,
      actionId: new ObjectID(textOf(proposal["_id"])),
      runner: runner(fake, now),
    });

    expect(result.status).toBe(CloudSavingsActionStatus.Applied);
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
  });

  test("a change a person approved is not read again when it is made: an owner's approval of production stands", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: PROD_INSTANCE,
      name: "orders-prod",
      tags: { environment: "production" },
    });
    const savingId: ObjectID = seedIdleSaving(world, resourceId, PROD_INSTANCE);
    const fake: FakeAwsSavings = fakeEc2([{ id: PROD_INSTANCE }]);

    const result: CloudSavingsActionResult = await CloudSavingsActions.apply({
      props: world.owner.props,
      projectId: world.projectId,
      cloudCostRecommendationId: savingId,
      runner: runner(fake, new Date()),
    });

    expect(result.status).toBe(CloudSavingsActionStatus.Applied);
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
  });
});

describe("the one reading of a resource, read as each change reads it", () => {
  test("a saving's context carries both readings: what a person sees, and what a change nobody approves acts on", async () => {
    const world: World = seedWorld();
    const resourceId: string = seedInstance(world, {
      id: OTHER_INSTANCE,
      name: "orders-staging",
      labelIds: [seedLabel(world, "Staging")],
    });
    const savingId: ObjectID = seedIdleSaving(
      world,
      resourceId,
      OTHER_INSTANCE,
    );

    const saving: JSONObject = (await CloudSavingsActions.readSaving({
      projectId: world.projectId,
      cloudCostRecommendationId: savingId,
    })) as unknown as JSONObject;

    expect(saving["environment"]).toEqual({
      environment: CloudResourceEnvironment.NonProduction,
      source: CloudEnvironmentSource.Label,
    });
    expect(saving["unattendedEnvironment"]).toEqual({
      environment: CloudResourceEnvironment.Unknown,
      source: CloudEnvironmentSource.None,
    });
  });

  test("the runner reads a change's resource as it is now, from its own row and its account's", async () => {
    const world: World = seedWorld({
      accountEnvironment: CloudResourceEnvironment.NonProduction,
    });
    const resourceId: string = seedInstance(world, {
      id: DEV_INSTANCE,
      name: "orders-dev",
      labelIds: [seedLabel(world, "dev")],
    });
    const action: CloudSavingsAction = modelOf(CloudSavingsAction, {
      projectId: world.projectId,
      cloudAccountId: new ObjectID(world.accountId),
      cloudResourceId: new ObjectID(resourceId),
    });

    expect(await CloudSavingsActionRunner.readEnvironmentNow(action)).toEqual({
      reading: {
        environment: CloudResourceEnvironment.NonProduction,
        source: CloudEnvironmentSource.Account,
      },
      unattended: {
        environment: CloudResourceEnvironment.NonProduction,
        source: CloudEnvironmentSource.Account,
      },
    });

    // A change that names no project reads nothing: not known.
    expect(
      await CloudSavingsActionRunner.readEnvironmentNow(
        modelOf(CloudSavingsAction, {
          cloudAccountId: new ObjectID(world.accountId),
          cloudResourceId: new ObjectID(resourceId),
        }),
      ),
    ).toEqual({
      reading: {
        environment: CloudResourceEnvironment.Unknown,
        source: CloudEnvironmentSource.None,
      },
      unattended: {
        environment: CloudResourceEnvironment.Unknown,
        source: CloudEnvironmentSource.None,
      },
    });
  });
});
