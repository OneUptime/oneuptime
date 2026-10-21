import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { getJestSpyOn } from "../../Spy";
import { meetsCondition } from "../TestingUtils/QueryConditions";
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayDeleteLikeFindBy,
} from "../TestingUtils/RowsCallerMayWrite";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Deleting any of the eight infrastructure resources a resource AI agent
 * serves cleans up its OneUptime AI state, through each service's own
 * delete hooks (the shared ResourceAiDeleteCleanup; its rules are pinned in
 * Tests/Server/Utils/AI/ResourceAccess/ResourceAiDeleteCleanup.test.ts):
 *
 * - onBeforeDelete reads the resource's in-flight rounds of ITS type,
 *   scoped to the resources the delete matches in the caller's project;
 * - onDeleteSuccess settles them only for the resources actually deleted,
 *   with a note naming the resource, then deletes those resources' AI
 *   agents;
 * - a failed read, settle or agent delete is logged and never fails the
 *   delete.
 *
 * A table over all eight services proves each one is wired, with its own
 * resource type.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ROUND_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const OTHER_ROUND_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

type Hooks = {
  onBeforeDelete: (
    deleteBy: DeleteBy<BaseModel>,
  ) => Promise<OnDelete<BaseModel>>;
  onDeleteSuccess: (
    onDelete: OnDelete<BaseModel>,
    deletedItemIds: Array<ObjectID>,
  ) => Promise<OnDelete<BaseModel>>;
};

interface ServiceWiring {
  resourceType: AiResourceType;
  service: DatabaseService<BaseModel>;
  // How the note names the resource.
  resourceInNote: string;
}

function asService(service: unknown): DatabaseService<BaseModel> {
  return service as DatabaseService<BaseModel>;
}

const WIRING: Array<ServiceWiring> = [
  {
    resourceType: AiResourceType.DockerHost,
    service: asService(DockerHostService),
    resourceInNote: 'the Docker host "web-1"',
  },
  {
    resourceType: AiResourceType.PodmanHost,
    service: asService(PodmanHostService),
    resourceInNote: 'the Podman host "web-1"',
  },
  {
    resourceType: AiResourceType.DockerSwarmCluster,
    service: asService(DockerSwarmClusterService),
    resourceInNote: 'the Docker Swarm cluster "web-1"',
  },
  {
    resourceType: AiResourceType.ProxmoxCluster,
    service: asService(ProxmoxClusterService),
    resourceInNote: 'the Proxmox cluster "web-1"',
  },
  {
    resourceType: AiResourceType.VMwareVCenter,
    service: asService(VMwareVCenterService),
    resourceInNote: 'the VMware vCenter "web-1"',
  },
  {
    resourceType: AiResourceType.CephCluster,
    service: asService(CephClusterService),
    resourceInNote: 'the Ceph cluster "web-1"',
  },
  {
    resourceType: AiResourceType.DatabaseServer,
    service: asService(DatabaseServerService),
    resourceInNote: 'the database server "web-1"',
  },
  {
    resourceType: AiResourceType.Host,
    service: asService(HostService),
    resourceInNote: 'the host "web-1"',
  },
];

function hooksOf(service: DatabaseService<BaseModel>): Hooks {
  return service as unknown as Hooks;
}

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function deleteBy(): DeleteBy<BaseModel> {
  return {
    query: { _id: RESOURCE_ID.toString() },
    limit: 1,
    skip: 0,
    props: userProps(),
  } as unknown as DeleteBy<BaseModel>;
}

function round(
  id: ObjectID,
  resourceType: AiResourceType,
  resourceId: ObjectID,
): AutoRemediationSuggestion {
  return {
    id,
    _id: id.toString(),
    status: AutoRemediationSuggestionStatus.Planning,
    resourceType,
    resourceId,
  } as unknown as AutoRemediationSuggestion;
}

interface Transition {
  suggestionId: ObjectID;
  fromStatus: AutoRemediationSuggestionStatus;
  set: Record<string, unknown>;
}

describe("resource services' delete hooks clean up OneUptime AI state", () => {
  it("covers every resource type exactly once", () => {
    expect(
      WIRING.map((wiring: ServiceWiring): AiResourceType => {
        return wiring.resourceType;
      }).sort(),
    ).toEqual([...ALL_AI_RESOURCE_TYPES].sort());
  });

  describe.each(WIRING)("$resourceType", (wiring: ServiceWiring) => {
    let resourceFind: jest.SpyInstance;
    let suggestionFind: jest.SpyInstance;
    let transition: jest.SpyInstance;
    let deleteAgents: jest.SpyInstance;
    let loggedError: jest.SpyInstance;

    beforeEach(() => {
      loggedError = jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      // The resources as the database answers a read: by the ids it names.
      const resources: Array<Record<string, unknown>> = [
        { id: RESOURCE_ID, _id: RESOURCE_ID.toString(), name: "web-1" },
        {
          id: OTHER_RESOURCE_ID,
          _id: OTHER_RESOURCE_ID.toString(),
          name: "web-2",
        },
      ];
      resourceFind = getJestSpyOn(wiring.service, "findBy").mockImplementation(
        (async (read: {
          query: Record<string, unknown>;
        }): Promise<Array<unknown>> => {
          const named: unknown = read.query["_id"];

          return resources.filter((resource: Record<string, unknown>) => {
            return (
              named === undefined || meetsCondition(named, resource["_id"])
            );
          });
        }) as never,
      );
      // The teammate may delete the resources their read reaches.
      stubRowsCallerMayDeleteLikeFindBy(wiring.service, resourceFind);
      suggestionFind = jest
        .spyOn(AutoRemediationSuggestionService, "findBy")
        .mockResolvedValue([
          round(ROUND_ID, wiring.resourceType, RESOURCE_ID),
          round(OTHER_ROUND_ID, wiring.resourceType, OTHER_RESOURCE_ID),
        ]);
      transition = jest
        .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
        .mockResolvedValue(1);
      deleteAgents = jest
        .spyOn(ResourceAiAgentService, "deleteAgentsForResources")
        .mockResolvedValue(1);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function deleteResource(
      deletedItemIds: Array<ObjectID>,
    ): Promise<OnDelete<BaseModel>> {
      const hooks: Hooks = hooksOf(wiring.service);
      const onDelete: OnDelete<BaseModel> =
        await hooks.onBeforeDelete(deleteBy());

      return await hooks.onDeleteSuccess(onDelete, deletedItemIds);
    }

    it("overrides both delete hooks on the service itself", () => {
      const prototype: Record<string, unknown> = Object.getPrototypeOf(
        wiring.service,
      ) as Record<string, unknown>;

      expect(
        Object.prototype.hasOwnProperty.call(prototype, "onBeforeDelete"),
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(prototype, "onDeleteSuccess"),
      ).toBe(true);
    });

    it("reads the in-flight rounds of its own type before the delete, for the resources the delete removes in the caller's project", async () => {
      const onDelete: OnDelete<BaseModel> = await hooksOf(
        wiring.service,
      ).onBeforeDelete(deleteBy());

      // The delete names the one resource read.
      expect(onDelete.deleteBy.query).toEqual({ _id: RESOURCE_ID.toString() });
      expect(onDelete.deleteBy.limit).toBe(1);

      // The resources the caller may delete, read in the caller's project.
      expect(
        readsOfRowsCallerMayWrite(wiring.service)[0]!.query["projectId"],
      ).toBe(PROJECT_ID);

      const resourceQuery: Record<string, unknown> = (
        resourceFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(resourceQuery["_id"]).toBe(RESOURCE_ID.toString());

      const suggestionQuery: Record<string, unknown> = (
        suggestionFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(suggestionQuery["resourceType"]).toBe(wiring.resourceType);

      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).not.toHaveBeenCalled();
    });

    it("settles only the deleted resource's rounds, naming it, then deletes its agents", async () => {
      const onDelete: OnDelete<BaseModel> = await deleteResource([RESOURCE_ID]);

      const settled: Array<Transition> = transition.mock.calls.map(
        (call: Array<unknown>): Transition => {
          return call[0] as Transition;
        },
      );
      expect(
        settled.map((call: Transition): string => {
          return call.suggestionId.toString();
        }),
      ).toEqual([ROUND_ID.toString()]);
      expect(settled[0]!.fromStatus).toBe(
        AutoRemediationSuggestionStatus.Planning,
      );
      expect(settled[0]!.set["status"]).toBe(
        AutoRemediationSuggestionStatus.Dismissed,
      );
      expect(settled[0]!.set["dismissedByUserId"]).toBe(USER_ID.toString());
      expect(settled[0]!.set["rationaleMarkdown"]).toBe(
        `**Dismissed: ${wiring.resourceInNote} this remediation was for was deleted.** None of its commands ran, and none will.`,
      );

      expect(deleteAgents).toHaveBeenCalledTimes(1);
      expect(deleteAgents).toHaveBeenCalledWith({
        resourceType: wiring.resourceType,
        resourceIds: [RESOURCE_ID],
      });

      // The hook hands the delete back held to the one resource it read.
      expect(onDelete.deleteBy.query).toEqual({ _id: RESOURCE_ID.toString() });
    });

    it("negative control: a delete that removed nothing settles and deletes nothing", async () => {
      await deleteResource([]);

      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).not.toHaveBeenCalled();
    });

    it("never fails the delete: failed reads, settles and agent deletes are only logged", async () => {
      suggestionFind.mockRejectedValue(new Error("db down"));
      deleteAgents.mockRejectedValue(new Error("db down"));

      await expect(deleteResource([RESOURCE_ID])).resolves.toBeDefined();
      expect(loggedError).toHaveBeenCalledTimes(2);

      loggedError.mockClear();
      suggestionFind.mockResolvedValue([
        round(ROUND_ID, wiring.resourceType, RESOURCE_ID),
      ]);
      transition.mockRejectedValue(new Error("db down"));
      deleteAgents.mockResolvedValue(1);

      await expect(deleteResource([RESOURCE_ID])).resolves.toBeDefined();
      expect(loggedError).toHaveBeenCalledTimes(1);
      // The agents still went.
      expect(deleteAgents).toHaveBeenLastCalledWith({
        resourceType: wiring.resourceType,
        resourceIds: [RESOURCE_ID],
      });
    });
  });
});
