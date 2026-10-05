import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  storageArray: StorageArray;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

// A storage array's name, linking to its overview (CephClusterElement's twin).
const StorageArrayElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.storageArray?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
          {
            modelId: new ObjectID(props.storageArray._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.StorageArray} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.storageArray.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.storageArray?.name || ""}</span>;
};

export default StorageArrayElement;
