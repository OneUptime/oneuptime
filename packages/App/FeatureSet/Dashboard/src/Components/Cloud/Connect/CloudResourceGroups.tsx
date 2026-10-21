import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudConnectionRegionCount,
  CloudConnectionTypeCount,
} from "Common/Types/CloudConnection/CloudConnectionTest";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  CloudTemplate,
  drawCloudTemplate,
  getCloudAccountsWords,
  getResourceTypeEntries,
} from "./CloudConnectionWords";

/*
 * A cloud account's resources at a glance, grouped the way people think
 * of them: by service ("Virtual Machine 12", "SQL Database 3") and by
 * region, most first, then the accounts read - what a test found. The
 * resources themselves are under Cloud > All Resources, and the list of
 * connections says less: how many, and where.
 */

export interface ComponentProps {
  provider: CloudProvider | string;
  resourceTypes: Array<CloudConnectionTypeCount>;
  regions: Array<CloudConnectionRegionCount>;
  accounts?: Array<string> | undefined;
}

const CloudResourceGroups: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const types: Array<{ label: string; count: number }> = getResourceTypeEntries(
    {
      provider: props.provider,
      resourceTypes: props.resourceTypes,
    },
  );
  const regions: Array<CloudConnectionRegionCount> = props.regions.filter(
    (entry: CloudConnectionRegionCount): boolean => {
      return Boolean(entry.region);
    },
  );
  // "Subscription: 7c4a…": what was read, in the cloud's own word for it.
  const accounts: CloudTemplate | undefined = getCloudAccountsWords({
    provider: props.provider,
    accounts: props.accounts || [],
  });

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

  return (
    <div className="space-y-2" data-testid="cloud-resource-groups">
      {types.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-medium text-gray-500">
            {translator.translateText("By service")}
          </div>
          <ul
            className="flex flex-wrap gap-1.5"
            data-testid="cloud-resource-groups-types"
          >
            {types.map(
              (entry: { label: string; count: number }): ReactElement => {
                // The cloud's own names for its services, as All Resources shows them.
                return chip(entry.label, entry.count, `type-${entry.label}`);
              },
            )}
          </ul>
        </div>
      ) : (
        <></>
      )}

      {regions.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-medium text-gray-500">
            {translator.translateText("By region")}
          </div>
          <ul
            className="flex flex-wrap gap-1.5"
            data-testid="cloud-resource-groups-regions"
          >
            {regions.map((entry: CloudConnectionRegionCount): ReactElement => {
              return chip(entry.region, entry.count, `region-${entry.region}`);
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}

      {accounts ? (
        <div
          className="break-words text-xs text-gray-500"
          data-testid="cloud-resource-groups-accounts"
        >
          {drawCloudTemplate(translator, accounts)}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudResourceGroups;
