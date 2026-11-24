import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RecordAccess, {
  RecordAccessKind,
  RecordAccessResult,
} from "Common/Types/RecordAccess/RecordAccess";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What the reader may do on one record, from GET /<record>/record-access/:id
 * (Common/Types/RecordAccess/RecordAccess, #10272): asked once by the
 * record's view layout (RecordAccessScopeProvider).
 *
 * The route is written out rather than read from RecordAccess.routePath so
 * the tenant-header sweep (App/Tests/Dashboard/
 * ProjectScopedApiTenantHeader.test.ts) can see which route this call
 * reaches; a test pins the two together. The tenant header is what tells
 * the server which project the answer is for.
 */

// Each kind of record's API path: the record's own CRUD path.
export const RECORD_ACCESS_API_PATHS: Readonly<
  Record<RecordAccessKind, string>
> = {
  [RecordAccessKind.Incident]: "/incident",
  [RecordAccessKind.Alert]: "/alert",
  [RecordAccessKind.IncidentEpisode]: "/incident-episode",
  [RecordAccessKind.AlertEpisode]: "/alert-episode",
  [RecordAccessKind.ScheduledMaintenance]: "/scheduled-maintenance",
};

export const fetchRecordAccess: (data: {
  kind: RecordAccessKind;
  recordId: ObjectID | string;
}) => Promise<RecordAccessResult> = async (data: {
  kind: RecordAccessKind;
  recordId: ObjectID | string;
}): Promise<RecordAccessResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.get({
    url: URL.fromURL(APP_API_URL).addRoute(
      `${RECORD_ACCESS_API_PATHS[data.kind]}/record-access/${data.recordId.toString()}`,
    ),
    headers: ModelAPI.getCommonHeaders(),
  });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const result: RecordAccessResult | null = RecordAccess.fromJSON(
    response.data,
  );

  if (!result) {
    throw new Error(
      "What you may do on this record could not be read from the server's answer.",
    );
  }

  return result;
};
