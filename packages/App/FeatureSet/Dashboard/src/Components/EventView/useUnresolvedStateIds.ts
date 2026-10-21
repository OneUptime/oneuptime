import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";
import IncidentStateUtil from "../../Utils/IncidentState";
import AlertStateUtil from "../../Utils/AlertState";

// Incidents and incident episodes, or alerts and alert episodes.
export type UnresolvedStateKind = "incident" | "alert";

export interface UnresolvedStateIds {
  // Null until the project's states are read.
  unresolvedStateIds: Array<ObjectID> | null;
  error: string | null;
}

/*
 * The ids of the project's states a record is still open in: every state
 * above its resolved state (Common/Utils/ResolvedState). The Active lists and
 * their menu badges match a record's current state against them, so a state
 * placed after Resolved - "Closed", "Postmortem done" - is over there too,
 * as everywhere else. Read once per project per minute (ModelListCache).
 */
export default function useUnresolvedStateIds(
  kind: UnresolvedStateKind,
): UnresolvedStateIds {
  const [unresolvedStateIds, setUnresolvedStateIds] =
    useState<Array<ObjectID> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return () => {};
    }

    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const states: Array<{ id: ObjectID | null }> =
        kind === "incident"
          ? await IncidentStateUtil.getUnresolvedIncidentStates(projectId)
          : await AlertStateUtil.getUnresolvedAlertStates(projectId);

      if (isCancelled) {
        return;
      }

      setUnresolvedStateIds(
        states
          .map((state: { id: ObjectID | null }) => {
            return state.id;
          })
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          }),
      );
      setError(null);
    };

    load().catch((err: unknown) => {
      if (!isCancelled) {
        setError(API.getFriendlyMessage(err as Error));
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [kind]);

  return { unresolvedStateIds, error };
}
