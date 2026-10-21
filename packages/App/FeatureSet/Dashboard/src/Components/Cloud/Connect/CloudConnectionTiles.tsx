import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudConnectionCatalog,
  CloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import CloudConnectionLogo from "./CloudConnectionLogo";

/*
 * The three clouds, one tile each: what connecting it brings in, and
 * whether the project has connected it already. A click opens that cloud's
 * guided form. A cloud can be connected more than once (two AWS accounts,
 * two Azure tenants).
 *
 * Side by side only from xl: beside the side menu, a 768-1279px window
 * leaves each of three tiles a column too narrow for its words (one word a
 * line at 768), so they stack until the card is wide enough.
 */
export const CLOUD_TILES_GRID_CLASS: string =
  "grid grid-cols-1 gap-3 xl:grid-cols-3";

export interface ComponentProps {
  connectionCounts: Partial<Record<CloudProvider, number>>;
  canConnect: boolean;
  connectDisabledReason?: string | undefined;
  onConnect: (provider: CloudProvider) => void;
}

const CloudConnectionTiles: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul className={CLOUD_TILES_GRID_CLASS} data-testid="cloud-connection-tiles">
      {CloudConnectionCatalog.map(
        (definition: CloudConnectionDefinition): ReactElement => {
          const count: number =
            props.connectionCounts[definition.provider] || 0;

          const tile: ReactElement = (
            <button
              type="button"
              disabled={!props.canConnect}
              data-testid={`cloud-connection-tile-${definition.provider}`}
              onClick={() => {
                props.onConnect(definition.provider);
              }}
              className="flex h-full w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CloudConnectionLogo provider={definition.provider} size="lg" />
              {/* A column, so each tile's Connect sits on the same line. */}
              <div className="flex h-full min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-gray-900">
                    {translator.translateText(definition.title)}
                  </span>
                  {count > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                      data-testid={`cloud-connection-tile-connected-${definition.provider}`}
                    >
                      <Icon icon={IconProp.Check} className="h-3 w-3" />
                      {count > 1
                        ? translator.translateTemplate(
                            "Connected ({{count}})",
                            { count: String(count) },
                          )
                        : translator.translateText("Connected")}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
                <div className="mt-1 text-sm text-gray-600">
                  {translator.translateText(definition.description)}
                </div>
                <div className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium text-indigo-600">
                  {count > 0
                    ? translator.translateText("Connect another")
                    : translator.translateText("Connect")}
                  <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
                </div>
              </div>
            </button>
          );

          return (
            <li key={definition.provider} className="min-w-0">
              {!props.canConnect && props.connectDisabledReason ? (
                <Tooltip text={props.connectDisabledReason}>{tile}</Tooltip>
              ) : (
                tile
              )}
            </li>
          );
        },
      )}
    </ul>
  );
};

export default CloudConnectionTiles;
