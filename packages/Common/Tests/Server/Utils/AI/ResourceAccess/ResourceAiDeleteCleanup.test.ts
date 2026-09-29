import ResourceAiDeleteCleanup, {
  ResourceAiDeleteCarryForward,
  getResourceAiDeleteCarryForward,
} from "../../../../../Server/Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ResourceAiAgentService from "../../../../../Server/Services/ResourceAiAgentService";
import DeleteBy from "../../../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../../../Server/Types/Database/Hooks";
import logger from "../../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../../Types/ResourceAiAgent/AiResourceType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What deleting an infrastructure resource a resource AI agent serves does
 * to its OneUptime AI state (ResourceAiDeleteCleanup), through a stand-in
 * service — the resource-level twin of
 * KubernetesClusterServiceDeleteSettlesRemediation.test.ts:
 *
 * - the resource's in-flight rounds (Planning, or waiting in Suggested) are
 *   read BEFORE the delete, scoped to the resources the delete matches in
 *   the caller's project;
 * - they are settled only for the resources that were actually deleted,
 *   through the same conditional status transition a human dismissal uses,
 *   with a note naming the resource — and, for a round that already ran
 *   commands, that those ran and nothing was rolled back;
 * - the deleted resources' AI agents are deleted, whatever happened to
 *   the rounds;
 * - nothing here ever fails the delete.
 *
 * The eight services' wiring is pinned in
 * Tests/Server/Services/ResourceServiceDeleteCleansUpAi.test.ts.
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
const PLANNING_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SUGGESTED_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

// A stand-in for a resource's DatabaseService: the read is all it is asked.
interface FakeService {
  findBy: jest.Mock;
}

function fakeService(
  rows: Array<Record<string, unknown>> = [
    { id: RESOURCE_ID, _id: RESOURCE_ID.toString(), name: "web-1" },
  ],
): FakeService {
  return { findBy: jest.fn().mockResolvedValue(rows) };
}

function asService(service: FakeService): DatabaseService<BaseModel> {
  return service as unknown as DatabaseService<BaseModel>;
}

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function deleteBy(
  props: DatabaseCommonInteractionProps = userProps(),
): DeleteBy<BaseModel> {
  return {
    query: { _id: RESOURCE_ID.toString() },
    limit: 1,
    skip: 0,
    props,
  } as unknown as DeleteBy<BaseModel>;
}

function commandPlan(executedCommands: number): JSONObject {
  const commands: Array<JSONObject> = [];

  for (let i: number = 0; i < 3; i++) {
    commands.push({
      sequence: i + 1,
      stepType: "ResourceCommand",
      command: `docker restart web-${i}`,
      runnerId: ObjectID.generate().toString(),
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID.toString(),
      resourceNameSnapshot: "web-1",
      resourceCommandTier: "SafeWrite",
      policyVerdict: "AutoApproved",
      rationale: "restart",
      ...(i < executedCommands
        ? {
            execution: {
              status: "Succeeded",
              runnerJobId: ObjectID.generate().toString(),
            },
          }
        : i === 2
          ? // A command skipped after an earlier one failed never ran.
            { execution: { status: "Skipped" } }
          : {}),
    });
  }

  return { commands, summary: "restart web" } as JSONObject;
}

function round(data: {
  id: ObjectID;
  status: AutoRemediationSuggestionStatus;
  resourceId?: ObjectID | undefined;
  rationaleMarkdown?: string | undefined;
  commandPlan?: JSONObject | undefined;
}): AutoRemediationSuggestion {
  return {
    id: data.id,
    _id: data.id.toString(),
    status: data.status,
    resourceType: AiResourceType.DockerHost,
    resourceId: data.resourceId || RESOURCE_ID,
    rationaleMarkdown: data.rationaleMarkdown,
    commandPlan: data.commandPlan,
  } as unknown as AutoRemediationSuggestion;
}

interface Transition {
  suggestionId: ObjectID;
  fromStatus: AutoRemediationSuggestionStatus;
  set: Record<string, unknown>;
}

describe("ResourceAiDeleteCleanup", () => {
  let service: FakeService;
  let suggestionFind: jest.SpyInstance;
  let transition: jest.SpyInstance;
  let deleteAgents: jest.SpyInstance;
  let loggedError: jest.SpyInstance;

  beforeEach(() => {
    loggedError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    service = fakeService();
    suggestionFind = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([
        round({
          id: PLANNING_ID,
          status: AutoRemediationSuggestionStatus.Planning,
        }),
        round({
          id: SUGGESTED_ID,
          status: AutoRemediationSuggestionStatus.Suggested,
          rationaleMarkdown: "The web container leaks memory; restart it.",
          commandPlan: commandPlan(0),
        }),
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
    deletedItemIds: Array<ObjectID> = [RESOURCE_ID],
    props: DatabaseCommonInteractionProps = userProps(),
    resourceType: AiResourceType = AiResourceType.DockerHost,
  ): Promise<void> {
    const request: DeleteBy<BaseModel> = deleteBy(props);
    const carryForward: ResourceAiDeleteCarryForward =
      await ResourceAiDeleteCleanup.beforeDelete({
        resourceType,
        service: asService(service),
        deleteBy: request,
      });

    await ResourceAiDeleteCleanup.afterDelete({
      resourceType,
      onDelete: { deleteBy: request, carryForward } as OnDelete<BaseModel>,
      deletedItemIds,
    });
  }

  function transitions(): Array<Transition> {
    return transition.mock.calls.map((call: Array<unknown>): Transition => {
      return call[0] as Transition;
    });
  }

  describe("beforeDelete", () => {
    it("reads the matched resources in the caller's project, then their in-flight rounds of that type", async () => {
      const carryForward: ResourceAiDeleteCarryForward =
        await ResourceAiDeleteCleanup.beforeDelete({
          resourceType: AiResourceType.DockerHost,
          service: asService(service),
          deleteBy: deleteBy(),
        });

      const resourceRead: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = service.findBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      };
      expect(resourceRead.query["_id"]).toBe(RESOURCE_ID.toString());
      expect(resourceRead.query["projectId"]).toBe(PROJECT_ID);
      expect(resourceRead.select["name"]).toBe(true);
      expect(resourceRead.props["isRoot"]).toBe(true);

      const suggestionQuery: Record<string, unknown> = (
        suggestionFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(suggestionQuery["resourceType"]).toBe(AiResourceType.DockerHost);
      expect(JSON.stringify(suggestionQuery["resourceId"])).toContain(
        RESOURCE_ID.toString(),
      );
      expect(JSON.stringify(suggestionQuery["status"])).toContain("Planning");
      expect(JSON.stringify(suggestionQuery["status"])).toContain("Suggested");

      expect(carryForward.resourceType).toBe(AiResourceType.DockerHost);
      expect(carryForward.inFlightRounds).toHaveLength(2);
      expect(carryForward.resourceNames).toEqual({
        [RESOURCE_ID.toString()]: "web-1",
      });

      // Nothing is settled or deleted before the delete has happened.
      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).not.toHaveBeenCalled();
    });

    it("a root delete (no project) reads by the delete's own query", async () => {
      await ResourceAiDeleteCleanup.beforeDelete({
        resourceType: AiResourceType.DockerHost,
        service: asService(service),
        deleteBy: deleteBy({ isRoot: true } as DatabaseCommonInteractionProps),
      });

      const query: Record<string, unknown> = (
        service.findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query).toEqual({ _id: RESOURCE_ID.toString() });
    });

    it("negative control: a delete that matches no resource reads no round", async () => {
      service.findBy.mockResolvedValue([]);

      const carryForward: ResourceAiDeleteCarryForward =
        await ResourceAiDeleteCleanup.beforeDelete({
          resourceType: AiResourceType.DockerHost,
          service: asService(service),
          deleteBy: deleteBy(),
        });

      expect(suggestionFind).not.toHaveBeenCalled();
      expect(carryForward.inFlightRounds).toEqual([]);
    });

    it("never blocks the delete: a failed read is logged and hands over nothing", async () => {
      service.findBy.mockRejectedValue(new Error("db down"));

      const carryForward: ResourceAiDeleteCarryForward =
        await ResourceAiDeleteCleanup.beforeDelete({
          resourceType: AiResourceType.CephCluster,
          service: asService(service),
          deleteBy: deleteBy(),
        });

      expect(carryForward).toEqual({
        resourceType: AiResourceType.CephCluster,
        inFlightRounds: [],
        resourceNames: {},
      });
      expect(String(loggedError.mock.calls[0]![0])).toContain(
        "could not read the in-flight AI remediation rounds of the Ceph cluster(s) being deleted",
      );
    });
  });

  describe("afterDelete", () => {
    it("dismisses Planning and Suggested rounds with a note naming the deleted resource", async () => {
      await deleteResource();

      expect(transitions()).toHaveLength(2);

      const [planning, suggested] = transitions();

      expect(planning!.suggestionId).toBe(PLANNING_ID);
      expect(planning!.fromStatus).toBe(
        AutoRemediationSuggestionStatus.Planning,
      );
      expect(planning!.set["status"]).toBe(
        AutoRemediationSuggestionStatus.Dismissed,
      );
      expect(planning!.set["dismissedByUserId"]).toBe(USER_ID.toString());
      expect(planning!.set["dismissedAt"]).toBeInstanceOf(Date);
      expect(planning!.set["rationaleMarkdown"]).toBe(
        '**Dismissed: the Docker host "web-1" this remediation was for was deleted.** None of its commands ran, and none will.',
      );

      expect(suggested!.suggestionId).toBe(SUGGESTED_ID);
      expect(suggested!.fromStatus).toBe(
        AutoRemediationSuggestionStatus.Suggested,
      );
      // The AI's own reasoning is kept, after the note.
      expect(String(suggested!.set["rationaleMarkdown"])).toMatch(
        /was deleted\.\*\* None of its commands ran, and none will\.\n\nThe web container leaks memory; restart it\.$/,
      );
    });

    it("says so when the round had already run commands, and that nothing was rolled back", async () => {
      suggestionFind.mockResolvedValue([
        round({
          id: PLANNING_ID,
          status: AutoRemediationSuggestionStatus.Planning,
          commandPlan: commandPlan(2),
        }),
      ]);

      await deleteResource();

      const note: string = String(transitions()[0]!.set["rationaleMarkdown"]);
      // Two ran; the Skipped third one never did.
      expect(note).toContain("2 command(s) had already run on it before");
      expect(note).toContain("nothing was rolled back");
      expect(note).not.toContain("None of its commands ran");
    });

    it("settles only the rounds of resources that were actually deleted, and deletes only their agents", async () => {
      service.findBy.mockResolvedValue([
        { id: RESOURCE_ID, name: "web-1" },
        { id: OTHER_RESOURCE_ID, name: "web-2" },
      ]);
      suggestionFind.mockResolvedValue([
        round({
          id: PLANNING_ID,
          status: AutoRemediationSuggestionStatus.Planning,
          resourceId: OTHER_RESOURCE_ID,
        }),
        round({
          id: SUGGESTED_ID,
          status: AutoRemediationSuggestionStatus.Suggested,
        }),
      ]);

      // Only RESOURCE_ID was deleted (the other was refused by permissions).
      await deleteResource([RESOURCE_ID]);

      expect(
        transitions().map((call: Transition): string => {
          return call.suggestionId.toString();
        }),
      ).toEqual([SUGGESTED_ID.toString()]);
      expect(deleteAgents).toHaveBeenCalledTimes(1);
      expect(deleteAgents).toHaveBeenCalledWith({
        resourceType: AiResourceType.DockerHost,
        resourceIds: [RESOURCE_ID],
      });
    });

    it("deletes the agents after settling the rounds", async () => {
      const order: Array<string> = [];
      transition.mockImplementation(async (): Promise<number> => {
        order.push("settle");
        return 1;
      });
      deleteAgents.mockImplementation(async (): Promise<number> => {
        order.push("agents");
        return 1;
      });

      await deleteResource();

      expect(order).toEqual(["settle", "settle", "agents"]);
    });

    it("negative control: a delete that removed nothing settles and deletes nothing", async () => {
      await deleteResource([]);

      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).not.toHaveBeenCalled();
    });

    it("negative control: a resource with no in-flight round still loses its agents", async () => {
      suggestionFind.mockResolvedValue([]);

      await deleteResource();

      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).toHaveBeenCalledWith({
        resourceType: AiResourceType.DockerHost,
        resourceIds: [RESOURCE_ID],
      });
    });

    it("still deletes the agents when the rounds could not be read before the delete", async () => {
      suggestionFind.mockRejectedValue(new Error("db down"));

      await expect(deleteResource()).resolves.toBeUndefined();

      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).toHaveBeenCalledTimes(1);
    });

    it("still deletes the agents when no carry-forward was handed over", async () => {
      await ResourceAiDeleteCleanup.afterDelete({
        resourceType: AiResourceType.Host,
        onDelete: {
          deleteBy: deleteBy(),
          carryForward: null,
        } as OnDelete<BaseModel>,
        deletedItemIds: [RESOURCE_ID],
      });

      expect(transition).not.toHaveBeenCalled();
      expect(deleteAgents).toHaveBeenCalledWith({
        resourceType: AiResourceType.Host,
        resourceIds: [RESOURCE_ID],
      });
    });

    it("never fails the delete: a failed settle is logged, the next round and the agents still go", async () => {
      transition
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce(1);

      await expect(deleteResource()).resolves.toBeUndefined();

      expect(transition).toHaveBeenCalledTimes(2);
      expect(deleteAgents).toHaveBeenCalledTimes(1);
      expect(String(loggedError.mock.calls[0]![0])).toContain(
        `could not settle AI remediation suggestion ${PLANNING_ID.toString()} of a deleted Docker host`,
      );
    });

    it("never fails the delete: a failed agent delete is only logged", async () => {
      deleteAgents.mockRejectedValue(new Error("db down"));

      await expect(deleteResource()).resolves.toBeUndefined();

      expect(String(loggedError.mock.calls[0]![0])).toContain(
        "could not delete the AI agent(s) of the deleted Docker host(s)",
      );
    });

    it("a root delete (no user) settles without naming anyone", async () => {
      await deleteResource([RESOURCE_ID], {
        isRoot: true,
      } as DatabaseCommonInteractionProps);

      expect(transitions()[0]!.set).not.toHaveProperty("dismissedByUserId");
      expect(transitions()[0]!.set["status"]).toBe(
        AutoRemediationSuggestionStatus.Dismissed,
      );
    });

    it("a resource without a name is still named by its type", async () => {
      service.findBy.mockResolvedValue([{ id: RESOURCE_ID, name: "  " }]);

      await deleteResource();

      expect(String(transitions()[0]!.set["rationaleMarkdown"])).toMatch(
        /^\*\*Dismissed: the Docker host this remediation was for was deleted\.\*\*/,
      );
    });
  });

  describe("getResourceAiDeleteCarryForward", () => {
    it("reads back only a resource delete carry-forward of the same type", () => {
      const carryForward: ResourceAiDeleteCarryForward = {
        resourceType: AiResourceType.PodmanHost,
        inFlightRounds: [],
        resourceNames: {},
      };

      expect(
        getResourceAiDeleteCarryForward(
          carryForward,
          AiResourceType.PodmanHost,
        ),
      ).toBe(carryForward);
      expect(
        getResourceAiDeleteCarryForward(
          carryForward,
          AiResourceType.DockerHost,
        ),
      ).toBeNull();
      expect(
        getResourceAiDeleteCarryForward(null, AiResourceType.PodmanHost),
      ).toBeNull();
      expect(
        getResourceAiDeleteCarryForward([], AiResourceType.PodmanHost),
      ).toBeNull();
      // A Kubernetes cluster's carry-forward is not one.
      expect(
        getResourceAiDeleteCarryForward(
          { inFlightRounds: [], clusterNames: {} },
          AiResourceType.PodmanHost,
        ),
      ).toBeNull();
    });
  });

  describe("getDeletedResourceNote", () => {
    it("names every resource type in a sentence", () => {
      const expected: Record<AiResourceType, string> = {
        [AiResourceType.DockerHost]: 'the Docker host "x"',
        [AiResourceType.PodmanHost]: 'the Podman host "x"',
        [AiResourceType.DockerSwarmCluster]: 'the Docker Swarm cluster "x"',
        [AiResourceType.ProxmoxCluster]: 'the Proxmox cluster "x"',
        [AiResourceType.VMwareVCenter]: 'the VMware vCenter "x"',
        [AiResourceType.CephCluster]: 'the Ceph cluster "x"',
        [AiResourceType.DatabaseServer]: 'the database server "x"',
        [AiResourceType.Host]: 'the host "x"',
      };

      for (const resourceType of ALL_AI_RESOURCE_TYPES) {
        expect(
          ResourceAiDeleteCleanup.getDeletedResourceNote({
            resourceType,
            resourceName: "x",
            executedCount: 0,
          }),
        ).toBe(
          `**Dismissed: ${expected[resourceType]} this remediation was for was deleted.** None of its commands ran, and none will.`,
        );
      }
    });

    it("says how many commands had run", () => {
      expect(
        ResourceAiDeleteCleanup.getDeletedResourceNote({
          resourceType: AiResourceType.Host,
          resourceName: "web-2",
          executedCount: 3,
        }),
      ).toBe(
        '**Dismissed: the host "web-2" this remediation was for was deleted.** 3 command(s) had already run on it before; nothing was rolled back and no further command will run.',
      );
    });
  });
});
