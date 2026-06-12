import { getProxmoxBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
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

const ProxmoxClusterViewLayout: FunctionComponent<
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
         * Reads counts from the ProxmoxResource inventory table — the
         * same source the overview page and the list pages use, so the
         * sidebar badges can never drift from them. The cached count
         * columns on the cluster row (nodeCount/guestCount/...) are
         * written by the ingest path from the SAME inventory buffer
         * (single-source rule), so no write-back is needed here —
         * unlike the K8s layout, which updates them client-side.
         */
        const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
          .addRoute("/proxmox-resource/inventory-summary/")
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

        setResourceCounts({
          nodes: readNum("nodeCount"),
          guests: readNum("guestCount"),
          storages: readNum("storageCount"),
        });
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="Proxmox Cluster"
      modelType={ProxmoxCluster}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getProxmoxBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default ProxmoxClusterViewLayout;
