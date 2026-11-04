import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import {
  ADDRESSES_FREE_COLUMN,
  OpenStackNetworkList,
} from "../../../Components/OpenStack/OpenStackLists";
import {
  OpenStackListColumn,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import { getOpenStackForecastText } from "../../../Components/OpenStack/Part/OpenStackForecastTile";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";
import OpenStackNetworkCountsCard from "../../../Components/OpenStack/Part/OpenStackNetworkCountsCard";
import useOpenStackCloudName from "../../../Components/OpenStack/Part/UseOpenStackCloudName";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import {
  countOpenStackRows,
  fetchOpenStackNetworkForecast,
} from "../Utils/OpenStackPartData";
import { OpenStackForecast } from "../Utils/OpenStackPartFacts";

/*
 * External pools first, because those are what everyone draws from: a tenant's own network
 * filling up is theirs to see, and an external one running out stops floating IPs and new
 * routers for everybody. Facts are not a column the server can sort by, so the two are two
 * lists, each paged and filtered on the server, and not one list reordered in the browser.
 */
function factsQuery(facts: JSONObject): Query<OpenStackResource> {
  return { facts: facts };
}

const EXTERNAL_QUERY: Query<OpenStackResource> = factsQuery({
  isExternal: true,
});
// A row that doesn't say is not external: a negative filter keeps it.
const OTHER_QUERY: Query<OpenStackResource> = factsQuery({
  isExternal: new NotEqual("true") as never,
});

const OpenStackCloudNetworks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const cloudName: string = useOpenStackCloudName(modelId);

  const { region }: OpenStackRegionState = useOpenStackRegion();

  const externalCount: OpenStackRead<number> = useOpenStackRead<number>(() => {
    return countOpenStackRows({
      openStackCloudId: modelId,
      kind: OpenStackResourceKind.Network,
      query: {
        ...EXTERNAL_QUERY,
        ...(region ? { regionName: region } : {}),
      },
    });
  }, [modelId.toString(), region]);

  const [forecasts, setForecasts] = useState<Record<string, OpenStackForecast>>(
    {},
  );

  const extraColumns: Array<OpenStackListColumn> = useMemo(() => {
    return [
      ADDRESSES_FREE_COLUMN,
      getOpenStackFactColumn({
        id: "days-until-empty",
        title: "Days Until Empty",
        isReadLater: true,
        description:
          "When this pool runs out at its growth over the last day. It says so when there isn't enough history yet to tell.",
        getText: (row: OpenStackResource): string => {
          const forecast: OpenStackForecast | undefined =
            forecasts[row.externalId || ""];
          return forecast ? getOpenStackForecastText(forecast, translator) : "";
        },
      }),
    ];
  }, [forecasts, translator]);

  const onExternalRows: (rows: Array<OpenStackResource>) => void = (
    rows: Array<OpenStackResource>,
  ): void => {
    if (!cloudName) {
      return;
    }
    for (const row of rows) {
      fetchOpenStackNetworkForecast({ cloudName, network: row })
        .then((forecast: OpenStackForecast) => {
          setForecasts((known: Record<string, OpenStackForecast>) => {
            return { ...known, [row.externalId || ""]: forecast };
          });
        })
        .catch(() => {
          // No column value is better than a forecast nobody can back up.
        });
    }
  };

  const hasExternal: boolean = (externalCount.data || 0) > 0;

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Network}
      />
      {hasExternal && cloudName ? (
        <OpenStackNetworkList
          openStackCloudId={modelId}
          query={EXTERNAL_QUERY}
          tableId="openstack-external-networks-table"
          title="External Networks"
          description="The pools floating IPs and routers draw from, and how long their addresses will last."
          extraColumns={extraColumns}
          onRowsFetched={onExternalRows}
        />
      ) : (
        <></>
      )}
      <OpenStackNetworkList
        openStackCloudId={modelId}
        query={hasExternal ? OTHER_QUERY : undefined}
      />
      {cloudName ? (
        <OpenStackNetworkCountsCard cloudName={cloudName} regionName={region} />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OpenStackCloudNetworks;
