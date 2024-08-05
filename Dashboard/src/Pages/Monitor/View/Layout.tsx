import { getMonitorBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import SideMenu from "./SideMenu";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import ModelPage from "CommonUI/src/Components/Page/ModelPage";
import API from "CommonUI/src/Utils/API/API";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "CommonUI/src/Utils/Navigation";
import Monitor from "Common/AppModels/Models/Monitor";
import React, { FunctionComponent, ReactElement, useState } from "react";
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
        setError(`Monitor not found`);

        return;
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (error) {
    return <ErrorMessage error={error} />;
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
