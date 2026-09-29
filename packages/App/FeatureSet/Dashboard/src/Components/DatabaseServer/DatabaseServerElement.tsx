import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

/*
 * A database as a link to its page — the chip the Incident / Alert /
 * Scheduled Maintenance tables and the affected-resources views render for
 * the `databaseServers` relation. Without an id (a relation row that could
 * not be read) it degrades to the plain name.
 */

export interface ComponentProps {
  databaseServer: DatabaseServer;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const DatabaseServerElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.databaseServer?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route,
          {
            modelId: new ObjectID(props.databaseServer._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Database} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.databaseServer.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.databaseServer?.name || ""}</span>;
};

export default DatabaseServerElement;
