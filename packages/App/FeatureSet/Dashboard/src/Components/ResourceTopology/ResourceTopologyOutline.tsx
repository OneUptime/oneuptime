import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyKindInfo,
  getResourceTopologyKind,
} from "./ResourceTopologyKinds";
import {
  ResourceTopologyCardItem,
  ResourceTopologyChipItem,
  ResourceTopologyGroupItem,
  ResourceTopologyMoreItem,
  ResourceTopologyOutlineRow,
  ResourceTopologyVisible,
  flattenResourceTopologyView,
} from "./ResourceTopologyView";
import {
  IssueBadges,
  ResourceTopologyNodeCallbacks,
  TopologyName,
  describeTopologyAttention,
  describeTopologyContents,
  describeTopologyPart,
  renderTopologyText,
  topologyKindLabel,
  topologyNodeName,
  tx,
} from "./ResourceTopologyNodes";
import { RESOURCE_TOPOLOGY_HEALTH_COLORS } from "./ResourceTopologyLook";

/*
 * The same view as the map, as a list: every part a row, indented under
 * what holds it, with the same groups, the same "+ N more" and the same
 * open and close. It is the map for a screen reader, the faster read for
 * someone who wants names rather than shapes, and the default on a phone,
 * where a map is pinch-and-pan.
 */

export interface ComponentProps {
  graph: ResourceTopologyGraph;
  visible: ResourceTopologyVisible;
  selectedId: string | null;
  callbacks: ResourceTopologyNodeCallbacks;
}

const INDENT_PX: number = 18;
/*
 * A phone indents less, and leaves the kind's icon to the words under the
 * name: a pod three levels down keeps room for its name.
 */
const PHONE_INDENT_PX: number = 12;
const PHONE_WIDTH_PX: number = 640;

const ResourceTopologyOutline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<ResourceTopologyOutlineRow> = flattenResourceTopologyView(
    props.visible,
  );
  const indent: number =
    typeof window !== "undefined" && window.innerWidth < PHONE_WIDTH_PX
      ? PHONE_INDENT_PX
      : INDENT_PX;

  const renderPart: (
    item: ResourceTopologyCardItem | ResourceTopologyChipItem,
    level: number,
  ) => ReactElement | null = (
    item: ResourceTopologyCardItem | ResourceTopologyChipItem,
    level: number,
  ): ReactElement | null => {
    const node: ResourceTopologyNode | undefined = props.graph.nodes.get(
      item.nodeId,
    );

    if (!node) {
      return null;
    }

    const kind: ResourceTopologyKindInfo = getResourceTopologyKind(node.kind);
    const card: ResourceTopologyCardItem | null =
      item.type === "card" ? item : null;
    const status: string = renderTopologyText(translator, node.status);
    const selected: boolean = props.selectedId === node.id;
    const contents: string =
      card && card.canOpen && !card.isOpen
        ? describeTopologyContents(translator, node)
        : "";

    return (
      <div
        role="listitem"
        key={item.id}
        data-testid={`resource-topology-row-${node.id}`}
        data-health={node.effectiveHealth}
        className={`flex items-center gap-1 border-b border-gray-100 py-1.5 pr-3 ${selected ? "bg-indigo-50" : ""}`}
        style={{ paddingInlineStart: 8 + level * indent }}
      >
        {card && card.canOpen ? (
          <button
            type="button"
            data-testid={`resource-topology-row-toggle-${node.id}`}
            aria-expanded={card.isOpen}
            aria-label={translator.translateTemplate(
              card.isOpen ? "Close {{name}}" : "Open {{name}}",
              { name: topologyNodeName(translator, node) },
            )}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              props.callbacks.onToggleOpen(node.id, !card.isOpen);
            }}
          >
            <Icon
              icon={card.isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
              className="h-3.5 w-3.5"
            />
          </button>
        ) : (
          <span className="w-6 flex-shrink-0" aria-hidden={true} />
        )}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={describeTopologyPart(translator, node)}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item.isMatch ? "ring-1 ring-indigo-300" : ""}`}
          onClick={() => {
            props.callbacks.onSelect(node.id);
          }}
        >
          <span
            aria-hidden={true}
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{
              backgroundColor:
                RESOURCE_TOPOLOGY_HEALTH_COLORS[node.effectiveHealth],
            }}
          />
          <span
            aria-hidden={true}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md max-sm:hidden"
            style={{ color: kind.color, backgroundColor: `${kind.color}1f` }}
          >
            <Icon icon={kind.icon} className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <TopologyName
                name={topologyNodeName(translator, node)}
                refitKey={node.issues.length}
                className="truncate text-sm font-medium text-gray-900"
              />
              <IssueBadges node={node} compact={true} />
            </span>
            <span className="block truncate text-xs text-gray-500">
              {[status, topologyKindLabel(translator, node), contents]
                .filter((part: string): boolean => {
                  return part.length > 0;
                })
                .join(" · ")}
            </span>
          </span>
          {card && !card.isOpen && node.attentionBelow > 0 ? (
            <span className="flex-shrink-0 text-xs font-medium text-amber-700 max-sm:hidden sm:inline">
              {describeTopologyAttention(translator, node.attentionBelow)}
            </span>
          ) : null}
        </button>
      </div>
    );
  };

  const renderGroup: (
    group: ResourceTopologyGroupItem,
    level: number,
  ) => ReactElement = (
    group: ResourceTopologyGroupItem,
    level: number,
  ): ReactElement => {
    const kind: ResourceTopologyKindInfo = getResourceTopologyKind(group.kind);

    return (
      <div
        role="listitem"
        key={group.id}
        className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 py-1 pr-3 text-xs text-gray-500"
        style={{ paddingInlineStart: 8 + level * indent + 24 }}
      >
        <span className="font-semibold uppercase tracking-wide text-gray-600">
          {tx(kind.plural, translator)}
        </span>
        <span>{translator.formatNumber(group.total)}</span>
        {group.attention > 0 ? (
          <span className="font-medium text-amber-700">
            {describeTopologyAttention(translator, group.attention)}
          </span>
        ) : null}
        {group.isShownInFull || group.more?.canShowAll ? (
          <button
            type="button"
            className="ml-auto font-medium text-indigo-600 hover:text-indigo-800"
            onClick={() => {
              props.callbacks.onToggleGroup(group.groupKey);
            }}
          >
            {group.isShownInFull
              ? tx("Show fewer", translator)
              : translator.translateTemplate("Show all {{count}}", {
                  count: translator.formatNumber(group.total),
                })}
          </button>
        ) : null}
      </div>
    );
  };

  const renderMore: (
    more: ResourceTopologyMoreItem,
    level: number,
  ) => ReactElement = (
    more: ResourceTopologyMoreItem,
    level: number,
  ): ReactElement => {
    return (
      <div
        role="listitem"
        key={more.id}
        className="border-b border-gray-100 py-1.5 pr-3"
        style={{ paddingInlineStart: 8 + level * indent + 24 }}
      >
        <button
          type="button"
          disabled={!more.canShowAll}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:text-gray-500"
          onClick={() => {
            props.callbacks.onToggleGroup(more.groupKey);
          }}
        >
          {translator.translateTemplate("+ {{count}} more", {
            count: translator.formatNumber(more.hiddenCount),
          })}
          {more.hiddenAttention > 0 ? (
            <span className="ml-2 text-xs text-amber-700">
              {describeTopologyAttention(translator, more.hiddenAttention)}
            </span>
          ) : null}
        </button>
      </div>
    );
  };

  return (
    <div
      role="list"
      aria-label={tx("Topology", translator)}
      data-testid="resource-topology-outline"
      className="max-h-[70vh] overflow-y-auto"
    >
      {rows.map((row: ResourceTopologyOutlineRow): ReactElement | null => {
        if (row.item.type === "group") {
          return renderGroup(row.item, row.level);
        }

        if (row.item.type === "more") {
          return renderMore(row.item, row.level);
        }

        return renderPart(row.item, row.level);
      })}
    </div>
  );
};

export default ResourceTopologyOutline;
