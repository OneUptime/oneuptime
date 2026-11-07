import { JSONObject, JSONValue } from "../../Types/JSON";
import { NodeType } from "../../Types/Workflow/Component";
import stableStringify from "../StableStringify";

/*
 * A WORKFLOW'S GRAPH AS IT IS KEPT.
 *
 * The builder's canvas holds more than the workflow. Each card carries its
 * component's catalog entry (metadata), what the checks say about it
 * (error, issueSummary), whether it is selected or being dragged and what
 * it measured; each connection, how it is drawn. None of that is the
 * workflow's, and all of it changes when the workflow does not: a click
 * selects a card, a badge makes it taller.
 *
 * toSavedWorkflowGraph is the graph as the builder saves it, keeps it in its
 * undo history and gets it back as a version: every card with its id, type,
 * position and step, every connection with its ends - nothing of the
 * canvas's. getWorkflowGraphKey tells two graphs apart exactly when they
 * differ in that, whatever order their cards, connections and keys come in
 * (jsonb hands a saved graph back with its keys in an order of its own), so
 * a click that only selects a card saves nothing, and a version is written
 * only when the graph changed.
 *
 * The empty slot where a trigger goes is the canvas's as well: the builder
 * draws one, under a new id, every time it opens a workflow that has no
 * trigger. It is saved, as the builder always saved it, but it is no part of
 * the key. Pure: no DOM, no server.
 */

export interface SavedWorkflowGraph {
  nodes: Array<JSONObject>;
  edges: Array<JSONObject>;
}

// What the canvas keeps on a card, never the workflow.
const CARD_KEYS_NOT_SAVED: ReadonlySet<string> = new Set<string>([
  "selected",
  "dragging",
  "positionAbsolute",
  "width",
  "height",
  "resizing",
]);

// What the canvas keeps on a step: its catalog entry and what the checks say.
const STEP_KEYS_NOT_SAVED: ReadonlySet<string> = new Set<string>([
  "metadata",
  "error",
  "onClick",
  "issueSummary",
]);

// How the canvas draws a connection.
const CONNECTION_KEYS_NOT_SAVED: ReadonlySet<string> = new Set<string>([
  "type",
  "style",
  "markerEnd",
  "selected",
  "animated",
]);

const isObject: (value: unknown) => value is JSONObject = (
  value: unknown,
): value is JSONObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const asText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

/*
 * A graph as it arrives: the canvas's nodes and edges, a graph as saved, or
 * that graph as JSON text. Anything else is an empty graph.
 */
const readGraphObject: (graph: unknown) => JSONObject | null = (
  graph: unknown,
): JSONObject | null => {
  if (typeof graph === "string") {
    try {
      const parsed: unknown = JSON.parse(graph);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isObject(graph) ? graph : null;
};

const listOf: (value: unknown) => Array<JSONObject> = (
  value: unknown,
): Array<JSONObject> => {
  return Array.isArray(value) ? value.filter(isObject) : [];
};

/*
 * A copy of `value` that shares nothing with it: plain JSON, so what the
 * canvas does to its own objects afterwards never reaches what was kept.
 * Functions (a card's click handler) and undefined are left out, as
 * JSON leaves them out.
 */
const copyOf: (value: unknown) => JSONValue = (value: unknown): JSONValue => {
  if (value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as JSONValue;
};

const copyWithout: (
  record: JSONObject,
  keysNotKept: ReadonlySet<string>,
) => JSONObject = (
  record: JSONObject,
  keysNotKept: ReadonlySet<string>,
): JSONObject => {
  const copy: JSONObject = {};

  for (const key of Object.keys(record)) {
    const value: unknown = record[key];

    if (
      keysNotKept.has(key) ||
      value === undefined ||
      typeof value === "function"
    ) {
      continue;
    }

    copy[key] = copyOf(value);
  }

  return copy;
};

export const getEmptyWorkflowGraph: () => SavedWorkflowGraph =
  (): SavedWorkflowGraph => {
    return { nodes: [], edges: [] };
  };

/*
 * The graph as it is saved: the canvas's nodes and edges without what only
 * the canvas keeps (see the sets above). A copy: nothing in it is shared
 * with what it was made from.
 */
export const toSavedWorkflowGraph: (graph: unknown) => SavedWorkflowGraph = (
  graph: unknown,
): SavedWorkflowGraph => {
  const graphObject: JSONObject | null = readGraphObject(graph);

  if (!graphObject) {
    return getEmptyWorkflowGraph();
  }

  return {
    nodes: listOf(graphObject["nodes"]).map((node: JSONObject): JSONObject => {
      const card: JSONObject = copyWithout(node, CARD_KEYS_NOT_SAVED);

      if (isObject(node["data"])) {
        card["data"] = copyWithout(node["data"], STEP_KEYS_NOT_SAVED);
      }

      return card;
    }),
    edges: listOf(graphObject["edges"]).map((edge: JSONObject): JSONObject => {
      return copyWithout(edge, CONNECTION_KEYS_NOT_SAVED);
    }),
  };
};

const isPlaceholder: (node: JSONObject) => boolean = (
  node: JSONObject,
): boolean => {
  return (
    isObject(node["data"]) &&
    node["data"]["nodeType"] === NodeType.PlaceholderNode
  );
};

const readPosition: (node: JSONObject) => JSONValue = (
  node: JSONObject,
): JSONValue => {
  const position: unknown = node["position"];

  if (!isObject(position)) {
    return null;
  }

  return {
    x: typeof position["x"] === "number" ? position["x"] : null,
    y: typeof position["y"] === "number" ? position["y"] : null,
  };
};

interface KeyedCard {
  id: string;
  type: JSONValue;
  position?: JSONValue;
  data: JSONObject;
}

const keyedCards: (
  graphObject: JSONObject | null,
  withPositions: boolean,
) => Array<KeyedCard> = (
  graphObject: JSONObject | null,
  withPositions: boolean,
): Array<KeyedCard> => {
  return listOf(graphObject?.["nodes"])
    .filter((node: JSONObject): boolean => {
      return !isPlaceholder(node);
    })
    .map((node: JSONObject): KeyedCard => {
      const data: JSONObject = isObject(node["data"])
        ? copyWithout(node["data"], STEP_KEYS_NOT_SAVED)
        : {};
      const card: KeyedCard = {
        id: asText(node["id"]),
        type: typeof node["type"] === "string" ? node["type"] : null,
        data,
      };

      if (withPositions) {
        card.position = readPosition(node);
      }

      return card;
    })
    .sort((a: KeyedCard, b: KeyedCard): number => {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
};

const keyedConnections: (graphObject: JSONObject | null) => Array<string> = (
  graphObject: JSONObject | null,
): Array<string> => {
  return listOf(graphObject?.["edges"])
    .map((edge: JSONObject): string => {
      return stableStringify({
        source: asText(edge["source"]),
        sourceHandle: asText(edge["sourceHandle"]),
        target: asText(edge["target"]),
        targetHandle: asText(edge["targetHandle"]),
      });
    })
    .sort();
};

/*
 * Text that is the same for two graphs exactly when they are the same
 * workflow drawn the same way: the same cards (by id, with their type,
 * position and step) and the same connections (by their ends). With
 * ignorePositions, two graphs that differ only in where cards sit read the
 * same.
 */
export const getWorkflowGraphKey: (
  graph: unknown,
  options?: { ignorePositions?: boolean | undefined } | undefined,
) => string = (
  graph: unknown,
  options?: { ignorePositions?: boolean | undefined } | undefined,
): string => {
  const graphObject: JSONObject | null = readGraphObject(graph);

  return stableStringify({
    nodes: keyedCards(graphObject, !options?.ignorePositions),
    edges: keyedConnections(graphObject),
  });
};

export const isSameWorkflowGraph: (first: unknown, second: unknown) => boolean =
  (first: unknown, second: unknown): boolean => {
    return getWorkflowGraphKey(first) === getWorkflowGraphKey(second);
  };

/*
 * The cards that moved from one graph to the other, by id, when moving them
 * is all that changed; null when anything else changed too. An empty list
 * when nothing changed at all.
 */
export const getCardsOnlyMoved: (
  before: unknown,
  after: unknown,
) => Array<string> | null = (
  before: unknown,
  after: unknown,
): Array<string> | null => {
  if (
    getWorkflowGraphKey(before, { ignorePositions: true }) !==
    getWorkflowGraphKey(after, { ignorePositions: true })
  ) {
    return null;
  }

  const positionsBefore: Map<string, string> = new Map<string, string>(
    keyedCards(readGraphObject(before), true).map(
      (card: KeyedCard): [string, string] => {
        return [card.id, stableStringify(card.position)];
      },
    ),
  );

  return keyedCards(readGraphObject(after), true)
    .filter((card: KeyedCard): boolean => {
      return positionsBefore.get(card.id) !== stableStringify(card.position);
    })
    .map((card: KeyedCard): string => {
      return card.id;
    });
};
