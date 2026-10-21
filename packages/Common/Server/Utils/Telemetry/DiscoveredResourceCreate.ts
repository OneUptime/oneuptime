import DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import CaptureSpan from "./CaptureSpan";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  getCloudEnvironmentNameFromIdentity,
  getNameFromIdentity,
} from "../../../Utils/Telemetry/DiscoveredResourceName";

/*
 * CREATING A RESOURCE THAT TELEMETRY ALSO DISCOVERS.
 *
 * Hosts, Docker and Podman hosts, Kubernetes clusters, RUM applications,
 * serverless functions and cloud environments are created by ingest the
 * first time their telemetry arrives, named after what that telemetry
 * reports (Utils/Telemetry/DiscoveredResourceName). A person can add one
 * ahead of its telemetry - from the dashboard, the API or Terraform - and
 * gets the resource ingest would have made:
 *
 *   - the name may be left out, or blank: the resource is named after its
 *     identifier, the way a discovered one is (fillName, from the service's
 *     onBeforeCreate). The column stays required - the hook runs before the
 *     required-field check - so the API and the Terraform schema do not
 *     change, and a caller who sends a name keeps it;
 *   - a person's identifier is stored without the spaces around it. Ingest
 *     looks a resource up by the trimmed value its telemetry reports, which
 *     never matches a stored " web-01 ", so a stray space used to leave the
 *     resource empty for good while ingest created a second one beside it;
 *   - a clash with an existing resource is refused in plain words
 *     (refuseClash, from the service's onBeforeCreateUniqueCheck - after the
 *     permission checks, so only a caller who may add the resource learns
 *     what exists). The identifier is checked first: a resource named after
 *     its identifier would otherwise be reported as a clash of names
 *     ("Host with the same name already exists.") when the truth is that
 *     the host is already there. A clash of names says what to do about it.
 *
 * Ingest's own creates (root) are left as they come but for a missing name.
 * Discovery always names what it creates and settles its own races, so it
 * never pays for the lookups.
 */

export interface DiscoveredResourceNaming<TModel extends BaseModel> {
  // The column the resource's telemetry is matched on.
  identityColumn: string;
  // The name a resource created without one is given: ingest's name for it.
  getDefaultName: (data: TModel) => string;
  // The refusal when another resource of the project has this identifier.
  getIdentityTakenMessage: (identity: string) => string;
  // The refusal when another resource of the project has this name.
  getNameTakenMessage: (name: string) => string;
}

export interface NamedAfterIdentityOptions {
  // The column the resource's telemetry is matched on: hostIdentifier, ...
  identityColumn: string;
  // One resource, as a sentence names it: "host", "Kubernetes cluster".
  resourceName: string;
  // Its identifier, as a sentence names it: "host name", "cluster name".
  identityName: string;
}

// Said after a refusal whose clash is with a resource the list hides.
export const ARCHIVED_RESOURCE_HINT: string =
  "It is archived: unarchive it instead of adding it again.";

// A text value without the spaces around it; empty for anything else.
const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const readColumn: (data: BaseModel, column: string) => unknown = (
  data: BaseModel,
  column: string,
): unknown => {
  return (data as unknown as Record<string, unknown>)[column];
};

/**
 * The refusal when another resource already has the name, with what to do
 * about it - for a person (the create form's Display Name) and an API
 * caller (the name) alike.
 */
export const getDiscoveredResourceNameTakenMessage: (data: {
  resourceName: string;
  name: string;
}) => string = (data: { resourceName: string; name: string }): string => {
  return `Another ${data.resourceName} is already named "${data.name}". Give this one a different display name.`;
};

/**
 * A resource matched by one identifier and, unless told otherwise, named
 * after it: hosts, Docker and Podman hosts, Kubernetes clusters, RUM
 * applications and serverless functions.
 */
export const namedAfterIdentity: <TModel extends BaseModel>(
  options: NamedAfterIdentityOptions,
) => DiscoveredResourceNaming<TModel> = <TModel extends BaseModel>(
  options: NamedAfterIdentityOptions,
): DiscoveredResourceNaming<TModel> => {
  return {
    identityColumn: options.identityColumn,
    getDefaultName: (data: TModel): string => {
      return getNameFromIdentity(readColumn(data, options.identityColumn));
    },
    getIdentityTakenMessage: (identity: string): string => {
      return `A ${options.resourceName} with the ${options.identityName} "${identity}" already exists.`;
    },
    getNameTakenMessage: (name: string): string => {
      return getDiscoveredResourceNameTakenMessage({
        resourceName: options.resourceName,
        name: name,
      });
    },
  };
};

/**
 * A cloud environment: matched on its key (platform|account|region) and
 * named after its platform, region and account.
 */
export const namedAfterCloudEnvironment: <
  TModel extends BaseModel,
>() => DiscoveredResourceNaming<TModel> = <
  TModel extends BaseModel,
>(): DiscoveredResourceNaming<TModel> => {
  return {
    identityColumn: "resourceIdentifier",
    getDefaultName: (data: TModel): string => {
      return getCloudEnvironmentNameFromIdentity({
        cloudPlatform: readColumn(data, "cloudPlatform"),
        cloudAccountId: readColumn(data, "cloudAccountId"),
        cloudRegion: readColumn(data, "cloudRegion"),
        resourceIdentifier: readColumn(data, "resourceIdentifier"),
      });
    },
    getIdentityTakenMessage: (identity: string): string => {
      return `A cloud environment for this platform, account and region (${identity}) already exists.`;
    },
    getNameTakenMessage: (name: string): string => {
      return getDiscoveredResourceNameTakenMessage({
        resourceName: "cloud environment",
        name: name,
      });
    },
  };
};

export default class DiscoveredResourceCreate {
  /**
   * From a service's onBeforeCreate, before the required-field check: a
   * missing or blank name becomes the resource's default name (any
   * caller), and a person's identifier and name lose the spaces around
   * them. Ingest's (root) values are otherwise left exactly as sent.
   */
  public static fillName<TModel extends BaseModel>(data: {
    createBy: CreateBy<TModel>;
    naming: DiscoveredResourceNaming<TModel>;
  }): void {
    const item: TModel = data.createBy.data;
    const values: Record<string, unknown> = item as unknown as Record<
      string,
      unknown
    >;
    const isPerson: boolean = !data.createBy.props.isRoot;
    const identityColumn: string = data.naming.identityColumn;

    if (isPerson && typeof values[identityColumn] === "string") {
      values[identityColumn] = (values[identityColumn] as string).trim();
    }

    const sentName: string = readText(values["name"]);

    if (sentName) {
      if (isPerson) {
        values["name"] = sentName;
      }

      return;
    }

    const defaultName: string = data.naming.getDefaultName(item);

    /*
     * Nothing to name it after - no identifier either - leaves the name as
     * it came, and the required-field check refuses the create as before.
     */
    if (defaultName) {
      values["name"] = defaultName;
    }
  }

  /**
   * From a service's onBeforeCreateUniqueCheck - a create the caller has
   * passed the permission checks for - refuses a person's clash with an
   * existing resource of the project in plain words: the identifier first,
   * then the name. Matched the way the unique checks match: whole value,
   * spaces around it and case aside, archived resources included.
   */
  @CaptureSpan()
  public static async refuseClash<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    createBy: CreateBy<TModel>;
    naming: DiscoveredResourceNaming<TModel>;
  }): Promise<void> {
    if (data.createBy.props.isRoot) {
      return;
    }

    const values: Record<string, unknown> = data.createBy
      .data as unknown as Record<string, unknown>;

    const projectId: ObjectID | undefined =
      (values["projectId"] as ObjectID | undefined) ||
      data.createBy.props.tenantId ||
      undefined;

    if (!projectId) {
      return;
    }

    const identity: string = readText(values[data.naming.identityColumn]);

    if (identity) {
      const sameIdentity: TModel | null = await data.service.findOneBy({
        query: {
          projectId: projectId,
          [data.naming.identityColumn]: QueryHelper.findWithSameText(identity),
        } as unknown as Query<TModel>,
        select: {
          _id: true,
          isArchived: true,
        } as unknown as Select<TModel>,
        props: {
          isRoot: true,
        },
      });

      if (sameIdentity) {
        const message: string = data.naming.getIdentityTakenMessage(identity);

        throw new BadDataException(
          readColumn(sameIdentity, "isArchived") === true
            ? `${message} ${ARCHIVED_RESOURCE_HINT}`
            : message,
        );
      }
    }

    const name: string = readText(values["name"]);

    if (name) {
      const sameName: TModel | null = await data.service.findOneBy({
        query: {
          projectId: projectId,
          name: QueryHelper.findWithSameText(name),
        } as unknown as Query<TModel>,
        select: {
          _id: true,
        } as unknown as Select<TModel>,
        props: {
          isRoot: true,
        },
      });

      if (sameName) {
        throw new BadDataException(data.naming.getNameTakenMessage(name));
      }
    }
  }
}
