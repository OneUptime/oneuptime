import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import SideOver, {
  SideOverSize,
} from "Common/UI/Components/SideOver/SideOver";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyIssue,
  ResourceTopologyLinkTarget,
  ResourceTopologyNeighbour,
  ResourceTopologyNode,
  ResourceTopologyText,
  getTopologyAncestors,
  getTopologyNeighbours,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyKindInfo,
  getResourceTopologyKind,
} from "./ResourceTopologyKinds";
import {
  RESOURCE_TOPOLOGY_HEALTH_COLORS,
  RESOURCE_TOPOLOGY_HEALTH_LABELS,
} from "./ResourceTopologyLook";
import {
  describeTopologyAttention,
  renderTopologyText,
  topologyKindLabel,
  topologyNodeName,
  tx,
} from "./ResourceTopologyNodes";

/*
 * What there is to know about one part, beside the map: how it is doing and
 * why, its numbers, the incidents and alerts open on it, what is inside it,
 * what it is related to and where it sits — with its own page one click
 * away, and a focus that narrows the map to it.
 */

export interface ComponentProps {
  graph: ResourceTopologyGraph;
  nodeId: string;
  focusId: string | null;
  onClose: () => void;
  onSelect: (nodeId: string) => void;
  onFocus: (nodeId: string | null) => void;
}

export function routeForTopologyLink(
  link: ResourceTopologyLinkTarget,
): Route {
  return RouteUtil.populateRouteParams(RouteMap[link.page] as Route, {
    modelId: link.modelId,
    ...(link.subModelId ? { subModelId: link.subModelId } : {}),
  });
}

/* "Open host page": what the button that opens a part's own page says. */
export function openPageLabel(
  translator: Translator,
  node: ResourceTopologyNode,
): string {
  const kind: ResourceTopologyKindInfo = getResourceTopologyKind(node.kind);

  return translator.translateTemplate("Open {{kind}}", {
    kind: tx(kind.label, translator),
  });
}

const SectionTitle: FunctionComponent<{ children: string }> = (props: {
  children: string;
}): ReactElement => {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {props.children}
    </h3>
  );
};

const ResourceTopologyDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const node: ResourceTopologyNode | undefined = props.graph.nodes.get(
    props.nodeId,
  );

  if (!node) {
    return null;
  }

  const kindLabel: string = topologyKindLabel(translator, node);
  const status: string = renderTopologyText(translator, node.status);
  const ancestors: Array<ResourceTopologyNode> = getTopologyAncestors(
    props.graph,
    node.id,
  );
  const neighbours: Array<ResourceTopologyNeighbour> = getTopologyNeighbours(
    props.graph,
    node.id,
  );
  const incidents: Array<ResourceTopologyIssue> = node.issues.filter(
    (issue: ResourceTopologyIssue): boolean => {
      return issue.type === "incident";
    },
  );
  const alerts: Array<ResourceTopologyIssue> = node.issues.filter(
    (issue: ResourceTopologyIssue): boolean => {
      return issue.type === "alert";
    },
  );
  const inside: Array<[string, number]> = Array.from(
    node.descendantCountsByKind.entries(),
  ).sort((a: [string, number], b: [string, number]): number => {
    return (
      getResourceTopologyKind(a[0]).order - getResourceTopologyKind(b[0]).order
    );
  });
  const isFocused: boolean = props.focusId === node.id;
  const canFocus: boolean =
    node.parentId !== null &&
    (node.childIds.length > 0 || neighbours.length > 0);
  const description: string = [kindLabel, node.context || ""]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" · ");

  const renderIssue: (issue: ResourceTopologyIssue) => ReactElement = (
    issue: ResourceTopologyIssue,
  ): ReactElement => {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[
        issue.type === "incident" ? PageMap.INCIDENT_VIEW : PageMap.ALERT_VIEW
      ] as Route,
      { modelId: issue.id },
    );

    return (
      <li key={`${issue.type}-${issue.id}`} className="py-2">
        <Link
          to={route}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          {issue.number ? `${issue.number} · ${issue.title}` : issue.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
          {issue.severityName ? (
            <span
              className="font-medium"
              style={{
                color:
                  issue.severityColor ||
                  RESOURCE_TOPOLOGY_HEALTH_COLORS.critical,
              }}
            >
              {issue.severityName}
            </span>
          ) : null}
          {issue.stateName ? <span>{issue.stateName}</span> : null}
          {issue.createdAt ? (
            <span>
              {OneUptimeDate.getDateAsLocalFormattedString(issue.createdAt)}
            </span>
          ) : null}
        </p>
      </li>
    );
  };

  return (
    <SideOver
      title={topologyNodeName(translator, node)}
      description={description}
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      <div className="space-y-6" data-testid="resource-topology-panel">
        <div className="flex flex-wrap gap-2">
          {node.link ? (
            <Link
              to={routeForTopologyLink(node.link)}
              dataTestId="resource-topology-panel-open"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <>
                {openPageLabel(translator, node)}
                <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
              </>
            </Link>
          ) : null}
          {canFocus || isFocused ? (
            <button
              type="button"
              data-testid="resource-topology-panel-focus"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => {
                props.onFocus(isFocused ? null : node.id);
              }}
            >
              <Icon
                icon={isFocused ? IconProp.Expand : IconProp.Collapse}
                className="h-4 w-4"
              />
              {isFocused
                ? tx("Show everything", translator)
                : tx("Focus on this", translator)}
            </button>
          ) : null}
        </div>

        <div>
          <SectionTitle>{tx("Status", translator)}</SectionTitle>
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-900">
            <span
              aria-hidden={true}
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{
                backgroundColor:
                  RESOURCE_TOPOLOGY_HEALTH_COLORS[node.effectiveHealth],
              }}
            />
            <span className="font-medium">
              {tx(RESOURCE_TOPOLOGY_HEALTH_LABELS[node.effectiveHealth], translator)}
            </span>
            {status ? <span className="text-gray-500">· {status}</span> : null}
          </div>
          {(node.reasons || []).length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
              {(node.reasons || []).map(
                (reason: ResourceTopologyText, index: number): ReactElement => {
                  return (
                    <li key={index}>
                      {renderTopologyText(translator, reason)}
                    </li>
                  );
                },
              )}
            </ul>
          ) : null}
        </div>

        {(node.facts || []).length > 0 ? (
          <div>
            <SectionTitle>{tx("Details", translator)}</SectionTitle>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(node.facts || []).map(
                (fact: ResourceTopologyFact): ReactElement => {
                  return (
                    <div key={fact.label}>
                      <dt className="text-xs text-gray-500">
                        {tx(fact.label, translator)}
                      </dt>
                      <dd className="font-medium text-gray-900">
                        {fact.value}
                      </dd>
                    </div>
                  );
                },
              )}
            </dl>
          </div>
        ) : null}

        {node.issues.length > 0 ? (
          <div data-testid="resource-topology-panel-issues">
            {incidents.length > 0 ? (
              <>
                <SectionTitle>
                  {tx("Open incidents", translator)}
                </SectionTitle>
                <ul className="mt-1 divide-y divide-gray-100">
                  {incidents.map(renderIssue)}
                </ul>
              </>
            ) : null}
            {alerts.length > 0 ? (
              <div className={incidents.length > 0 ? "mt-4" : ""}>
                <SectionTitle>
                  {tx("Open alerts", translator)}
                </SectionTitle>
                <ul className="mt-1 divide-y divide-gray-100">
                  {alerts.map(renderIssue)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {inside.length > 0 ? (
          <div>
            <SectionTitle>{tx("Inside", translator)}</SectionTitle>
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {inside.map((entry: [string, number]): ReactElement => {
                const kind: ResourceTopologyKindInfo = getResourceTopologyKind(
                  entry[0],
                );

                return (
                  <li key={entry[0]} className="flex justify-between gap-4">
                    <span>
                      {tx(entry[1] === 1 ? kind.label : kind.plural, translator)}
                    </span>
                    <span className="font-medium text-gray-900">
                      {translator.formatNumber(entry[1])}
                    </span>
                  </li>
                );
              })}
            </ul>
            {node.attentionBelow > 0 ? (
              <p className="mt-2 text-sm font-medium text-amber-700">
                {describeTopologyAttention(translator, node.attentionBelow)}
              </p>
            ) : null}
          </div>
        ) : null}

        {neighbours.length > 0 ? (
          <div>
            <SectionTitle>{tx("Related", translator)}</SectionTitle>
            <ul className="mt-2 space-y-1">
              {neighbours.slice(0, 50).map(
                (neighbour: ResourceTopologyNeighbour): ReactElement | null => {
                  const other: ResourceTopologyNode | undefined =
                    props.graph.nodes.get(neighbour.nodeId);

                  if (!other) {
                    return null;
                  }

                  return (
                    <li key={`${neighbour.label}-${neighbour.nodeId}`}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                        onClick={() => {
                          props.onSelect(other.id);
                        }}
                      >
                        <span
                          aria-hidden={true}
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              RESOURCE_TOPOLOGY_HEALTH_COLORS[
                                other.effectiveHealth
                              ],
                          }}
                        />
                        <span className="text-xs text-gray-500">
                          {tx(neighbour.label, translator)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                          {topologyNodeName(translator, other)}
                        </span>
                      </button>
                    </li>
                  );
                },
              )}
            </ul>
            {neighbours.length > 50 ? (
              <p className="mt-1 text-xs text-gray-500">
                {translator.translateTemplate("And {{count}} more", {
                  count: translator.formatNumber(neighbours.length - 50),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {ancestors.length > 0 ? (
          <div>
            <SectionTitle>{tx("Where it is", translator)}</SectionTitle>
            <nav
              aria-label={tx("Where it is", translator)}
              className="mt-2 flex flex-wrap items-center gap-1 text-sm"
            >
              {ancestors.map(
                (ancestor: ResourceTopologyNode, index: number): ReactElement => {
                  return (
                    <React.Fragment key={ancestor.id}>
                      {index > 0 ? (
                        <Icon
                          icon={IconProp.ChevronRight}
                          className="h-3 w-3 text-gray-400"
                        />
                      ) : null}
                      <button
                        type="button"
                        className="rounded text-indigo-600 hover:underline"
                        onClick={() => {
                          props.onSelect(ancestor.id);
                        }}
                      >
                        {topologyNodeName(translator, ancestor)}
                      </button>
                    </React.Fragment>
                  );
                },
              )}
            </nav>
          </div>
        ) : null}
      </div>
    </SideOver>
  );
};

export default ResourceTopologyDetailPanel;
