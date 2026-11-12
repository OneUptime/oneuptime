import PageComponentProps from "../../PageComponentProps";
import { OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS } from "Common/Types/OpenStack/OpenStackHealthRules";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackCapacityResource,
  OpenStackCapacityRollup,
  OpenStackOvercommitReading,
} from "Common/Types/OpenStack/OpenStackCapacity";
import {
  OPENSTACK_CAPACITY_MAIN_CLASSES,
  OpenStackBareMetalCapacityRow,
  OpenStackCapacityFlavorRow,
  OpenStackCapacityForecastRow,
  OpenStackCapacityHostNotCounted,
  OpenStackCapacityMismatchRow,
  OpenStackCapacityShortage,
  OpenStackCapacitySnapshot,
  OpenStackCapacityZone,
  getOpenStackCapacityHeadline,
  getOpenStackCapacityResourceOf,
  getOpenStackCapacityShortages,
  isOpenStackAllocationMismatchLasting,
} from "Common/Types/OpenStack/OpenStackCapacitySnapshot";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import OpenStackForecastTile, {
  getOpenStackForecastText,
} from "../../../Components/OpenStack/Part/OpenStackForecastTile";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import {
  OpenStackCapacityView,
  fetchOpenStackCapacitySnapshot,
  formatOpenStackCapacityAmount,
  formatOpenStackRatio,
  formatOpenStackRatioRange,
  getOpenStackCapacityCsv,
  getOpenStackCapacityResourceTitle,
  getOpenStackCapacityView,
} from "../Utils/OpenStackCapacityView";
import { formatOpenStackPercent } from "../Utils/OpenStackFigures";
import { getOpenStackHostGroupId } from "../Utils/OpenStackPartFacts";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { joinList } from "Common/UI/Utils/ListSeparator";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import {
  ReadingDirection,
  getReadingDirection,
  setApartInSentence,
} from "Common/Types/ReadingDirection";

/*
 * CAN WE FIT THIS?
 *
 * The question an OpenStack operator gets asked most, answered at the top: how many more of what
 * people run fit, and what is short, soonest first. The tables are beneath it, and everything says
 * allocated, because it is what has been promised, and an idle instance holds all of it.
 *
 * One row is all this reads (OpenStackCapacitySnapshot), so a cloud of 5,000 hosts costs this page
 * what a cloud of one does.
 */

const TABLE_CLASS_NAME: string = "min-w-full text-start text-sm";
const HEAD_CLASS_NAME: string =
  "border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-500";
// A browser centres a heading cell by itself.
const CELL_CLASS_NAME: string = "py-2 pe-4 text-start align-top";
// What a phone can go without: the row's own page has it, or a person can read it on a wider one.
const WIDE_CELL_CLASS_NAME: string = `${CELL_CLASS_NAME} max-md:hidden md:table-cell`;
const ROW_CLASS_NAME: string = "border-b border-gray-100 last:border-0";
const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

const ORPHANED_ALLOCATIONS_DOCS: URL = URL.fromString(
  "https://docs.openstack.org/nova/latest/admin/troubleshooting/orphaned-allocations.html",
);

const ZONE_NO_NAME: string = translationKey("No zone");

const TILE_TITLES: Readonly<Record<string, string>> = {
  VCPU: translationKey("vCPUs Allocated"),
  PCPU: translationKey("Pinned CPUs Allocated"),
  MEMORY_MB: translationKey("Memory Allocated"),
  DISK_GB: translationKey("Local Disk Allocated"),
};

const HEADROOM_WORDS: Readonly<Record<string, string>> = {
  "can-lose-a-host": translationKey("Yes"),
  "cannot-lose-a-host": translationKey("No"),
  "too-few-hosts": translationKey("Needs two hosts"),
  "host-disabled": translationKey("A host is disabled"),
  "not-reported": translationKey("Not reported"),
};

const HEADROOM_TONES: Readonly<Record<string, string>> = {
  "can-lose-a-host": "text-emerald-700",
  "cannot-lose-a-host": "font-medium text-red-700",
  "too-few-hosts": "text-gray-500",
  "host-disabled": "text-gray-500",
  "not-reported": "text-gray-500",
};

function zoneTitle(name: string, translator: Translator): string {
  return name || translator.translateText(ZONE_NO_NAME) || ZONE_NO_NAME;
}

/*
 * "۴۸۰ GiB / ۱٫۰ TiB": each amount reads its own way, so a size keeps its
 * number before its unit on a page read from the right, and the pair reads
 * the page's way, what is used first (issue #7191).
 */
export function formatOpenStackCapacityPair(data: {
  used: string;
  total: string;
  language: string;
}): string {
  const direction: ReadingDirection = getReadingDirection(data.language);
  return `${setApartInSentence(data.used, direction)} / ${setApartInSentence(
    data.total,
    direction,
  )}`;
}

function AllocatedCell(props: {
  resource: OpenStackCapacityResource | null;
}): ReactElement {
  const { resource } = props;

  if (!resource) {
    return <span className="text-gray-400">-</span>;
  }

  /*
   * Each amount reads its own way ("۶٫۰ TiB", its number first on a page
   * read from the right) and the cell the page's way (issue #7191). A
   * narrow column breaks the line between the cell's parts - "674 GiB",
   * "/ 762 GiB", "(88%)" - never inside one, where it left a unit alone on
   * the line under its number.
   */
  return (
    <span data-testid="openstack-capacity-allocated">
      <IsolatedText
        text={formatOpenStackCapacityAmount(
          resource.resourceClass,
          resource.used,
        )}
        className="whitespace-nowrap"
        dataTestId="openstack-capacity-allocated-used"
      />{" "}
      <span className="whitespace-nowrap text-gray-400">
        /{" "}
        <IsolatedText
          text={formatOpenStackCapacityAmount(
            resource.resourceClass,
            resource.capacity,
          )}
          dataTestId="openstack-capacity-allocated-total"
        />
      </span>
      {resource.percent !== null ? (
        <span className="ms-1 whitespace-nowrap text-gray-500">
          ({formatOpenStackPercent(resource.percent)})
        </span>
      ) : (
        <></>
      )}
    </span>
  );
}

const ShortageRow: FunctionComponent<{
  shortage: OpenStackCapacityShortage;
  routes: OpenStackPartRoutes;
}> = (props: {
  shortage: OpenStackCapacityShortage;
  routes: OpenStackPartRoutes;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { shortage, routes } = props;
  const resource: string = shortage.resourceClass
    ? translator.translateText(
        getOpenStackCapacityResourceTitle(shortage.resourceClass),
      ) || shortage.resourceClass
    : "";

  let sentence: string = "";
  let route: Route | undefined;

  switch (shortage.kind) {
    case "flavor-cannot-be-placed":
      route = routes.getPartRoute(
        OpenStackResourceKind.Flavor,
        `${shortage.regionName || "default"}/${shortage.id}`,
      );
      sentence =
        (shortage.fitsIfOnePool || 0) > 0
          ? translator.translateTemplate(
              "No host has room for one, though {{count}} would fit if what is free were on one host. What is free is too spread out.",
              { count: translator.formatNumber(shortage.fitsIfOnePool || 0) },
            )
          : translator.translateTemplate(
              "No host has room for one, and {{resource}} is what ran out.",
              { resource: resource || "-" },
            );
      break;
    case "headroom-gone":
      route = routes.getZoneRoute(
        getOpenStackHostGroupId(shortage.regionName, shortage.name),
      );
      // Each value set apart: "۶۴ GiB" reads with its number first in a Persian sentence.
      sentence = translator.translateTemplate(
        "Couldn't lose its largest host and still fit what runs on it: {{amount}} short of {{resource}}.",
        {
          amount: formatOpenStackCapacityAmount(
            shortage.resourceClass || "",
            shortage.shortBy || 0,
          ),
          resource: resource || "-",
        },
        { setsValuesApart: true },
      );
      break;
    case "full":
      sentence = translator.translateTemplate(
        "{{resource}}: nothing left to allocate.",
        { resource: resource || "-" },
      );
      break;
    case "fills-up":
      sentence = translator.translatePlural(
        {
          one: "{{resource}}: full in about {{count}} day, at this week's growth.",
          other:
            "{{resource}}: full in about {{count}} days, at this week's growth.",
        },
        Math.max(1, Math.round(shortage.days)),
        { resource: resource || "-" },
      );
      break;
    default:
      sentence = translator.translateTemplate(
        "Placement holds {{vcpus}} vCPUs and {{memory}} more than its instances explain.",
        {
          vcpus: translator.formatNumber(Math.max(0, shortage.vcpuExcess || 0)),
          memory: formatOpenStackCapacityAmount(
            "MEMORY_MB",
            Math.max(0, shortage.memoryMbExcess || 0),
          ),
        },
        { setsValuesApart: true },
      );
      break;
  }

  return (
    <li
      className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
      data-testid="openstack-capacity-shortage"
      data-kind={shortage.kind}
    >
      <div className="min-w-0">
        <span className="font-medium text-gray-900">
          {route ? (
            <Link to={route} className={LINK_CLASS_NAME}>
              <bdi>{shortage.name || zoneTitle(shortage.name, translator)}</bdi>
            </Link>
          ) : (
            <bdi>{shortage.name || zoneTitle(shortage.name, translator)}</bdi>
          )}
        </span>
        <span className="ms-2 text-sm text-gray-600">{sentence}</span>
      </div>
      {
        // `days` only sorts one of these last: it isn't filling up, so nothing says when.
        shortage.kind === "allocations-disagree" ? (
          <></>
        ) : (
          <span
            className={`flex-shrink-0 text-sm ${shortage.isUrgent ? "font-medium text-red-700" : "text-gray-500"}`}
          >
            {shortage.days <= 0
              ? translator.translateText("Now")
              : translator.translatePlural(
                  { one: "~{{count}} day", other: "~{{count}} days" },
                  Math.max(1, Math.round(shortage.days)),
                )}
          </span>
        )
      }
    </li>
  );
};

const ZonesTable: FunctionComponent<{
  zones: Array<OpenStackCapacityZone>;
  forecasts: Array<OpenStackCapacityForecastRow>;
  showRegion: boolean;
  routes: OpenStackPartRoutes;
}> = (props: {
  zones: Array<OpenStackCapacityZone>;
  forecasts: Array<OpenStackCapacityForecastRow>;
  showRegion: boolean;
  routes: OpenStackPartRoutes;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="overflow-x-auto" data-testid="openstack-capacity-zones">
      <table className={TABLE_CLASS_NAME}>
        <thead>
          <tr className={HEAD_CLASS_NAME}>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Zone")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Hosts")}
            </th>
            {OPENSTACK_CAPACITY_MAIN_CLASSES.filter((name: string): boolean => {
              return props.zones.some((zone: OpenStackCapacityZone) => {
                return Boolean(getOpenStackCapacityResourceOf(zone, name));
              });
            }).map((name: string): ReactElement => {
              return (
                <th key={name} className={CELL_CLASS_NAME}>
                  {translator.translateText(
                    getOpenStackCapacityResourceTitle(name),
                  )}{" "}
                  {translator.translateText("allocated")}
                </th>
              );
            })}
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Soonest full")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Can lose a host")}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.zones.map((zone: OpenStackCapacityZone): ReactElement => {
            const soonest: OpenStackCapacityForecastRow | undefined =
              props.forecasts.find(
                (row: OpenStackCapacityForecastRow): boolean => {
                  return (
                    row.scope === "zone" &&
                    row.name === zone.name &&
                    row.regionName === zone.regionName
                  );
                },
              );

            return (
              <tr
                key={`${zone.regionName || ""}/${zone.name}`}
                className={ROW_CLASS_NAME}
                data-testid="openstack-capacity-zone"
              >
                <td className={CELL_CLASS_NAME}>
                  {zone.name ? (
                    <Link
                      to={props.routes.getZoneRoute(
                        getOpenStackHostGroupId(zone.regionName, zone.name),
                      )}
                      className={LINK_CLASS_NAME}
                    >
                      <bdi className="whitespace-nowrap">{zone.name}</bdi>
                    </Link>
                  ) : (
                    zoneTitle(zone.name, translator)
                  )}
                  {props.showRegion ? (
                    <div className="text-xs text-gray-500">
                      <bdi>{zone.regionName}</bdi>
                    </div>
                  ) : (
                    <></>
                  )}
                </td>
                <td className={WIDE_CELL_CLASS_NAME}>
                  {zone.hostCount.toLocaleString(getReaderNumberLocale())}
                  {zone.lostHostCount + zone.disabledHostCount > 0 ? (
                    <div className="text-xs text-amber-700">
                      {translator.translateTemplate(
                        "{{lost}} lost, {{disabled}} disabled",
                        {
                          lost: zone.lostHostCount.toLocaleString(
                            getReaderNumberLocale(),
                          ),
                          disabled: zone.disabledHostCount.toLocaleString(
                            getReaderNumberLocale(),
                          ),
                        },
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                </td>
                {OPENSTACK_CAPACITY_MAIN_CLASSES.filter(
                  (name: string): boolean => {
                    return props.zones.some((row: OpenStackCapacityZone) => {
                      return Boolean(getOpenStackCapacityResourceOf(row, name));
                    });
                  },
                ).map((name: string): ReactElement => {
                  return (
                    <td key={name} className={CELL_CLASS_NAME}>
                      <AllocatedCell
                        resource={getOpenStackCapacityResourceOf(zone, name)}
                      />
                    </td>
                  );
                })}
                <td className={WIDE_CELL_CLASS_NAME}>
                  {soonest
                    ? getOpenStackForecastText(soonest.forecast, translator)
                    : "-"}
                </td>
                <td
                  className={`${CELL_CLASS_NAME} ${HEADROOM_TONES[zone.headroom.state] || ""}`}
                  data-testid="openstack-capacity-headroom"
                  data-state={zone.headroom.state}
                >
                  {translator.translateText(
                    HEADROOM_WORDS[zone.headroom.state] || "",
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const FlavorsTable: FunctionComponent<{
  flavors: Array<OpenStackCapacityFlavorRow>;
  showRegion: boolean;
  routes: OpenStackPartRoutes;
}> = (props: {
  flavors: Array<OpenStackCapacityFlavorRow>;
  showRegion: boolean;
  routes: OpenStackPartRoutes;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="overflow-x-auto" data-testid="openstack-capacity-flavors">
      <table className={TABLE_CLASS_NAME}>
        <thead>
          <tr className={HEAD_CLASS_NAME}>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Flavor")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Room for")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Hosts with room")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("By zone")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Running")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Counted from")}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.flavors.map(
            (flavor: OpenStackCapacityFlavorRow): ReactElement => {
              return (
                <tr
                  key={`${flavor.regionName || ""}/${flavor.id}`}
                  className={ROW_CLASS_NAME}
                  data-testid="openstack-capacity-flavor"
                  data-flavor={flavor.name}
                >
                  <td className={CELL_CLASS_NAME}>
                    <Link
                      to={
                        props.routes.getPartRoute(
                          OpenStackResourceKind.Flavor,
                          `${flavor.regionName || "default"}/${flavor.id}`,
                        ) as Route
                      }
                      className={LINK_CLASS_NAME}
                    >
                      <bdi>{flavor.name}</bdi>
                    </Link>
                    {props.showRegion ? (
                      <div className="text-xs text-gray-500">
                        <bdi>{flavor.regionName}</bdi>
                      </div>
                    ) : (
                      <></>
                    )}
                  </td>
                  <td
                    className={CELL_CLASS_NAME}
                    data-testid="openstack-capacity-flavor-fits"
                  >
                    <span
                      className={
                        flavor.fits === 0 && !flavor.isTooLargeForEveryHost
                          ? "font-medium text-red-700"
                          : "text-gray-900"
                      }
                    >
                      {flavor.isAtLeast
                        ? translator.translateTemplate("At least {{count}}", {
                            count: flavor.fits.toLocaleString(
                              getReaderNumberLocale(),
                            ),
                          })
                        : flavor.fits.toLocaleString(getReaderNumberLocale())}
                    </span>
                    {flavor.isTooLargeForEveryHost ? (
                      <div className="text-xs text-gray-500">
                        {translator.translateText("Too large for every host")}
                      </div>
                    ) : flavor.isOnlyOnDisabledHosts ? (
                      <div className="text-xs text-gray-500">
                        {translator.translateText(
                          "Room only on hosts someone disabled",
                        )}
                      </div>
                    ) : flavor.fitsIfOnePool > flavor.fits ? (
                      <div
                        className="text-xs text-gray-500"
                        data-testid="openstack-capacity-flavor-fragmented"
                      >
                        {translator.translateTemplate(
                          "{{count}} if it were one pool",
                          {
                            count: flavor.fitsIfOnePool.toLocaleString(
                              getReaderNumberLocale(),
                            ),
                          },
                        )}
                      </div>
                    ) : (
                      <></>
                    )}
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {flavor.hostsWithRoom.toLocaleString(
                      getReaderNumberLocale(),
                    )}
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {joinList(
                      Object.keys(flavor.byZone)
                        .sort()
                        .map((zone: string): string => {
                          return `${zoneTitle(zone, translator)} ${flavor.byZone[zone]!.toLocaleString(getReaderNumberLocale())}`;
                        }),
                    )}
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {flavor.instanceCount.toLocaleString(
                      getReaderNumberLocale(),
                    )}
                  </td>
                  <td
                    className={WIDE_CELL_CLASS_NAME}
                    data-testid="openstack-capacity-flavor-source"
                    data-source={flavor.source}
                  >
                    {flavor.source === "placement"
                      ? translator.translateText("Asked Placement")
                      : translator.translateText("Inventories")}
                    {flavor.source === "inventories" &&
                    flavor.hasRequiredTraits ? (
                      <div className="text-xs text-amber-700">
                        {translator.translateText("Can't see its traits")}
                      </div>
                    ) : (
                      <></>
                    )}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

const ForecastsTable: FunctionComponent<{
  forecasts: Array<OpenStackCapacityForecastRow>;
  showRegion: boolean;
}> = (props: {
  forecasts: Array<OpenStackCapacityForecastRow>;
  showRegion: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="overflow-x-auto" data-testid="openstack-capacity-forecasts">
      <table className={TABLE_CLASS_NAME}>
        <thead>
          <tr className={HEAD_CLASS_NAME}>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("What fills up")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Of")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Full in")}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.forecasts.map(
            (row: OpenStackCapacityForecastRow): ReactElement => {
              return (
                <tr
                  key={`${row.regionName || ""}/${row.scope}/${row.id || row.name}/${row.resourceClass}`}
                  className={ROW_CLASS_NAME}
                  data-testid="openstack-capacity-forecast"
                  data-state={row.forecast.state}
                >
                  <td className={CELL_CLASS_NAME}>
                    <bdi>{zoneTitle(row.name, translator)}</bdi>
                    {props.showRegion ? (
                      <div className="text-xs text-gray-500">
                        <bdi>{row.regionName}</bdi>
                      </div>
                    ) : (
                      <></>
                    )}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {translator.translateText(
                      getOpenStackCapacityResourceTitle(row.resourceClass),
                    )}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {getOpenStackForecastText(row.forecast, translator)}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

const OvercommitTable: FunctionComponent<{
  zones: Array<OpenStackCapacityZone>;
}> = (props: { zones: Array<OpenStackCapacityZone> }): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<{
    zone: OpenStackCapacityZone;
    reading: OpenStackOvercommitReading;
  }> = [];

  for (const zone of props.zones) {
    for (const reading of zone.overcommit) {
      rows.push({ zone, reading });
    }
  }

  return (
    <div
      className="overflow-x-auto"
      data-testid="openstack-capacity-overcommit"
    >
      <table className={TABLE_CLASS_NAME}>
        <thead>
          <tr className={HEAD_CLASS_NAME}>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Zone")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Of")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Ratio set")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Allocated")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Really used, at peak")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Busiest host")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Reaches its line at")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(
            (row: {
              zone: OpenStackCapacityZone;
              reading: OpenStackOvercommitReading;
            }): ReactElement => {
              return (
                <tr
                  key={`${row.zone.regionName || ""}/${row.zone.name}/${row.reading.resourceClass}`}
                  className={ROW_CLASS_NAME}
                >
                  <td className={CELL_CLASS_NAME}>
                    <bdi>{zoneTitle(row.zone.name, translator)}</bdi>
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {translator.translateText(
                      getOpenStackCapacityResourceTitle(
                        row.reading.resourceClass,
                      ),
                    )}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {formatOpenStackRatio(row.reading.allocationRatio)}
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {formatOpenStackRatio(row.reading.allocatedRatio)}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {Math.round(row.reading.realPercent)}%
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {Math.round(row.reading.busiestPercent)}%
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {row.reading.ratioAtLine === null
                      ? "-"
                      : formatOpenStackRatio(
                          Math.round(row.reading.ratioAtLine * 10) / 10,
                        )}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

const AggregatesTable: FunctionComponent<{
  aggregates: Array<OpenStackCapacityRollup>;
  routes: OpenStackPartRoutes;
}> = (props: {
  aggregates: Array<OpenStackCapacityRollup>;
  routes: OpenStackPartRoutes;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="overflow-x-auto"
      data-testid="openstack-capacity-aggregates"
    >
      <table className={TABLE_CLASS_NAME}>
        <thead>
          <tr className={HEAD_CLASS_NAME}>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Aggregate")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Hosts")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("vCPUs allocated")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Memory allocated")}
            </th>
            <th className={WIDE_CELL_CLASS_NAME}>
              {translator.translateText("Ratio set")}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.aggregates.map(
            (aggregate: OpenStackCapacityRollup): ReactElement => {
              const vcpu: OpenStackCapacityResource | null =
                getOpenStackCapacityResourceOf(aggregate, "VCPU");

              return (
                <tr
                  key={`${aggregate.regionName || ""}/${aggregate.name}`}
                  className={ROW_CLASS_NAME}
                >
                  <td className={CELL_CLASS_NAME}>
                    <Link
                      to={props.routes.getAggregateRoute(
                        getOpenStackHostGroupId(
                          aggregate.regionName,
                          aggregate.name,
                        ),
                      )}
                      className={LINK_CLASS_NAME}
                    >
                      <bdi>{aggregate.name}</bdi>
                    </Link>
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {aggregate.hostCount.toLocaleString(
                      getReaderNumberLocale(),
                    )}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    <AllocatedCell resource={vcpu} />
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    <AllocatedCell
                      resource={getOpenStackCapacityResourceOf(
                        aggregate,
                        "MEMORY_MB",
                      )}
                    />
                  </td>
                  <td className={WIDE_CELL_CLASS_NAME}>
                    {vcpu ? formatOpenStackRatioRange(vcpu) : ""}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

const BareMetalClassesTable: FunctionComponent<{
  classes: Array<OpenStackBareMetalCapacityRow>;
  showRegion: boolean;
}> = (props: {
  classes: Array<OpenStackBareMetalCapacityRow>;
  showRegion: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="overflow-x-auto"
      data-testid="openstack-capacity-bare-metal-classes"
    >
      <table className={TABLE_CLASS_NAME}>
        <thead>
          <tr className={HEAD_CLASS_NAME}>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Resource class")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Nodes")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Can take an instance")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("In use")}
            </th>
            <th className={CELL_CLASS_NAME}>
              {translator.translateText("Held back")}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.classes.map(
            (row: OpenStackBareMetalCapacityRow): ReactElement => {
              return (
                <tr
                  key={`${row.regionName || ""}/${row.resourceClass}`}
                  className={ROW_CLASS_NAME}
                  data-testid="openstack-capacity-bare-metal-class"
                >
                  <td className={CELL_CLASS_NAME}>
                    <span className="font-medium text-gray-900">
                      {row.resourceClass}
                    </span>
                    {props.showRegion && row.regionName ? (
                      <div className="text-xs text-gray-500">
                        {row.regionName}
                      </div>
                    ) : (
                      <></>
                    )}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {row.nodeCount.toLocaleString(getReaderNumberLocale())}
                  </td>
                  <td
                    className={
                      row.free === 0 && row.heldBack > 0
                        ? `${CELL_CLASS_NAME} font-medium text-red-700`
                        : CELL_CLASS_NAME
                    }
                  >
                    {row.free.toLocaleString(getReaderNumberLocale())}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {row.used.toLocaleString(getReaderNumberLocale())}
                  </td>
                  <td className={CELL_CLASS_NAME}>
                    {row.heldBack.toLocaleString(getReaderNumberLocale())}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

const OpenStackCloudCapacity: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { region }: OpenStackRegionState = useOpenStackRegion();
  const [isAggregatesOpen, setIsAggregatesOpen] = useState<boolean>(false);

  const read: OpenStackRead<OpenStackCapacitySnapshot | null> =
    useOpenStackRead<OpenStackCapacitySnapshot | null>(() => {
      return fetchOpenStackCapacitySnapshot(modelId);
    }, [modelId.toString()]);

  if (read.isLoading && !read.data) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error && !read.data) {
    return (
      <ResourcePartReadError
        testId="openstack-capacity-read-error"
        title={translationKey("Couldn't load this cloud's capacity")}
        message={read.error}
        onRetry={read.reload}
      />
    );
  }

  const snapshot: OpenStackCapacitySnapshot | null = read.data;

  if (!snapshot) {
    return (
      <OpenStackPartNotice
        testId="openstack-capacity-not-yet"
        text={translationKey(
          "This cloud's capacity is worked out every couple of minutes while it reports, and it hasn't been yet. Come back in a few minutes.",
        )}
      />
    );
  }

  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(modelId);
  const now: Date = OneUptimeDate.getCurrentDate();
  const view: OpenStackCapacityView = getOpenStackCapacityView({
    snapshot,
    region,
  });
  const shortages: Array<OpenStackCapacityShortage> =
    getOpenStackCapacityShortages({ snapshot, regionName: region, now });
  const headline: ReturnType<typeof getOpenStackCapacityHeadline> =
    getOpenStackCapacityHeadline({ snapshot, regionName: region });
  const showRegion: boolean = !region && snapshot.regions.length > 1;

  const hasInventories: boolean = Boolean(
    view.overall && view.overall.resources.length > 0,
  );
  const askedPlacement: boolean = view.flavors.some(
    (flavor: OpenStackCapacityFlavorRow): boolean => {
      return flavor.source === "placement";
    },
  );
  const calculated: boolean = view.flavors.some(
    (flavor: OpenStackCapacityFlavorRow): boolean => {
      return flavor.source === "inventories";
    },
  );
  const hasOvercommit: boolean = view.zones.some(
    (zone: OpenStackCapacityZone): boolean => {
      return zone.overcommit.length > 0;
    },
  );
  const notCounted: Array<OpenStackCapacityHostNotCounted> =
    snapshot.hostsNotCounted.filter(
      (host: OpenStackCapacityHostNotCounted): boolean => {
        return !region || host.regionName === region;
      },
    );
  const mismatches: Array<OpenStackCapacityMismatchRow> =
    snapshot.mismatches.filter((row: OpenStackCapacityMismatchRow): boolean => {
      return (
        (!region || row.regionName === region) &&
        (row.vcpuExcess > 0 || row.memoryMbExcess > 0) &&
        isOpenStackAllocationMismatchLasting(row, now)
      );
    });

  const soonest: OpenStackCapacityForecastRow | undefined = view.forecasts[0];
  const hasBareMetalRoom: boolean = view.bareMetalClasses.some(
    (row: OpenStackBareMetalCapacityRow): boolean => {
      return row.free > 0;
    },
  );

  return (
    <div data-testid="openstack-capacity">
      {!hasInventories && view.bareMetalClasses.length === 0 ? (
        <OpenStackPartNotice
          testId="openstack-capacity-no-placement"
          tone="warning"
          text={translationKey(
            "Nothing has said what this cloud's hosts hold yet. Capacity comes from Placement, which takes the Full view or Infrastructure only credential. Run troubleshoot.sh on the agent's machine to see what it can read, or check the probe's Data Collection card.",
          )}
        />
      ) : (
        <></>
      )}

      {headline ? (
        <div
          className="mb-6 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
          data-testid="openstack-capacity-headline"
        >
          <p className="text-lg font-medium text-gray-900">
            {headline.hasRoom && headline.noRoom
              ? translator.translateTemplate(
                  "Room for {{count}} {{flavor}}, and 0 {{none}}.",
                  {
                    count: headline.hasRoom.fits.toLocaleString(
                      getReaderNumberLocale(),
                    ),
                    flavor: headline.hasRoom.name,
                    none: headline.noRoom.name,
                  },
                )
              : headline.hasRoom
                ? translator.translateTemplate(
                    "Room for {{count}} {{flavor}}.",
                    {
                      count: headline.hasRoom.fits.toLocaleString(
                        getReaderNumberLocale(),
                      ),
                      flavor: headline.hasRoom.name,
                    },
                  )
                : hasBareMetalRoom
                  ? translator.translateTemplate(
                      "No room on a host for {{flavor}}. What bare metal can still take is below.",
                      { flavor: headline.noRoom?.name || "" },
                    )
                  : translator.translateTemplate(
                      "No room for {{flavor}}, or for anything else people can ask for.",
                      { flavor: headline.noRoom?.name || "" },
                    )}
          </p>
          <p
            className="mt-1 text-sm text-gray-600"
            data-testid="openstack-capacity-source"
            data-source={askedPlacement ? "placement" : "inventories"}
          >
            {askedPlacement && calculated
              ? translator.translateText(
                  "Counted host by host. Placement has answered for some of these flavors so far, and the rest are worked out from what each host holds until it has been asked. Booted from an image: one booted from a volume asks for no root disk.",
                )
              : askedPlacement
                ? translator.translateText(
                    "Counted host by host, from what Placement itself answers, which respects traits and aggregates. Booted from an image: one booted from a volume asks for no root disk.",
                  )
                : translator.translateText(
                    "Counted host by host, from what each host holds. This can't see traits: a probe that asks Placement can. Booted from an image: one booted from a volume asks for no root disk.",
                  )}
          </p>
        </div>
      ) : (
        <></>
      )}

      {notCounted.length > 0 ? (
        <OpenStackPartNotice
          testId="openstack-capacity-not-counted"
          tone={
            notCounted.some((host: OpenStackCapacityHostNotCounted) => {
              return host.state === "lost";
            })
              ? "warning"
              : "neutral"
          }
        >
          {translator.translatePlural(
            {
              one: "{{count}} host isn't counted as room, because it can't take instances:",
              other:
                "{{count}} hosts aren't counted as room, because they can't take instances:",
            },
            notCounted.length + snapshot.hostsNotCountedLeftOut,
          )}{" "}
          {joinList(
            notCounted
              .slice(0, 5)
              .map((host: OpenStackCapacityHostNotCounted): string => {
                return `${host.name} (${
                  host.state === "lost"
                    ? translator.translateText("lost")
                    : translator.translateText("disabled")
                })`;
              }),
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {hasInventories && view.overall ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="openstack-capacity-tiles"
        >
          {OPENSTACK_CAPACITY_MAIN_CLASSES.map((name: string): ReactElement => {
            const resource: OpenStackCapacityResource | null =
              getOpenStackCapacityResourceOf(view.overall!, name);

            return resource ? (
              <GoldenMetricTile
                key={name}
                title={TILE_TITLES[name] || name}
                icon={IconProp.ChartBar}
                iconColor="blue"
                value={formatOpenStackPercent(resource.percent ?? 0, {
                  language: translator.language,
                })}
                sublabel={formatOpenStackCapacityPair({
                  used: formatOpenStackCapacityAmount(name, resource.used),
                  total: formatOpenStackCapacityAmount(name, resource.capacity),
                  language: translator.language,
                })}
                percent={resource.percent}
                description={translator.translateText(
                  "What Placement has promised, of what it will promise on hosts that can take instances: (total - reserved) x allocation ratio. This is allocation, not load: an idle instance holds all of it.",
                )}
              />
            ) : (
              <React.Fragment key={name} />
            );
          })}
          <OpenStackForecastTile
            forecast={
              soonest ? soonest.forecast : { state: "not-enough-history" }
            }
            windowWords={translationKey("until full, at this week's growth")}
            description={
              soonest
                ? translator.translateTemplate(
                    "What fills up soonest: {{name}}, {{resource}}. A straight line through what was allocated over the last week, against what there is today.",
                    {
                      name: zoneTitle(soonest.name, translator),
                      resource:
                        translator.translateText(
                          getOpenStackCapacityResourceTitle(
                            soonest.resourceClass,
                          ),
                        ) || "",
                    },
                  )
                : translator.translateText(
                    "A new cloud has no history to draw a line through.",
                  ) || ""
            }
          />
        </div>
      ) : (
        <></>
      )}

      <div className="mb-6" data-testid="openstack-capacity-short">
        <Card
          title={translationKey("What is short")}
          description={translator.translateTemplate(
            "Soonest first. What is at the alert templates' line, under {{days}} days, is in red. All of it is allocation: what has been promised, not what is busy.",
            {
              days: OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS.toLocaleString(
                getReaderNumberLocale(),
              ),
            },
          )}
        >
          {shortages.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {shortages.map(
                (shortage: OpenStackCapacityShortage): ReactElement => {
                  return (
                    <ShortageRow
                      key={`${shortage.kind}/${shortage.regionName || ""}/${shortage.id}/${shortage.resourceClass || ""}/${shortage.scope || ""}`}
                      shortage={shortage}
                      routes={routes}
                    />
                  );
                },
              )}
            </ul>
          ) : (
            <p
              className="text-sm text-gray-600"
              data-testid="openstack-capacity-nothing-short"
            >
              {translator.translateText(
                "Nothing is short: every flavor people run has room, and nothing fills up within a quarter at this week's growth.",
              )}
            </p>
          )}
        </Card>
      </div>

      <div className="mb-6">
        <Card
          title={translationKey("By flavor")}
          description={translationKey(
            "How many more of each fit, counted host by host, so what is free but too spread out to use doesn't count.",
          )}
          buttons={[
            {
              title: translationKey("Export CSV"),
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: IconProp.Download,
              onClick: (): void => {
                TableColumnsToCsv.downloadCsv({
                  csv: getOpenStackCapacityCsv({ snapshot, region }),
                  filename: "openstack-capacity.csv",
                });
              },
            },
          ]}
        >
          {view.flavors.length > 0 ? (
            <FlavorsTable
              flavors={view.flavors}
              showRegion={showRegion}
              routes={routes}
            />
          ) : (
            <p className="text-sm text-gray-600">
              {translator.translateText("No flavors have been reported yet.")}
            </p>
          )}
          {snapshot.flavorsLeftOut > 0 ? (
            <p className="mt-2 text-xs text-gray-500">
              {translator.translatePlural(
                {
                  one: "And {{count}} more nobody runs.",
                  other: "And {{count}} more nobody runs.",
                },
                snapshot.flavorsLeftOut,
              )}
            </p>
          ) : (
            <></>
          )}
        </Card>
      </div>

      {view.bareMetalClasses.length > 0 ? (
        <div className="mb-6">
          <Card
            title={translationKey("By bare metal class")}
            description={translationKey(
              "What Placement holds of each resource class a flavor can ask for. A node takes one instance whole, so these are nodes, apart from the vCPUs above. Held back means Nova's Ironic driver can't use it right now.",
            )}
          >
            <BareMetalClassesTable
              classes={view.bareMetalClasses}
              showRegion={showRegion}
            />
            <p
              className="mt-2 text-xs text-gray-500"
              data-testid="openstack-capacity-bare-metal-flavors"
            >
              {translator.translateText(
                "A probe reads which class a flavor asks for, and By flavor counts it against these. The agent's exporter doesn't say, so on the agent a bare metal flavor counts as its vCPUs, memory and disk, on hosts.",
              )}
            </p>
          </Card>
        </div>
      ) : (
        <></>
      )}

      {view.zones.length > 0 ? (
        <div className="mb-6">
          <Card
            title={translationKey("By availability zone")}
            description={translationKey(
              "What has been allocated of what can be, on hosts that can take instances, and whether each zone could lose its largest host and still fit what runs on it.",
            )}
          >
            <ZonesTable
              zones={view.zones}
              forecasts={view.forecasts}
              showRegion={showRegion}
              routes={routes}
            />
          </Card>
        </div>
      ) : (
        <></>
      )}

      {view.forecasts.length > 0 ? (
        <div className="mb-6">
          <Card
            title={translationKey("When things fill up")}
            description={translationKey(
              "At each one's growth over the last week. A new cloud says it hasn't enough history until it has a day of it.",
            )}
          >
            <ForecastsTable
              forecasts={view.forecasts}
              showRegion={showRegion}
            />
          </Card>
        </div>
      ) : (
        <></>
      )}

      {hasInventories ? (
        <div className="mb-6">
          <Card
            title={translationKey("Allocation beside what hosts really use")}
            description={translationKey(
              "Allocation says what has been promised, and this says what is busy. Past what a line can tell you from one week of one workload, moving a ratio is your call.",
            )}
          >
            {hasOvercommit ? (
              <OvercommitTable zones={view.zones} />
            ) : (
              <p
                className="text-sm text-gray-600"
                data-testid="openstack-capacity-no-real-usage"
              >
                {translator.translateText(
                  "No real usage is reaching OneUptime for this cloud, so nothing here can say how far a ratio could move. Point the OpenStack agent at prometheus-libvirt-exporter or Ceilometer's exporter on your compute nodes to add it.",
                )}
              </p>
            )}
          </Card>
        </div>
      ) : (
        <></>
      )}

      {mismatches.length > 0 ? (
        <div className="mb-6" data-testid="openstack-capacity-orphans">
          <Card
            title={translationKey("Allocations no instance explains")}
            description={translationKey(
              "Placement holds more on these hosts than their instances' flavors add up to, and has for a while: usually an orphaned allocation from a failed delete or move, eating capacity until someone clears it.",
            )}
          >
            <ul className="divide-y divide-gray-100">
              {mismatches.map(
                (row: OpenStackCapacityMismatchRow): ReactElement => {
                  return (
                    <li
                      key={`${row.regionName || ""}/${row.hypervisorName}`}
                      className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between"
                      data-testid="openstack-capacity-orphan"
                    >
                      <bdi className="font-medium text-gray-900">
                        {row.hypervisorName}
                      </bdi>
                      <span className="text-gray-600">
                        {translator.translateTemplate(
                          "{{vcpus}} vCPUs and {{memory}} more than its {{count}} instances explain",
                          {
                            vcpus: translator.formatNumber(
                              Math.max(0, row.vcpuExcess),
                            ),
                            memory: formatOpenStackCapacityAmount(
                              "MEMORY_MB",
                              Math.max(0, row.memoryMbExcess),
                            ),
                            count: translator.formatNumber(row.instanceCount),
                          },
                          { setsValuesApart: true },
                        )}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
            <p className="mt-3 text-sm text-gray-700">
              {translator.translateText(
                "To see which, and then to remove them once you've checked each one is really no instance's or migration's:",
              )}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-800">
              {
                "nova-manage placement audit --verbose\nnova-manage placement audit --verbose --delete"
              }
            </pre>
            <p className="mt-2 text-sm">
              <Link
                to={ORPHANED_ALLOCATIONS_DOCS}
                openInNewTab={true}
                className={LINK_CLASS_NAME}
              >
                {translator.translateText(
                  "What Nova's own guide says about orphaned allocations",
                )}
              </Link>
            </p>
          </Card>
        </div>
      ) : (
        <></>
      )}

      {view.aggregates.length > 0 ? (
        <div className="mb-6" data-testid="openstack-capacity-advanced">
          <button
            type="button"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            aria-expanded={isAggregatesOpen}
            data-testid="openstack-capacity-aggregates-toggle"
            onClick={(): void => {
              setIsAggregatesOpen(!isAggregatesOpen);
            }}
          >
            {isAggregatesOpen
              ? translator.translateText("Hide aggregates")
              : translator.translateText("Show aggregates")}
          </button>
          {isAggregatesOpen ? (
            <div className="mt-3">
              <Card
                title={translationKey("By aggregate")}
                description={translationKey(
                  "A host can be in several aggregates, so these don't add up to the zones above.",
                )}
              >
                <AggregatesTable aggregates={view.aggregates} routes={routes} />
              </Card>
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      <p className="text-xs text-gray-500" data-testid="openstack-capacity-age">
        {translator.translateTemplate("Worked out {{time}}.", {
          time: OneUptimeDate.fromNow(new Date(snapshot.generatedAt)),
        })}
      </p>
    </div>
  );
};

export default OpenStackCloudCapacity;
