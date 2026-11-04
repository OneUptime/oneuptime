import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackRegionSummary } from "Common/Types/OpenStack/OpenStackOverview";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { OPENSTACK_METRIC_DESCRIPTIONS } from "../MetricDescriptions/OpenStackMetricDescriptions";
import { ResourceHealth } from "../ResourcePart/ResourceAttention";
import { RESOURCE_PART_TONE_CLASS_NAMES } from "../ResourcePart/ResourcePartHero";
import ResourcePartReadError from "../ResourcePart/ResourcePartReadError";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { ResourcePartTone } from "../ResourcePart/ResourcePartTypes";
import { getResourceHealthLabel } from "../TelemetryResource/ResourceHeroStatus";
import { getOpenStackPercent } from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";

/*
 * A multi-region cloud at a glance: each region, whether it is healthy by the same rules
 * as the cloud, what it holds and how much of it is promised, one step from reading the
 * whole product for that region. A cloud of one region has nothing to compare, so it has
 * no card. The numbers are what the region can give, so a lost host is not room to spare.
 */

export interface ComponentProps {
  regions: Array<OpenStackRegionSummary>;
  // Each region's health by the rules. Missing while it is read or could not be.
  healthByRegion: Record<string, ResourceHealth>;
  selectedRegion: string | null;
  getRegionRoute: (regionName: string) => Route;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}

const HEALTH_TONES: Record<ResourceHealth, ResourcePartTone> = {
  Healthy: "positive",
  Degraded: "warning",
  Unhealthy: "danger",
};

const OpenStackRegionsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
          {props.regions.map(
            (region: OpenStackRegionSummary): ReactElement => {
              const health: ResourceHealth | undefined =
                props.healthByRegion[region.regionName];
              const tone: ResourcePartTone | undefined = health
                ? HEALTH_TONES[health]
                : undefined;
              const isSelected: boolean =
                props.selectedRegion === region.regionName;
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
                    up: translator.formatNumber(
                      region.apiCount - region.downApiCount,
                    ),
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
                  translator.translateTemplate(
                    "{{percent}} of vCPUs allocated",
                    {
                      percent: `${translator.formatNumber(Math.round(vcpuPercent))}%`,
                    },
                  ),
                );
              }

              return (
                <li
                  key={region.regionName}
                  data-testid="openstack-regions-card-item"
                  data-region={region.regionName}
                  data-health={health || ""}
                  aria-current={isSelected ? "true" : undefined}
                  className={isSelected ? "bg-indigo-50" : ""}
                >
                  <ResourcePartRow
                    to={props.getRegionRoute(region.regionName)}
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
                        <span
                          data-testid="openstack-regions-card-name"
                          className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                        >
                          <bdi>
                            <BreakableName text={region.regionName} />
                          </bdi>
                        </span>
                        {health && tone ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              data-testid="openstack-regions-card-health"
                              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[tone].badge}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${RESOURCE_PART_TONE_CLASS_NAMES[tone].dot}`}
                                aria-hidden="true"
                              />
                              {getResourceHealthLabel({
                                translator: translator,
                                health: health,
                                isConnected: true,
                              })}
                            </span>
                            <InfoTooltip
                              label="Region health"
                              text={OPENSTACK_METRIC_DESCRIPTIONS.regionHealth}
                            />
                          </span>
                        ) : (
                          <></>
                        )}
                      </div>
                      <div
                        data-testid="openstack-regions-card-facts"
                        className="mt-0.5 text-xs text-gray-500"
                      >
                        {facts.map(
                          (fact: string, index: number): ReactElement => {
                            return (
                              <React.Fragment key={fact}>
                                {index > 0 ? " · " : ""}
                                <span className="whitespace-nowrap">
                                  {fact}
                                </span>
                              </React.Fragment>
                            );
                          },
                        )}
                      </div>
                    </div>
                  </ResourcePartRow>
                </li>
              );
            },
          )}
        </ul>
      </Card>
    </div>
  );
};

export default OpenStackRegionsCard;
