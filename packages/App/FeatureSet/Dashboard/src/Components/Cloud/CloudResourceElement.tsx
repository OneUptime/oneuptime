import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

/*
 * A cloud resource as a link to its page - the chip the Incident and Alert
 * tables, the monitor's Linked Resources and the affected-resources views
 * render for the `cloudResources` relation (DatabaseServerElement's twin).
 * Without an id (a relation row that could not be read) it degrades to the
 * plain name.
 */

export interface ComponentProps {
  cloudResource: CloudResource;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const CloudResourceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.cloudResource?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
          {
            modelId: new ObjectID(props.cloudResource._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Cloud} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.cloudResource.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.cloudResource?.name || ""}</span>;
};

export default CloudResourceElement;
