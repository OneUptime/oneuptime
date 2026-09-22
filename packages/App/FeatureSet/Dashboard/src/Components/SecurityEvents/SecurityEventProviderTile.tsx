import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEventConnectorDefinition } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslateValue from "Common/UI/Utils/Translation";
import { connectorDocsUrl } from "./SecurityEventConnectionDiagnosticsUtil";

export interface ComponentProps {
  // Prefix of the element ids, so two galleries on a page cannot collide.
  idPrefix: string;
  definition: SecurityEventConnectorDefinition;
  // False for a member who cannot create connections: the tile is static.
  canConnect: boolean;
  onConnect: () => void;
}

/*
 * One product in the Connections empty state.
 *
 * Clicking anywhere on the tile starts a connection for that product,
 * through a stretched button (its ::after covers the tile). The setup guide
 * is a separate link raised above that overlay, so the two actions are
 * siblings, never one control inside the other.
 *
 * Below lg the tile is a row: badge, name over "category · Setup guide",
 * and the plus at the end. At lg the grid has four columns, too narrow for
 * "Splunk Enterprise Security" beside a badge, so the tile stands upright
 * (badge and plus on top, the name under them at the tile's full width) and
 * every name stays on one line. The same three children are placed on a
 * grid in both, so nothing is duplicated or reordered for either.
 *
 * Colour classes are literal and limited to ones Theme.css re-colours for
 * dark mode. Every hover colour on an icon sits on the icon alone, with the
 * resting grey on its wrapper: text-gray-* and group-hover:text-indigo-* on
 * one element turn near-white on hover in the dark theme.
 */
const SecurityEventProviderTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const definition: SecurityEventConnectorDefinition = props.definition;
  const categoryId: string = `${props.idPrefix}-provider-${definition.provider}-category`;

  return (
    <li
      data-testid={`${props.idPrefix}-provider-${definition.provider}`}
      className={
        props.canConnect
          ? "group relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors duration-150 ease-out hover:border-indigo-300 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-y-3 lg:p-4"
          : "relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-lg border border-gray-200 bg-white p-3 lg:items-start lg:gap-y-3 lg:p-4"
      }
    >
      <div
        aria-hidden="true"
        className={
          props.canConnect
            ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200 transition-colors duration-150 ease-out group-hover:bg-indigo-50"
            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200"
        }
      >
        <Icon
          icon={definition.icon}
          className={
            props.canConnect ? "h-5 w-5 group-hover:text-indigo-600" : "h-5 w-5"
          }
        />
      </div>

      <div className="min-w-0 lg:col-span-2 lg:row-start-2">
        {props.canConnect ? (
          <button
            type="button"
            data-provider-tile={definition.provider}
            aria-describedby={categoryId}
            onClick={props.onConnect}
            className="block max-w-full text-left text-sm font-semibold text-gray-900 after:absolute after:inset-0 after:rounded-lg after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
          >
            <span className="sr-only">{translateString("Connect")} </span>
            {/* A product name is a brand, never translated. */}
            {definition.title}
          </button>
        ) : (
          <p className="text-sm font-semibold text-gray-900">
            {definition.title}
          </p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-gray-500">
          <span id={categoryId}>{translateString(definition.category)}</span>
          {/* A dot, not a slash: "EDR / XDR" already has one. */}
          <span aria-hidden="true">&middot;</span>
          <Link
            to={connectorDocsUrl(definition)}
            openInNewTab={true}
            className="relative z-10 inline-flex items-center gap-1 rounded font-medium hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="sr-only">{definition.title} </span>
            {translateString("Setup guide")}
            <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
            <span className="sr-only">
              {" "}
              {translateString("(opens in a new tab)")}
            </span>
          </Link>
        </div>
      </div>

      {props.canConnect && (
        <div
          aria-hidden="true"
          className="text-gray-400 lg:col-start-2 lg:row-start-1 lg:self-center lg:justify-self-end"
        >
          <Icon
            icon={IconProp.Add}
            className="h-4 w-4 group-hover:text-indigo-600"
          />
        </div>
      )}
    </li>
  );
};

export default SecurityEventProviderTile;
