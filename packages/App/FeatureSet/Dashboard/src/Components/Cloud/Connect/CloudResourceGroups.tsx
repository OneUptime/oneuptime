import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudConnectionRegionCount,
  CloudConnectionTypeCount,
} from "Common/Types/CloudConnection/CloudConnectionTest";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getResourceTypeEntries } from "./CloudConnectionWords";

/*
 * A cloud account's resources at a glance, grouped the way people think
 * of them: by service ("Virtual Machine 12", "SQL Database 3") and by
 * region, most first - the resources themselves are under Cloud > All
 * Resources. Compact, it shows the first few of each and how many more.
 */

export interface ComponentProps {
  provider: CloudProvider | string;
  resourceTypes: Array<CloudConnectionTypeCount>;
  regions: Array<CloudConnectionRegionCount>;
  accounts?: Array<string> | undefined;
  compact?: boolean | undefined;
}

const COMPACT_COUNT: number = 3;

const CloudResourceGroups: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const types: Array<{ label: string; count: number }> =
    getResourceTypeEntries({
      provider: props.provider,
      resourceTypes: props.resourceTypes,
    });
  const regions: Array<CloudConnectionRegionCount> = props.regions.filter(
    (entry: CloudConnectionRegionCount): boolean => {
      return Boolean(entry.region);
    },
  );
  const shownTypes: Array<{ label: string; count: number }> = props.compact
    ? types.slice(0, COMPACT_COUNT)
    : types;
  const shownRegions: Array<CloudConnectionRegionCount> = props.compact
    ? regions.slice(0, COMPACT_COUNT)
    : regions;

  const chip: (label: string, count: number, key: string) => ReactElement = (
    label: string,
    count: number,
    key: string,
  ): ReactElement => {
    return (
      <li
        key={key}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
      >
        <span className="truncate">{label}</span>
        <span className="font-semibold text-gray-900">
          {translator.formatNumber(count)}
        </span>
      </li>
    );
  };

  const more: (hidden: number) => ReactElement = (
    hidden: number,
  ): ReactElement => {
    return hidden > 0 ? (
      <li className="inline-flex items-center px-1 text-xs text-gray-500">
        {translator.translatePlural(
          { one: "+{{count}} more", other: "+{{count}} more" },
          hidden,
        )}
      </li>
    ) : (
      <></>
    );
  };

  return (
    <div className="space-y-2" data-testid="cloud-resource-groups">
      {shownTypes.length > 0 ? (
        <div>
          {props.compact ? (
            <></>
          ) : (
            <div className="mb-1 text-xs font-medium text-gray-500">
              {translator.translateText("By service")}
            </div>
          )}
          <ul
            className="flex flex-wrap gap-1.5"
            data-testid="cloud-resource-groups-types"
          >
            {shownTypes.map(
              (entry: { label: string; count: number }): ReactElement => {
                // The cloud's own names for its services, as All Resources shows them.
                return chip(entry.label, entry.count, `type-${entry.label}`);
              },
            )}
            {more(types.length - shownTypes.length)}
          </ul>
        </div>
      ) : (
        <></>
      )}

      {!props.compact && shownRegions.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-medium text-gray-500">
            {translator.translateText("By region")}
          </div>
          <ul
            className="flex flex-wrap gap-1.5"
            data-testid="cloud-resource-groups-regions"
          >
            {shownRegions.map(
              (entry: CloudConnectionRegionCount): ReactElement => {
                return chip(entry.region, entry.count, `region-${entry.region}`);
              },
            )}
          </ul>
        </div>
      ) : (
        <></>
      )}

      {!props.compact && props.accounts && props.accounts.length > 0 ? (
        <div className="text-xs text-gray-500" data-testid="cloud-resource-groups-accounts">
          {translator.translateTemplate("Reads {{accounts}}", {
            accounts: props.accounts.join(", "),
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudResourceGroups;
