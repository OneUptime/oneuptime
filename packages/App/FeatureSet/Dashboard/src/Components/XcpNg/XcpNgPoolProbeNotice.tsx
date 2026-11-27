import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { XcpNgPoolReadBy, getXcpNgPoolReadBy } from "./XcpNgConnectionView";

/*
 * Under a probe-read pool's hero, while it is not read: where to look. The
 * agent's install guide would send people to an agent nobody runs, so a
 * pool a probe reads points at its connection instead, whose page says
 * exactly why the probe is not reading it and the one thing that fixes it.
 * A pool whose connection was deleted says so, and where to set it up.
 */

export interface ComponentProps {
  pool: Pick<
    XcpNgPool,
    "collectionMethod" | "xcpNgConnectionId" | "xcpNgConnection" | "_id"
  >;
  isConnected: boolean;
}

const XcpNgPoolProbeNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.isConnected) {
    return <></>;
  }

  const readBy: XcpNgPoolReadBy = getXcpNgPoolReadBy(props.pool);

  if (readBy === XcpNgPoolReadBy.Connection && props.pool.xcpNgConnectionId) {
    const connectionRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route,
      {
        modelId: new ObjectID(props.pool.xcpNgConnectionId.toString()),
      },
    );

    return (
      <Card
        id="xcp-ng-pool-probe-notice"
        title="Not Read Right Now"
        description={translator.translateTemplate(
          "A probe reads this pool through {{connection}}, and has not read it lately. The connection's page says why, and what fixes it.",
          {
            connection:
              props.pool.xcpNgConnection?.name ||
              props.pool.xcpNgConnectionId.toString(),
          },
        )}
        buttons={[
          {
            title: "Open the Connection",
            icon: IconProp.Link,
            onClick: () => {
              Navigation.navigate(connectionRoute);
            },
          },
        ]}
      />
    );
  }

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.XCP_NG_POOL_VIEW_SETTINGS] as Route,
    { modelId: new ObjectID(String(props.pool._id)) },
  );

  return (
    <Card
      id="xcp-ng-pool-probe-notice"
      title="Not Read Right Now"
      description="The connection that read this pool was deleted. Collect it with another connection's probe, or use the XCP-ng Agent, on its Settings page."
      buttons={[
        {
          title: "Settings",
          icon: IconProp.Settings,
          onClick: () => {
            Navigation.navigate(settingsRoute);
          },
        },
      ]}
    />
  );
};

export default XcpNgPoolProbeNotice;
