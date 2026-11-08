import AuditLogService from "../../../../../Server/Services/AuditLogService";
import DockerHostService from "../../../../../Server/Services/DockerHostService";
import KubernetesClusterService from "../../../../../Server/Services/KubernetesClusterService";
import { getResourceAiAgentResourceBinding } from "../../../../../Server/Services/ResourceAiAgentService";
import AiAgentResetAuditLog, {
  AI_AGENT_RESET_AUDIT_COLUMNS,
} from "../../../../../Server/Utils/AI/ResourceAccess/AiAgentResetAuditLog";
import logger from "../../../../../Server/Utils/Logger";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../../../Models/DatabaseModels/DockerHost";
import KubernetesCluster from "../../../../../Models/DatabaseModels/KubernetesCluster";
import {
  AUDIT_LOG_ROOT_RESOURCE_TABLES,
  looksLikeSecretColumn,
} from "../../../../../Types/AuditLog/AuditLogCoverage";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getColumnAccessControlForAllColumns } from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../../Types/ObjectID";
import { ALL_AI_RESOURCE_TYPES } from "../../../../../Types/ResourceAiAgent/AiResourceType";
import UserType from "../../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RESOURCE'S AI AGENT RESET, ON THE RESOURCE'S AUDIT LOGS (issue #6302).
 *
 * The agent's own row is what the agent reports, and the audit log leaves
 * it out, so a reset recorded nothing. It is now stamped on the resource
 * the agent works for, whose Audit Logs page lists it, by whoever reset it,
 * naming when - never a key.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RESET_AT: Date = new Date("2026-11-08T10:00:00.000Z");

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
};

// Every model whose AI agent can be reset: the resources' and the clusters'.
const RESET_MODELS: Array<BaseModel> = [
  ...Array.from(
    new Set(
      ALL_AI_RESOURCE_TYPES.map((resourceType: string) => {
        return getResourceAiAgentResourceBinding(resourceType as never)
          .getService()
          .getModel().constructor as { new (): BaseModel };
      }),
    ),
  ).map((modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  }),
  new KubernetesCluster(),
];

let read: jest.SpyInstance;
let stamp: jest.SpyInstance;
let recordUpdate: jest.SpyInstance;

function host(lastResetAt?: Date): DockerHost {
  const row: DockerHost = new DockerHost(RESOURCE_ID);
  row.projectId = PROJECT_ID;
  row.name = "prod-docker-1";

  if (lastResetAt) {
    row.aiAgentResetAt = lastResetAt;
  }

  return row;
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  read = jest
    .spyOn(DockerHostService, "findOneById")
    .mockResolvedValue(host() as never);
  stamp = jest
    .spyOn(DockerHostService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
  recordUpdate = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function record(
  props?: DatabaseCommonInteractionProps | undefined,
): Promise<void> {
  await AiAgentResetAuditLog.record({
    service: DockerHostService,
    resourceId: RESOURCE_ID,
    resetAt: RESET_AT,
    props: props,
  });
}

describe("recording a reset on the resource", () => {
  test("stamps when, and records an Update by whoever reset it, naming only that", async () => {
    await record(PERSON);

    expect(stamp).toHaveBeenCalledWith({
      id: RESOURCE_ID,
      data: { aiAgentResetAt: RESET_AT },
    });
    expect(recordUpdate).toHaveBeenCalledTimes(1);

    const entry: Record<string, unknown> = recordUpdate.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(entry["model"]).toBeInstanceOf(DockerHost);
    expect(String(entry["itemId"])).toBe(RESOURCE_ID.toString());
    expect(entry["updatedFields"]).toEqual({ aiAgentResetAt: RESET_AT });
    expect(entry["includeColumns"]).toEqual(["aiAgentResetAt"]);
    expect(entry["props"]).toBe(PERSON);
    // Named, and filed under its project, from the row as it was.
    expect((entry["before"] as DockerHost).name).toBe("prod-docker-1");
    expect(String((entry["before"] as DockerHost).projectId)).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("reads the resource for its name, project and last reset only - never a key", async () => {
    await record(PERSON);

    expect(read).toHaveBeenCalledWith({
      id: RESOURCE_ID,
      select: {
        _id: true,
        projectId: true,
        name: true,
        aiAgentResetAt: true,
      },
      props: { isRoot: true },
    });
  });

  test("the entry says when the agent was last reset before", async () => {
    const before: Date = new Date("2026-10-01T09:00:00.000Z");
    read.mockResolvedValue(host(before) as never);

    await record(PERSON);

    const entry: Record<string, unknown> = recordUpdate.mock
      .calls[0]![0] as Record<string, unknown>;

    expect((entry["before"] as DockerHost).aiAgentResetAt).toEqual(before);
  });

  test("with nobody named, it is OneUptime's own: a system event", async () => {
    await record(undefined);

    expect(
      (recordUpdate.mock.calls[0]![0] as Record<string, unknown>)["props"],
    ).toEqual({ isRoot: true });
  });

  test("a resource that is gone gets nothing written and nothing recorded", async () => {
    read.mockResolvedValue(null as never);

    await record(PERSON);

    expect(stamp).not.toHaveBeenCalled();
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("a stamp that fails records no entry, and never fails the reset", async () => {
    stamp.mockRejectedValue(new Error("connection reset"));

    await expect(record(PERSON)).resolves.toBeUndefined();

    expect(recordUpdate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a read that fails never fails the reset either", async () => {
    read.mockRejectedValue(new Error("connection reset"));

    await expect(record(PERSON)).resolves.toBeUndefined();

    expect(stamp).not.toHaveBeenCalled();
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("a Kubernetes cluster's reset goes through the cluster's own service", async () => {
    const cluster: KubernetesCluster = new KubernetesCluster(RESOURCE_ID);
    cluster.projectId = PROJECT_ID;
    cluster.name = "prod-eks";
    jest
      .spyOn(KubernetesClusterService, "findOneById")
      .mockResolvedValue(cluster);
    const clusterStamp: jest.SpyInstance = jest
      .spyOn(KubernetesClusterService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await AiAgentResetAuditLog.record({
      service: KubernetesClusterService,
      resourceId: RESOURCE_ID,
      resetAt: RESET_AT,
      props: PERSON,
    });

    expect(clusterStamp).toHaveBeenCalledTimes(1);
    expect(
      (recordUpdate.mock.calls[0]![0] as Record<string, unknown>)["model"],
    ).toBeInstanceOf(KubernetesCluster);
  });
});

/*
 * The column a reset names, on every resource whose AI agent can be reset:
 * there, readable by whoever reads the resource, written by OneUptime alone
 * - so nothing but a reset puts it in an entry - and no secret.
 */
describe("the column every resource with an AI agent records a reset in", () => {
  test("covers every resource type with an AI agent, and the Kubernetes cluster", () => {
    expect(
      RESET_MODELS.map((model: BaseModel): string => {
        return model.tableName!;
      }).sort(),
    ).toEqual(
      [
        "CephCluster",
        "CloudAccount",
        "DatabaseServer",
        "DockerHost",
        "DockerSwarmCluster",
        "Host",
        "KubernetesCluster",
        "OpenStackCloud",
        "PodmanHost",
        "ProxmoxCluster",
        "VMwareVCenter",
      ].sort(),
    );
    expect(AI_AGENT_RESET_AUDIT_COLUMNS).toEqual(["aiAgentResetAt"]);
  });

  test.each(
    RESET_MODELS.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName!, model];
    }),
  )(
    "%s has it: a date its readers read, only OneUptime writes, and a reset's entry shows",
    (_tableName: string, model: BaseModel) => {
      for (const column of AI_AGENT_RESET_AUDIT_COLUMNS) {
        expect(model.isTableColumn(column)).toBe(true);
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.Date,
        );
        expect(
          looksLikeSecretColumn(
            column,
            model.getTableColumnMetadata(column).type,
          ),
        ).toBe(false);

        const access: {
          create?: Array<unknown>;
          read?: Array<unknown>;
          update?: Array<unknown>;
        } =
          (
            getColumnAccessControlForAllColumns(model) as Record<
              string,
              {
                create?: Array<unknown>;
                read?: Array<unknown>;
                update?: Array<unknown>;
              }
            >
          )[column] || {};
        const nameAccess: { read?: Array<unknown> } =
          (
            getColumnAccessControlForAllColumns(model) as Record<
              string,
              { read?: Array<unknown> }
            >
          )["aiAccessConfiguredAt"] || {};

        expect(access.create).toEqual([]);
        expect(access.update).toEqual([]);
        // Whoever reads the resource's AI access reads when its agent was reset.
        expect(access.read).toEqual(nameAccess.read);
        expect((access.read || []).length).toBeGreaterThan(0);

        // Recorded with its value: when, never "[REDACTED]".
        expect(model.enableAuditLogOn?.redactColumns || []).not.toContain(
          column,
        );
      }

      // Its entries are on its own Audit Logs page.
      expect(AUDIT_LOG_ROOT_RESOURCE_TABLES.has(model.tableName!)).toBe(true);
      expect(model.enableAuditLogOn?.update).toBe(true);
    },
  );
});
