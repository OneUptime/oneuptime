import CephClusterService from "../../Services/CephClusterService";
import CloudResourceService from "../../Services/CloudResourceService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DockerHostService from "../../Services/DockerHostService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import HostService from "../../Services/HostService";
import IoTFleetService from "../../Services/IoTFleetService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import PodmanHostService from "../../Services/PodmanHostService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import ServiceService from "../../Services/ServiceService";
import StorageArrayService from "../../Services/StorageArrayService";
import VMwareVCenterService from "../../Services/VMwareVCenterService";
import { escapeLikePattern } from "../../Types/Database/JSONColumnQuery";
import ColumnPermissions from "../../Types/Database/Permissions/ColumnPermission";
import logger from "../Logger";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import {
  AffectedResourceKind,
  AffectedResourceSearchCount,
  AffectedResourceSearchKindResult,
  AffectedResourceSearchMatch,
  AffectedResourceSearchRequest,
  AffectedResourceSearchResult,
} from "../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";

/*
 * THE SERVER'S HALF OF THE AFFECTED RESOURCES SEARCH (issue #5341).
 *
 * One request finds what the person typed across every kind of resource the
 * picker offers - hosts, network devices, clusters, databases, cloud
 * resources, services and the rest - instead of two requests per kind per
 * keystroke. Every kind is read with the caller's own props, through its own
 * service: a kind whose table they may not read is reported as unreadable
 * and listed nowhere, labels and owned scope narrow what is listed and
 * counted exactly as they narrow that kind's own list, and a column they may
 * not read is never searched, so a match cannot give away what it holds.
 *
 * Archived resources are left out where the kind can be archived: they are
 * kept for their history, not offered for a new link. Resources already
 * linked keep showing as chips - the picker names them by id.
 *
 * The request and the answer are Types/AffectedResources/
 * AffectedResourceSearch, which the dashboard reads too.
 */

/*
 * What each kind is searched by. Every kind is found by its name and its
 * description, as the picker always found them; a network device also by
 * the address it is polled at and its DNS name, and a host by the name its
 * agent reports and its addresses, which is how people know them ("the
 * switch at 10.0.4.1"). The detail is what tells two of one name apart.
 */
export interface AffectedResourceKindSearchSpec {
  modelType: DatabaseBaseModelType;
  searchFields: Array<string>;
  detailField?: string | undefined;
}

// Read off the services per call: they load after this module does.
interface KindService {
  findBy: (data: unknown) => Promise<Array<BaseModel>>;
  countBy: (data: unknown) => Promise<PositiveNumber>;
}

const NAME_AND_DESCRIPTION: Array<string> = ["name", "description"];

export const AFFECTED_RESOURCE_KIND_SEARCH_SPECS: Readonly<
  Record<AffectedResourceKind, AffectedResourceKindSearchSpec>
> = {
  [AffectedResourceKind.Monitor]: {
    modelType: Monitor,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.Host]: {
    modelType: Host,
    searchFields: ["name", "hostIdentifier", "hostIpAddresses", "description"],
  },
  [AffectedResourceKind.NetworkDevice]: {
    modelType: NetworkDevice,
    searchFields: ["name", "hostname", "dnsName", "description"],
    detailField: "hostname",
  },
  [AffectedResourceKind.KubernetesCluster]: {
    modelType: KubernetesCluster,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.DockerHost]: {
    modelType: DockerHost,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.PodmanHost]: {
    modelType: PodmanHost,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.ProxmoxCluster]: {
    modelType: ProxmoxCluster,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.VMwareVCenter]: {
    modelType: VMwareVCenter,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.CephCluster]: {
    modelType: CephCluster,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.StorageArray]: {
    modelType: StorageArray,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.DockerSwarmCluster]: {
    modelType: DockerSwarmCluster,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.IoTFleet]: {
    modelType: IoTFleet,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.DatabaseServer]: {
    modelType: DatabaseServer,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.CloudResource]: {
    modelType: CloudResource,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.NetworkSite]: {
    modelType: NetworkSite,
    searchFields: NAME_AND_DESCRIPTION,
  },
  [AffectedResourceKind.Service]: {
    modelType: Service,
    searchFields: NAME_AND_DESCRIPTION,
  },
};

// The service each kind is read with.
export function getAffectedResourceKindService(
  kind: AffectedResourceKind,
): KindService {
  const services: Record<AffectedResourceKind, unknown> = {
    [AffectedResourceKind.Monitor]: MonitorService,
    [AffectedResourceKind.Host]: HostService,
    [AffectedResourceKind.NetworkDevice]: NetworkDeviceService,
    [AffectedResourceKind.KubernetesCluster]: KubernetesClusterService,
    [AffectedResourceKind.DockerHost]: DockerHostService,
    [AffectedResourceKind.PodmanHost]: PodmanHostService,
    [AffectedResourceKind.ProxmoxCluster]: ProxmoxClusterService,
    [AffectedResourceKind.VMwareVCenter]: VMwareVCenterService,
    [AffectedResourceKind.CephCluster]: CephClusterService,
    [AffectedResourceKind.StorageArray]: StorageArrayService,
    [AffectedResourceKind.DockerSwarmCluster]: DockerSwarmClusterService,
    [AffectedResourceKind.IoTFleet]: IoTFleetService,
    [AffectedResourceKind.DatabaseServer]: DatabaseServerService,
    [AffectedResourceKind.CloudResource]: CloudResourceService,
    [AffectedResourceKind.NetworkSite]: NetworkSiteService,
    [AffectedResourceKind.Service]: ServiceService,
  };

  return services[kind] as KindService;
}

// Why a kind is left out of an answer: unreadable, or it failed.
enum KindReadOutcome {
  Read = "Read",
  Unreadable = "Unreadable",
  Failed = "Failed",
}

interface KindRead {
  outcome: KindReadOutcome;
  count: number;
  matches: Array<AffectedResourceSearchMatch>;
}

/*
 * Whether an error means the caller may not read the kind - its table, or
 * on a plan without it - rather than that reading it went wrong.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

export default class AffectedResourceSearch {
  /*
   * The search fields of a kind the caller may read. Root, a master admin
   * and a workflow acting as OneUptime read every column; anyone else only
   * the columns their permissions open, so a match on a column they could
   * not select never tells them what it holds. Empty when they may not read
   * even the name.
   */
  public static getReadableSearchFields(data: {
    kind: AffectedResourceKind;
    props: DatabaseCommonInteractionProps;
  }): Array<string> {
    const spec: AffectedResourceKindSearchSpec =
      AFFECTED_RESOURCE_KIND_SEARCH_SPECS[data.kind];
    const model: BaseModel = new spec.modelType();
    const fields: Array<string> = spec.searchFields.filter(
      (field: string): boolean => {
        return model.hasColumn(field);
      },
    );

    if (data.props.isRoot || data.props.isMasterAdmin) {
      return fields;
    }

    const readable: Array<string> =
      ColumnPermissions.getModelColumnsByPermissions(
        spec.modelType,
        ColumnPermissions.getColumnCheckRows(data.props),
        DatabaseRequestType.Read,
      ).columns;

    if (!readable.includes("name")) {
      return [];
    }

    return fields.filter((field: string): boolean => {
      return readable.includes(field);
    });
  }

  /*
   * The query a kind is listed and counted by: the project's resources, not
   * archived ones, and - when the person typed something - those with the
   * text in a field they may read. The text is matched literally: a % or _
   * someone typed is not a wildcard.
   */
  public static buildKindQuery(data: {
    kind: AffectedResourceKind;
    projectId: ObjectID;
    search: string;
    searchFields: Array<string>;
  }): JSONObject {
    const spec: AffectedResourceKindSearchSpec =
      AFFECTED_RESOURCE_KIND_SEARCH_SPECS[data.kind];
    const model: BaseModel = new spec.modelType();
    const query: JSONObject = {
      projectId: data.projectId as unknown as JSONObject,
    };

    if (model.hasColumn("isArchived")) {
      query["isArchived"] = false;
    }

    if (data.search) {
      query["_multiFieldSearch"] = new MultiSearch({
        fields: data.searchFields,
        value: escapeLikePattern(data.search),
      }) as unknown as JSONObject;
    }

    return query;
  }

  /*
   * The matches in the order a person scans them: a name that is the text
   * typed, then names that start with it, then the rest by name - so "sw"
   * finds the switch called "sw" before "core-sw-02".
   */
  public static rankMatches(data: {
    matches: Array<AffectedResourceSearchMatch>;
    search: string;
  }): Array<AffectedResourceSearchMatch> {
    const needle: string = data.search.trim().toLowerCase();

    if (!needle) {
      return data.matches;
    }

    const rank: (match: AffectedResourceSearchMatch) => number = (
      match: AffectedResourceSearchMatch,
    ): number => {
      const name: string = match.name.trim().toLowerCase();

      if (name === needle) {
        return 0;
      }

      return name.startsWith(needle) ? 1 : 2;
    };

    return data.matches
      .map((match: AffectedResourceSearchMatch, index: number) => {
        return { match, index, rank: rank(match) };
      })
      .sort(
        (
          a: {
            match: AffectedResourceSearchMatch;
            index: number;
            rank: number;
          },
          b: {
            match: AffectedResourceSearchMatch;
            index: number;
            rank: number;
          },
        ): number => {
          return a.rank - b.rank || a.index - b.index;
        },
      )
      .map(
        (item: {
          match: AffectedResourceSearchMatch;
          index: number;
          rank: number;
        }): AffectedResourceSearchMatch => {
          return item.match;
        },
      );
  }

  // One row as a match: its id, its name, and its detail when it adds one.
  public static toMatch(data: {
    row: BaseModel;
    detailField?: string | undefined;
  }): AffectedResourceSearchMatch | null {
    const id: string = data.row._id?.toString() || "";

    if (!ObjectID.isValidUUID(id)) {
      return null;
    }

    const rowJson: Record<string, unknown> = data.row as unknown as Record<
      string,
      unknown
    >;
    const name: string =
      typeof rowJson["name"] === "string" ? (rowJson["name"] as string) : "";
    const match: AffectedResourceSearchMatch = { _id: id, name: name };

    if (data.detailField) {
      const detail: unknown = rowJson[data.detailField];

      if (
        typeof detail === "string" &&
        detail.trim() &&
        detail.trim().toLowerCase() !== name.trim().toLowerCase()
      ) {
        match.detail = detail.trim();
      }
    }

    return match;
  }

  private static async readKind(data: {
    kind: AffectedResourceKind;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    search: string;
    limit: number;
    countOnly: boolean;
  }): Promise<KindRead> {
    const spec: AffectedResourceKindSearchSpec =
      AFFECTED_RESOURCE_KIND_SEARCH_SPECS[data.kind];
    const searchFields: Array<string> =
      AffectedResourceSearch.getReadableSearchFields({
        kind: data.kind,
        props: data.props,
      });

    if (searchFields.length === 0) {
      return { outcome: KindReadOutcome.Unreadable, count: 0, matches: [] };
    }

    const service: KindService = getAffectedResourceKindService(data.kind);
    const query: JSONObject = AffectedResourceSearch.buildKindQuery({
      kind: data.kind,
      projectId: data.projectId,
      search: data.search,
      searchFields: searchFields,
    });

    /*
     * The detail is selected only when the caller may read it - it is one of
     * their readable search fields, which hold every readable column the
     * kind is found by.
     */
    const detailField: string | undefined =
      spec.detailField && searchFields.includes(spec.detailField)
        ? spec.detailField
        : undefined;
    const select: JSONObject = { _id: true, name: true };

    if (detailField) {
      select[detailField] = true;
    }

    try {
      const [rows, count]: [Array<BaseModel>, PositiveNumber] =
        await Promise.all([
          data.countOnly
            ? Promise.resolve([])
            : service.findBy({
                query: query,
                select: select,
                sort: { name: SortOrder.Ascending },
                skip: 0,
                limit: data.limit,
                props: data.props,
              }),
          service.countBy({
            query: query,
            props: data.props,
          }),
        ]);

      const matches: Array<AffectedResourceSearchMatch> = [];

      for (const row of rows) {
        const match: AffectedResourceSearchMatch | null =
          AffectedResourceSearch.toMatch({
            row: row,
            detailField: detailField,
          });

        if (match) {
          matches.push(match);
        }
      }

      return {
        outcome: KindReadOutcome.Read,
        count: Math.max(count.toNumber(), matches.length),
        matches: AffectedResourceSearch.rankMatches({
          matches: matches,
          search: data.search,
        }),
      };
    } catch (error) {
      if (isRefusal(error)) {
        return { outcome: KindReadOutcome.Unreadable, count: 0, matches: [] };
      }

      /*
       * One kind that failed to read is left out rather than failing the
       * whole search: the person still finds every other kind.
       */
      logger.error(
        `Affected resources search could not read ${data.kind}: ${error}`,
      );

      return { outcome: KindReadOutcome.Failed, count: 0, matches: [] };
    }
  }

  /*
   * Every kind the request names, read at once, each with the caller's
   * props. The answer lists the readable kinds in the order asked, counts
   * the count-only kinds, and names the kinds the caller may not read.
   */
  public static async search(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: AffectedResourceSearchRequest;
  }): Promise<AffectedResourceSearchResult> {
    const listed: Array<KindRead> = await Promise.all(
      data.request.kinds.map(
        (kind: AffectedResourceKind): Promise<KindRead> => {
          return AffectedResourceSearch.readKind({
            kind: kind,
            projectId: data.projectId,
            props: data.props,
            search: data.request.search,
            limit: data.request.limitPerKind,
            countOnly: false,
          });
        },
      ),
    );

    const counted: Array<KindRead> = await Promise.all(
      data.request.countKinds.map(
        (kind: AffectedResourceKind): Promise<KindRead> => {
          return AffectedResourceSearch.readKind({
            kind: kind,
            projectId: data.projectId,
            props: data.props,
            search: data.request.search,
            limit: 0,
            countOnly: true,
          });
        },
      ),
    );

    const result: AffectedResourceSearchResult = {
      kinds: [],
      counts: [],
      unreadableKinds: [],
    };

    data.request.kinds.forEach((kind: AffectedResourceKind, index: number) => {
      const read: KindRead = listed[index]!;

      if (read.outcome === KindReadOutcome.Unreadable) {
        result.unreadableKinds.push(kind);
        return;
      }

      if (read.outcome === KindReadOutcome.Read) {
        const kindResult: AffectedResourceSearchKindResult = {
          kind: kind,
          count: read.count,
          matches: read.matches,
        };
        result.kinds.push(kindResult);
      }
    });

    data.request.countKinds.forEach(
      (kind: AffectedResourceKind, index: number) => {
        const read: KindRead = counted[index]!;

        if (read.outcome === KindReadOutcome.Unreadable) {
          result.unreadableKinds.push(kind);
          return;
        }

        if (read.outcome === KindReadOutcome.Read) {
          const count: AffectedResourceSearchCount = {
            kind: kind,
            count: read.count,
          };
          result.counts.push(count);
        }
      },
    );

    return result;
  }
}
