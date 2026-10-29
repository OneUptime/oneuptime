import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
  AffectedResourceSearchKindResult,
  AffectedResourceSearchResult,
} from "../../../Types/AffectedResources/AffectedResourceSearch";
import Search from "../../../Types/BaseDatabase/Search";

/*
 * The Affected Resources picker asks one route for every kind
 * (AffectedResourceSearchApi -> POST /affected-resources/search). Picker
 * suites that keep their resources in an in-memory store behind a fake
 * ModelAPI.getList answer that route from the same store: each kind is
 * read through the store's getList, as the server reads each kind through
 * its service, so a suite's seeded rows, failing kinds and gates behave as
 * they did when the picker read every kind itself.
 */

export const KIND_MODELS: Record<AffectedResourceKind, { new (): BaseModel }> =
  {
    [AffectedResourceKind.Monitor]: Monitor,
    [AffectedResourceKind.Host]: Host,
    [AffectedResourceKind.NetworkDevice]: NetworkDevice,
    [AffectedResourceKind.KubernetesCluster]: KubernetesCluster,
    [AffectedResourceKind.DockerHost]: DockerHost,
    [AffectedResourceKind.PodmanHost]: PodmanHost,
    [AffectedResourceKind.ProxmoxCluster]: ProxmoxCluster,
    [AffectedResourceKind.VMwareVCenter]: VMwareVCenter,
    [AffectedResourceKind.CephCluster]: CephCluster,
    [AffectedResourceKind.StorageArray]: StorageArray,
    [AffectedResourceKind.DockerSwarmCluster]: DockerSwarmCluster,
    [AffectedResourceKind.IoTFleet]: IoTFleet,
    [AffectedResourceKind.DatabaseServer]: DatabaseServer,
    [AffectedResourceKind.CloudResource]: CloudResource,
    [AffectedResourceKind.NetworkSite]: NetworkSite,
    [AffectedResourceKind.Service]: Service,
  };

export interface SearchQueryLike {
  search: string;
  kinds: Array<AffectedResourceKind>;
  limitPerKind: number;
  countKinds?: Array<AffectedResourceKind> | undefined;
}

type GetListLike = (args: {
  modelType: { new (): BaseModel };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}) => Promise<{ data: Array<BaseModel>; count?: number | undefined }>;

/*
 * A search answered from a getList: the name matched as the store matches
 * it, each kind's count the rows the store returns, a kind whose read
 * throws left out of the answer - as the server leaves out a kind it could
 * not read.
 */
export function searchThroughGetList(
  getList: GetListLike,
): (query: SearchQueryLike) => Promise<AffectedResourceSearchResult> {
  const read: (
    kind: AffectedResourceKind,
    search: string,
    limit: number,
  ) => Promise<AffectedResourceSearchKindResult | null> = async (
    kind: AffectedResourceKind,
    search: string,
    limit: number,
  ): Promise<AffectedResourceSearchKindResult | null> => {
    try {
      const result: { data: Array<BaseModel>; count?: number | undefined } =
        await getList({
          modelType: KIND_MODELS[kind],
          query: search ? { name: new Search(search) } : {},
          limit: limit,
          skip: 0,
          select: { _id: true, name: true },
          sort: {},
        });

      const matches: Array<{ _id: string; name: string }> = (
        result.data || []
      ).map((row: BaseModel): { _id: string; name: string } => {
        return {
          _id: String(row._id),
          name: String((row as unknown as { name?: string }).name || ""),
        };
      });

      return {
        kind: kind,
        count: Math.max(result.count || 0, matches.length),
        matches: matches,
      };
    } catch {
      return null;
    }
  };

  return async (
    query: SearchQueryLike,
  ): Promise<AffectedResourceSearchResult> => {
    const answer: AffectedResourceSearchResult = {
      kinds: [],
      counts: [],
      unreadableKinds: [],
    };

    for (const kind of query.kinds) {
      const result: AffectedResourceSearchKindResult | null = await read(
        kind,
        query.search,
        query.limitPerKind,
      );

      if (result) {
        answer.kinds.push(result);
      }
    }

    for (const kind of query.countKinds || []) {
      const result: AffectedResourceSearchKindResult | null = await read(
        kind,
        query.search,
        1000,
      );

      if (result) {
        answer.counts.push({ kind: kind, count: result.count });
      }
    }

    return answer;
  };
}
