import { getMonitorBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import SideMenu from "./SideMenu";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement, useState } from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { Outlet, useParams } from "react-router-dom";
import useAsyncEffect from "use-async-effect";

const MonitorViewLayout: FunctionComponent = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    await fetchItem();
  }, []);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
        },
      });

      setMonitor(item);

      if (!item) {
        setError(ExceptionMessages.MonitorNotFound);

        return;
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading || !monitor?.monitorType) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <ModelPage
      title="Monitor"
      modelType={Monitor}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getMonitorBreadcrumbs(path)}
      sideMenu={
        <SideMenu monitorType={monitor?.monitorType} modelId={modelId} />
      }
    >
      <Outlet />
    </ModelPage>
  );
};

export default MonitorViewLayout;
