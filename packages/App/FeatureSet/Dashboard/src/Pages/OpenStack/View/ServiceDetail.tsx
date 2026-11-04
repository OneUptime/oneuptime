import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import { openStackIdFromRouteParam } from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import OpenStackServiceOverview, {
  OpenStackServiceMetrics,
} from "../../../Components/OpenStack/Part/OpenStackServiceOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import { ResourcePartChip } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  getOpenStackCollectionSeconds,
  getOpenStackServiceTitle,
  getOpenStackWorkerHost,
  isOpenStackApiExternalId,
} from "../Utils/OpenStackServices";

/*
 * One OpenStack service's page: an API in a region, or one worker on one host. A worker's
 * name says only half of what it is, so its hero says its host too. A Neutron agent has a
 * page of its own, which also says what it serves (OpenStackPartRoutes.routeFor).
 */

const OpenStackCloudServiceDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: OpenStackResourceKind = isOpenStackApiExternalId(
    openStackIdFromRouteParam(Navigation.getLastParamAsString()),
  )
    ? OpenStackResourceKind.Api
    : OpenStackResourceKind.Service;
  const part: OpenStackPart = useOpenStackPart(kind);
  const row: OpenStackResource | null = part.row;

  const chips: Array<ResourcePartChip> = [];
  if (row && kind === OpenStackResourceKind.Service) {
    chips.push({
      key: "host",
      icon: IconProp.ServerStack,
      label: getOpenStackWorkerHost(row),
    });
    if (row.availabilityZone) {
      chips.push({
        key: "zone",
        icon: IconProp.MapPin,
        label: row.availabilityZone,
      });
    }
  }
  const seconds: number | null = getOpenStackCollectionSeconds(row);
  if (row && kind === OpenStackResourceKind.Api && seconds !== null) {
    chips.push({
      key: "collection",
      icon: IconProp.Clock,
      label: translator.translateTemplate("Collected in {{seconds}}", {
        seconds: `${translator.formatNumber(
          Math.round(seconds * 100) / 100,
        )} s`,
      }),
    });
  }

  return (
    <OpenStackPartPage
      part={part}
      hero={{
        slug: "service",
        name:
          row && kind === OpenStackResourceKind.Api
            ? getOpenStackServiceTitle(row.name)
            : undefined,
        chips: chips,
      }}
      overview={(loaded: OpenStackResource): ReactElement => {
        return <OpenStackServiceOverview part={part} row={loaded} />;
      }}
      tabs={(loaded: OpenStackResource): Array<Tab> => {
        return [
          {
            name: "Metrics",
            children: <OpenStackServiceMetrics part={part} row={loaded} />,
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudServiceDetail;
