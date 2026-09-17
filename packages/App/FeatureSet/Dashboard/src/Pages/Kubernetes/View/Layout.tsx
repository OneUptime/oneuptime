import { getKubernetesBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";

const KubernetesClusterViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);

  useEffect(() => {
    const fetchCounts: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * Reads counts from the KubernetesResource inventory table — the
         * same source the overview page uses so sidebar badges and the
         * overview cards stay in lockstep. Previously this pulled from
         * ClickHouse metrics and k8sobjects logs, which drifted from the
         * Postgres snapshot (different lookback windows + dedup rules).
         */
        const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
          .addRoute("/kubernetes-resource/inventory-summary/")
          .addRoute(modelId.toString());

        const summaryResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: summaryUrl,
            data: {},
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (summaryResponse instanceof HTTPErrorResponse) {
          return;
        }

        const summary: JSONObject = summaryResponse.data;
        const readNum: (k: string) => number = (k: string): number => {
          const v: unknown = summary[k];
          return typeof v === "number" ? v : 0;
        };

        const nodeCount: number = readNum("nodeCount");
        const podCount: number = readNum("podCount");
        const namespaceCount: number = readNum("namespaceCount");

        setResourceCounts({
          nodes: nodeCount,
          pods: podCount,
          namespaces: namespaceCount,
          deployments: readNum("deploymentCount"),
          statefulSets: readNum("statefulSetCount"),
          daemonSets: readNum("daemonSetCount"),
          jobs: readNum("jobCount"),
          cronJobs: readNum("cronJobCount"),
          containers: readNum("containerCount"),
          pvcs: readNum("pvcCount"),
          pvs: readNum("pvCount"),
          hpas: readNum("hpaCount"),
          vpas: readNum("vpaCount"),
        });

        // Update cached counts on the cluster model for the clusters list table
        try {
          await ModelAPI.updateById({
            modelType: KubernetesCluster,
            id: modelId,
            data: {
              nodeCount,
              podCount,
              namespaceCount,
            },
          });
        } catch {
          // Updating cached counts is best-effort
        }
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="Kubernetes Cluster"
      modelType={KubernetesCluster}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getKubernetesBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default KubernetesClusterViewLayout;
