import MyReadiness, {
  MyReadinessReading,
} from "../OnCallPolicy/Readiness/MyReadiness";
import {
  NotificationSetupReason,
  getNotificationSetupReason,
  hideNotificationSetupNudge,
  readNotificationSetupHiddenUntil,
} from "./NotificationSetupNudge";
import { useCallback, useEffect, useState } from "react";

/*
 * Whether the bell asks the signed-in person to finish setting up their
 * notifications in the open project, and why (NotificationSetupNudge.ts,
 * #7040).
 *
 * Their readiness is read when the project opens, and again - once the
 * last read is a minute old, as long as the server keeps it - when they
 * move to another page or come back to the tab: a person who fixed their
 * setup sees the item go without reloading. Every fresh read the setup
 * checklist makes lands here too (MyReadiness), so a Recheck there clears
 * it at once. A read that fails says nothing: the bell never claims a gap
 * it could not see.
 */

// A read younger than this is not read again: the server keeps it as long.
export const NOTIFICATION_SETUP_REREAD_AFTER_IN_MS: number = 60 * 1000;

export interface NotificationSetupNudgeState {
  // Why the bell asks, or null while it asks nothing.
  reason: NotificationSetupReason | null;
  // Puts the item away for a week, in this browser.
  hide: () => void;
}

const isFresh: (reading: MyReadinessReading | null) => boolean = (
  reading: MyReadinessReading | null,
): boolean => {
  return Boolean(
    reading &&
      Date.now() - reading.readAt < NOTIFICATION_SETUP_REREAD_AFTER_IN_MS,
  );
};

const useNotificationSetupNudge: (data: {
  userId: string | null;
  projectId: string | null;
}) => NotificationSetupNudgeState = (data: {
  userId: string | null;
  projectId: string | null;
}): NotificationSetupNudgeState => {
  const userId: string = data.userId || "";
  const projectId: string = data.projectId || "";
  // Whose answer, in which project: another project's is never shown here.
  const key: string = `${projectId}:${userId}`;

  const [known, setKnown] = useState<{
    key: string;
    reading: MyReadinessReading | null;
  }>({ key: "", reading: null });
  const [hiddenUntil, setHiddenUntil] = useState<number>(0);

  const reading: MyReadinessReading | null =
    known.key === key ? known.reading : null;

  // The page the header is drawn on: moving to another reads again, when due.
  const path: string =
    typeof window !== "undefined" ? window.location.pathname : "";

  const readIfDue: () => void = useCallback((): void => {
    if (!userId || !projectId) {
      return;
    }

    if (isFresh(MyReadiness.get({ projectId, userId }))) {
      return;
    }

    MyReadiness.load({ projectId, userId }).catch(() => {
      // Nothing is claimed on a read that failed; the next one may answer.
    });
  }, [userId, projectId]);

  // What is known now, what the person put away, and every answer after.
  useEffect(() => {
    if (!userId || !projectId) {
      setKnown({ key: "", reading: null });
      setHiddenUntil(0);
      return undefined;
    }

    const readingKey: string = `${projectId}:${userId}`;

    setKnown({
      key: readingKey,
      reading: MyReadiness.get({ projectId, userId }),
    });
    setHiddenUntil(readNotificationSetupHiddenUntil({ userId, projectId }));

    return MyReadiness.subscribe(() => {
      setKnown({
        key: readingKey,
        reading: MyReadiness.get({ projectId, userId }),
      });
    });
  }, [userId, projectId]);

  // Read when the project opens and on each move to another page, when due.
  useEffect(() => {
    readIfDue();
  }, [readIfDue, path]);

  // And on coming back to the tab.
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const onVisibilityChange: () => void = (): void => {
      if (document.visibilityState === "visible") {
        readIfDue();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [readIfDue]);

  const hide: () => void = useCallback((): void => {
    if (!userId || !projectId) {
      return;
    }

    setHiddenUntil(
      hideNotificationSetupNudge({ userId, projectId, now: Date.now() }),
    );
  }, [userId, projectId]);

  const isHidden: boolean = hiddenUntil > Date.now();

  return {
    reason: isHidden ? null : getNotificationSetupReason(reading?.readiness),
    hide: hide,
  };
};

export default useNotificationSetupNudge;
