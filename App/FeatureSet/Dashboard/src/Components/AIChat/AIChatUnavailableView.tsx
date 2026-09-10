import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AIChatUnavailableReason, {
  AIChatUnavailableCopy,
  getAIChatUnavailableCopy,
} from "./AIChatAvailability";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  reason: AIChatUnavailableReason;
}

/*
 * What Ask AI shows INSTEAD of the composer when AI is switched off for the
 * project.
 *
 * Ask AI used to look completely ready in this state: the hero invited a
 * question, the suggested prompts were clickable, and the only sign that AI
 * was off arrived as a red error banner after the user had already written
 * something. This view replaces the whole surface, so the answer to "why did
 * nothing happen?" is on screen before the question is asked — and it names
 * the settings page that owns the switch, because the person who hits this is
 * usually not the person who flipped it.
 */
const AIChatUnavailableView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: AIChatUnavailableCopy = getAIChatUnavailableCopy(props.reason);

  const actionRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[copy.actionPage as PageMap] as Route,
  );

  return (
    <div
      className="flex min-h-full w-full flex-1 flex-col items-center justify-center px-6 py-12 text-center"
      role="status"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
        <Icon icon={copy.icon} className="h-5 w-5 text-gray-400" />
      </div>

      <h3 className="mt-4 text-base font-semibold tracking-tight text-gray-900">
        {copy.title}
      </h3>

      <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-500">
        {copy.description}
      </p>

      <Link
        to={actionRoute}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
      >
        <Icon icon={IconProp.Settings} className="h-4 w-4" />
        <span>{copy.actionLabel}</span>
      </Link>
    </div>
  );
};

export default AIChatUnavailableView;
