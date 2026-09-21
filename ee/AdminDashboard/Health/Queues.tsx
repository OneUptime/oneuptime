import BackgroundQueues from "./BackgroundQueues";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import HealthLicenseRequired, {
  HealthRequestError,
  toHealthRequestError,
} from "./HealthLicenseRequired";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Health > Background Queues content: the per-queue stats from
 * GET /admin/health/queues, with the failed-job drill-in. The core page keeps
 * the Health layout around it.
 */
const HealthQueuesContent: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<HealthRequestError | null>(null);

  const loadQueues: () => Promise<void> = async (): Promise<void> => {
    setError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/queues",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setData(response.data);
    } catch (err) {
      setError(toHealthRequestError(err));
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadQueues().catch(() => {
      // handled via setError
    });
  }, []);

  if (isInitialLoading && !data) {
    return <ComponentLoader />;
  }

  const queues: JSONArray = (data?.["queues"] || []) as JSONArray;

  // A 402 means the license, not the datastore: say so instead of the data.
  if (error?.isLicenseRequired) {
    return <HealthLicenseRequired />;
  }

  return (
    <div>
      {error ? (
        <Alert type={AlertType.DANGER} title={error.message} className="mb-5" />
      ) : (
        <></>
      )}

      <BackgroundQueues
        queues={queues}
        isRefreshing={isRefreshing}
        onRefresh={() => {
          setIsRefreshing(true);
          loadQueues().catch(() => {
            // handled via setError
          });
        }}
      />
    </div>
  );
};

export default HealthQueuesContent;
