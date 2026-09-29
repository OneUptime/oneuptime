import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

/*
 * An SLO named inline, linking to its overview - the SLO's counterpart of
 * MonitorElement / ServiceElement, used wherever an SLO shows up as an
 * affected resource (an incident or alert its burn rate rules raised).
 *
 * Only `_id` and `name` are read. Those are the columns a relation select on
 * Incident or Alert may reach (ServiceLevelObjective flags them with
 * canReadOnRelationQuery), so this renders for an incident-only role that
 * cannot read the SLO itself. Such a user still gets the link; the SLO page
 * then applies its own permissions.
 */
export interface ComponentProps {
  serviceLevelObjective: ServiceLevelObjective;
  showIcon?: boolean | undefined;
  onNavigateComplete?: (() => void) | undefined;
}

const SloElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.serviceLevelObjective?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(RouteMap[PageMap.SLO_VIEW] as Route, {
          modelId: new ObjectID(props.serviceLevelObjective._id as string),
        })}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Gauge} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.serviceLevelObjective.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.serviceLevelObjective?.name || ""}</span>;
};

export default SloElement;
