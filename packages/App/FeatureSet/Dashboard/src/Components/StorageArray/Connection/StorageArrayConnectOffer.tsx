import Route from "Common/Types/API/Route";
import {
  CREATE_FORM_ADDRESS_PARAM,
  CREATE_FORM_ADDRESS_VALUE,
} from "Common/Types/CreateFormAddress";
import IconProp from "Common/Types/Icon/IconProp";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import StorageArrayProbeCollectors from "Common/Types/StorageArray/Collection/StorageArrayProbeCollectors";
import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * Where the Storage Arrays list offers the platforms a probe reads from
 * their management server (#11004): "Monitoring Dell PowerMax? Connect
 * Unisphere" - for someone about to install the agent for an array no
 * agent reads. The link opens the Connections page with its Connect form
 * open ("?create=1", the lists' own CreateFormAddress) for the platform
 * named (CONNECT_PLATFORM_QUERY_PARAMETER).
 */

// Which platform's Connect form the Connections page opens.
export const CONNECT_PLATFORM_QUERY_PARAMETER: string = "platform";

export function getConnectRoute(collector: StorageArrayProbeCollector): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.STORAGE_ARRAYS_CONNECTIONS] as Route,
  ).addQueryParams({
    [CREATE_FORM_ADDRESS_PARAM]: CREATE_FORM_ADDRESS_VALUE,
    [CONNECT_PLATFORM_QUERY_PARAMETER]: encodeURIComponent(
      collector.storageSystem,
    ),
  });
}

// Whether the reader may connect one: the Connect form's own permission.
export function canConnect(): boolean {
  return PermissionGate.check(new StorageArrayConnection(), ModelAction.Create)
    .isAllowed;
}

const StorageArrayConnectOffer: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  if (!canConnect()) {
    return <></>;
  }

  return (
    <div className="mt-5 space-y-1" data-testid="storage-array-connect-offer">
      {StorageArrayProbeCollectors.getAll().map(
        (collector: StorageArrayProbeCollector) => {
          return (
            <p
              key={collector.storageSystem}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600"
            >
              <span>{translator.translateText(collector.words.offerQuestion)}</span>{" "}
              <Link
                to={getConnectRoute(collector)}
                className="inline-flex items-center gap-1.5 font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
                dataTestId={`storage-array-connect-offer-${collector.storageSystem}`}
              >
                <Icon icon={IconProp.Link} className="h-4 w-4 flex-shrink-0" />
                <span>{translator.translateText(collector.words.connectTitle)}</span>
              </Link>
            </p>
          );
        },
      )}
    </div>
  );
};

export default StorageArrayConnectOffer;
