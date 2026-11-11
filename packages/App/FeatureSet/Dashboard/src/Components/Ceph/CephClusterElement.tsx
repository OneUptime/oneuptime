import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

export interface ComponentProps {
  cephCluster: CephCluster;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const CephClusterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.cephCluster?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route,
          {
            modelId: new ObjectID(props.cephCluster._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <RecordLinkName
          name={props.cephCluster.name}
          icon={props.showIcon ? IconProp.Ceph : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.cephCluster?.name || ""}</span>;
};

export default CephClusterElement;
