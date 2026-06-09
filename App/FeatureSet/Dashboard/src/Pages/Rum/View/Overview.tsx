import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationClient from "Common/Models/DatabaseModels/RumApplicationClient";
import React, {
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
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
} from "../../../Components/TelemetryResource/ResourceOverview";

const RumApplicationOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [clientCount, setClientCount] = useState<number | null>(null);
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
          sdkLanguage: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentVersion: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.appIdentifier) {
        setError("RUM application not found.");
        setIsLoading(false);
        return;
      }

      setRumApplication(item);

      try {
        const count: number = await ModelAPI.count({
          modelType: RumApplicationClient,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: { rumApplicationId: modelId } as any,
        });
        setClientCount(count);
      } catch {
        setClientCount(0);
      }
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

  const chips: Array<ResourceOverviewChip> = [];
  if (a.clientType) {
    chips.push({ icon: IconProp.Window, label: String(a.clientType) });
  }

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "App Identifier (service.name)", value: a.appIdentifier },
    { label: "Client Type", value: a.clientType },
    { label: "SDK Language (telemetry.sdk.language)", value: a.sdkLanguage },
    { label: "SDK Version", value: a.agentVersion },
  ];

  return (
    <ResourceOverview
      icon={IconProp.Globe}
      title={(a.name as string) || "RUM Application"}
      identifier={(a.appIdentifier as string) || ""}
      identifierLabel="service.name"
      status={a.otelCollectorStatus}
      lastSeenAt={a.lastSeenAt}
      description={a.description as string}
      chips={chips}
      telemetryServiceId={modelId}
      metricsRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS] as Route,
        { modelId },
      )}
      logsRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATION_VIEW_LOGS] as Route,
        { modelId },
      )}
      tracesRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATION_VIEW_TRACES] as Route,
        { modelId },
      )}
      inventoryTile={{
        title: "Clients",
        icon: IconProp.Globe,
        count: clientCount,
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATION_VIEW_CLIENTS] as Route,
          { modelId },
        ),
      }}
      detailRows={detailRows}
      labels={a.labels}
    />
  );
};

export default RumApplicationOverview;
