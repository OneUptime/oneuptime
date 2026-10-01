import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import DatabaseService from "../../../Services/DatabaseService";
import DeleteBy from "../../../Types/Database/DeleteBy";
import { OnDelete } from "../../../Types/Database/Hooks";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getResourceSentenceName } from "../../../../Types/AI/ResourceAiAccessPermissions";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";

/*
 * What deleting an infrastructure resource a resource AI agent serves (a
 * Docker or Podman host, a Docker Swarm, Proxmox or Ceph cluster, a VMware
 * vCenter, a database server or a host) does to its OneUptime AI state —
 * shared by the eight resource services, whose delete hooks call it. The
 * resource-level twin of KubernetesClusterService's onBeforeDelete /
 * onDeleteSuccess / settleRoundOfDeletedCluster:
 *
 * - a resource round (a suggestion the resource's AI mode produced) still
 *   Planning or waiting in Suggested can never finish once its resource is
 *   gone: its commands name a resource that no longer exists, and
 *   resourceId has no foreign key to null, so nothing would ever say why it
 *   is stuck. Its rounds are read BEFORE the delete (beforeDelete) and
 *   settled AFTER it (afterDelete), only for the resources that were
 *   actually deleted — the delete may still be refused after the before-hook
 *   runs — through the same conditional status transition a human dismissal
 *   uses, with a note that says why;
 * - the resource's AI agent rows are deleted with it
 *   (ResourceAiAgentService.deleteAgentsForResources). Without this they
 *   would linger until their agent's next heartbeat noticed the resource
 *   was gone.
 *
 * Best effort throughout: nothing here ever fails, or blocks, the delete.
 */

// Handed from beforeDelete to afterDelete through the delete's carryForward.
export interface ResourceAiDeleteCarryForward {
  resourceType: AiResourceType;
  // Planning / Suggested rounds of the resources the delete matched.
  inFlightRounds: Array<AutoRemediationSuggestion>;
  // Each matched resource's name, by id — for the note on its rounds.
  resourceNames: Record<string, string>;
}

// The resource columns the note names a resource by.
const RESOURCE_SELECT: Record<string, true> = {
  _id: true,
  name: true,
};

/*
 * The carry-forward a resource delete hook handed over, or null when it is
 * not one (another hook's, or the before-hook never ran) or belongs to
 * another resource type.
 */
export function getResourceAiDeleteCarryForward(
  carryForward: unknown,
  resourceType: AiResourceType,
): ResourceAiDeleteCarryForward | null {
  if (
    carryForward &&
    typeof carryForward === "object" &&
    "inFlightRounds" in carryForward &&
    "resourceNames" in carryForward &&
    (carryForward as ResourceAiDeleteCarryForward).resourceType ===
      resourceType &&
    Array.isArray((carryForward as ResourceAiDeleteCarryForward).inFlightRounds)
  ) {
    return carryForward as ResourceAiDeleteCarryForward;
  }

  return null;
}

export default class ResourceAiDeleteCleanup {
  /*
   * For a resource service's onBeforeDelete: the in-flight rounds of every
   * resource the delete matches, and those resources' names. onBeforeDelete
   * runs before the framework scopes the query to the caller's project, so
   * scope it here. A failed read is only logged: the delete goes ahead and
   * its agents are still removed; the rounds then fail on their next
   * command, as the resource is gone.
   */
  @CaptureSpan()
  public static async beforeDelete<TBaseModel extends BaseModel>(data: {
    resourceType: AiResourceType;
    service: DatabaseService<TBaseModel>;
    deleteBy: DeleteBy<TBaseModel>;
  }): Promise<ResourceAiDeleteCarryForward> {
    let inFlightRounds: Array<AutoRemediationSuggestion> = [];
    const resourceNames: Record<string, string> = {};

    try {
      const resources: Array<TBaseModel> = await data.service.findBy({
        query: {
          ...data.deleteBy.query,
          ...(data.deleteBy.props.tenantId
            ? { projectId: data.deleteBy.props.tenantId }
            : {}),
        } as never,
        select: RESOURCE_SELECT as never,
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      const resourceIds: Array<ObjectID> = [];

      for (const resource of resources) {
        const resourceId: string | undefined =
          resource.id?.toString() || resource._id?.toString();

        if (!resourceId) {
          continue;
        }

        const name: unknown = (resource as unknown as Record<string, unknown>)[
          "name"
        ];

        resourceIds.push(new ObjectID(resourceId));
        resourceNames[resourceId] = typeof name === "string" ? name.trim() : "";
      }

      if (resourceIds.length > 0) {
        inFlightRounds = await AutoRemediationSuggestionService.findBy({
          query: {
            resourceType: data.resourceType,
            resourceId: QueryHelper.any(resourceIds),
            status: QueryHelper.any([
              AutoRemediationSuggestionStatus.Planning,
              AutoRemediationSuggestionStatus.Suggested,
            ]),
          },
          select: {
            _id: true,
            status: true,
            resourceType: true,
            resourceId: true,
            rationaleMarkdown: true,
            commandPlan: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
      }
    } catch (error) {
      logger.error(
        `ResourceAiDeleteCleanup: could not read the in-flight AI remediation rounds of the ${getResourceSentenceName(
          data.resourceType,
        )}(s) being deleted: ${error}`,
      );
    }

    return {
      resourceType: data.resourceType,
      inFlightRounds,
      resourceNames,
    };
  }

  /*
   * For a resource service's onDeleteSuccess, with the ids the delete
   * actually removed: settle the in-flight rounds of those resources, then
   * delete their AI agents. Never throws.
   */
  @CaptureSpan()
  public static async afterDelete<TBaseModel extends BaseModel>(data: {
    resourceType: AiResourceType;
    onDelete: OnDelete<TBaseModel>;
    deletedItemIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.deletedItemIds.length === 0) {
      return;
    }

    const deleted: Set<string> = new Set<string>(
      data.deletedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    const carryForward: ResourceAiDeleteCarryForward | null =
      getResourceAiDeleteCarryForward(
        data.onDelete.carryForward,
        data.resourceType,
      );

    for (const suggestion of carryForward?.inFlightRounds || []) {
      const resourceId: string = suggestion.resourceId?.toString() || "";

      if (!deleted.has(resourceId)) {
        continue;
      }

      await ResourceAiDeleteCleanup.settleRoundOfDeletedResource({
        suggestion,
        resourceType: data.resourceType,
        resourceName: carryForward?.resourceNames[resourceId] || "",
        deletedByUserId: data.onDelete.deleteBy.props.userId,
      });
    }

    await ResourceAiDeleteCleanup.deleteAgentsOfDeletedResources({
      resourceType: data.resourceType,
      resourceIds: data.deletedItemIds,
    });
  }

  /*
   * The note a round of a deleted resource is dismissed with — and, for a
   * round that had already run commands, that those changes were made and
   * nothing was rolled back.
   */
  public static getDeletedResourceNote(data: {
    resourceType: AiResourceType;
    resourceName: string;
    executedCount: number;
  }): string {
    const resource: string = `the ${getResourceSentenceName(data.resourceType)}${
      data.resourceName ? ` "${data.resourceName}"` : ""
    }`;
    const headline: string = `**Dismissed: ${resource} this remediation was for was deleted.**`;

    return data.executedCount > 0
      ? `${headline} ${data.executedCount} command(s) had already run on it before; nothing was rolled back and no further command will run.`
      : `${headline} None of its commands ran, and none will.`;
  }

  /*
   * Settle one in-flight round of a deleted resource the way a human
   * dismissal settles it (the conditional status transition, so a planner
   * finishing at the same moment loses cleanly and writes nothing), keeping
   * the AI's own reasoning after the note. Best effort: a settle that fails
   * must not fail the delete that already happened.
   */
  private static async settleRoundOfDeletedResource(data: {
    suggestion: AutoRemediationSuggestion;
    resourceType: AiResourceType;
    resourceName: string;
    deletedByUserId?: ObjectID | undefined;
  }): Promise<void> {
    const { suggestion } = data;

    try {
      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);
      // A Skipped command never ran; any other execution record may have.
      const executedCount: number = (plan?.commands || []).filter(
        (command: AiRemediationCommand): boolean => {
          return (
            command.execution !== undefined &&
            command.execution.status !==
              AiRemediationCommandExecutionStatus.Skipped
          );
        },
      ).length;

      const note: string = ResourceAiDeleteCleanup.getDeletedResourceNote({
        resourceType: data.resourceType,
        resourceName: data.resourceName,
        executedCount,
      });

      await AutoRemediationSuggestionService.attemptStatusTransition({
        suggestionId: suggestion.id!,
        fromStatus: suggestion.status!,
        set: {
          status: AutoRemediationSuggestionStatus.Dismissed,
          dismissedAt: OneUptimeDate.getCurrentDate(),
          ...(data.deletedByUserId
            ? { dismissedByUserId: data.deletedByUserId.toString() }
            : {}),
          rationaleMarkdown: suggestion.rationaleMarkdown
            ? `${note}\n\n${suggestion.rationaleMarkdown}`
            : note,
        },
      });
    } catch (error) {
      logger.error(
        `ResourceAiDeleteCleanup: could not settle AI remediation suggestion ${suggestion.id?.toString()} of a deleted ${getResourceSentenceName(
          data.resourceType,
        )}: ${error}`,
      );
    }
  }

  /*
   * The AI agent rows of the deleted resources. Not scoped to a project:
   * the ids are the ones the (already project-scoped) delete removed, and an
   * agent row belongs to exactly one resource. Best effort: a row left
   * behind is still removed by its agent's next heartbeat, which finds the
   * resource gone.
   */
  private static async deleteAgentsOfDeletedResources(data: {
    resourceType: AiResourceType;
    resourceIds: Array<ObjectID>;
  }): Promise<void> {
    try {
      /*
       * Required here, not imported: ResourceAiAgentService imports every
       * resource service, and every resource service imports this file.
       */
      const resourceAiAgentService: typeof import("../../../Services/ResourceAiAgentService").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../../Services/ResourceAiAgentService").default;

      await resourceAiAgentService.deleteAgentsForResources({
        resourceType: data.resourceType,
        resourceIds: data.resourceIds,
      });
    } catch (error) {
      logger.error(
        `ResourceAiDeleteCleanup: could not delete the AI agent(s) of the deleted ${getResourceSentenceName(
          data.resourceType,
        )}(s): ${error}`,
      );
    }
  }
}
