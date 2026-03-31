import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import MonitorMetricsElement from "../../../Components/Monitor/MonitorMetrics";
import MonitorIncidentMetrics from "../../../Components/Monitor/MonitorIncidentMetrics";
import MonitorAlertMetrics from "../../../Components/Monitor/MonitorAlertMetrics";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

const MonitorMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [, setCurrentTab] = useState<Tab | null>(null);
  const [monitorType, setMonitorType] = useState<MonitorType | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setIsLoading(true);
    ModelAPI.getItem({
      modelType: Monitor,
      id: modelId,
      select: { monitorType: true },
    })
      .then((item: Monitor | null) => {
        setMonitorType(item?.monitorType || null);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const hasMonitorMetrics: boolean =
    monitorType !== null &&
    MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(monitorType)
      .length > 0;

  const tabs: Array<Tab> = [];

  if (hasMonitorMetrics) {
    tabs.push({
      name: "Monitor Metrics",
      children: <MonitorMetricsElement monitorId={modelId} />,
    });
  }

  tabs.push({
    name: "Incident Metrics",
    children: <MonitorIncidentMetrics monitorId={modelId} />,
  });

  tabs.push({
    name: "Alert Metrics",
    children: <MonitorAlertMetrics monitorId={modelId} />,
  });

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <Tabs
        tabs={tabs}
        onTabChange={(tab: Tab) => {
          setCurrentTab(tab);
        }}
      />
    </Fragment>
  );
};

export default MonitorMetrics;
