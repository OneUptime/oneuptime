import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_DEPENDENCY_DEFINITIONS,
  OpenStackDependency,
  OpenStackDependencyDefinition,
} from "Common/Types/OpenStack/OpenStackControlPlane";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import ResourcePartReadError from "../ResourcePart/ResourcePartReadError";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { ResourceAttentionText } from "../ResourcePart/ResourceAttention";
import {
  OpenStackDependencyState,
  OpenStackDependencySummary,
  getOpenStackDependencySummaries,
} from "../../Pages/OpenStack/Utils/OpenStackControlPlaneHealth";
import { fetchOpenStackRows } from "../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "./Part/OpenStackPartRoutes";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";
import { useOpenStackRegion } from "./OpenStackRegionContext";

/*
 * What the cloud stands on, at a glance: RabbitMQ, MariaDB, Memcached, HAProxy, OVN and Open
 * vSwitch, and libvirt. Each says how it is, or says plainly that nobody is reading it,
 * because a green tick on something nobody reads is the worst thing this card could draw.
 *
 * Reads its own rows, so a page mounts it in one line.
 */

// A cloud has a few machines of each, so a page of them is all of them.
export const OPENSTACK_CONTROL_PLANE_ROW_LIMIT: number = 500;

export function fetchOpenStackControlPlaneRows(
  openStackCloudId: ObjectID,
): Promise<Array<OpenStackResource>> {
  return fetchOpenStackRows({
    openStackCloudId,
    kind: OpenStackResourceKind.ControlPlane,
    limit: OPENSTACK_CONTROL_PLANE_ROW_LIMIT,
  });
}

const STATE_CLASS_NAMES: Record<OpenStackDependencyState, string> = {
  Fine: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  NeedsALook: "bg-amber-50 text-amber-700 ring-amber-200",
  Broken: "bg-red-50 text-red-700 ring-red-200",
  NotWatched: "bg-gray-50 text-gray-600 ring-gray-200",
  NoReading: "bg-gray-50 text-gray-600 ring-gray-200",
};

const STATE_WORDS: Record<OpenStackDependencyState, string> = {
  Fine: "Answering",
  NeedsALook: "Needs a look",
  Broken: "Down",
  NotWatched: "Not watched",
  NoReading: "No reading",
};

export const OpenStackDependencyStatePill: FunctionComponent<{
  state: OpenStackDependencyState;
}> = (props: { state: OpenStackDependencyState }): ReactElement => {
  const translator: Translator = useTranslator();
  const word: string = STATE_WORDS[props.state];

  return (
    <span
      data-testid="openstack-control-plane-state"
      data-state={props.state}
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_CLASS_NAMES[props.state]}`}
    >
      {translator.translateText(word) || word}
    </span>
  );
};

/*
 * The line under its name: what is wrong, how many answer, or what would have it read.
 * What nobody named says which setting names it, because that is all it takes.
 */
export function useOpenStackDependencyLine(): (
  summary: OpenStackDependencySummary,
) => string {
  const translator: Translator = useTranslator();

  return (summary: OpenStackDependencySummary): string => {
    const definition: OpenStackDependencyDefinition =
      OPENSTACK_DEPENDENCY_DEFINITIONS[summary.dependency];

    switch (summary.state) {
      case "NotWatched":
        return translator.translateTemplate(
          "Name its targets in {{variable}} to read it.",
          { variable: definition.targetsVariable },
        );
      case "NoReading":
        return (
          translator.translateText(
            "Nothing has been read from it lately, so what it last said isn't shown.",
          ) || ""
        );
      case "Fine":
        return translator.translatePlural(
          {
            one: "{{up}} of {{count}} answering",
            other: "{{up}} of {{count}} answering",
          },
          summary.nodesCurrent,
          { up: translator.formatNumber(summary.nodesUp) },
        );
      default:
        return summary.reasons
          .map((reason: ResourceAttentionText): string => {
            return translator.translateTemplate(
              reason.text,
              reason.values || {},
            );
          })
          .join(" · ");
    }
  };
}

export interface ComponentProps {
  modelId: ObjectID;
}

const VIEW_ALL_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const OpenStackControlPlaneCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const lineOf: (summary: OpenStackDependencySummary) => string =
    useOpenStackDependencyLine();
  const { region } = useOpenStackRegion();
  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(props.modelId);
  }, [props.modelId.toString()]);

  const read: OpenStackRead<Array<OpenStackResource>> = useOpenStackRead<
    Array<OpenStackResource>
  >(() => {
    return fetchOpenStackControlPlaneRows(props.modelId);
  }, [props.modelId.toString()]);

  const summaries: Array<OpenStackDependencySummary> = useMemo(() => {
    return getOpenStackDependencySummaries({
      rows: (read.data || []).filter((row: OpenStackResource): boolean => {
        return !region || row.regionName === region;
      }),
      now: new Date(),
    });
  }, [read.data, region]);

  return (
    <div className="mb-6" data-testid="openstack-control-plane-card">
      <Card
        title="What the cloud stands on"
        description="RabbitMQ, MariaDB, Memcached, HAProxy, OVN and libvirt, from the exporters they already have."
        buttons={[
          <Link
            key="control-plane"
            to={routes.getControlPlaneRoute()}
            className={VIEW_ALL_CLASS_NAME}
            dataTestId="openstack-control-plane-card-all"
          >
            {translator.translateText("View control plane") ||
              "View control plane"}
          </Link>,
        ]}
      >
        {read.error && !read.data ? (
          <ResourcePartReadError
            testId="openstack-control-plane-card-error"
            title="Couldn't load what this cloud stands on"
            message={read.error}
            onRetry={read.reload}
          />
        ) : (
          <ul className={listClassName}>
            {summaries.map(
              (summary: OpenStackDependencySummary): ReactElement => {
                const dependency: OpenStackDependency = summary.dependency;
                const definition: OpenStackDependencyDefinition =
                  OPENSTACK_DEPENDENCY_DEFINITIONS[dependency];
                const route: Route = routes.getDependencyRoute(dependency);

                return (
                  <li
                    key={dependency}
                    data-testid="openstack-control-plane-card-item"
                    data-dependency={dependency}
                    data-state={read.data ? summary.state : "Loading"}
                  >
                    <ResourcePartRow
                      to={route}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div
                          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
                          aria-hidden="true"
                        >
                          <Icon
                            icon={IconProp.Layers}
                            className="h-3.5 w-3.5"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {translator.translateText(definition.title) ||
                              definition.title}
                          </div>
                          <div
                            className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]"
                            data-testid="openstack-control-plane-card-line"
                          >
                            {read.data
                              ? lineOf(summary)
                              : translator.translateText(
                                  definition.description,
                                ) || definition.description}
                          </div>
                        </div>
                      </div>
                      {read.data ? (
                        <div className="flex flex-wrap items-center gap-2 ps-10 sm:flex-none sm:ps-0">
                          <OpenStackDependencyStatePill state={summary.state} />
                        </div>
                      ) : (
                        <></>
                      )}
                    </ResourcePartRow>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default OpenStackControlPlaneCard;
