import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

export interface ComponentProps {
  xcpNgPool: XcpNgPool;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

/*
 * An XCP-ng pool named as a link to its own page: in an incident's,
 * alert's or maintenance event's affected resources, a monitor's linked
 * resources and every list that names the pools a record is about. A pool
 * read without its id (a name alone) is drawn as text.
 */
const XcpNgPoolElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.xcpNgPool?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
          {
            modelId: new ObjectID(props.xcpNgPool._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <RecordLinkName
          name={props.xcpNgPool.name}
          icon={props.showIcon ? IconProp.XcpNg : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.xcpNgPool?.name || ""}</span>;
};

export default XcpNgPoolElement;
