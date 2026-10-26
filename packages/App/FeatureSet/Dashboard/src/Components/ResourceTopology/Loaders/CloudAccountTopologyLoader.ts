import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { readCloudRelationships } from "Common/Types/Cloud/CloudInventory";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getCloudAccountResourcesQuery } from "../../Cloud/CloudAccountScope";
import {
  CloudAccountTopologyResource,
  buildCloudAccountTopology,
} from "../Builders/CloudAccountTopology";
import { OpenIssueRecord } from "../ResourceTopologyIssues";
import {
  OpenIssuesResult,
  areOpenIssuesUnreadable,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { ResourceTopologyTruncation } from "../ResourceTopologyModel";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * A cloud account's topology: the account, every live resource of its
 * cloud and account id (the columns the map needs), and the open incidents
 * and alerts linked to those resources - read in groups of
 * CLOUD_TOPOLOGY_ISSUE_ID_CHUNK ids, at most CLOUD_TOPOLOGY_ISSUE_ID_LIMIT
 * resources' worth, the map saying so when an account holds more.
 */

export const CLOUD_TOPOLOGY_ISSUE_ID_CHUNK: number = 500;
export const CLOUD_TOPOLOGY_ISSUE_ID_LIMIT: number = 2000;

// The ids to read open issues for, in groups, and whether some were left out.
export function chunkCloudTopologyIssueIds(ids: Array<string>): {
  chunks: Array<Array<string>>;
  isPartial: boolean;
} {
  const kept: Array<string> = ids.slice(0, CLOUD_TOPOLOGY_ISSUE_ID_LIMIT);
  const chunks: Array<Array<string>> = [];

  for (
    let start: number = 0;
    start < kept.length;
    start += CLOUD_TOPOLOGY_ISSUE_ID_CHUNK
  ) {
    chunks.push(kept.slice(start, start + CLOUD_TOPOLOGY_ISSUE_ID_CHUNK));
  }

  return { chunks, isPartial: ids.length > kept.length };
}

// Open issues of each group, as one: a count is unknown when any group's is.
export function mergeOpenIssues(
  results: Array<OpenIssuesResult>,
  leftOut: boolean,
): OpenIssuesResult {
  const records: Array<OpenIssueRecord> = [];
  let incidentCount: number | null = 0;
  let alertCount: number | null = 0;
  let isPartial: boolean = leftOut;

  for (const result of results) {
    records.push(...result.records);
    incidentCount =
      incidentCount === null || result.incidentCount === null
        ? null
        : incidentCount + result.incidentCount;
    alertCount =
      alertCount === null || result.alertCount === null
        ? null
        : alertCount + result.alertCount;
    isPartial = isPartial || result.isPartial;
  }

  return { records, incidentCount, alertCount, isPartial };
}

export async function loadCloudAccountTopology(
  accountId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const account: CloudAccount | null = await ModelAPI.getItem<CloudAccount>({
    modelType: CloudAccount,
    id: accountId,
    select: {
      name: true,
      provider: true,
      accountId: true,
      lastSeenAt: true,
    },
  });

  if (!account || !projectId) {
    throw new Error("Cloud account not found.");
  }

  const provider: string = (account.provider as string) || "";

  const rows: ListResult<CloudResource> = await ModelAPI.getList<CloudResource>(
    {
      modelType: CloudResource,
      query: getCloudAccountResourcesQuery({
        projectId,
        provider,
        accountId: (account.accountId as string) || "",
      }),
      select: {
        _id: true,
        name: true,
        cloudResourceType: true,
        providerResourceId: true,
        cloudRegion: true,
        cloudRelationships: true,
        lastSeenAt: true,
        otelCollectorStatus: true,
      },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    },
  );

  const resources: Array<CloudAccountTopologyResource> = rows.data
    .filter((row: CloudResource): boolean => {
      return Boolean(row._id);
    })
    .map((row: CloudResource): CloudAccountTopologyResource => {
      return {
        id: row._id!.toString(),
        name: (row.name as string) || "",
        type: (row.cloudResourceType as string) || "",
        providerResourceId: (row.providerResourceId as string) || "",
        region: (row.cloudRegion as string) || "",
        relationships: readCloudRelationships(row.cloudRelationships),
        lastSeenAt: row.lastSeenAt || null,
        isReporting: row.otelCollectorStatus === "connected",
      };
    });

  const { chunks, isPartial } = chunkCloudTopologyIssueIds(
    resources.map((resource: CloudAccountTopologyResource): string => {
      return resource.id;
    }),
  );

  const issues: OpenIssuesResult = mergeOpenIssues(
    await Promise.all(
      chunks.map((chunk: Array<string>): Promise<OpenIssuesResult> => {
        return loadOpenIssues({
          projectId,
          resourceRelation: "cloudResources",
          resourceIds: chunk.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          relations: [{ name: "cloudResources", select: { _id: true } }],
        });
      }),
    ),
    isPartial,
  );

  const truncations: Array<ResourceTopologyTruncation> =
    rows.count > rows.data.length
      ? [{ kind: "cloud.resource", shown: rows.data.length, total: rows.count }]
      : [];

  return {
    arrangements: [
      {
        id: "account",
        label: translationKey("Cloud Account"),
        graph: buildCloudAccountTopology({
          account: {
            id: accountId.toString(),
            name: (account.name as string) || "",
            provider,
            lastSeenAt: account.lastSeenAt || null,
          },
          resources,
          issues: issues.records,
          now: new Date(),
          truncations,
        }),
      },
    ],
    issuesArePartial: issues.isPartial,
    issuesAreUnreadable: areOpenIssuesUnreadable(issues),
    // A cloud account is not drawn on the master Topology.
    masterTopologyRoute: null,
  };
}
