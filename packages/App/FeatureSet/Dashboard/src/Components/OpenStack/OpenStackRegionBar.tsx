import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { Location, useLocation } from "react-router-dom";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "./OpenStackRegionContext";

/*
 * Which region a cloud's page reads: one, or all of them. A cloud of one region has
 * nothing to choose, and most clouds have one region, so it draws nothing there. Nor on a
 * page where a region means nothing: a cloud's settings, or a project, which belongs to
 * Keystone, or a part's own page, which is already in one region.
 *
 * What reads a region on each page: the inventory's rows and the map, by their region; a
 * metric's datapoint, a log's and a span's resource; an incident's and an alert's series
 * labels. A maintenance event names none, and its page says so.
 */
export const OPENSTACK_REGION_PAGES: ReadonlyArray<PageMap> = [
  PageMap.OPENSTACK_CLOUD_VIEW,
  PageMap.OPENSTACK_CLOUD_VIEW_CAPACITY,
  PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY,
  PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
  PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE,
  PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
  PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
  PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS,
  PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES,
  PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES,
  PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
  PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS,
  PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
  PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
  PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS,
  PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
  PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS,
  PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS,
  PageMap.OPENSTACK_CLOUD_VIEW_IMAGES,
  PageMap.OPENSTACK_CLOUD_VIEW_METRICS,
  PageMap.OPENSTACK_CLOUD_VIEW_LOGS,
  PageMap.OPENSTACK_CLOUD_VIEW_TRACES,
  PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS,
  PageMap.OPENSTACK_CLOUD_VIEW_ALERTS,
  PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE,
];

export interface ComponentProps {
  openStackCloudId: ObjectID;
}

// What the picker hands back for the whole cloud. No region is called this.
const ALL_REGIONS: string = "__all-regions__";

const OpenStackRegionBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const location: Location = useLocation();
  const { region, regions, setRegion }: OpenStackRegionState =
    useOpenStackRegion();

  const isRegionPage: boolean = OPENSTACK_REGION_PAGES.some(
    (page: PageMap): boolean => {
      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[page] as Route,
        { modelId: props.openStackCloudId },
      );
      return route.toString() === location.pathname;
    },
  );

  if (regions.length < 2 || !isRegionPage) {
    return <></>;
  }

  const allRegions: DropdownOption = {
    value: ALL_REGIONS,
    label: translator.translateText("All regions") || "All regions",
    isInPageDirection: true,
  };
  const options: Array<DropdownOption> = [
    allRegions,
    // A name someone gave it: drawn as written in every language.
    ...regions.map((name: string): DropdownOption => {
      return { value: name, label: name, isUserContent: true };
    }),
  ];
  const selected: DropdownOption =
    options.find((option: DropdownOption): boolean => {
      return option.value === region;
    }) || allRegions;

  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-end gap-2"
      data-testid="openstack-region-bar"
    >
      <span className="text-sm text-gray-500">
        {translator.translateText("Region")}
      </span>
      <div className="w-56 max-w-full">
        <Dropdown
          options={options}
          value={selected}
          isClearable={false}
          ariaLabel="Region"
          dataTestId="openstack-region-picker"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const next: string =
              typeof value === "string" ? value : ALL_REGIONS;
            setRegion(next === ALL_REGIONS ? null : next);
          }}
        />
      </div>
    </div>
  );
};

export default OpenStackRegionBar;
