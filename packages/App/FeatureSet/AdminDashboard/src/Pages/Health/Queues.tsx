import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import BackgroundQueues from "./BackgroundQueues";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const QueuesContent: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadQueues: () => Promise<void> = async (): Promise<void> => {
    setError("");

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
      setError(API.getFriendlyMessage(err));
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

  return (
    <div>
      {error ? (
        <Alert type={AlertType.DANGER} title={error} className="mb-5" />
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

const HealthQueues: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Background Queues"
      currentRoute={RouteMap[PageMap.HEALTH_QUEUES] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Background queue health"
      enterpriseFeatureDescription="Job backlog and failures across the BullMQ workers, with a drill-in to the recent failed-job logs for any queue reporting failures."
    >
      <QueuesContent />
    </HealthPage>
  );
};

export default HealthQueues;
