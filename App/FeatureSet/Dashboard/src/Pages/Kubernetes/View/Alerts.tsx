import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
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
import {
  getAllKubernetesAlertTemplates,
  KubernetesAlertTemplate,
  KubernetesAlertTemplateCategory,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import RouteMap from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";

const KubernetesClusterAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
          name: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found" />;
  }

  const allTemplates: Array<KubernetesAlertTemplate> =
    getAllKubernetesAlertTemplates();

  const categories: Array<KubernetesAlertTemplateCategory> = [
    "Workload",
    "Node",
    "ControlPlane",
    "Storage",
    "Scheduling",
  ];

  const getCategoryIcon = (
    category: KubernetesAlertTemplateCategory,
  ): IconProp => {
    switch (category) {
      case "Workload":
        return IconProp.Cube;
      case "Node":
        return IconProp.Server;
      case "ControlPlane":
        return IconProp.Settings;
      case "Storage":
        return IconProp.Disc;
      case "Scheduling":
        return IconProp.Clock;
      default:
        return IconProp.Alert;
    }
  };

  const getCategoryDescription = (
    category: KubernetesAlertTemplateCategory,
  ): string => {
    switch (category) {
      case "Workload":
        return "Monitor workload health including pod restarts, replica mismatches, and job failures.";
      case "Node":
        return "Monitor node health including CPU, memory, disk usage, and node readiness.";
      case "ControlPlane":
        return "Monitor Kubernetes control plane components including etcd, API server, and scheduler.";
      case "Storage":
        return "Monitor storage resources including disk usage and persistent volume claims.";
      case "Scheduling":
        return "Monitor pod scheduling including pending pods and scheduler backlog.";
      default:
        return "";
    }
  };

  return (
    <Fragment>
      <div className="mb-6">
        <p className="text-sm text-gray-500">
          Pre-built alert templates for common Kubernetes failure patterns. Click
          &quot;Create Monitor&quot; to set up monitoring for your cluster{" "}
          <strong>{cluster.name || cluster.clusterIdentifier}</strong>.
        </p>
      </div>

      {categories.map((category: KubernetesAlertTemplateCategory) => {
        const categoryTemplates: Array<KubernetesAlertTemplate> =
          allTemplates.filter(
            (t: KubernetesAlertTemplate) => t.category === category,
          );

        if (categoryTemplates.length === 0) {
          return null;
        }

        return (
          <Card
            key={category}
            title={
              <span className="flex items-center">
                <Icon icon={getCategoryIcon(category)} className="mr-2 h-4 w-4" />
                {category === "ControlPlane" ? "Control Plane" : category}
              </span>
            }
            description={getCategoryDescription(category)}
          >
            <div className="divide-y divide-gray-200">
              {categoryTemplates.map(
                (template: KubernetesAlertTemplate) => {
                  return (
                    <div
                      key={template.id}
                      className="flex items-center justify-between py-3 px-1"
                    >
                      <div className="flex-1">
                        <div className="flex items-center">
                          <span className="text-sm font-medium text-gray-900">
                            {template.name}
                          </span>
                          <span
                            className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              template.severity === "Critical"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {template.severity}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {template.description}
                        </p>
                      </div>
                      <div className="ml-4">
                        <Button
                          title="Create Monitor"
                          buttonStyle={ButtonStyleType.OUTLINE}
                          icon={IconProp.Add}
                          onClick={() => {
                            const baseRoute: string =
                              RouteMap[PageMap.MONITOR_CREATE]?.toString() || "";
                            const queryParams: string = `?monitorType=Kubernetes&templateId=${template.id}&clusterId=${cluster.clusterIdentifier || ""}`;
                            Navigation.navigate(
                              new Route(baseRoute + queryParams),
                            );
                          }}
                        />
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
        );
      })}
    </Fragment>
  );
};

export default KubernetesClusterAlerts;
