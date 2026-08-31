import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorTemplate?: MonitorTemplate | undefined;
  onNavigateComplete?: (() => void) | undefined;
}

/**
 * The template a monitor came from, as a table cell.
 *
 * Most monitors are not created from a template, so the empty case is the
 * common one and has to read as "no template" rather than as a missing value —
 * hence a dash rather than a blank cell.
 *
 * When there is one, it links to the template: the reason to look at this
 * column at all is usually to go and check what the template now says.
 */
const MonitorTemplateElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const templateName: string = props.monitorTemplate?.templateName || "";

  if (!templateName) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const templateId: string | undefined =
    props.monitorTemplate?._id?.toString() ||
    props.monitorTemplate?.id?.toString();

  /*
   * A monitor can carry a template name without the id being selected (a table
   * that asked for the name only). Showing the name unlinked beats hiding it.
   */
  if (!templateId) {
    return <span className="text-sm text-gray-900">{templateName}</span>;
  }

  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES_VIEW] as Route,
    {
      modelId: new ObjectID(templateId),
    },
  );

  return (
    <AppLink
      to={route}
      className="text-sm text-gray-900 hover:underline"
      onNavigateComplete={props.onNavigateComplete}
    >
      {templateName}
    </AppLink>
  );
};

export default MonitorTemplateElement;
