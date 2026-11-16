import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  SLO_MONTHLY_REPORT_ROUTE,
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  getSloMonthlyReportPeriodQuery,
  parseSloMonthlyReport,
} from "Common/Utils/Slo/SloMonthlyReport";

/*
 * An SLO's monthly report, as the API measures it when asked
 * (Common/Server/API/ServiceLevelObjectiveAPI):
 *
 *   GET /service-level-objective/:id/monthly-report?months=12 | ?year=2025
 *
 * A refusal throws the error response, whose message is the server's
 * sentence (API.getFriendlyMessage reads it).
 */

export const SLO_MONTHLY_REPORT_UNREADABLE_MESSAGE: string =
  "The server's answer was not a monthly report. Reload the page, and if it happens again, check that the server and the Dashboard are the same version.";

export const getSloMonthlyReportUrl: (sloId: ObjectID) => URL = (
  sloId: ObjectID,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `/service-level-objective/${sloId.toString()}${SLO_MONTHLY_REPORT_ROUTE}`,
  );
};

export const fetchSloMonthlyReport: (data: {
  sloId: ObjectID;
  period: SloMonthlyReportPeriod;
}) => Promise<SloMonthlyReport> = async (data: {
  sloId: ObjectID;
  period: SloMonthlyReportPeriod;
}): Promise<SloMonthlyReport> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: getSloMonthlyReportUrl(data.sloId),
      headers: ModelAPI.getCommonHeaders(),
      params: getSloMonthlyReportPeriodQuery(data.period),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const report: SloMonthlyReport | null = parseSloMonthlyReport(response.data);

  if (!report) {
    throw new BadDataException(SLO_MONTHLY_REPORT_UNREADABLE_MESSAGE);
  }

  return report;
};
