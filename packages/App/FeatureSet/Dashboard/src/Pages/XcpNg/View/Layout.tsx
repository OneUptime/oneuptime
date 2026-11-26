import { getXcpNgBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The side menu's counts, from the pool's row. Undefined - no badge - for a
 * count the pool has not reported yet: a pool added ahead by its UUID says
 * nothing about its hosts until Xen Orchestra does.
 */
export function getXcpNgPoolResourceCounts(
  pool: Pick<XcpNgPool, "hostCount" | "vmCount" | "storageRepositoryCount">,
): ResourceCounts {
  const readCount: (value: unknown) => number | undefined = (
    value: unknown,
  ): number | undefined => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const count: number = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : undefined;
  };

  return {
    hosts: readCount(pool.hostCount),
    vms: readCount(pool.vmCount),
    storageRepositories: readCount(pool.storageRepositoryCount),
  };
}

const XcpNgPoolViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);

  useEffect(() => {
    /*
     * The pool's row carries its counts (XcpNgPool.hostCount, vmCount,
     * storageRepositoryCount), written by the ingest from the same read
     * that writes the XcpNgResource inventory the Hosts, VMs and Storage
     * pages list - so one small read, and the badges never drift from them.
     */
    ModelAPI.getItem<XcpNgPool>({
      modelType: XcpNgPool,
      id: modelId,
      select: {
        hostCount: true,
        vmCount: true,
        storageRepositoryCount: true,
      },
    })
      .then((pool: XcpNgPool | null) => {
        if (pool) {
          setResourceCounts(getXcpNgPoolResourceCounts(pool));
        }
      })
      .catch(() => {
        // Counts are supplementary, don't fail the layout.
      });
  }, [id]);

  return (
    <ModelPage
      title="XCP-ng Pool"
      modelType={XcpNgPool}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getXcpNgBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default XcpNgPoolViewLayout;
