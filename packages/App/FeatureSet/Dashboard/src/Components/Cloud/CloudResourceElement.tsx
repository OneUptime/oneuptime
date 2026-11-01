import { getCloudResourceViewRoute } from "../../Utils/CloudResourceViewPages";
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
 *
 * It opens the row in its own product - an environment in App Platforms, a
 * resource in Cloud - when the relation read the row's kind; otherwise in
 * Cloud, whose page forwards an environment to App Platforms.
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
        to={getCloudResourceViewRoute({
          cloudResourceKind: props.cloudResource.cloudResourceKind,
          modelId: new ObjectID(props.cloudResource._id as string),
        })}
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
