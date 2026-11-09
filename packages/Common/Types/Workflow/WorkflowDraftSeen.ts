import { JSONObject } from "../JSON";
import stableStringify from "../../Utils/StableStringify";
import {
  WorkflowDraftDigestFunction,
  WorkflowGraphParts,
  getWorkflowGraphParts,
} from "./WorkflowDraftRebase";

/*
 * WHAT AN ASK AI CHANGE WOULD UNDO THAT ASK AI NEVER SAW (issue #6291).
 *
 * Ask AI writes a change to a workflow as a whole draft of its steps, from
 * what it last saw of them (Types/AI/AIChatRecordSeen): its read, or the
 * workflow as it created or changed it itself. Whatever was saved after
 * that - a step a teammate added, a setting the person changed in the
 * Builder beside the panel - the draft knows nothing of. Laid over the
 * workflow as it is, it takes their step out again, or puts the old
 * setting back. The approval card says what the change does to the
 * workflow as it is ("Removes Send Message to Slack"), which is true, but
 * nothing told the person that this removal was no part of what they
 * asked for.
 *
 * So a workflow is seen as its parts: each step, by what it is - its
 * component and settings, never where its card sits - and each connection.
 * A part saved after Ask AI saw it is undone when the change makes it
 * something else again: it was one thing then, it is another now, and the
 * change leaves it a third, most often what Ask AI saw. A moved card is no
 * part, and a setting changed on a step the change keeps as it is, or a
 * step added after one the person changed, undoes nothing: the card then
 * says nothing more than it always did.
 *
 * Pure: no database, no clock. The digest is the caller's, keyed.
 */

// A part of a workflow as seen: a step by its id, or a connection by the steps it joins.
export interface WorkflowPartSeen {
  id: string;
  // Null: the workflow had no such part.
  fingerprint: string | null;
}

const STEP_PART: string = "step:";
const CONNECTION_PART: string = "connection:";

// What a connection's part holds: that it is there.
const CONNECTED: string = "connected";

type StepPartIdFunction = (stepId: string) => string;

export const getWorkflowStepPartId: StepPartIdFunction = (
  stepId: string,
): string => {
  return `${STEP_PART}${stepId}`;
};

type ConnectionPartIdFunction = (connection: {
  from: string;
  fromOutput: string;
  to: string;
}) => string;

export const getWorkflowConnectionPartId: ConnectionPartIdFunction =
  (connection: { from: string; fromOutput: string; to: string }): string => {
    return `${CONNECTION_PART}${stableStringify([
      connection.from,
      connection.fromOutput,
      connection.to,
    ])}`;
  };

// What a part is made of: the step, or the two steps a connection joins.
interface PartOfGraph {
  id: string;
  fingerprint: string;
  stepIds: Array<string>;
  isStep: boolean;
}

type PartsOfFunction = (data: {
  graph: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}) => Array<PartOfGraph>;

const partsOf: PartsOfFunction = (data: {
  graph: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}): Array<PartOfGraph> => {
  const graphParts: WorkflowGraphParts = getWorkflowGraphParts({
    graph: data.graph,
    digest: data.digest,
  });

  return [
    ...graphParts.steps.map(
      (step: { id: string; fingerprint: string }): PartOfGraph => {
        return {
          id: getWorkflowStepPartId(step.id),
          fingerprint: step.fingerprint,
          stepIds: [step.id],
          isStep: true,
        };
      },
    ),
    ...graphParts.connections.map(
      (connection: {
        from: string;
        fromOutput: string;
        to: string;
      }): PartOfGraph => {
        return {
          id: getWorkflowConnectionPartId(connection),
          fingerprint: CONNECTED,
          stepIds: [connection.from, connection.to],
          isStep: false,
        };
      },
    ),
  ];
};

type SeeWorkflowFunction = (data: {
  graph: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}) => Array<WorkflowPartSeen>;

// What Ask AI is shown of a graph: every step and every connection, in the graph's order.
export const seeWorkflowParts: SeeWorkflowFunction = (data: {
  graph: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}): Array<WorkflowPartSeen> => {
  return partsOf(data).map((part: PartOfGraph): WorkflowPartSeen => {
    return { id: part.id, fingerprint: part.fingerprint };
  });
};

type SeeSavedFunction = (data: {
  // The steps the change touches (its record of what it was proposed on).
  stepIds: Array<string>;
  // The workflow the change was saved over, and the workflow it saved.
  replaced: JSONObject | null | undefined;
  saved: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}) => Array<WorkflowPartSeen>;

/*
 * What Ask AI sees of a change it saved itself: the steps it touches as it
 * saved them (null for one it took out), and every connection to or from
 * them, there or gone. Every other part it saw as it saw it before: that is
 * where a save the change was made on top of left its own changes.
 */
export const seeWorkflowPartsSaved: SeeSavedFunction = (data: {
  stepIds: Array<string>;
  replaced: JSONObject | null | undefined;
  saved: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}): Array<WorkflowPartSeen> => {
  const touched: Set<string> = new Set<string>(data.stepIds);
  const saved: Array<PartOfGraph> = partsOf({
    graph: data.saved,
    digest: data.digest,
  });
  const savedById: Map<string, PartOfGraph> = new Map<string, PartOfGraph>(
    saved.map((part: PartOfGraph): [string, PartOfGraph] => {
      return [part.id, part];
    }),
  );

  const parts: Array<WorkflowPartSeen> = data.stepIds.map(
    (stepId: string): WorkflowPartSeen => {
      return {
        id: getWorkflowStepPartId(stepId),
        fingerprint:
          savedById.get(getWorkflowStepPartId(stepId))?.fingerprint ?? null,
      };
    },
  );
  const listed: Set<string> = new Set<string>(
    parts.map((part: WorkflowPartSeen): string => {
      return part.id;
    }),
  );

  for (const part of [
    ...saved,
    ...partsOf({ graph: data.replaced, digest: data.digest }),
  ]) {
    if (
      part.isStep ||
      listed.has(part.id) ||
      !part.stepIds.some((stepId: string): boolean => {
        return touched.has(stepId);
      })
    ) {
      continue;
    }

    listed.add(part.id);
    parts.push({
      id: part.id,
      fingerprint: savedById.has(part.id) ? CONNECTED : null,
    });
  }

  return parts;
};

/*
 * Ask AI's knowledge of the workflow: each part as it last saw it, by id; a
 * part the map leaves out is one it saw no such part of. Null as a whole:
 * it never saw the workflow's steps.
 */
export type WorkflowPartsSeen = ReadonlyMap<string, string | null> | null;

export interface WorkflowStepsUndone {
  // The parts whose changes since Ask AI saw them the change undoes.
  partIds: Array<string>;
  /*
   * The steps to name for them: the steps the change adds back, takes out,
   * or makes another component or other settings; when it undoes only
   * connections, the steps those join. In the order of the workflow as it
   * is, then of the change.
   */
  namedStepIds: Array<string>;
}

type FindUndoneFunction = (data: {
  seen: WorkflowPartsSeen;
  // The workflow as it is now.
  graph: JSONObject | null | undefined;
  // The workflow as the change would leave it (the draft built over `graph`).
  changed: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}) => WorkflowStepsUndone;

/*
 * What the change would undo that was saved after Ask AI saw it (see the
 * comment at the top): nothing when nobody saved the workflow since, when
 * only cards moved, and when the change leaves alone each part that was
 * saved. With nothing seen, every part the workflow has that the change
 * takes out or makes something else - never what it only adds.
 */
export const findWorkflowStepsUndoneUnseen: FindUndoneFunction = (data: {
  seen: WorkflowPartsSeen;
  graph: JSONObject | null | undefined;
  changed: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}): WorkflowStepsUndone => {
  const now: Array<PartOfGraph> = partsOf({
    graph: data.graph,
    digest: data.digest,
  });
  const after: Array<PartOfGraph> = partsOf({
    graph: data.changed,
    digest: data.digest,
  });

  const byId: Map<string, PartOfGraph> = new Map<string, PartOfGraph>();
  const nowById: Map<string, string> = new Map<string, string>();
  const afterById: Map<string, string> = new Map<string, string>();

  for (const part of now) {
    byId.set(part.id, part);
    nowById.set(part.id, part.fingerprint);
  }

  for (const part of after) {
    if (!byId.has(part.id)) {
      byId.set(part.id, part);
    }

    afterById.set(part.id, part.fingerprint);
  }

  const undone: Array<PartOfGraph> = Array.from(byId.values()).filter(
    (part: PartOfGraph): boolean => {
      const isNow: string | null = nowById.get(part.id) ?? null;

      // The change leaves the part as it is: whatever was saved to it stays.
      if ((afterById.get(part.id) ?? null) === isNow) {
        return false;
      }

      // Never seen: what the change takes out or makes something else.
      if (!data.seen) {
        return isNow !== null;
      }

      // Saved since Ask AI saw it: it was another part then, or none.
      return (data.seen.get(part.id) ?? null) !== isNow;
    },
  );

  const steps: Array<string> = undone
    .filter((part: PartOfGraph): boolean => {
      return part.isStep;
    })
    .map((part: PartOfGraph): string => {
      return part.stepIds[0] as string;
    });

  const joined: Array<string> = Array.from(
    new Set<string>(
      undone.flatMap((part: PartOfGraph): Array<string> => {
        return part.stepIds;
      }),
    ),
  );

  return {
    partIds: undone.map((part: PartOfGraph): string => {
      return part.id;
    }),
    namedStepIds: steps.length > 0 ? steps : joined,
  };
};
