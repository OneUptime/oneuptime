import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { InvestigationEventReference } from "Common/Types/AI/InvestigationEvidence";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  reference: InvestigationEventReference;
  // The reference as the report wrote it, e.g. "#6954".
  text: string;
}

export const REFERENCE_LINK_CLASS_NAME: string =
  "inline-flex items-center rounded bg-indigo-50 px-1 font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100 hover:bg-indigo-100 hover:underline";

// "INC-6954 · Checkout latency above 2s · Resolved"
export function getReferenceLinkTitle(
  reference: InvestigationEventReference,
): string {
  return [reference.displayNumber, reference.title, reference.stateName]
    .filter((part: string | undefined): part is string => {
      return typeof part === "string" && part.trim().length > 0;
    })
    .join(" · ");
}

export function getReferenceRoute(
  reference: InvestigationEventReference,
): Route {
  const pageMapKey: PageMap =
    reference.kind === "alert" ? PageMap.ALERT_VIEW : PageMap.INCIDENT_VIEW;

  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(reference.id),
  });
}

/*
 * An incident or alert number inside the AI report ("prior: #6954"), linked to
 * its page. The report text only contributes the number: the id, title and
 * state come from rows the server resolved under the viewer's own permissions,
 * and the route is built here — never from a URL in the markdown.
 */
const InvestigationReferenceLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Link
      to={getReferenceRoute(props.reference)}
      className={REFERENCE_LINK_CLASS_NAME}
      title={getReferenceLinkTitle(props.reference)}
    >
      {props.text || props.reference.displayNumber}
    </Link>
  );
};

export default InvestigationReferenceLink;
