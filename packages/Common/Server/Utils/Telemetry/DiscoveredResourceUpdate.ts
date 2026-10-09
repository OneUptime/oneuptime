import DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import UpdateBy from "../../Types/Database/UpdateBy";
import CaptureSpan from "./CaptureSpan";
import {
  ARCHIVED_RESOURCE_HINT,
  NamedAfterIdentityOptions,
  namedAfterIdentity,
} from "./DiscoveredResourceCreate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * CHANGING WHAT A RESOURCE'S TELEMETRY IS MATCHED ON.
 *
 * A resource that telemetry discovers is matched to its telemetry by one
 * column. Hosts, Docker and Podman hosts and Kubernetes clusters have an
 * identifier of their own for it (hostIdentifier holds host.name,
 * clusterIdentifier the agent's clusterName). Ceph, Proxmox and Docker
 * Swarm clusters, vCenters, storage arrays, IoT fleets and services are
 * matched by their name (ceph.cluster.name, proxmox.cluster.name,
 * docker.swarm.cluster.name, vmware.vcenter.name, storage.array.name,
 * iot.fleet.name, service.name).
 *
 * That column is edited in one place: the details card at the top of the
 * resource's Settings page (the identifier folded under Advanced, a matched
 * name as the card's Name). A person's write of it is held to what creating
 * the resource holds it to (DiscoveredResourceCreate):
 *
 *   - it is stored without the spaces around it. Ingest looks a resource up
 *     by the trimmed value its telemetry reports, so a stored " web-01 "
 *     never matches again, and ingest quietly creates a second resource
 *     beside it;
 *   - it is never blank: the column is required, and a blank one matches
 *     nothing;
 *   - it is refused when another resource of the project - archived ones
 *     included - already has it, in plain words. Two hosts with one host
 *     name would split that host's telemetry between them, and the columns
 *     with a unique index of their own would only answer with the
 *     database's generic refusal.
 *
 * Only a change is looked up. An edit form sends the column back unchanged
 * with every save, so saving a resource's description never trips over a
 * clash that was there before.
 *
 * It runs from the service's onBeforeUpdateUniqueCheck: after the
 * permission checks, so only a caller who may make the write learns what
 * else exists. Ingest's own (root) writes are left exactly as sent.
 */

export interface MatchColumn {
  // The column the resource's telemetry is matched on: hostIdentifier, name.
  column: string;
  // The refusal when it is sent blank.
  blankMessage: string;
  // The refusal when one write would give it to more than one resource.
  sharedMessage: string;
  // The refusal when another resource of the project already has it.
  getTakenMessage: (value: string) => string;
}

/**
 * A resource matched by an identifier of its own: hosts, Docker and Podman
 * hosts, Kubernetes clusters. Refused in the words a clash on create is.
 */
export const matchedOnIdentifier: (
  options: NamedAfterIdentityOptions,
) => MatchColumn = (options: NamedAfterIdentityOptions): MatchColumn => {
  return {
    column: options.identityColumn,
    blankMessage: `Enter the ${options.identityName} this ${options.resourceName}'s telemetry reports.`,
    sharedMessage: `Each ${options.resourceName} needs a ${options.identityName} of its own.`,
    getTakenMessage: namedAfterIdentity(options).getIdentityTakenMessage,
  };
};

export interface MatchedOnNameOptions {
  // One resource, as a sentence names it: "Proxmox cluster", "service".
  resourceName: string;
}

/**
 * A resource whose telemetry is matched by its name: Ceph, Proxmox and
 * Docker Swarm clusters, vCenters, storage arrays, IoT fleets and services.
 */
export const matchedOnName: (options: MatchedOnNameOptions) => MatchColumn = (
  options: MatchedOnNameOptions,
): MatchColumn => {
  return {
    column: "name",
    blankMessage: `Enter the name this ${options.resourceName}'s telemetry reports.`,
    sharedMessage: `Each ${options.resourceName} needs a name of its own.`,
    getTakenMessage: (name: string): string => {
      return `Another ${options.resourceName} is already named "${name}".`;
    },
  };
};

// The same text as findWithSameText compares it: case and spaces aside.
const isSameText: (stored: unknown, value: string) => boolean = (
  stored: unknown,
  value: string,
): boolean => {
  return (
    typeof stored === "string" &&
    stored.trim().toLowerCase() === value.trim().toLowerCase()
  );
};

const readColumn: (row: BaseModel, column: string) => unknown = (
  row: BaseModel,
  column: string,
): unknown => {
  return (row as unknown as Record<string, unknown>)[column];
};

export default class DiscoveredResourceUpdate {
  /**
   * From a service's onBeforeUpdateUniqueCheck: a person's write of the
   * column telemetry is matched on loses the spaces around it, may not be
   * blank, and is refused when it would give another resource's value to
   * the resource being saved. Nothing is looked up unless the value changes.
   */
  @CaptureSpan()
  public static async checkMatchColumn<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
    matchColumn: MatchColumn;
  }): Promise<void> {
    if (data.updateBy.props.isRoot) {
      return;
    }

    const values: Record<string, unknown> = (data.updateBy.data ||
      {}) as unknown as Record<string, unknown>;
    const column: string = data.matchColumn.column;
    const sent: unknown = values[column];

    // Not part of this write: nothing to hold it to.
    if (typeof sent !== "string") {
      return;
    }

    const value: string = sent.trim();

    if (!value) {
      throw new BadDataException(data.matchColumn.blankMessage);
    }

    values[column] = value;

    /*
     * Every row this write reaches - the ones the caller may write - with
     * the write held to them: whether it is refused turns on whether any of
     * them changes, so each one is read.
     */
    const targets: Array<TModel> =
      await data.service.findRowsAndHoldUpdateToThem(data.updateBy, {
        _id: true,
        projectId: true,
        [column]: true,
      } as unknown as Select<TModel>);

    const changing: Array<TModel> = targets.filter((row: TModel): boolean => {
      return !isSameText(readColumn(row, column), value);
    });

    if (changing.length === 0) {
      return;
    }

    if (targets.length > 1) {
      throw new BadDataException(data.matchColumn.sharedMessage);
    }

    const target: TModel = targets[0]!;
    const projectId: ObjectID | undefined = readColumn(target, "projectId") as
      | ObjectID
      | undefined;

    if (!projectId || !target._id) {
      return;
    }

    const sameValue: TModel | null = await data.service.findOneBy({
      query: {
        projectId: projectId,
        [column]: QueryHelper.findWithSameText(value),
        _id: QueryHelper.notEquals(target._id),
      } as unknown as Query<TModel>,
      select: {
        _id: true,
        isArchived: true,
      } as unknown as Select<TModel>,
      props: {
        isRoot: true,
      },
    });

    if (!sameValue) {
      return;
    }

    const message: string = data.matchColumn.getTakenMessage(value);

    throw new BadDataException(
      readColumn(sameValue, "isArchived") === true
        ? `${message} ${ARCHIVED_RESOURCE_HINT}`
        : message,
    );
  }
}
