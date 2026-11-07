import { JSONObject, JSONValue } from "../JSON";
import stableStringify from "../../Utils/StableStringify";
import { NodeType } from "./Component";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpressionKind,
  parseReferencePath,
  parseTemplateExpressions,
} from "./TemplateSyntax";
import {
  GetWorkflowComponentFunction,
  WorkflowDraft,
  WorkflowDraftConnection,
  WorkflowDraftStep,
  buildGraphFromDraft,
  checkWorkflowDraft,
  getDraftValueKey,
} from "./WorkflowDraft";

/*
 * ASK AI'S CHANGE, APPROVED AFTER THE WORKFLOW WAS SAVED AGAIN (issue #6274).
 *
 * Ask AI changes a workflow in two steps. It proposes a draft - every step
 * and connection the workflow should have - and the card the person approves
 * says what the draft does to the workflow as it was then. Between the two,
 * anyone can save the workflow: a teammate in the Builder, the API, or the
 * person themselves in the Builder beside the panel. The draft knows nothing
 * of what they saved, so saving it as it is would take their change out,
 * and the card the person approved never said so.
 *
 * So the proposal keeps what the change was made to (proposeWorkflowDraft):
 * the workflow's graph revision (Workflow.graphRevision), and a fingerprint
 * of each step the change touches - a step it adds, removes or changes, a
 * step at either end of a connection it makes or takes out, and a step that
 * a step it writes reads from ({{local.components.<id>...}}). Nothing else of
 * the workflow matters to the change, so nothing else is kept.
 *
 * Approved while the workflow is still at that revision, the draft is saved
 * as it always was. Approved after another save, it is made on top of that
 * save (rebaseWorkflowDraft), but only when every step the change touches is
 * still as it was: the other save changed other steps. Then every step and
 * connection the change does not touch is the workflow's as it is now, with
 * whatever was saved, and the ones it touches are the draft's - exactly the
 * change the card described, on the workflow as it is. Otherwise nothing is
 * saved: the two changes meet, and only the person can say which way, so
 * Ask AI reads the workflow again and proposes its change once more.
 *
 * A fingerprint is a digest of what the step is: its component, its settings
 * as saved, what leads into it and where it leads. Never where its card sits
 * - a card moved is no change to what the workflow does, and the moves are
 * kept. Settings are compared as the approval card compares them
 * (getDraftValueKey), an unset setting as unset. The digest is the caller's
 * to give, and must be keyed: it reads settings as saved, secrets and all,
 * and what a change was proposed on goes back to the model with the change.
 *
 * Pure: no database, no clock.
 */

// A step a change touches, and its fingerprint when the change was proposed.
export interface WorkflowDraftProposedStep {
  id: string;
  // Null: the workflow had no step with this id.
  fingerprint: string | null;
}

export interface WorkflowDraftProposedOn {
  // The workflow's graph revision when the change was proposed.
  graphRevision: number;
  steps: Array<WorkflowDraftProposedStep>;
}

// A keyed digest of a step's text: the same text gives the same fingerprint.
export type WorkflowDraftDigestFunction = (text: string) => string;

// More than any draft can touch: a draft has 100 steps at most, and so has what it replaces.
const MAX_PROPOSED_STEPS: number = 1000;

const MAX_FINGERPRINT_LENGTH: number = 128;

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

type ReadProposedOnFunction = (
  value: unknown,
) => WorkflowDraftProposedOn | null;

/*
 * What a change was proposed on, as its arguments carry it, or null when they
 * carry nothing well formed. They are stored with the change and come back
 * with it, so they are read as untrusted.
 */
export const readWorkflowDraftProposedOn: ReadProposedOnFunction = (
  value: unknown,
): WorkflowDraftProposedOn | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  const graphRevision: unknown = value["graphRevision"];
  const steps: unknown = value["steps"];

  if (
    typeof graphRevision !== "number" ||
    !Number.isSafeInteger(graphRevision) ||
    graphRevision < 0 ||
    !Array.isArray(steps) ||
    steps.length > MAX_PROPOSED_STEPS
  ) {
    return null;
  }

  const read: Array<WorkflowDraftProposedStep> = [];
  const seen: Set<string> = new Set<string>();

  for (const step of steps) {
    if (!isPlainObject(step)) {
      return null;
    }

    const id: unknown = step["id"];
    const fingerprint: unknown = step["fingerprint"];

    if (typeof id !== "string" || id.length === 0 || seen.has(id)) {
      return null;
    }

    if (
      fingerprint !== null &&
      (typeof fingerprint !== "string" ||
        fingerprint.length === 0 ||
        fingerprint.length > MAX_FINGERPRINT_LENGTH)
    ) {
      return null;
    }

    seen.add(id);
    read.push({ id: id, fingerprint: fingerprint as string | null });
  }

  return { graphRevision: graphRevision, steps: read };
};

// A step of a stored graph, by the id it goes by, with its settings as saved.
interface StoredStep {
  id: string;
  componentId: string;
  arguments: JSONObject;
}

interface StoredSteps {
  steps: Array<StoredStep>;
  connections: Array<WorkflowDraftConnection>;
}

type ReadStoredStepsFunction = (
  graph: JSONObject | null | undefined,
) => StoredSteps;

/*
 * The steps and connections of a stored graph, read as a draft reads them
 * (getDraftFromGraph) - the slot where a trigger goes is no step, and a
 * connection to no step is none - but with every setting as it is saved: a
 * secret too, which a draft shows as hidden.
 */
const readStoredSteps: ReadStoredStepsFunction = (
  graph: JSONObject | null | undefined,
): StoredSteps => {
  const nodes: unknown = graph?.["nodes"];
  const edges: unknown = graph?.["edges"];
  const steps: Array<StoredStep> = [];
  const stepIdByNodeId: Map<string, string> = new Map<string, string>();

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!isPlainObject(node) || !isPlainObject(node["data"])) {
      continue;
    }

    const data: JSONObject = node["data"];
    const id: unknown = data["id"];

    if (
      typeof id !== "string" ||
      !id ||
      data["nodeType"] === NodeType.PlaceholderNode
    ) {
      continue;
    }

    steps.push({
      id: id,
      componentId:
        typeof data["metadataId"] === "string" ? data["metadataId"] : "",
      arguments: isPlainObject(data["arguments"]) ? data["arguments"] : {},
    });

    if (typeof node["id"] === "string") {
      stepIdByNodeId.set(node["id"], id);
    }
  }

  const connections: Array<WorkflowDraftConnection> = [];

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!isPlainObject(edge)) {
      continue;
    }

    const from: string | undefined =
      typeof edge["source"] === "string"
        ? stepIdByNodeId.get(edge["source"])
        : undefined;
    const to: string | undefined =
      typeof edge["target"] === "string"
        ? stepIdByNodeId.get(edge["target"])
        : undefined;

    if (!from || !to) {
      continue;
    }

    const fromOutput: unknown = edge["sourceHandle"];

    connections.push({
      from: from,
      to: to,
      ...(typeof fromOutput === "string" && fromOutput
        ? { fromOutput: fromOutput }
        : {}),
    });
  }

  return { steps: steps, connections: connections };
};

type GetSettingsKeyFunction = (settings: JSONObject) => string;

// A step's settings as text, an unset setting ("", null) as one left out.
const getSettingsKey: GetSettingsKeyFunction = (
  settings: JSONObject,
): string => {
  const set: JSONObject = {};

  for (const settingId of Object.keys(settings)) {
    const value: JSONValue | undefined = settings[settingId];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    set[settingId] = value;
  }

  return getDraftValueKey(set);
};

type GetStepContentKeyFunction = (steps: Array<StoredStep>) => string;

// What steps of one id are, as text: their components and their settings.
const getStepContentKey: GetStepContentKeyFunction = (
  steps: Array<StoredStep>,
): string => {
  return stableStringify(
    steps.map((step: StoredStep): Array<string> => {
      return [step.componentId, getSettingsKey(step.arguments)];
    }),
  );
};

type GetConnectionKeyFunction = (connection: WorkflowDraftConnection) => string;

const getConnectionKey: GetConnectionKeyFunction = (
  connection: WorkflowDraftConnection,
): string => {
  return stableStringify([
    connection.from,
    connection.fromOutput || "",
    connection.to,
  ]);
};

type DescribeStepFunction = (
  stored: StoredSteps,
  stepId: string,
) => string | null;

/*
 * What a step is, as the text its fingerprint is a digest of: its component,
 * its settings, what leads into it and where it leads - never where its card
 * sits. Null for a step the graph does not have.
 */
const describeStep: DescribeStepFunction = (
  stored: StoredSteps,
  stepId: string,
): string | null => {
  const steps: Array<StoredStep> = stored.steps.filter(
    (step: StoredStep): boolean => {
      return step.id === stepId;
    },
  );

  if (steps.length === 0) {
    return null;
  }

  return stableStringify({
    step: getStepContentKey(steps),
    leadsTo: stored.connections
      .filter((connection: WorkflowDraftConnection): boolean => {
        return connection.from === stepId;
      })
      .map((connection: WorkflowDraftConnection): string => {
        return getConnectionKey(connection);
      })
      .sort(),
    ledInto: stored.connections
      .filter((connection: WorkflowDraftConnection): boolean => {
        return connection.to === stepId;
      })
      .map((connection: WorkflowDraftConnection): string => {
        return getConnectionKey(connection);
      })
      .sort(),
  });
};

type FingerprintStepsFunction = (data: {
  graph: JSONObject | null | undefined;
  stepIds: Array<string>;
  digest: WorkflowDraftDigestFunction;
}) => Array<WorkflowDraftProposedStep>;

// The fingerprints of these steps of a graph, in their order: null for one it does not have.
export const fingerprintWorkflowSteps: FingerprintStepsFunction = (data: {
  graph: JSONObject | null | undefined;
  stepIds: Array<string>;
  digest: WorkflowDraftDigestFunction;
}): Array<WorkflowDraftProposedStep> => {
  const stored: StoredSteps = readStoredSteps(data.graph);

  return data.stepIds.map((stepId: string): WorkflowDraftProposedStep => {
    const text: string | null = describeStep(stored, stepId);

    return {
      id: stepId,
      fingerprint: text === null ? null : data.digest(text),
    };
  });
};

type CollectStringsFunction = (value: JSONValue | undefined) => Array<string>;

// Every text in a setting, however deep in its JSON.
const collectStrings: CollectStringsFunction = (
  value: JSONValue | undefined,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: JSONValue): Array<string> => {
      return collectStrings(item);
    });
  }

  if (isPlainObject(value)) {
    return Object.values(value).flatMap(
      (item: JSONValue | undefined): Array<string> => {
        return collectStrings(item);
      },
    );
  }

  return [];
};

const EACH_TAG: string = "#each";

type GetStepsReadFunction = (settings: JSONObject) => Array<string>;

/*
 * The steps settings read the results of, by id: every
 * {{local.components.<id>.returnValues...}}, and every loop over one
 * ({{#each local.components.<id>...}}). Found the way the runtime finds them
 * (parseTemplateExpressions), in time in line with the text's length.
 */
export const getStepsReadBySettings: GetStepsReadFunction = (
  settings: JSONObject,
): Array<string> => {
  const read: Set<string> = new Set<string>();

  for (const text of collectStrings(settings)) {
    for (const expression of parseTemplateExpressions(text)) {
      let path: string | null = null;

      if (expression.kind === TemplateExpressionKind.Reference) {
        path = expression.inner;
      } else if (expression.kind === TemplateExpressionKind.EachOpen) {
        path = expression.inner.slice(EACH_TAG.length).trim();
      }

      if (!path) {
        continue;
      }

      const parsed: ParsedReferencePath = parseReferencePath(path);

      if (
        parsed.rootType === ReferenceRootType.ComponentReturnValue &&
        parsed.componentId
      ) {
        read.add(parsed.componentId);
      }
    }
  }

  return Array.from(read).sort();
};

type GroupStepsFunction = (
  steps: Array<StoredStep>,
) => Map<string, Array<StoredStep>>;

const groupStepsById: GroupStepsFunction = (
  steps: Array<StoredStep>,
): Map<string, Array<StoredStep>> => {
  const groups: Map<string, Array<StoredStep>> = new Map<
    string,
    Array<StoredStep>
  >();

  for (const step of steps) {
    groups.set(step.id, [...(groups.get(step.id) || []), step]);
  }

  return groups;
};

type GetStepsTouchedFunction = (data: {
  draft: WorkflowDraft;
  graph: JSONObject | null | undefined;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
}) => Array<string>;

/*
 * The steps a draft that has passed checkWorkflowDraft touches, saved over
 * `graph`, by id: the steps it adds, removes or changes (another component,
 * or other settings), both ends of every connection it makes or takes out,
 * and every step a step it adds or changes reads from. Compared as they
 * would be saved (buildGraphFromDraft), so a setting written back hidden is
 * no change, and a card that only keeps its place is not touched.
 */
export const getStepsTouchedByDraft: GetStepsTouchedFunction = (data: {
  draft: WorkflowDraft;
  graph: JSONObject | null | undefined;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
}): Array<string> => {
  const before: StoredSteps = readStoredSteps(data.graph);
  const after: StoredSteps = readStoredSteps(
    buildGraphFromDraft({
      draft: data.draft,
      getComponent: data.getComponent,
      generateId: data.generateId,
      existingGraph: data.graph,
    }),
  );

  const beforeById: Map<string, Array<StoredStep>> = groupStepsById(
    before.steps,
  );
  const afterById: Map<string, Array<StoredStep>> = groupStepsById(after.steps);

  const touched: Set<string> = new Set<string>();
  // The steps whose own settings the draft writes: the ones it adds or changes.
  const written: Set<string> = new Set<string>();

  for (const stepId of new Set<string>([
    ...beforeById.keys(),
    ...afterById.keys(),
  ])) {
    const was: Array<StoredStep> | undefined = beforeById.get(stepId);
    const is: Array<StoredStep> | undefined = afterById.get(stepId);

    if (!was || !is || getStepContentKey(was) !== getStepContentKey(is)) {
      touched.add(stepId);

      if (is) {
        written.add(stepId);
      }
    }
  }

  const connectionsBefore: Set<string> = new Set<string>(
    before.connections.map(getConnectionKey),
  );
  const connectionsAfter: Set<string> = new Set<string>(
    after.connections.map(getConnectionKey),
  );

  for (const connection of before.connections) {
    if (!connectionsAfter.has(getConnectionKey(connection))) {
      touched.add(connection.from);
      touched.add(connection.to);
    }
  }

  for (const connection of after.connections) {
    if (!connectionsBefore.has(getConnectionKey(connection))) {
      touched.add(connection.from);
      touched.add(connection.to);
    }
  }

  for (const step of after.steps) {
    if (!written.has(step.id)) {
      continue;
    }

    for (const stepRead of getStepsReadBySettings(step.arguments)) {
      touched.add(stepRead);
    }
  }

  return Array.from(touched).sort();
};

type ProposeWorkflowDraftFunction = (data: {
  draft: WorkflowDraft;
  graph: JSONObject | null | undefined;
  graphRevision: number;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
  digest: WorkflowDraftDigestFunction;
}) => WorkflowDraftProposedOn;

/*
 * What a draft that has passed checkWorkflowDraft is proposed on: the
 * revision of `graph`, the workflow as it is when the change is proposed,
 * and the fingerprint there of every step the draft touches.
 */
export const proposeWorkflowDraft: ProposeWorkflowDraftFunction = (data: {
  draft: WorkflowDraft;
  graph: JSONObject | null | undefined;
  graphRevision: number;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
  digest: WorkflowDraftDigestFunction;
}): WorkflowDraftProposedOn => {
  return {
    graphRevision: data.graphRevision,
    steps: fingerprintWorkflowSteps({
      graph: data.graph,
      stepIds: getStepsTouchedByDraft({
        draft: data.draft,
        graph: data.graph,
        getComponent: data.getComponent,
        generateId: data.generateId,
      }),
      digest: data.digest,
    }),
  };
};

export enum WorkflowDraftRebaseKind {
  // The change, made on top of what was saved since it was proposed.
  Rebased = "Rebased",
  // The change and what was saved since meet: nothing can be saved.
  Conflict = "Conflict",
}

export type WorkflowDraftRebase =
  | {
      kind: WorkflowDraftRebaseKind.Rebased;
      // The draft of the workflow as it is now, with the change made to it.
      draft: WorkflowDraft;
      graph: JSONObject;
    }
  | {
      kind: WorkflowDraftRebaseKind.Conflict;
      // The steps the change touches that were changed since it was proposed.
      stepIds: Array<string>;
      /*
       * Or, with none of those: what stops the two changes holding together
       * as one workflow (checkWorkflowDraft) - two triggers, say.
       */
      problems: Array<string>;
    };

type RebaseWorkflowDraftFunction = (data: {
  draft: WorkflowDraft;
  proposedOn: WorkflowDraftProposedOn;
  // The workflow's graph as it is now.
  graph: JSONObject | null | undefined;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
  digest: WorkflowDraftDigestFunction;
}) => WorkflowDraftRebase;

/*
 * A draft that has passed checkWorkflowDraft, proposed on an earlier graph,
 * made on top of `graph`, the workflow as it is now (see the comment at the
 * top). Every step the draft touches has to be as it was when it was
 * proposed; then the steps and connections it touches are the draft's, and
 * every other is the workflow's as it is now, its settings as saved. The
 * graph is built as any draft's is, so each step that stays keeps its card
 * where it is now.
 */
export const rebaseWorkflowDraft: RebaseWorkflowDraftFunction = (data: {
  draft: WorkflowDraft;
  proposedOn: WorkflowDraftProposedOn;
  graph: JSONObject | null | undefined;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
  digest: WorkflowDraftDigestFunction;
}): WorkflowDraftRebase => {
  const touchedIds: Array<string> = data.proposedOn.steps.map(
    (step: WorkflowDraftProposedStep): string => {
      return step.id;
    },
  );
  const now: Array<WorkflowDraftProposedStep> = fingerprintWorkflowSteps({
    graph: data.graph,
    stepIds: touchedIds,
    digest: data.digest,
  });

  const changedSince: Array<string> = data.proposedOn.steps
    .filter((step: WorkflowDraftProposedStep, index: number): boolean => {
      return now[index]?.fingerprint !== step.fingerprint;
    })
    .map((step: WorkflowDraftProposedStep): string => {
      return step.id;
    });

  if (changedSince.length > 0) {
    return {
      kind: WorkflowDraftRebaseKind.Conflict,
      stepIds: changedSince,
      problems: [],
    };
  }

  const touched: Set<string> = new Set<string>(touchedIds);
  const current: StoredSteps = readStoredSteps(data.graph);
  const currentIds: Set<string> = new Set<string>(
    current.steps.map((step: StoredStep): string => {
      return step.id;
    }),
  );
  const drafted: Map<string, WorkflowDraftStep> = new Map<
    string,
    WorkflowDraftStep
  >(
    data.draft.steps.map(
      (step: WorkflowDraftStep): [string, WorkflowDraftStep] => {
        return [step.id, step];
      },
    ),
  );

  const steps: Array<WorkflowDraftStep> = [];

  for (const step of current.steps) {
    if (!touched.has(step.id)) {
      // As it is now: with no settings given, a step keeps the ones saved.
      steps.push({ id: step.id, componentId: step.componentId });
      continue;
    }

    // The draft's, where it keeps the step; it takes out one it does not have.
    const draftStep: WorkflowDraftStep | undefined = drafted.get(step.id);

    if (draftStep) {
      steps.push(draftStep);
    }
  }

  /*
   * What the draft adds. A step the draft only kept as it was, and that the
   * workflow no longer has, was taken out since: it stays out.
   */
  for (const step of data.draft.steps) {
    if (!currentIds.has(step.id) && touched.has(step.id)) {
      steps.push(step);
    }
  }

  const connections: Array<WorkflowDraftConnection> = [
    ...current.connections.filter(
      (connection: WorkflowDraftConnection): boolean => {
        return !touched.has(connection.from) && !touched.has(connection.to);
      },
    ),
    ...data.draft.connections.filter(
      (connection: WorkflowDraftConnection): boolean => {
        return touched.has(connection.from) || touched.has(connection.to);
      },
    ),
  ];

  const draft: WorkflowDraft = { steps: steps, connections: connections };
  const problems: Array<string> = checkWorkflowDraft({
    draft: draft,
    getComponent: data.getComponent,
  });

  if (problems.length > 0) {
    return {
      kind: WorkflowDraftRebaseKind.Conflict,
      stepIds: [],
      problems: problems,
    };
  }

  return {
    kind: WorkflowDraftRebaseKind.Rebased,
    draft: draft,
    graph: buildGraphFromDraft({
      draft: draft,
      getComponent: data.getComponent,
      generateId: data.generateId,
      existingGraph: data.graph,
    }),
  };
};
