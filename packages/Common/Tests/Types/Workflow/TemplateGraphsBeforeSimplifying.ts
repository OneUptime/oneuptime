/*
 * THE WORKFLOW TEMPLATES AS THEY WERE BEFORE THEY WERE MADE SIMPLE.
 *
 * The maintainer found the templates far too long - the Zabbix one had 48
 * steps, a Log on every Error output, a Switch / Case over the event's kind
 * and a Find, an If / Else and a Create on each path - and asked for four or
 * five steps each. They were rebuilt on a few new steps (Incident and Alert
 * From Another Tool, Check With JavaScript, API Get By ID, Update Zabbix
 * Problem), and the promise was that each still does the same job.
 *
 * This is what the promise is checked against: every template's graph as
 * the create wizard built it before the rebuild (buildGraphForTemplate), and
 * the Huntress connections' graphs (buildHuntressIncidentWorkflowGraph) for
 * the settings a connection could have, frozen from Templates.ts at
 * d9a64eeca4a7c38af37154c4f75f10459f69d3d4. The equivalence suites
 * (*TemplateEquivalence.test.ts) run the old graph and the new template on
 * the same sample payloads, against the same project, and expect the same
 * incidents and alerts, the same notes and state changes, the same requests
 * to the other tool and the same pages.
 *
 * Gzipped JSON (1.2 MB of graphs, most of it the old scripts): it is never
 * regenerated, since what it records is gone from Templates.ts. Not a test
 * file itself (jest only collects *.test.ts).
 */

import { JSONObject } from "../../../Types/JSON";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const FIXTURE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "Fixtures",
  "WorkflowTemplateGraphsBeforeSimplifying.json.gz",
);

interface FrozenGraphs {
  source: string;
  templates: Record<string, JSONObject>;
  huntressConnections: Record<string, { options: JSONObject; graph: JSONObject }>;
}

let frozen: FrozenGraphs | null = null;

const read: () => FrozenGraphs = (): FrozenGraphs => {
  if (!frozen) {
    frozen = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(FIXTURE_PATH)).toString("utf-8"),
    ) as FrozenGraphs;
  }

  return frozen;
};

// A deep copy, so a run that edits its graph never edits the next one's.
const copied: (value: JSONObject) => JSONObject = (
  value: JSONObject,
): JSONObject => {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
};

export type GetTemplateGraphBeforeSimplifyingFunction = (
  templateId: string,
) => JSONObject;

// The graph a template built before it was made simple.
export const getTemplateGraphBeforeSimplifying: GetTemplateGraphBeforeSimplifyingFunction =
  (templateId: string): JSONObject => {
    const graph: JSONObject | undefined = read().templates[templateId];

    if (!graph) {
      throw new Error(`No template ${templateId} was frozen.`);
    }

    return copied(graph);
  };

export type GetTemplateIdsBeforeSimplifyingFunction = () => Array<string>;

// Every template there was, in the picker's order.
export const getTemplateIdsBeforeSimplifying: GetTemplateIdsBeforeSimplifyingFunction =
  (): Array<string> => {
    return Object.keys(read().templates);
  };

/*
 * The Huntress connections' graphs, by the settings they were built with:
 * pages-low, pages-high and pages-critical page from that severity up;
 * pages-nobody pages nobody; notes-closes adds a note instead of resolving.
 */
export type HuntressConnectionBeforeSimplifyingFunction = (variant: string) => {
  options: JSONObject;
  graph: JSONObject;
};

export const getHuntressConnectionBeforeSimplifying: HuntressConnectionBeforeSimplifyingFunction =
  (variant: string): { options: JSONObject; graph: JSONObject } => {
    const found: { options: JSONObject; graph: JSONObject } | undefined =
      read().huntressConnections[variant];

    if (!found) {
      throw new Error(`No Huntress connection ${variant} was frozen.`);
    }

    return { options: copied(found.options), graph: copied(found.graph) };
  };

export type GetFrozenSourceFunction = () => string;

// Where the graphs were built from.
export const getFrozenSource: GetFrozenSourceFunction = (): string => {
  return read().source;
};
