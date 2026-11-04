import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import {
  OpenStackServiceGroup,
  getOpenStackServiceTitle,
  isOpenStackApiScrapeFailed,
} from "../../Pages/OpenStack/Utils/OpenStackServices";
import OpenStackStatusCell from "./OpenStackStatusCell";

/*
 * The control plane at a glance: each OpenStack service, whether its API answers and how
 * many of its workers are up, what is down first, one step from its page. The Services
 * page has every worker by name.
 */

// How many services the card lists before it points to the Services page.
export const OPENSTACK_SERVICES_CARD_SHOWN: number = 6;

export interface ComponentProps {
  groups: Array<OpenStackServiceGroup>;
  // The whole list's route, where the card's button leads.
  servicesRoute: Route;
  // A service's page: its API's, when it has reported one.
  getRowRoute: (row: OpenStackResource) => Route | undefined;
  showRegion: boolean;
}

const VIEW_ALL_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const OpenStackServicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  if (props.groups.length === 0) {
    return <></>;
  }

  const shown: Array<OpenStackServiceGroup> = props.groups.slice(
    0,
    OPENSTACK_SERVICES_CARD_SHOWN,
  );

  return (
    <div className="mb-6" data-testid="openstack-services-card">
      <Card
        title="Services"
        description="Each OpenStack service's API and workers, what is down first."
        buttons={[
          <Link
            key="all-services"
            to={props.servicesRoute}
            className={VIEW_ALL_CLASS_NAME}
            dataTestId="openstack-services-card-all"
          >
            {translator.translateText("View all services") ||
              "View all services"}
          </Link>,
        ]}
      >
        <ul className={listClassName}>
          {shown.map((group: OpenStackServiceGroup): ReactElement => {
            const facts: Array<string> = [];
            if (group.counts.total > 0) {
              facts.push(
                translator.translatePlural(
                  {
                    one: "{{up}} of {{count}} worker up",
                    other: "{{up}} of {{count}} workers up",
                  },
                  group.counts.total,
                  { up: translator.formatNumber(group.counts.up) },
                ),
              );
            }
            if (group.counts.disabled > 0) {
              facts.push(
                translator.translatePlural(
                  { one: "{{count}} disabled", other: "{{count}} disabled" },
                  group.counts.disabled,
                ),
              );
            }

            return (
              <li
                key={group.key}
                data-testid="openstack-services-card-item"
                data-service={group.service}
                data-region={group.regionName || ""}
                data-health={group.health}
              >
                <ResourcePartRow
                  to={
                    group.api
                      ? props.getRowRoute(group.api)
                      : props.servicesRoute
                  }
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
                      aria-hidden="true"
                    >
                      <Icon icon={IconProp.Activity} className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        <bdi data-testid="openstack-services-card-name">
                          {getOpenStackServiceTitle(group.service)}
                        </bdi>
                        {props.showRegion && group.regionName ? (
                          <span className="ms-2 text-xs font-normal text-gray-500">
                            <bdi>
                              <BreakableName text={group.regionName} />
                            </bdi>
                          </span>
                        ) : (
                          <></>
                        )}
                      </div>
                      {facts.length > 0 ? (
                        <div
                          className="mt-0.5 text-xs text-gray-500"
                          data-testid="openstack-services-card-facts"
                        >
                          {facts.join(" · ")}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex flex-wrap items-center gap-2 ps-10 sm:flex-none sm:ps-0"
                    data-testid="openstack-services-card-state"
                  >
                    {group.counts.down > 0 ? (
                      <span
                        data-testid="openstack-services-card-down"
                        className="inline-flex whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200"
                      >
                        {translator.translatePlural(
                          {
                            one: "{{count}} worker down",
                            other: "{{count}} workers down",
                          },
                          group.counts.down,
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    {group.api ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs text-gray-500"
                        data-testid="openstack-services-card-api"
                      >
                        {translator.translateText("API") || "API"}
                        <OpenStackStatusCell
                          kind={group.api.kind}
                          status={group.api.status}
                          isScrapeFailed={isOpenStackApiScrapeFailed(group.api)}
                          showReason={false}
                        />
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                </ResourcePartRow>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default OpenStackServicesCard;
