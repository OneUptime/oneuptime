/*
 * The records Run Workflow can run a record trigger with, from the workflow
 * service's /run-records (App/FeatureSet/Workflow/API/RunRecords): the
 * newest ones, or the ones a search finds by number, name or ID. The project
 * goes in the tenant header, like any other read of the project's data.
 */

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  RunRecordOption,
  parseRunRecordSearchResponse,
} from "../../../Types/Workflow/RunRecord";
import { WORKFLOW_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";

export type LoadRunRecordsFunction = (data: {
  workflowId: ObjectID;
  search: string;
}) => Promise<Array<RunRecordOption>>;

export const loadRunRecords: LoadRunRecordsFunction = async (data: {
  workflowId: ObjectID;
  search: string;
}): Promise<Array<RunRecordOption>> => {
  const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
        `/run-records/${data.workflowId.toString()}`,
      ),
      data: { search: data.search },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (result instanceof HTTPErrorResponse) {
    throw result;
  }

  return parseRunRecordSearchResponse(result.data);
};
