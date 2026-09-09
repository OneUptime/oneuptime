import { getVMwareBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
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

const VMwareVCenterViewLayout: FunctionComponent<
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
         * Reads counts from the VMwareResource inventory table — the
         * same source the overview page and the list pages use, so the
         * sidebar badges can never drift from them. The cached count
         * columns on the vCenter row (hostCount/vmCount/...) are
         * written by the ingest path from the SAME inventory buffer
         * (single-source rule), so no write-back is needed here.
         */
        const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
          .addRoute("/vmware-resource/inventory-summary/")
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
          hosts: readNum("hostCount"),
          // Non-template VMs — the same population the vCenter list counts.
          virtualMachines: readNum("virtualMachineCount"),
          datastores: readNum("datastoreCount"),
          clusters: readNum("clusterCount"),
          resourcePools: readNum("resourcePoolCount"),
        });
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="vCenter"
      modelType={VMwareVCenter}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getVMwareBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default VMwareVCenterViewLayout;
