import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  CLOUD_TAG_COVERAGE_ROUTE,
  CloudTagCoverageJSON,
  readCloudTagCoverage,
} from "Common/Types/Cloud/CloudTagCoverage";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What Cloud > Tags and an account's Tags read (#11012): the server's one
 * read of coverage (CloudRequiredTagAPI), as the reader may read the
 * accounts, read back with care. React-free: App tests read it too.
 */
export async function fetchCloudTagCoverage(data: {
  cloudAccountId?: ObjectID | null | undefined;
}): Promise<CloudTagCoverageJSON> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `/cloud-required-tag/${CLOUD_TAG_COVERAGE_ROUTE}`,
      ),
      data: data.cloudAccountId
        ? { cloudAccountId: data.cloudAccountId.toString() }
        : {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readCloudTagCoverage(response.data);
}
