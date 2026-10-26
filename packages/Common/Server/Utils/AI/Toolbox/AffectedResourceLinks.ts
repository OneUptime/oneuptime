import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../Models/DatabaseModels/Alert";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IoTFleet from "../../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../../Models/DatabaseModels/Service";
import StorageArray from "../../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceArgument,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
  AiAffectedResourceRef,
  AiAffectedResourceRelation,
  getAiAffectedResourceKindInfo,
  getPageAffectedResource,
  MAX_AI_AFFECTED_RESOURCES,
  readAiAffectedResourceArgument,
} from "../../../../Types/AI/AiAffectedResources";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import CephClusterService from "../../../Services/CephClusterService";
import DatabaseServerService from "../../../Services/DatabaseServerService";
import DockerHostService from "../../../Services/DockerHostService";
import DockerSwarmClusterService from "../../../Services/DockerSwarmClusterService";
import HostService from "../../../Services/HostService";
import IoTFleetService from "../../../Services/IoTFleetService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import PodmanHostService from "../../../Services/PodmanHostService";
import ProxmoxClusterService from "../../../Services/ProxmoxClusterService";
import ServiceService from "../../../Services/ServiceService";
import StorageArrayService from "../../../Services/StorageArrayService";
import VMwareVCenterService from "../../../Services/VMwareVCenterService";
import FindBy from "../../../Types/Database/FindBy";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import { ToolContext } from "./ToolTypes";

/*
 * THE RESOURCES AN INCIDENT OR ALERT THE AI DECLARES, OR CHANGES, IS
 * LINKED TO.
 *
 * Issue #5293: declared from a host's page, an incident Ask AI created was
 * linked to nothing, so its investigation never reached the host and
 * auto-remediation had nothing to fix. The vocabulary (which kinds, which
 * list each goes in, the page's resource) is Types/AI/AiAffectedResources;
 * this is the server's half, shared by every tool that links:
 *
 *   - which resources a call asks for: the ones it names, or - when it
 *     names none and the tool says so - the resource of the page the
 *     conversation is about (getRequested);
 *   - which of them are linked: read with the person's own props, in the
 *     project, so a resource they may not view, one of another project and
 *     an archived one are left out, each with a reason for the model to
 *     pass on (resolve);
 *   - the lists to write: on a new record (setOnRecord), or added to what an
 *     existing record lists already (getListsWithAdded) - never in place of
 *     it, so a link its editor may not view stays;
 *   - and the words: the approval card's line, the answer to the model, the
 *     widget's field.
 *
 * It only reads. The writes are the tools' own - IncidentService.create,
 * IncidentService.updateOneById, AlertService.updateOneById - made with the
 * person's props where the toolbox's guard sees them
 * (ToolboxWritesAsThePersonGuard).
 */

// One resource a call links, as the person reads it.
export interface LinkedAffectedResource {
  kind: AiAffectedResourceKind;
  id: string;
  name: string;
}

// What a call links, and what it asked for and does not link.
export interface AffectedResourcesToLink {
  linked: Array<LinkedAffectedResource>;
  // Each resource asked for and left out, and why: model-facing English.
  notLinked: Array<string>;
  // Whether the call named none, so the page's resource was taken.
  isFromPage: boolean;
}

// What a call asks for, before anything is read.
export interface RequestedAffectedResources {
  refs: Array<AiAffectedResourceRef>;
  problems: Array<string>;
  // Whether the call named none, so the page's resource was taken.
  isFromPage: boolean;
  // Whether the call named a list at all (possibly empty).
  isNamedByCall: boolean;
}

// The argument's name in every tool that links.
export const AFFECTED_RESOURCES_ARGUMENT_NAME: string = "affectedResources";

/*
 * The argument's JSON schema. Its resourceType is one of the kinds, its
 * resourceId the OneUptime ID query_telemetry_resources (or, for a
 * service, lookup_context) returned.
 */
export const AFFECTED_RESOURCES_ARGUMENT_SCHEMA: JSONObject = {
  type: "array",
  description: `The infrastructure and services this is about, at most ${MAX_AI_AFFECTED_RESOURCES}: each { resourceType, resourceId } with the resource's OneUptime ID from query_telemetry_resources (or lookup_context for a service). OneUptime AI investigates and fixes what an incident or alert is linked to.`,
  items: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        enum: AI_AFFECTED_RESOURCE_KINDS.map(
          (info: AiAffectedResourceKindInfo): string => {
            return info.kind;
          },
        ),
      },
      resourceId: {
        type: "string",
        description: "The resource's OneUptime ID (a UUID).",
      },
    },
    required: ["resourceType", "resourceId"],
  },
};

interface AffectedResourceReader {
  model: new () => BaseModel;
  findBy: (data: FindBy<BaseModel>) => Promise<Array<BaseModel>>;
}

// How each kind is read: its model and its service's own find.
const READERS: Readonly<
  Record<AiAffectedResourceKind, AffectedResourceReader>
> = {
  [AiAffectedResourceKind.Host]: {
    model: Host,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return HostService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.DockerHost]: {
    model: DockerHost,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return DockerHostService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.PodmanHost]: {
    model: PodmanHost,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return PodmanHostService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.KubernetesCluster]: {
    model: KubernetesCluster,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return KubernetesClusterService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.DockerSwarmCluster]: {
    model: DockerSwarmCluster,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return DockerSwarmClusterService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.ProxmoxCluster]: {
    model: ProxmoxCluster,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return ProxmoxClusterService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.VMwareVCenter]: {
    model: VMwareVCenter,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return VMwareVCenterService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.CephCluster]: {
    model: CephCluster,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return CephClusterService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.StorageArray]: {
    model: StorageArray,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return StorageArrayService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.IoTFleet]: {
    model: IoTFleet,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return IoTFleetService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.DatabaseServer]: {
    model: DatabaseServer,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return DatabaseServerService.findBy(data as never);
    },
  },
  [AiAffectedResourceKind.Service]: {
    model: Service,
    findBy: (data: FindBy<BaseModel>): Promise<Array<BaseModel>> => {
      return ServiceService.findBy(data as never);
    },
  },
};

// What a resource is called in a sentence: host "test01".
export function describeLinkedResource(
  resource: LinkedAffectedResource,
): string {
  return `${getAiAffectedResourceKindInfo(resource.kind).noun} ${JSON.stringify(resource.name)}`;
}

// A row's name, as the dashboard shows it.
function readName(row: BaseModel, noun: string): string {
  const name: unknown = (row as unknown as { name?: unknown }).name;

  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }

  return `the ${noun}`;
}

export default class AffectedResourceLinks {
  /*
   * The resources a call asks to link: the ones its affectedResources
   * argument names - an empty list naming none - or, when it leaves the
   * argument out and `defaultsToPage` is set, the resource of the page the
   * conversation is about (an incident declared from a host's page is that
   * host's), when that page is a resource's.
   */
  public static getRequested(data: {
    args: JSONObject;
    ctx: ToolContext;
    defaultsToPage: boolean;
  }): RequestedAffectedResources {
    const argument: AiAffectedResourceArgument | undefined =
      readAiAffectedResourceArgument(
        data.args[AFFECTED_RESOURCES_ARGUMENT_NAME],
      );

    if (argument) {
      return {
        refs: argument.refs,
        problems: argument.problems,
        isFromPage: false,
        isNamedByCall: true,
      };
    }

    const pageResource: AiAffectedResourceRef | null = data.defaultsToPage
      ? getPageAffectedResource(data.ctx.pageContext)
      : null;

    return {
      refs: pageResource ? [pageResource] : [],
      problems: [],
      isFromPage: Boolean(pageResource),
      isNamedByCall: false,
    };
  }

  /*
   * The arguments with the page's resource written out: what the tool
   * would link when it runs, so the person approves exactly that. A call
   * that names its own list, or a conversation not about a resource's page,
   * is left as it is.
   */
  public static withPageResourceWrittenOut(data: {
    args: JSONObject;
    ctx: ToolContext;
  }): JSONObject {
    const requested: RequestedAffectedResources = this.getRequested({
      args: data.args,
      ctx: data.ctx,
      defaultsToPage: true,
    });

    if (!requested.isFromPage) {
      return data.args;
    }

    return {
      ...data.args,
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: requested.refs.map(
        (ref: AiAffectedResourceRef): JSONObject => {
          return { resourceType: ref.kind, resourceId: ref.id };
        },
      ),
    };
  }

  /*
   * Which of the resources asked for are linked: each read with the
   * person's props, in the request's project. One they may not view, one
   * that is not the project's or no longer exists, and an archived one are
   * left out, each with the reason; so is every resource of a kind they
   * may not read at all. Never throws for the resources it is given.
   */
  public static async resolve(data: {
    refs: Array<AiAffectedResourceRef>;
    ctx: ToolContext;
  }): Promise<{
    linked: Array<LinkedAffectedResource>;
    notLinked: Array<string>;
  }> {
    const linked: Array<LinkedAffectedResource> = [];
    const notLinked: Array<string> = [];

    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      const ids: Array<string> = data.refs
        .filter((ref: AiAffectedResourceRef): boolean => {
          return ref.kind === info.kind;
        })
        .map((ref: AiAffectedResourceRef): string => {
          return ref.id.toLowerCase();
        });

      if (ids.length === 0) {
        continue;
      }

      let rows: Array<BaseModel> = [];

      try {
        rows = await READERS[info.kind].findBy({
          query: {
            _id: QueryHelper.any(
              ids.map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
            ),
            projectId: data.ctx.projectId,
          } as never,
          select: { _id: true, name: true, isArchived: true } as never,
          limit: ids.length,
          skip: 0,
          props: data.ctx.props,
        });
      } catch (error) {
        logger.debug(
          `AffectedResourceLinks: could not read ${info.noun}s for the person: ${error}`,
        );
        notLinked.push(
          `${ids.length === 1 ? `The ${info.noun}` : `${ids.length} ${info.noun}s`} named could not be read for the current user (they may not view ${info.noun}s), so ${ids.length === 1 ? "it was" : "they were"} not linked.`,
        );
        continue;
      }

      const rowsById: Map<string, BaseModel> = new Map<string, BaseModel>();

      for (const row of rows) {
        const id: string | undefined = row.id?.toString().toLowerCase();

        if (id) {
          rowsById.set(id, row);
        }
      }

      for (const id of ids) {
        const row: BaseModel | undefined = rowsById.get(id);

        if (!row) {
          notLinked.push(
            `No ${info.noun} with ID ${id} that the current user may view exists in this project, so it was not linked.`,
          );
          continue;
        }

        const name: string = readName(row, info.noun);

        if ((row as unknown as { isArchived?: unknown }).isArchived === true) {
          notLinked.push(
            `${info.noun} ${JSON.stringify(name)} is archived, so it was not linked. Unarchive it in OneUptime to link it.`,
          );
          continue;
        }

        linked.push({ kind: info.kind, id, name });
      }
    }

    return { linked, notLinked };
  }

  /*
   * getRequested then resolve: what one call links, and what it asked for
   * and does not link - an argument it could not read included.
   */
  public static async resolveForCall(data: {
    args: JSONObject;
    ctx: ToolContext;
    defaultsToPage: boolean;
  }): Promise<AffectedResourcesToLink> {
    const requested: RequestedAffectedResources = this.getRequested(data);

    const resolved: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await this.resolve({ refs: requested.refs, ctx: data.ctx });

    return {
      linked: resolved.linked,
      notLinked: [...requested.problems, ...resolved.notLinked],
      isFromPage: requested.isFromPage,
    };
  }

  // The lists of a new incident or alert: each resource in its kind's list.
  public static setOnRecord(
    record: Incident | Alert,
    linked: Array<LinkedAffectedResource>,
  ): void {
    const lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> =
      this.toLists(linked);

    for (const relation of Object.keys(
      lists,
    ) as Array<AiAffectedResourceRelation>) {
      (record as unknown as Record<string, unknown>)[relation] =
        lists[relation];
    }
  }

  /*
   * The lists an update of an existing incident or alert writes to add
   * `linked`: for each kind added, what the record lists already (`held`,
   * its IDs read as OneUptime) and then the new ones. A list is written
   * whole, so leaving out what it held would unlink it - and what it held
   * may include a resource the person may not view, which an edit keeps
   * (RelationListPermission asks only about what a write adds). Only the
   * kinds that gain a resource are written.
   */
  public static getListsWithAdded(data: {
    held: Partial<Record<AiAffectedResourceRelation, Array<string>>>;
    linked: Array<LinkedAffectedResource>;
  }): {
    lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>>;
    added: Array<LinkedAffectedResource>;
    alreadyLinked: Array<LinkedAffectedResource>;
  } {
    const lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> =
      {};
    const added: Array<LinkedAffectedResource> = [];
    const alreadyLinked: Array<LinkedAffectedResource> = [];

    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      const ofKind: Array<LinkedAffectedResource> = data.linked.filter(
        (resource: LinkedAffectedResource): boolean => {
          return resource.kind === info.kind;
        },
      );

      if (ofKind.length === 0) {
        continue;
      }

      const heldIds: Array<string> = (data.held[info.relation] || []).map(
        (id: string): string => {
          return id.toLowerCase();
        },
      );
      const newOnes: Array<LinkedAffectedResource> = [];

      for (const resource of ofKind) {
        if (heldIds.includes(resource.id)) {
          alreadyLinked.push(resource);
        } else {
          newOnes.push(resource);
        }
      }

      if (newOnes.length === 0) {
        continue;
      }

      added.push(...newOnes);
      lists[info.relation] = [
        ...heldIds,
        ...newOnes.map((resource: LinkedAffectedResource): string => {
          return resource.id;
        }),
      ].map((id: string): BaseModel => {
        return this.toRecord(info.kind, id);
      });
    }

    return { lists, added, alreadyLinked };
  }

  // The relations to read of an existing record before adding `linked`.
  public static getRelationsOf(
    linked: Array<LinkedAffectedResource>,
  ): Array<AiAffectedResourceRelation> {
    const relations: Array<AiAffectedResourceRelation> = [];

    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      const isAdded: boolean = linked.some(
        (resource: LinkedAffectedResource): boolean => {
          return resource.kind === info.kind;
        },
      );

      if (isAdded) {
        relations.push(info.relation);
      }
    }

    return relations;
  }

  // The IDs a record holds in each of these lists, as read from it.
  public static readHeldIds(
    record: Incident | Alert | null,
    relations: Array<AiAffectedResourceRelation>,
  ): Partial<Record<AiAffectedResourceRelation, Array<string>>> {
    const held: Partial<Record<AiAffectedResourceRelation, Array<string>>> = {};

    for (const relation of relations) {
      const list: unknown = (record as unknown as Record<string, unknown>)?.[
        relation
      ];

      held[relation] = (Array.isArray(list) ? list : [])
        .map((item: unknown): string => {
          const id: unknown =
            (item as { id?: unknown; _id?: unknown } | null)?.id ||
            (item as { _id?: unknown } | null)?._id;

          return id ? id.toString() : "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        });
    }

    return held;
  }

  /*
   * The approval card's line: what an action links, by name - "Linked to
   * host "test01"." - and what it will not link. Undefined when it names
   * nothing.
   */
  public static describeForPerson(data: {
    linked: Array<LinkedAffectedResource>;
    // Whether some resource named will not be linked (resolve's notLinked).
    hasNotLinked: boolean;
    verb: "Linked to" | "Adds";
  }): string | undefined {
    const parts: Array<string> = [];

    if (data.linked.length > 0) {
      parts.push(
        `${data.verb} ${data.linked.map(describeLinkedResource).join(", ")}.`,
      );
    }

    if (data.hasNotLinked) {
      parts.push(
        data.linked.length > 0
          ? "Some of the other resources named will not be linked."
          : "The resources named will not be linked.",
      );
    }

    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  // The answer's line for the model: what was linked, and what was not and why.
  public static describeForModel(data: {
    linked: Array<LinkedAffectedResource>;
    notLinked: Array<string>;
    // "Linked to" for a new record, "Added" for an existing one.
    verb: string;
  }): string {
    const lines: Array<string> = [];

    if (data.linked.length > 0) {
      lines.push(
        `${data.verb}: ${data.linked.map(describeLinkedResource).join(", ")}.`,
      );
    }

    for (const reason of data.notLinked) {
      lines.push(`Not linked: ${reason}`);
    }

    return lines.join("\n");
  }

  // The widget field's value: the names, kind first.
  public static describeForWidget(
    linked: Array<LinkedAffectedResource>,
  ): string {
    return linked.map(describeLinkedResource).join(", ");
  }

  // Whether any of these is something auto-remediation can fix.
  public static hasFixableResource(
    linked: Array<LinkedAffectedResource>,
  ): boolean {
    return linked.some((resource: LinkedAffectedResource): boolean => {
      return getAiAffectedResourceKindInfo(resource.kind).isFixedByOneUptimeAi;
    });
  }

  private static toLists(
    linked: Array<LinkedAffectedResource>,
  ): Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> {
    const lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> =
      {};

    for (const resource of linked) {
      const relation: AiAffectedResourceRelation =
        getAiAffectedResourceKindInfo(resource.kind).relation;

      lists[relation] = [
        ...(lists[relation] || []),
        this.toRecord(resource.kind, resource.id),
      ];
    }

    return lists;
  }

  private static toRecord(kind: AiAffectedResourceKind, id: string): BaseModel {
    const record: BaseModel = new READERS[kind].model();
    record.id = new ObjectID(id);
    return record;
  }
}
