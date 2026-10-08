import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import { useEffect, useState } from "react";
import ScheduledMaintenanceStateUtil from "../../Utils/ScheduledMaintenanceState";

export interface InProgressScheduledMaintenanceStateIds {
  // Null until the project's states are read.
  inProgressStateIds: Array<ObjectID> | null;
  error: string | null;
}

/*
 * The ids of the project's states a scheduled maintenance event is in
 * progress in: its ongoing state, and every state of its own placed between
 * Ongoing and Ended, such as "Verifying" (Common/Utils/ScheduledMaintenanceStart).
 * The Ongoing lists and their menu badges match an event's current state
 * against them, so an event moved on to "Verifying" stays ongoing there, as
 * everywhere else - and one in a state placed after Ended does not. Read
 * once per project per minute (ModelListCache).
 */
export default function useInProgressScheduledMaintenanceStateIds(): InProgressScheduledMaintenanceStateIds {
  const [inProgressStateIds, setInProgressStateIds] =
    useState<Array<ObjectID> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return () => {};
    }

    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const states: Array<ScheduledMaintenanceState> =
        await ScheduledMaintenanceStateUtil.getInProgressScheduledMaintenanceStates(
          projectId,
        );

      if (isCancelled) {
        return;
      }

      setInProgressStateIds(
        states
          .map((state: ScheduledMaintenanceState): ObjectID | null => {
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
  }, []);

  return { inProgressStateIds, error };
}
