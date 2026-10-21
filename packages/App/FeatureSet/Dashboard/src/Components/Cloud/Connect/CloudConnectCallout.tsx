import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import Route from "Common/Types/API/Route";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import CloudConnectionTiles from "./CloudConnectionTiles";

/*
 * The way into Cloud > All Resources while it is empty: the three clouds,
 * each one click from its guided form on Cloud > Connect (opened there at
 * once, ?cloud=aws). Whoever may not connect sees the tiles greyed, with
 * why.
 */

export const CLOUD_CONNECT_CALLOUT_TITLE: string = translationKey(
  "Connect a cloud account",
);
export const CLOUD_CONNECT_CALLOUT_DESCRIPTION: string = translationKey(
  "Pick your cloud and run one command in its terminal. This list fills in on its own.",
);

export function getConnectRouteFor(provider: CloudProvider): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CLOUD_CONNECT] as Route,
  );

  return new Route(`${route.toString()}?cloud=${provider}`);
}

const CloudConnectCallout: FunctionComponent = (): ReactElement => {
  const gate: PermissionGateResult = PermissionGate.check(
    new CloudConnection(),
    ModelAction.Create,
  );

  return (
    <div data-testid="cloud-connect-callout">
      <Card
        title={CLOUD_CONNECT_CALLOUT_TITLE}
        description={CLOUD_CONNECT_CALLOUT_DESCRIPTION}
      >
        <CloudConnectionTiles
          connectionCounts={{}}
          canConnect={gate.isAllowed}
          connectDisabledReason={gate.disabledReason}
          onConnect={(provider: CloudProvider) => {
            Navigation.navigate(getConnectRouteFor(provider));
          }}
        />
      </Card>
    </div>
  );
};

export default CloudConnectCallout;
