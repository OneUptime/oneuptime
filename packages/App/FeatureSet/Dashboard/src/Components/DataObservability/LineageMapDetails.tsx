import AppLink from "../AppLink/AppLink";
import { formatOverdue } from "./DataObservabilityFormat";
import { CardButton } from "./LineageMapList";
import {
  getLineageMapDashboardUrl,
  getLineageMapNodeIcon,
  getLineageMapNodeRoute,
  getLineageMapNodeSubtitle,
  getLineageMapOpenLabel,
} from "./LineageMapWords";
import { getRunStatePill } from "../../Pages/DataObservability/Pipelines";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import {
  DataLineageMap,
  DataLineageMapEdge,
  DataLineageMapNode,
  DataLineageMapNodeKind,
  DataLineageMapTrace,
} from "Common/Types/DataObservability/DataLineageMap";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * THE CARD A READER SELECTED ON THE LINEAGE MAP (#9114): what it is and how
 * it is now, the cards right before and after it - its data's sources and
 * what reads it - with how many more lie further each way, and its page
 * one click away. "Show Only Its Lineage" leaves only the card and what is
 * upstream and downstream of it on the map.
 */

const COMES_FROM: string = translationKey("Comes from");
const GOES_TO: string = translationKey("Goes to");
const NOTHING_UPSTREAM: string = translationKey(
  "Nothing on the map writes or feeds it.",
);
const NOTHING_DOWNSTREAM: string = translationKey(
  "Nothing on the map reads it or is built from it.",
);
const MORE_UPSTREAM: PluralTemplate = {
  one: "{{count}} more further upstream",
  other: "{{count}} more further upstream",
};
const MORE_DOWNSTREAM: PluralTemplate = {
  one: "{{count}} more further downstream",
  other: "{{count}} more further downstream",
};
const OPEN_ALERTS: PluralTemplate = {
  one: "{{count}} open alert",
  other: "{{count}} open alerts",
};
const SHOW_ONLY: string = translationKey("Show Only Its Lineage");
const SHOW_ALL: string = translationKey("Show the Whole Map");
const CLOSE: string = translationKey("Close");

function nodeStatus(
  node: DataLineageMapNode,
  translator: Translator,
): ReactElement {
  if (node.kind === DataLineageMapNodeKind.Pipeline) {
    return getRunStatePill(node.lastRunState || undefined, PillSize.Small);
  }

  if (node.kind !== DataLineageMapNodeKind.Table) {
    return <></>;
  }

  const pills: Array<ReactElement> = [];

  if (node.isDropped) {
    pills.push(
      <Pill
        key="dropped"
        text={translationKey("Dropped")}
        color={Gray500}
        size={PillSize.Small}
      />,
    );
  }

  if ((node.openAlertCount || 0) > 0) {
    pills.push(
      <Pill
        key="alerts"
        text={translator.translatePlural(OPEN_ALERTS, node.openAlertCount!)}
        isUserContent={true}
        color={Red500}
        size={PillSize.Small}
      />,
    );
  }

  if (!node.isDropped && node.freshness === DataAssetFreshness.Late) {
    pills.push(
      <Pill
        key="late"
        text={formatOverdue(translator, node.lateBySeconds || 0)}
        isUserContent={true}
        color={Red500}
        size={PillSize.Small}
      />,
    );
  } else if (!node.isDropped && node.freshness === DataAssetFreshness.Fresh) {
    pills.push(
      <Pill
        key="fresh"
        text={translationKey("Fresh")}
        color={Green500}
        size={PillSize.Small}
      />,
    );
  }

  return <>{pills}</>;
}

export interface ComponentProps {
  node: DataLineageMapNode;
  // The map as drawn now: the neighbours it names are the ones on it.
  map: DataLineageMap;
  trace: DataLineageMapTrace;
  isShowingOnlyItsLineage: boolean;
  onShowOnlyItsLineage: (isOn: boolean) => void;
  onSelect: (nodeId: string | null) => void;
}

const LineageMapDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const node: DataLineageMapNode = props.node;
  const route: Route | null = getLineageMapNodeRoute(node);
  const dashboardUrl: URL | null = getLineageMapDashboardUrl(node);
  const openLabel: string = getLineageMapOpenLabel(node);

  const { before, after } = useMemo((): {
    before: Array<DataLineageMapNode>;
    after: Array<DataLineageMapNode>;
  } => {
    const byId: Map<string, DataLineageMapNode> = new Map(
      props.map.nodes.map(
        (other: DataLineageMapNode): [string, DataLineageMapNode] => {
          return [other.id, other];
        },
      ),
    );
    const sources: Set<string> = new Set();
    const targets: Set<string> = new Set();

    for (const edge of props.map.edges as Array<DataLineageMapEdge>) {
      if (edge.target === node.id) {
        sources.add(edge.source);
      }

      if (edge.source === node.id) {
        targets.add(edge.target);
      }
    }

    const named: (ids: Set<string>) => Array<DataLineageMapNode> = (
      ids: Set<string>,
    ): Array<DataLineageMapNode> => {
      return Array.from(ids)
        .map((id: string): DataLineageMapNode | undefined => {
          return byId.get(id);
        })
        .filter((other: DataLineageMapNode | undefined): boolean => {
          return Boolean(other);
        })
        .sort(
          (
            a: DataLineageMapNode | undefined,
            b: DataLineageMapNode | undefined,
          ) => {
            return a!.name.localeCompare(b!.name);
          },
        ) as Array<DataLineageMapNode>;
    };

    return { before: named(sources), after: named(targets) };
  }, [props.map, node.id]);

  const section: (data: {
    title: string;
    empty: string;
    cards: Array<DataLineageMapNode>;
    further: number;
    more: PluralTemplate;
    testId: string;
  }) => ReactElement = (data: {
    title: string;
    empty: string;
    cards: Array<DataLineageMapNode>;
    further: number;
    more: PluralTemplate;
    testId: string;
  }): ReactElement => {
    return (
      <div className="min-w-0" data-testid={data.testId}>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {translator.translateText(data.title)}
        </h4>
        {data.cards.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">
            {translator.translateText(data.empty)}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {data.cards.map((card: DataLineageMapNode): ReactElement => {
              return (
                <li key={card.id} className="min-w-0">
                  <CardButton
                    node={card}
                    isSelected={false}
                    onSelect={(nodeId: string): void => {
                      props.onSelect(nodeId);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {data.further > 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            {translator.translatePlural(data.more, data.further)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const subtitle: string = getLineageMapNodeSubtitle(node, translator);

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4"
      aria-label={node.name}
      data-testid="lineage-map-details"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            icon={getLineageMapNodeIcon(node)}
            className="mt-0.5 h-5 w-5 shrink-0 text-gray-400"
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">
              <IsolatedText text={node.name} />
            </h3>
            {subtitle ? (
              <p className="truncate text-xs text-gray-500">{subtitle}</p>
            ) : (
              <></>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {nodeStatus(node, translator)}
            </div>
          </div>
        </div>
        <Button
          title=""
          ariaLabel={CLOSE}
          icon={IconProp.Close}
          buttonStyle={ButtonStyleType.ICON}
          buttonSize={ButtonSize.Small}
          dataTestId="lineage-map-details-close"
          onClick={(): void => {
            props.onSelect(null);
          }}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {section({
          title: COMES_FROM,
          empty: NOTHING_UPSTREAM,
          cards: before,
          further: Math.max(0, props.trace.upstream.size - before.length),
          more: MORE_UPSTREAM,
          testId: "lineage-map-details-upstream",
        })}
        {section({
          title: GOES_TO,
          empty: NOTHING_DOWNSTREAM,
          cards: after,
          further: Math.max(0, props.trace.downstream.size - after.length),
          more: MORE_DOWNSTREAM,
          testId: "lineage-map-details-downstream",
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {route ? (
          <AppLink
            to={route}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            dataTestId="lineage-map-details-open"
          >
            <span>{translator.translateText(openLabel)}</span>
          </AppLink>
        ) : dashboardUrl ? (
          <Link
            to={dashboardUrl}
            openInNewTab={true}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            dataTestId="lineage-map-details-open"
          >
            <span>{translator.translateText(openLabel)}</span>
          </Link>
        ) : (
          <></>
        )}
        <Button
          title={props.isShowingOnlyItsLineage ? SHOW_ALL : SHOW_ONLY}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          dataTestId="lineage-map-details-only"
          onClick={(): void => {
            props.onShowOnlyItsLineage(!props.isShowingOnlyItsLineage);
          }}
        />
      </div>
    </section>
  );
};

export default LineageMapDetails;
