import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackInstanceMetricsOptions,
  getDefaultOpenStackInstanceMetricsOptions,
  normalizeOpenStackInstanceMetricsOptions,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_INSTANCES_BY_PROJECT_SERIES,
  OPENSTACK_INSTANCES_BY_STATUS_SERIES,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  isOpenStackSummaryMode,
} from "../../../Types/OpenStack/OpenStackScale";
import { OpenStackServiceType } from "../../../Types/OpenStack/OpenStackResourceKind";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import logger from "../Logger";

/*
 * What ingest needs to know to treat a cloud past the summary size as one: whether it is, whose
 * instances keep their series anyway, and how often it should recount and write its counts. Read
 * once a minute per process at most, since a person sets it and a cloud does not cross the line
 * from one scrape to the next. If it cannot be read the cloud keeps its series: a bill that is
 * briefly too high is better than history that is gone.
 */

const CHOICE_CACHE_MS: number = 60 * 1000;

/*
 * How often a large cloud recounts its rows. A batch of a small cloud recounts every time, as it
 * always did: a recount of a few rows costs nothing and a page wants it now.
 */
const RECOUNT_EVERY_MS: number = 60 * 1000;
const LARGE_CLOUD_CACHE_MS: number = 30 * 60 * 1000;

// As often as the series they stand in for were, so a monitor's window holds the same points.
const SUMMARY_SERIES_EVERY_MS: number = 110 * 1000;

const SCOPE_NAME: string = "oneuptime-openstack-summary";

export interface OpenStackSummaryChoice {
  isSummaryMode: boolean;
  keptProjectIds: ReadonlySet<string>;
  cloudName: string;
}

const NOT_SUMMARY: OpenStackSummaryChoice = {
  isSummaryMode: false,
  keptProjectIds: new Set(),
  cloudName: "",
};

const choices: InMemoryTTLCache<OpenStackSummaryChoice> =
  new InMemoryTTLCache<OpenStackSummaryChoice>(5000);
const largeClouds: InMemoryTTLCache<boolean> = new InMemoryTTLCache<boolean>(
  5000,
);
const recountedAt: InMemoryTTLCache<boolean> = new InMemoryTTLCache<boolean>(
  5000,
);
const seriesWrittenAt: InMemoryTTLCache<boolean> =
  new InMemoryTTLCache<boolean>(5000);

function attribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

/*
 * One gauge per count. What each says is the state of the cloud's rows now, so they are stamped
 * with now, whichever batch happened to bring it to this.
 */
export function buildOpenStackSummaryResourceMetrics(data: {
  cloudName: string;
  now: Date;
  byStatus: ReadonlyArray<{
    regionName: string | null;
    status: string | null;
    count: number;
  }>;
  byProject: ReadonlyArray<{
    regionName: string | null;
    openStackProjectId: string;
    count: number;
  }>;
}): JSONArray {
  const timeUnixNano: string = `${data.now.getTime()}000000`;

  const point: (
    labels: Array<JSONObject>,
    regionName: string | null,
    count: number,
  ) => JSONObject = (
    labels: Array<JSONObject>,
    regionName: string | null,
    count: number,
  ): JSONObject => {
    return {
      attributes: [
        ...labels,
        ...(regionName ? [attribute("openstack.region.name", regionName)] : []),
        attribute("openstack_service", OpenStackServiceType.Compute),
      ],
      timeUnixNano: timeUnixNano,
      asDouble: count,
    };
  };

  return [
    {
      resource: {
        attributes: [attribute("openstack.cloud.name", data.cloudName)],
      },
      scopeMetrics: [
        {
          scope: { name: SCOPE_NAME },
          metrics: [
            {
              name: OPENSTACK_INSTANCES_BY_STATUS_SERIES,
              description: "How many instances are in each status.",
              gauge: {
                dataPoints: data.byStatus.map(
                  (row: {
                    regionName: string | null;
                    status: string | null;
                    count: number;
                  }): JSONObject => {
                    return point(
                      [attribute("status", row.status || "UNKNOWN")],
                      row.regionName,
                      row.count,
                    );
                  },
                ),
              },
            },
            {
              name: OPENSTACK_INSTANCES_BY_PROJECT_SERIES,
              description: "How many instances each project holds.",
              gauge: {
                dataPoints: data.byProject.map(
                  (row: {
                    regionName: string | null;
                    openStackProjectId: string;
                    count: number;
                  }): JSONObject => {
                    return point(
                      [attribute("tenant_id", row.openStackProjectId)],
                      row.regionName,
                      row.count,
                    );
                  },
                ),
              },
            },
          ],
        },
      ],
    },
  ];
}

export default class OpenStackSummaryMode {
  public static async readChoice(
    openStackCloudId: ObjectID,
  ): Promise<OpenStackSummaryChoice> {
    const key: string = openStackCloudId.toString();
    const cached: OpenStackSummaryChoice | undefined = choices.get(key);

    if (cached) {
      return cached;
    }

    let choice: OpenStackSummaryChoice = NOT_SUMMARY;

    try {
      const cloud: OpenStackCloud | null =
        await OpenStackCloudService.findOneById({
          id: openStackCloudId,
          select: {
            instanceMetricsOptions: true,
            instanceCount: true,
            name: true,
          },
          props: { isRoot: true },
        });
      const options: OpenStackInstanceMetricsOptions =
        normalizeOpenStackInstanceMetricsOptions(cloud?.instanceMetricsOptions)
          .options || getDefaultOpenStackInstanceMetricsOptions();

      choice = {
        isSummaryMode: isOpenStackSummaryMode({
          options: options,
          instanceCount: cloud?.instanceCount,
        }),
        keptProjectIds: new Set(options.projectIds),
        cloudName: cloud?.name || "",
      };
    } catch (err) {
      logger.warn(
        `Whether OpenStack cloud ${key} is in summary mode could not be read, so it keeps its series: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    choices.set(key, choice, CHOICE_CACHE_MS);

    return choice;
  }

  public static isRecountDue(openStackCloudId: ObjectID): boolean {
    const key: string = openStackCloudId.toString();

    return !(largeClouds.get(key) && recountedAt.get(key));
  }

  public static noteRecount(
    openStackCloudId: ObjectID,
    instanceCount: number,
  ): void {
    const key: string = openStackCloudId.toString();

    if (instanceCount > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT) {
      largeClouds.set(key, true, LARGE_CLOUD_CACHE_MS);
      recountedAt.set(key, true, RECOUNT_EVERY_MS);
    }
  }

  /*
   * The counts, when this cloud keeps them and it is time. Two processes can both decide it is
   * time: a count read twice in a minute is the same count, and nothing reads these with a Sum.
   */
  public static async getSeriesIfDue(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<JSONArray | null> {
    const key: string = data.openStackCloudId.toString();
    const choice: OpenStackSummaryChoice = await this.readChoice(
      data.openStackCloudId,
    );

    if (
      !choice.isSummaryMode ||
      !choice.cloudName ||
      seriesWrittenAt.get(key)
    ) {
      return null;
    }

    seriesWrittenAt.set(key, true, SUMMARY_SERIES_EVERY_MS);

    try {
      const counts: Awaited<
        ReturnType<typeof OpenStackResourceService.getInstanceCounts>
      > = await OpenStackResourceService.getInstanceCounts(data);

      return buildOpenStackSummaryResourceMetrics({
        cloudName: choice.cloudName,
        now: OneUptimeDate.getCurrentDate(),
        byStatus: counts.byStatus,
        byProject: counts.byProject,
      });
    } catch (err) {
      logger.warn(
        `OpenStack cloud ${key}'s summary counts were not written: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // For tests: each starts with nothing remembered.
  public static clear(): void {
    choices.clear();
    largeClouds.clear();
    recountedAt.clear();
    seriesWrittenAt.clear();
  }
}
