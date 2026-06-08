import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
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

const ServerlessFunctionOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [serverlessFunction, setServerlessFunction] =
    useState<ServerlessFunction | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: ServerlessFunction | null = await ModelAPI.getItem({
        modelType: ServerlessFunction,
        id: modelId,
        select: {
          name: true,
          description: true,
          functionIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          functionVersion: true,
          runtimeName: true,
          runtimeVersion: true,
          agentVersion: true,
        },
      });

      if (!item?.functionIdentifier) {
        setError("Serverless function not found.");
        setIsLoading(false);
        return;
      }

      setServerlessFunction(item);
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

  if (!serverlessFunction) {
    return <ErrorMessage message="Serverless function not found." />;
  }

  const fn: ServerlessFunction = serverlessFunction;
  const runtime: string = [fn.runtimeName, fn.runtimeVersion]
    .filter((s: string | undefined): boolean => {
      return Boolean(s);
    })
    .join(" ");
  const lastSeen: string = fn.lastSeenAt
    ? OneUptimeDate.fromNow(fn.lastSeenAt)
    : "never";

  return (
    <Fragment>
      <Card
        title={(fn.name as string) || "Serverless Function"}
        description={
          (fn.description as string) ||
          "Serverless / FaaS function auto-discovered from OpenTelemetry."
        }
      >
        <div className="border-t border-gray-200 divide-y divide-gray-100 -m-6 -mt-2">
          <DetailRow
            label="Function Identifier (faas.name)"
            value={fn.functionIdentifier as string}
          />
          <DetailRow
            label="Status"
            value={
              fn.otelCollectorStatus === "connected"
                ? "Connected"
                : "Disconnected"
            }
          />
          <DetailRow label="Last Seen" value={lastSeen} />
          <DetailRow
            label="Cloud Platform"
            value={fn.cloudPlatform as string}
          />
          <DetailRow
            label="Cloud Provider"
            value={fn.cloudProvider as string}
          />
          <DetailRow label="Cloud Region" value={fn.cloudRegion as string} />
          <DetailRow
            label="Cloud Account ID"
            value={fn.cloudAccountId as string}
          />
          <DetailRow
            label="Function Version (faas.version)"
            value={fn.functionVersion as string}
          />
          <DetailRow label="Runtime" value={runtime} />
          <DetailRow label="Agent Version" value={fn.agentVersion as string} />
        </div>
      </Card>
    </Fragment>
  );
};

export default ServerlessFunctionOverview;
