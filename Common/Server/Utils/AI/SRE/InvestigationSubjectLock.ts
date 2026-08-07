import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import logger from "../../Logger";

/*
 * Investigation creation and FixFromIncident authorization must share one
 * linearization point. Without it, a new Investigation can be inserted after
 * a fix trigger's "latest run" read but before the CodeFix INSERT, allowing a
 * task grounded in an analysis that is no longer authoritative.
 */
export const INVESTIGATION_SUBJECT_LOCK_NAMESPACE: string =
  "InvestigationSubjectLifecycle";

export interface InvestigationSubjectLockData {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

export function getInvestigationSubjectLockKey(
  data: InvestigationSubjectLockData,
): string {
  if (Boolean(data.incidentId) === Boolean(data.alertId)) {
    throw new BadDataException(
      "Exactly one incident or alert subject is required.",
    );
  }

  const subjectKey: string = data.incidentId
    ? `incident-${data.incidentId.toString()}`
    : `alert-${data.alertId!.toString()}`;

  return `${data.projectId.toString()}-${subjectKey}`;
}

export default class InvestigationSubjectLock {
  public static async runExclusive<T>(
    data: InvestigationSubjectLockData,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key: string = getInvestigationSubjectLockKey(data);
    const mutex: SemaphoreMutex = await Semaphore.lock({
      key,
      namespace: INVESTIGATION_SUBJECT_LOCK_NAMESPACE,
      lockTimeout: 30 * 1000,
      acquireTimeout: 10 * 1000,
    });

    try {
      return await operation();
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        /*
         * The Redis mutex expires automatically. Do not hide the operation's
         * result (or its more useful error) when best-effort release fails.
         */
        logger.error(
          `AI: failed to release the investigation subject lock ${key}; it will expire automatically: ${error}`,
        );
      }
    }
  }
}
