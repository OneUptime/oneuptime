import { getStorageArrayBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
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

const StorageArrayViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);
  /*
   * The array's platform decides which inventory pages the side menu
   * offers: volumes, hosts, replication and directories on a FlashArray,
   * file systems and buckets on a FlashBlade. Undefined until it loads, so
   * the menu never flashes the other platform's pages.
   */
  const [storageSystem, setStorageSystem] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    const fetchStorageSystem: () => Promise<void> = async (): Promise<void> => {
      try {
        const item: StorageArray | null = await ModelAPI.getItem({
          modelType: StorageArray,
          id: modelId,
          select: {
            storageSystem: true,
          },
        });
        setStorageSystem(item?.storageSystem || "");
      } catch {
        // The platform is supplementary, don't fail the layout.
        setStorageSystem("");
      }
    };

    const fetchCounts: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * Reads counts from the StorageArrayResource inventory table — the
         * same source the overview page and the list pages use, so sidebar
         * badges can never drift from the page contents (single-source
         * rule, Ceph View/Layout.tsx precedent). The array row's own count
         * columns are written from the same upsert buffer by the ingest
         * path — never from here.
         */
        const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
          .addRoute("/storage-array-resource/inventory-summary/")
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
          volumes: readNum("volumeCount"),
          hosts: readNum("hostCount"),
          pods: readNum("podCount"),
          directories: readNum("directoryCount"),
          fileSystems: readNum("fileSystemCount"),
          buckets: readNum("bucketCount"),
          hardware:
            readNum("hardwareCount") +
            readNum("driveCount") +
            readNum("controllerCount") +
            readNum("networkInterfaceCount"),
          unhealthyHardware: readNum("unhealthyHardwareCount"),
        });
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchStorageSystem().catch(() => {});
    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="Storage Array"
      modelType={StorageArray}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getStorageArrayBreadcrumbs(path)}
      sideMenu={
        <SideMenu
          modelId={modelId}
          storageSystem={storageSystem}
          resourceCounts={resourceCounts}
        />
      }
    >
      <Outlet />
    </ModelPage>
  );
};

export default StorageArrayViewLayout;
