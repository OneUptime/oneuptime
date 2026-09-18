import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

export type SloOverviewActionLinkVariant = "primary" | "secondary" | "text";

/*
 * Literal class names per variant so the runtime Tailwind scanner sees each
 * one, built only from classes Theme.css already remaps for dark mode.
 */
const VARIANT_CLASS_NAMES: Record<SloOverviewActionLinkVariant, string> = {
  primary:
    "inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
  secondary:
    "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
  text: "inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
};

const ICON_CLASS_NAMES: Record<SloOverviewActionLinkVariant, string> = {
  primary: "h-4 w-4 flex-shrink-0 text-white",
  secondary: "h-4 w-4 flex-shrink-0 text-gray-500",
  text: "h-4 w-4 flex-shrink-0",
};

export interface ComponentProps {
  title: string;
  to: Route;
  variant?: SloOverviewActionLinkVariant | undefined;
  icon?: IconProp | undefined;
  className?: string | undefined;
}

/*
 * Every call to action on the SLO overview points at another SLO page, so
 * each one is a real link — an <a href> that opens in a new tab on a middle
 * or modifier click and is announced as a link — styled as a button where
 * it is the primary thing to do. A Button with an onClick navigate would
 * lose both.
 */
const SloOverviewActionLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const variant: SloOverviewActionLinkVariant = props.variant || "text";

  return (
    <Link
      to={props.to}
      className={`${VARIANT_CLASS_NAMES[variant]} ${props.className || ""}`}
    >
      {props.icon ? (
        <Icon icon={props.icon} className={ICON_CLASS_NAMES[variant]} />
      ) : (
        <></>
      )}
      <span>{props.title}</span>
    </Link>
  );
};

export default SloOverviewActionLink;
