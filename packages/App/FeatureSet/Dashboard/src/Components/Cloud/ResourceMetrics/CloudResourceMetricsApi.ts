import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  readCloudAddedMetrics,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  CloudAddedMetricReaders,
  readCloudAddedMetricReaders,
} from "Common/Types/Cloud/CloudAddedMetricReaders";
import {
  CloudPublishedMetricsListing,
  readCloudPublishedMetricsListing,
} from "Common/Types/Cloud/CloudPublishedMetrics";
import {
  CloudUnreportedKeyMetricReport,
  readCloudUnreportedKeyMetricReports,
} from "Common/Types/Cloud/CloudUnreportedKeyMetrics";
import {
  CloudResourceMetricCollection,
  readCloudResourceMetricCollection,
} from "Common/Types/Cloud/CloudResourceMetricCollection";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The calls a cloud resource's pages make about its metrics beyond its key
 * metrics (CloudConnectionAPI's resource-metrics routes): what it
 * publishes, asked of its cloud now (#9563); adding one of them to what its
 * connection reads, and removing it; why it did not report some of its
 * key metrics (#9569); and how its metrics were collected (#10291).
 */

export const CLOUD_RESOURCE_METRICS_API_PATH: string =
  "/cloud-connection/resource-metrics";

async function post(
  cloudResourceId: ObjectID,
  action: string,
  data: JSONObject,
): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `${CLOUD_RESOURCE_METRICS_API_PATH}/${cloudResourceId.toString()}/${action}`,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data || {};
}

// What the resource publishes, asked of its cloud now.
export async function listCloudResourcePublishedMetrics(
  cloudResourceId: ObjectID,
): Promise<CloudPublishedMetricsListing> {
  const listing: CloudPublishedMetricsListing | null =
    readCloudPublishedMetricsListing(
      await post(cloudResourceId, "published", {}),
    );

  if (!listing) {
    throw new Error(
      "The server did not answer with the metrics this resource publishes. Try again.",
    );
  }

  return listing;
}

// Adds one to what its connection reads; the connection's additions after.
export async function addCloudResourceMetric(data: {
  cloudResourceId: ObjectID;
  name: string;
  namespace?: string | undefined;
  scope: CloudAddedMetricScope;
  aggregation?: string | undefined;
  // The dimension to split it by (#9808).
  splitBy?: string | undefined;
}): Promise<Array<CloudAddedMetric>> {
  const answer: JSONObject = await post(data.cloudResourceId, "add", {
    name: data.name,
    scope: data.scope,
    ...(data.namespace ? { namespace: data.namespace } : {}),
    ...(data.aggregation ? { aggregation: data.aggregation } : {}),
    ...(data.splitBy ? { splitBy: data.splitBy } : {}),
  });

  return readCloudAddedMetrics(answer["addedMetrics"]);
}

/*
 * What reads one of the additions that apply to the resource, by its key:
 * the monitors, dashboard widgets and SLOs that get no new data once it is
 * removed (#9807).
 */
export async function findCloudResourceMetricReaders(data: {
  cloudResourceId: ObjectID;
  key: string;
}): Promise<CloudAddedMetricReaders> {
  const readers: CloudAddedMetricReaders | null = readCloudAddedMetricReaders(
    await post(data.cloudResourceId, "readers", { key: data.key }),
  );

  if (!readers) {
    throw new Error(
      "The server did not answer with what reads this metric. Try again.",
    );
  }

  return readers;
}

// Removes one of the additions that apply to the resource, by its key.
export async function removeCloudResourceMetric(data: {
  cloudResourceId: ObjectID;
  key: string;
}): Promise<Array<CloudAddedMetric>> {
  const answer: JSONObject = await post(data.cloudResourceId, "remove", {
    key: data.key,
  });

  return readCloudAddedMetrics(answer["addedMetrics"]);
}

/*
 * Keeps a metric added for every resource of its type for some of them
 * alone (#10078): the ones its readers read it of.
 */
export async function keepCloudResourceMetricFor(data: {
  cloudResourceId: ObjectID;
  key: string;
  cloudResourceIds: Array<string>;
}): Promise<Array<CloudAddedMetric>> {
  const answer: JSONObject = await post(data.cloudResourceId, "keep-for", {
    key: data.key,
    cloudResourceIds: data.cloudResourceIds,
  });

  return readCloudAddedMetrics(answer["addedMetrics"]);
}

// When each of its key metrics it did not report last did, and why.
export async function explainCloudResourceUnreportedKeyMetrics(data: {
  cloudResourceId: ObjectID;
  keys: Array<string>;
}): Promise<Array<CloudUnreportedKeyMetricReport>> {
  return readCloudUnreportedKeyMetricReports(
    await post(data.cloudResourceId, "unreported", { keys: data.keys }),
  );
}

/*
 * How its metrics were collected (#10291): when its connection last read
 * them, and what it could not. Null where its reads keep nothing to say.
 */
export async function getCloudResourceMetricCollection(
  cloudResourceId: ObjectID,
): Promise<CloudResourceMetricCollection | null> {
  return readCloudResourceMetricCollection(
    await post(cloudResourceId, "collection", {}),
  );
}
