import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackRegionSummary } from "Common/Types/OpenStack/OpenStackOverview";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useId } from "react";
import { OPENSTACK_METRIC_DESCRIPTIONS } from "../MetricDescriptions/OpenStackMetricDescriptions";
import {
  ResourceAttentionItem,
  ResourceHealth,
} from "../ResourcePart/ResourceAttention";
import ResourceHealthPill, {
  ResourceHealthDialogWords,
} from "../ResourcePart/ResourceHealthPill";
import ResourcePartReadError from "../ResourcePart/ResourcePartReadError";
import ResourcePartRow, {
  ResourcePartRowControls,
  ResourcePartRowName,
} from "../ResourcePart/ResourcePartRow";
import { getOpenStackPercent } from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

/*
 * A multi-region cloud at a glance: each region, whether it is healthy by the same rules
 * as the cloud, what it holds and how much of it is promised, one step from reading the
 * whole product for that region. A cloud of one region has nothing to compare, so it has
 * no card. The numbers are what the region can give, so a lost host is not room to spare.
 *
 * A region's Degraded or Unhealthy opens why, as the cloud's own health pill does: the
 * parts of that region that need attention, from the Overview's list (#9728). The pill is
 * a control of its own, so the row is not one link around it: the region's name is the
 * link, stretched over the row, and the pill and its (i) sit above it (ResourcePartRow's
 * hasControls). The keyboard reaches the name, then the pill, then the (i); a screen
 * reader hears the name, with the row's facts read after it.
 */

// What a region's Degraded or Unhealthy opens, its name in the title.
export const OPENSTACK_REGION_HEALTH_WORDS: ResourceHealthDialogWords = {
  degradedTitle: translationKey("Why region {{name}} is Degraded"),
  unhealthyTitle: translationKey("Why region {{name}} is Unhealthy"),
};

export interface ComponentProps {
  regions: Array<OpenStackRegionSummary>;
  // Each region's health by the rules. Missing while it is read or could not be.
  healthByRegion: Record<string, ResourceHealth>;
  /*
   * What needs attention in each region, as the Overview lists it: what its Degraded or
   * Unhealthy opens.
   */
  attentionByRegion: Record<string, Array<ResourceAttentionItem>>;
  selectedRegion: string | null;
  getRegionRoute: (regionName: string) => Route;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}

/*
 * One region's row: its name the link to its pages, its health a control of its own
 * beside it, and what it holds under them.
 */
const RegionRow: FunctionComponent<{
  region: OpenStackRegionSummary;
  health: ResourceHealth | undefined;
  items: Array<ResourceAttentionItem>;
  isSelected: boolean;
  route: Route;
}> = (props: {
  region: OpenStackRegionSummary;
  health: ResourceHealth | undefined;
  items: Array<ResourceAttentionItem>;
  isSelected: boolean;
  route: Route;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const factsId: string = useId();
  const region: OpenStackRegionSummary = props.region;
  const vcpuPercent: number | null = getOpenStackPercent(
    region.vcpuAllocated,
    region.vcpuCapacity,
  );

  const facts: Array<string> = [
    translator.translatePlural(
      {
        one: "{{up}} of {{count}} API up",
        other: "{{up}} of {{count}} APIs up",
      },
      region.apiCount,
      {
        up: translator.formatNumber(region.apiCount - region.downApiCount),
      },
    ),
  ];
  if (region.downServiceCount > 0) {
    facts.push(
      translator.translatePlural(
        {
          one: "{{count}} worker down",
          other: "{{count}} workers down",
        },
        region.downServiceCount,
      ),
    );
  }
  if (region.hypervisorCount > 0) {
    facts.push(
      translator.translatePlural(
        {
          one: "{{count}} hypervisor",
          other: "{{count}} hypervisors",
        },
        region.hypervisorCount,
      ),
    );
  }
  facts.push(
    translator.translatePlural(
      { one: "{{count}} instance", other: "{{count}} instances" },
      region.instanceCount,
    ),
  );
  if (vcpuPercent !== null) {
    facts.push(
      translator.translateTemplate("{{percent}} of vCPUs allocated", {
        percent: `${translator.formatNumber(Math.round(vcpuPercent))}%`,
      }),
    );
  }

  return (
    <ResourcePartRow
      to={props.route}
      hasControls={true}
      className="flex items-start gap-3"
    >
      <div
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
        aria-hidden="true"
      >
        <Icon icon={IconProp.Globe} className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ResourcePartRowName
            dataTestId="openstack-regions-card-name"
            className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            describedBy={factsId}
            ariaCurrent={props.isSelected ? "true" : undefined}
          >
            <bdi>
              <BreakableName text={region.regionName} />
            </bdi>
          </ResourcePartRowName>
          {props.health ? (
            <ResourcePartRowControls className="inline-flex items-center gap-1">
              {/*
               * Healthy is a word; Degraded or Unhealthy opens why, from the parts of
               * this region that need attention.
               */}
              <ResourceHealthPill
                health={props.health}
                isConnected={true}
                items={props.items}
                testId="openstack-regions-card-health"
                words={{
                  ...OPENSTACK_REGION_HEALTH_WORDS,
                  titleValues: { name: region.regionName },
                }}
              />
              <InfoTooltip
                label="Region health"
                text={OPENSTACK_METRIC_DESCRIPTIONS.regionHealth}
              />
            </ResourcePartRowControls>
          ) : (
            <></>
          )}
        </div>
        <div
          id={factsId}
          data-testid="openstack-regions-card-facts"
          className="mt-0.5 text-xs text-gray-500"
        >
          {facts.map((fact: string, index: number): ReactElement => {
            return (
              <React.Fragment key={fact}>
                {index > 0 ? <InlineSeparator /> : null}
                <span className="whitespace-nowrap">{fact}</span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </ResourcePartRow>
  );
};

const OpenStackRegionsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const listClassName: string = useCardRuledListClassName();

  if (props.error) {
    return (
      <div className="mb-6">
        <ResourcePartReadError
          testId="openstack-regions-card-error"
          title="Couldn't read this cloud's regions"
          message={props.error}
          onRetry={props.onRetry || ((): void => {})}
        />
      </div>
    );
  }

  if (props.regions.length < 2) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="openstack-regions-card">
      <Card
        title="Regions"
        description="Each region of this cloud, by the same rules as its health. Open one to read every page for that region."
      >
        <ul className={listClassName}>
          {props.regions.map((region: OpenStackRegionSummary): ReactElement => {
            const health: ResourceHealth | undefined =
              props.healthByRegion[region.regionName];
            const isSelected: boolean =
              props.selectedRegion === region.regionName;

            return (
              <li
                key={region.regionName}
                data-testid="openstack-regions-card-item"
                data-region={region.regionName}
                data-health={health || ""}
                className={isSelected ? "bg-indigo-50" : ""}
              >
                <RegionRow
                  region={region}
                  health={health}
                  items={props.attentionByRegion[region.regionName] || []}
                  isSelected={isSelected}
                  route={props.getRegionRoute(region.regionName)}
                />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default OpenStackRegionsCard;
