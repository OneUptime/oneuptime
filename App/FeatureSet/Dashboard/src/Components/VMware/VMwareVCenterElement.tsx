import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  vmwareVCenter: VMwareVCenter;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const VMwareVCenterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.vmwareVCenter?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route,
          {
            modelId: new ObjectID(props.vmwareVCenter._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.VMware} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.vmwareVCenter.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.vmwareVCenter?.name || ""}</span>;
};

export default VMwareVCenterElement;
