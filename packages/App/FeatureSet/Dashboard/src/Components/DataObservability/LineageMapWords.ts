import { getDataAssetKindText } from "./DataAssetKindWords";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  DataLineageMapEdge,
  DataLineageMapEdgeKind,
  DataLineageMapEvidence,
  DataLineageMapNode,
  DataLineageMapNodeKind,
} from "Common/Types/DataObservability/DataLineageMap";
import DataAssetKind from "Common/Types/DataObservability/DataAssetKind";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  PluralTemplate,
  Translator,
  formatInline,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE LINEAGE MAP'S WORDS AND LINKS (#9114): what a card is called and
 * opens, what an arrow says, shared by the map's drawing, its list and the
 * card a reader selects, so each says a thing the same way.
 */

export const KIND_COUNTS: Readonly<
  Record<DataLineageMapNodeKind, PluralTemplate>
> = {
  [DataLineageMapNodeKind.Service]: {
    one: "{{count}} service",
    other: "{{count}} services",
  },
  [DataLineageMapNodeKind.Table]: {
    one: "{{count}} table",
    other: "{{count}} tables",
  },
  [DataLineageMapNodeKind.Pipeline]: {
    one: "{{count}} pipeline",
    other: "{{count}} pipelines",
  },
  [DataLineageMapNodeKind.Dashboard]: {
    one: "{{count}} dashboard",
    other: "{{count}} dashboards",
  },
};

// The kinds a reader can leave off the map, as the switches name them.
export const KIND_SWITCH_LABELS: Readonly<
  Partial<Record<DataLineageMapNodeKind, string>>
> = {
  [DataLineageMapNodeKind.Service]: translationKey("Services"),
  [DataLineageMapNodeKind.Pipeline]: translationKey("Pipelines"),
  [DataLineageMapNodeKind.Dashboard]: translationKey("Dashboards"),
};

// What an arrow does, read from its start to its end.
export const EDGE_VERBS: Readonly<Record<DataLineageMapEdgeKind, string>> = {
  [DataLineageMapEdgeKind.Feeds]: translationKey("feeds"),
  [DataLineageMapEdgeKind.Writes]: translationKey("writes"),
  [DataLineageMapEdgeKind.Reads]: translationKey("is read by"),
};

export const EVIDENCE_WORDS: Readonly<Record<DataLineageMapEvidence, string>> =
  {
    [DataLineageMapEvidence.Pipeline]: translationKey("Pipeline run"),
    [DataLineageMapEvidence.QueryHistory]: translationKey("Query history"),
    [DataLineageMapEvidence.ViewDefinition]: translationKey("View definition"),
    [DataLineageMapEvidence.Traces]: translationKey("Traces"),
    [DataLineageMapEvidence.BiTool]: translationKey("BI tool"),
  };

const MOVED_BY: string = translationKey("Moved by {{pipelines}}");
const SERVICE: string = translationKey("Service");
const PIPELINE: string = translationKey("Pipeline");
const DASHBOARD: string = translationKey("Dashboard");

// As a table's lineage diagram draws them.
const ASSET_KIND_ICONS: Readonly<Record<string, IconProp>> = {
  [DataAssetKind.View]: IconProp.Eye,
  [DataAssetKind.MaterializedView]: IconProp.Eye,
  [DataAssetKind.StoragePath]: IconProp.CloudArrowDown,
};

export function getLineageMapNodeIcon(node: DataLineageMapNode): IconProp {
  switch (node.kind) {
    case DataLineageMapNodeKind.Service:
      return IconProp.Code;
    case DataLineageMapNodeKind.Pipeline:
      return IconProp.Workflow;
    case DataLineageMapNodeKind.Dashboard:
      return IconProp.ChartBar;
    default:
      return ASSET_KIND_ICONS[node.assetKind || ""] || IconProp.TableCells;
  }
}

// The line under a card's name: where a table lives and what it is, what kind of card the rest are.
export function getLineageMapNodeSubtitle(
  node: DataLineageMapNode,
  translator: Translator,
): string {
  switch (node.kind) {
    case DataLineageMapNodeKind.Service:
      return translator.translateText(SERVICE) || SERVICE;
    case DataLineageMapNodeKind.Pipeline:
      return (
        node.jobNamespace || translator.translateText(PIPELINE) || PIPELINE
      );
    case DataLineageMapNodeKind.Dashboard:
      return node.tool || translator.translateText(DASHBOARD) || DASHBOARD;
    default:
      return formatInline(
        [
          node.database || "",
          node.assetKind
            ? getDataAssetKindText(translator, node.assetKind)
            : "",
        ].filter(Boolean),
        translator,
      );
  }
}

// The page a card opens in OneUptime; null for a dashboard, opened in its tool, or a service known only by name.
export function getLineageMapNodeRoute(node: DataLineageMapNode): Route | null {
  if (node.kind === DataLineageMapNodeKind.Table && node.dataAssetId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
      { modelId: new ObjectID(node.dataAssetId) },
    );
  }

  if (node.kind === DataLineageMapNodeKind.Pipeline && node.dataPipelineId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW] as Route,
      { modelId: new ObjectID(node.dataPipelineId) },
    );
  }

  if (node.kind === DataLineageMapNodeKind.Service && node.serviceId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SERVICE_VIEW] as Route,
      { modelId: new ObjectID(node.serviceId) },
    );
  }

  return null;
}

const WEB_ADDRESS_REGEX: RegExp = /^https?:\/\//i;

// A dashboard's link in its tool, when the tool gave one on the web.
export function getLineageMapDashboardUrl(
  node: DataLineageMapNode,
): URL | null {
  if (
    node.kind !== DataLineageMapNodeKind.Dashboard ||
    !node.url ||
    !WEB_ADDRESS_REGEX.test(node.url)
  ) {
    return null;
  }

  try {
    return URL.fromString(node.url);
  } catch {
    return null;
  }
}

// What the button that opens a card's page says.
export function getLineageMapOpenLabel(node: DataLineageMapNode): string {
  switch (node.kind) {
    case DataLineageMapNodeKind.Service:
      return translationKey("View Service");
    case DataLineageMapNodeKind.Pipeline:
      return translationKey("View Pipeline");
    case DataLineageMapNodeKind.Dashboard:
      return translationKey("Open Dashboard");
    default:
      return translationKey("View Table");
  }
}

/*
 * Where an arrow was seen, in a line: each place, then the pipelines that
 * move its data, and the statements a service ran - "Pipeline run ·
 * Moved by orders_etl", "Traces · INSERT, UPDATE".
 */
export function getLineageMapEdgeEvidence(
  edge: DataLineageMapEdge,
  translator: Translator,
): string {
  const parts: Array<string> = edge.seenIn.map(
    (evidence: DataLineageMapEvidence): string => {
      const words: string = EVIDENCE_WORDS[evidence];
      return translator.translateText(words) || words;
    },
  );

  if (edge.pipelines.length > 0) {
    parts.push(
      translator.translateTemplate(MOVED_BY, {
        pipelines: edge.pipelines
          .map((pipeline: { name: string }): string => {
            return pipeline.name;
          })
          .join(", "),
      }),
    );
  }

  if (edge.operations.length > 0) {
    parts.push(edge.operations.join(", "));
  }

  return formatInline(parts, translator);
}
