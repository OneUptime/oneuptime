import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import OneUptimeDate from "Common/Types/Date";

const DetailRow: FunctionComponent<{
  label: string;
  value: string | undefined;
}> = (props: { label: string; value: string | undefined }): ReactElement => {
  return (
    <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{props.label}</dt>
      <dd className="mt-1 text-sm text-gray-900 sm:col-span-2 sm:mt-0 font-mono break-all">
        {props.value && props.value.length > 0 ? props.value : "—"}
      </dd>
    </div>
  );
};

const RumApplicationOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: RumApplication | null = await ModelAPI.getItem({
        modelType: RumApplication,
        id: modelId,
        select: {
          name: true,
          description: true,
          appIdentifier: true,
          clientType: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentVersion: true,
        },
      });

      if (!item?.appIdentifier) {
        setError("RUM application not found.");
        setIsLoading(false);
        return;
      }

      setRumApplication(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!rumApplication) {
    return <ErrorMessage message="RUM application not found." />;
  }

  const a: RumApplication = rumApplication;
  const lastSeen: string = a.lastSeenAt
    ? OneUptimeDate.fromNow(a.lastSeenAt)
    : "never";

  return (
    <Fragment>
      <Card
        title={(a.name as string) || "RUM Application"}
        description={
          (a.description as string) ||
          "Browser / mobile application auto-discovered from OpenTelemetry RUM telemetry."
        }
      >
        <div className="border-t border-gray-200 divide-y divide-gray-100 -m-6 -mt-2">
          <DetailRow
            label="App Identifier (service.name)"
            value={a.appIdentifier as string}
          />
          <DetailRow label="Client Type" value={a.clientType as string} />
          <DetailRow
            label="Status"
            value={
              a.otelCollectorStatus === "connected"
                ? "Connected"
                : "Disconnected"
            }
          />
          <DetailRow label="Last Seen" value={lastSeen} />
          <DetailRow label="SDK Version" value={a.agentVersion as string} />
        </div>
      </Card>
    </Fragment>
  );
};

export default RumApplicationOverview;
