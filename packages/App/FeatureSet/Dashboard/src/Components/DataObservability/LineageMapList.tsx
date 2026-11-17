import {
  EDGE_VERBS,
  getLineageMapEdgeEvidence,
  getLineageMapNodeIcon,
} from "./LineageMapWords";
import OneUptimeDate from "Common/Types/Date";
import {
  DataLineageMap,
  DataLineageMapEdge,
  DataLineageMapNode,
} from "Common/Types/DataObservability/DataLineageMap";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  PluralTemplate,
  Translator,
  getInlineSeparator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * THE LINEAGE MAP AS A LIST (#9114): every arrow on it as a line that reads
 * from its start to its end - "orders_etl writes public.orders",
 * "public.orders is read by checkout" - with where it was seen and when.
 * It is what a phone shows first, and what a screen reader reads: the same
 * cards and arrows as the drawing, each card a button that selects it as a
 * click on the drawing does.
 */

// The most lines drawn at once: a search narrows the rest.
export const MAX_LINEAGE_MAP_LIST_ROWS: number = 300;

const SHOWING_SOME: PluralTemplate = {
  one: "Showing {{shown}} of {{count}} flow. Search to narrow them.",
  other: "Showing {{shown}} of {{count}} flows. Search to narrow them.",
};

export const CardButton: FunctionComponent<{
  node: DataLineageMapNode | undefined;
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
}> = (props: {
  node: DataLineageMapNode | undefined;
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
}): ReactElement => {
  if (!props.node) {
    return <></>;
  }

  const node: DataLineageMapNode = props.node;

  return (
    <button
      type="button"
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded px-1 text-start text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isSelected ? "text-indigo-700" : "text-gray-900"
      }`}
      aria-pressed={props.isSelected}
      data-testid="lineage-map-list-card"
      onClick={(): void => {
        props.onSelect(node.id);
      }}
    >
      <Icon
        icon={getLineageMapNodeIcon(node)}
        className="h-4 w-4 shrink-0 text-gray-400"
      />
      <IsolatedText text={node.name} className="min-w-0 truncate" />
    </button>
  );
};

function compareEdges(
  byId: Map<string, DataLineageMapNode>,
): (a: DataLineageMapEdge, b: DataLineageMapEdge) => number {
  const nameOf: (id: string) => string = (id: string): string => {
    return byId.get(id)?.name || id;
  };

  return (a: DataLineageMapEdge, b: DataLineageMapEdge): number => {
    return (
      nameOf(a.source).localeCompare(nameOf(b.source)) ||
      nameOf(a.target).localeCompare(nameOf(b.target))
    );
  };
}

export interface ComponentProps {
  map: DataLineageMap;
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
}

const LineageMapList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const byId: Map<string, DataLineageMapNode> = useMemo(() => {
    return new Map(
      props.map.nodes.map(
        (node: DataLineageMapNode): [string, DataLineageMapNode] => {
          return [node.id, node];
        },
      ),
    );
  }, [props.map]);
  const edges: Array<DataLineageMapEdge> = useMemo(() => {
    return [...props.map.edges].sort(compareEdges(byId));
  }, [props.map, byId]);
  const shown: Array<DataLineageMapEdge> = edges.slice(
    0,
    MAX_LINEAGE_MAP_LIST_ROWS,
  );
  const select: (nodeId: string) => void = (nodeId: string): void => {
    props.onSelect(nodeId === props.selectedNodeId ? null : nodeId);
  };

  return (
    <div data-testid="lineage-map-list">
      <ul className="divide-y divide-gray-100">
        {shown.map((edge: DataLineageMapEdge): ReactElement => {
          const verb: string = EDGE_VERBS[edge.kind];
          const evidence: string = getLineageMapEdgeEvidence(edge, translator);

          return (
            <li
              key={edge.id}
              className="flex flex-col gap-1 py-3"
              data-testid="lineage-map-flow"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <CardButton
                  node={byId.get(edge.source)}
                  isSelected={edge.source === props.selectedNodeId}
                  onSelect={select}
                />
                <span className="text-sm text-gray-500">
                  {translator.translateText(verb)}
                </span>
                <CardButton
                  node={byId.get(edge.target)}
                  isSelected={edge.target === props.selectedNodeId}
                  onSelect={select}
                />
              </div>
              <p className="ps-1 text-xs text-gray-500">
                {evidence}
                {edge.lastSeenAt ? (
                  <span className="whitespace-nowrap">
                    {evidence ? getInlineSeparator(translator.language) : ""}
                    {OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(edge.lastSeenAt),
                    )}
                  </span>
                ) : (
                  <></>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      {edges.length > shown.length ? (
        <p
          className="pt-3 text-xs text-gray-500"
          data-testid="lineage-map-list-more"
        >
          {translator.translatePlural(SHOWING_SOME, edges.length, {
            shown: translator.formatNumber(shown.length),
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default LineageMapList;
