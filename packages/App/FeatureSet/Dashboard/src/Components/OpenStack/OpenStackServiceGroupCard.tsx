import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackServiceFamily } from "Common/Types/OpenStack/OpenStackResourceKind";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { getOpenStackTimeInState } from "../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  OpenStackServiceGroup,
  getOpenStackCollectionSeconds,
  getOpenStackServiceTitle,
  getOpenStackStaleAgentIds,
  getOpenStackWorkerFamily,
  getOpenStackWorkerHost,
  getOpenStackWorkerRank,
  isOpenStackApiScrapeFailed,
} from "../../Pages/OpenStack/Utils/OpenStackServices";
import OpenStackStatusCell from "./OpenStackStatusCell";

/*
 * One OpenStack service in one region, in its own words: the API from Keystone's catalog
 * with how long collecting it took, then each worker, with its state, what an operator
 * set on it and why, its host and its zone. What needs someone comes first in the list,
 * and a long list shows what fits and opens the rest in place.
 *
 * Each family keeps its own word for what an operator set, because it is what the same
 * person reads in `openstack compute service list` and `network agent list`: Nova and
 * Cinder say enabled and disabled, Neutron says admin up and down. A worker someone
 * disabled reads Disabled with their reason, whatever it says, and never as a failure.
 */

// How many workers a group lists before "Show all".
export const OPENSTACK_SERVICE_GROUP_WORKERS_SHOWN: number = 8;

export interface ComponentProps {
  group: OpenStackServiceGroup;
  // Keeps the region in the card's title, on a page reading more than one.
  showRegion: boolean;
  // The network backend the agents list reports, on Neutron's card.
  backendName?: string | null | undefined;
  getRowRoute: (row: OpenStackResource) => Route | undefined;
  now: Date;
}

interface WorkerRowProps {
  row: OpenStackResource;
  to?: Route | undefined;
  now: Date;
}

// What an operator set on it, in its service's own word.
export function getOpenStackAdminStateText(
  row: OpenStackResource,
  translator: Translator,
): string {
  if (!row.adminState) {
    return "";
  }
  return getOpenStackWorkerFamily(row) === OpenStackServiceFamily.Network
    ? translator.translateTemplate("Admin {{state}}", {
        state: row.adminState,
      })
    : row.adminState;
}

export const OpenStackWorkerRow: FunctionComponent<WorkerRowProps> = (
  props: WorkerRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { row, now } = props;
  const host: string = getOpenStackWorkerHost(row);
  const staleCount: number = getOpenStackStaleAgentIds(row).length;
  const timeInState: string =
    row.status === "up" && row.adminState !== "disabled" && row.adminState !== "down"
      ? ""
      : getOpenStackTimeInState(row, now);
  const zone: string = row.availabilityZone || "";
  // Planned work, until it has been so long that somebody probably forgot it.
  const isForgotten: boolean = getOpenStackWorkerRank(row, now) === 1;

  const facts: Array<string> = [
    getOpenStackAdminStateText(row, translator),
    timeInState
      ? translator.translateTemplate("for {{duration}}", {
          duration: timeInState,
        })
      : "",
  ].filter((fact: string): boolean => {
    return fact.length > 0;
  });

  return (
    <li
      data-testid="openstack-service-worker"
      data-name={row.name}
      data-host={host}
      data-status={row.status}
      data-admin-state={row.adminState}
    >
      <ResourcePartRow
        to={props.to}
        className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            data-testid="openstack-service-worker-name"
          >
            <bdi>{row.name}</bdi>
          </div>
          <div
            className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]"
            data-testid="openstack-service-worker-where"
          >
            <bdi>
              <BreakableName text={host} />
            </bdi>
            {zone ? (
              <>
                {" · "}
                <bdi>{zone}</bdi>
              </>
            ) : (
              <></>
            )}
          </div>
          {staleCount > 0 ? (
            <div
              className="mt-0.5 text-xs text-amber-700"
              data-testid="openstack-service-worker-stale"
            >
              {translator.translatePlural(
                {
                  one: "{{count}} stale record beside it, left by a crash or a new system-id. The agent is up.",
                  other:
                    "{{count}} stale records beside it, left by a crash or a new system-id. The agent is up.",
                },
                staleCount,
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
        <div
          className={`flex-none text-xs sm:w-32 sm:pt-0.5 ${
            isForgotten ? "font-medium text-amber-700" : "text-gray-500"
          }`}
          data-testid="openstack-service-worker-admin"
        >
          {facts.join(" · ")}
        </div>
        <div
          className="min-w-0 sm:w-48"
          data-testid="openstack-service-worker-state"
        >
          <OpenStackStatusCell
            kind={row.kind}
            status={row.status}
            adminState={row.adminState}
            disabledReason={row.disabledReason}
          />
        </div>
      </ResourcePartRow>
    </li>
  );
};

const OpenStackServiceGroupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const { group } = props;

  const seconds: number | null = getOpenStackCollectionSeconds(group.api);
  const shown: Array<OpenStackResource> = isExpanded
    ? group.workers
    : group.workers.slice(0, OPENSTACK_SERVICE_GROUP_WORKERS_SHOWN);
  const hiddenCount: number = group.workers.length - shown.length;

  return (
    <div
      className="mb-6"
      data-testid="openstack-service-group"
      data-service={group.service}
      data-region={group.regionName || ""}
      data-health={group.health}
    >
      <Card
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span data-testid="openstack-service-group-title">
              <bdi>{getOpenStackServiceTitle(group.service)}</bdi>
            </span>
            {props.backendName ? (
              <span
                data-testid="openstack-service-group-backend"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700"
              >
                <bdi>{props.backendName}</bdi>
              </span>
            ) : (
              <></>
            )}
          </span>
        }
        description={
          props.showRegion && group.regionName ? (
            <span data-testid="openstack-service-group-region">
              <bdi>{group.regionName}</bdi>
            </span>
          ) : undefined
        }
      >
        <ul className={listClassName}>
          {group.api ? (
            <li
              data-testid="openstack-service-api"
              data-status={group.api.status}
            >
              <ResourcePartRow
                to={props.getRowRoute(group.api)}
                className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Icon
                    icon={IconProp.Globe}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  <div className="min-w-0 text-sm font-medium text-gray-900">
                    {translator.translateText("API") || "API"}
                  </div>
                </div>
                <div
                  className="flex-none text-xs text-gray-500 sm:w-32 sm:pt-0.5"
                  data-testid="openstack-service-api-collection"
                >
                  {seconds !== null
                    ? translator.translateTemplate("Collected in {{seconds}}", {
                        seconds: `${translator.formatNumber(
                          Math.round(seconds * 100) / 100,
                        )} s`,
                      })
                    : ""}
                </div>
                <div className="min-w-0 sm:w-48">
                  <OpenStackStatusCell
                    kind={group.api.kind}
                    status={group.api.status}
                    isScrapeFailed={isOpenStackApiScrapeFailed(group.api)}
                  />
                </div>
              </ResourcePartRow>
            </li>
          ) : (
            <></>
          )}
          {group.isLastKnown ? (
            <li
              className="bg-amber-50 px-5 py-2 text-xs text-amber-800 md:px-6"
              data-testid="openstack-service-group-last-known"
            >
              {translator.translateText(
                "Its API isn't answering, so nothing has been able to read these workers since. They read as they last did.",
              )}
            </li>
          ) : (
            <></>
          )}
          {shown.map((row: OpenStackResource): ReactElement => {
            return (
              <OpenStackWorkerRow
                key={row.externalId || row.name}
                row={row}
                to={props.getRowRoute(row)}
                now={props.now}
              />
            );
          })}
          {group.workers.length > OPENSTACK_SERVICE_GROUP_WORKERS_SHOWN ? (
            <li className="px-5 py-3 md:px-6">
              <button
                type="button"
                data-testid="openstack-service-group-toggle"
                aria-expanded={isExpanded}
                onClick={() => {
                  setIsExpanded(!isExpanded);
                }}
                className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon
                  icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
                  className="h-4 w-4"
                />
                {isExpanded
                  ? translator.translateText("Show fewer") || "Show fewer"
                  : translator.translatePlural(
                      {
                        one: "Show {{count}} more",
                        other: "Show {{count}} more",
                      },
                      hiddenCount,
                    )}
              </button>
            </li>
          ) : (
            <></>
          )}
        </ul>
      </Card>
    </div>
  );
};

export default OpenStackServiceGroupCard;
