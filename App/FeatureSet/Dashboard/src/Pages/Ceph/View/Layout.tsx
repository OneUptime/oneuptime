import { getCephBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
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

const CephClusterViewLayout: FunctionComponent<
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
         * Reads counts from the CephResource inventory table — the same
         * source the overview page and the list pages use, so sidebar
         * badges can never drift from the page contents (single-source
         * rule, K8s View/Layout.tsx precedent). The cluster row's own
         * count columns are written from the same upsert buffer by the
         * ingest path — never from here.
         */
        const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
          .addRoute("/ceph-resource/inventory-summary/")
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
          osds: readNum("osdCount"),
          pools: readNum("poolCount"),
          daemons:
            readNum("monCount") +
            readNum("mgrCount") +
            readNum("mdsCount") +
            readNum("rgwCount"),
        });
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="Ceph Cluster"
      modelType={CephCluster}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getCephBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default CephClusterViewLayout;
