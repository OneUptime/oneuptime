import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import {
  OpenShiftKind,
  OpenShiftRouteObject,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import {
  OpenShiftRouteTarget,
  getRouteHost,
  getRouteTargets,
  getRouteTlsLabel,
} from "../Utils/KubernetesOpenShiftResources";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const KubernetesClusterOpenShiftRoutes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const routeList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: OpenShiftKind.Route,
          selectFullSpec: true,
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const route: Pick<OpenShiftRouteObject, "spec" | "status"> = {
              spec: (row.spec || {}) as unknown as OpenShiftRouteObject["spec"],
              status: (row.status ||
                {}) as unknown as OpenShiftRouteObject["status"],
            };

            resource.status = row.phase || "";
            resource.additionalAttributes["host"] = getRouteHost(route);
            resource.additionalAttributes["service"] = getRouteTargets(route)
              .map((target: OpenShiftRouteTarget): string => {
                return target.name;
              })
              .join(", ");
            resource.additionalAttributes["tls"] =
              translator.translateText(
                getRouteTlsLabel(route.spec.tlsTermination),
              ) || getRouteTlsLabel(route.spec.tlsTermination);
          },
        });

      setResources(routeList);
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

  return (
    <KubernetesResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Routes"
      description="How traffic reaches this cluster's Services through OpenShift's routers."
      resources={resources}
      showResourceMetrics={false}
      emptyMessage="No Routes yet. OpenShift's Routes appear here once the kubernetes-agent runs with preset=openshift."
      columns={[
        { title: "Host", key: "host" },
        { title: "Service", key: "service" },
        { title: "TLS", key: "tls" },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        ).addQueryParams({ namespace: resource.namespace });
      }}
    />
  );
};

export default KubernetesClusterOpenShiftRoutes;
