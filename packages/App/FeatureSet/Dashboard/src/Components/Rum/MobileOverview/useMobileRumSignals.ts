import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { useCallback, useState } from "react";
import {
  MobileAppStarts,
  MobileFaults,
  MobileFrames,
  MobileSessions,
} from "./MobileRumSignalData";
import {
  fetchMobileAppStarts,
  fetchMobileFaults,
  fetchMobileFrames,
  fetchMobileSessions,
  fetchNewestAppStartAt,
  fetchNewestFrameEventAt,
} from "./MobileRumSignalReads";

/*
 * What a mobile RUM application's Overview draws (#9588), and the one
 * loader that reads it. The page calls `load` from its own telemetry loader,
 * with the window it computed and its staleness guard, so a slow read for
 * an old range never overwrites a newer one, exactly as for its other
 * charts. Loading flags are set only when the page asks for them (a first
 * load, a new range): a refresh keeps every value on screen until its
 * replacement arrives (correlation-12).
 */

export interface MobileSignalArrival {
  at: Date | null;
  failed: boolean;
}

export interface MobileRumSignalsState {
  appStarts: MobileAppStarts | null;
  appStartsLoading: boolean;
  sessions: MobileSessions | null;
  sessionsLoading: boolean;
  faults: MobileFaults | null;
  faultsLoading: boolean;
  frames: MobileFrames | null;
  framesLoading: boolean;
  /*
   * When the newest app start and the newest slow-frame event of the past
   * 30 days arrived, read only while the range has none, so an empty chart
   * can tell "none in this range" from "never reported". null while that
   * read is out, or while there is no need for it.
   */
  lastAppStart: MobileSignalArrival | null;
  lastFrameEvent: MobileSignalArrival | null;
}

export interface MobileRumSignalsLoad {
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
  showLoading: boolean;
  isCurrent: () => boolean;
}

export interface UseMobileRumSignalsResult extends MobileRumSignalsState {
  load: (input: MobileRumSignalsLoad) => void;
}

export default function useMobileRumSignals(): UseMobileRumSignalsResult {
  const [appStarts, setAppStarts] = useState<MobileAppStarts | null>(null);
  const [appStartsLoading, setAppStartsLoading] = useState<boolean>(true);
  const [sessions, setSessions] = useState<MobileSessions | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState<boolean>(true);
  const [faults, setFaults] = useState<MobileFaults | null>(null);
  const [faultsLoading, setFaultsLoading] = useState<boolean>(true);
  const [frames, setFrames] = useState<MobileFrames | null>(null);
  const [framesLoading, setFramesLoading] = useState<boolean>(true);
  const [lastAppStart, setLastAppStart] = useState<MobileSignalArrival | null>(
    null,
  );
  const [lastFrameEvent, setLastFrameEvent] =
    useState<MobileSignalArrival | null>(null);

  const load: (input: MobileRumSignalsLoad) => void = useCallback(
    (input: MobileRumSignalsLoad): void => {
      const scope: { primaryEntityId: ObjectID; start: Date; end: Date } = {
        primaryEntityId: input.primaryEntityId,
        start: input.start,
        end: input.end,
      };

      if (input.showLoading) {
        setAppStartsLoading(true);
        setSessionsLoading(true);
        setFaultsLoading(true);
        setFramesLoading(true);
        setAppStarts(null);
        setSessions(null);
        setFaults(null);
        setFrames(null);
        setLastAppStart(null);
        setLastFrameEvent(null);
      }

      // One clock for both lookbacks, as the range's own reads have.
      const now: Date = OneUptimeDate.getCurrentDate();

      // The reads never throw: a failure comes back marked failed.
      fetchMobileAppStarts(scope)
        .then((result: MobileAppStarts) => {
          if (!input.isCurrent()) {
            return;
          }

          setAppStarts(result);
          setAppStartsLoading(false);

          if (result.failed || result.total > 0) {
            setLastAppStart(null);
            return;
          }

          fetchNewestAppStartAt({ primaryEntityId: input.primaryEntityId, now })
            .then((at: Date | null) => {
              if (input.isCurrent()) {
                setLastAppStart({ at, failed: false });
              }
            })
            .catch(() => {
              if (input.isCurrent()) {
                setLastAppStart({ at: null, failed: true });
              }
            });
        })
        .catch(() => {
          if (input.isCurrent()) {
            setAppStartsLoading(false);
          }
        });

      fetchMobileSessions(scope)
        .then((result: MobileSessions) => {
          if (!input.isCurrent()) {
            return;
          }

          setSessions(result);
          setSessionsLoading(false);
        })
        .catch(() => {
          if (input.isCurrent()) {
            setSessionsLoading(false);
          }
        });

      fetchMobileFaults(scope)
        .then((result: MobileFaults) => {
          if (!input.isCurrent()) {
            return;
          }

          setFaults(result);
          setFaultsLoading(false);
        })
        .catch(() => {
          if (input.isCurrent()) {
            setFaultsLoading(false);
          }
        });

      fetchMobileFrames(scope)
        .then((result: MobileFrames) => {
          if (!input.isCurrent()) {
            return;
          }

          setFrames(result);
          setFramesLoading(false);

          if (result.failed || result.slow > 0 || result.frozen > 0) {
            setLastFrameEvent(null);
            return;
          }

          fetchNewestFrameEventAt({
            primaryEntityId: input.primaryEntityId,
            now,
          })
            .then((at: Date | null) => {
              if (input.isCurrent()) {
                setLastFrameEvent({ at, failed: false });
              }
            })
            .catch(() => {
              if (input.isCurrent()) {
                setLastFrameEvent({ at: null, failed: true });
              }
            });
        })
        .catch(() => {
          if (input.isCurrent()) {
            setFramesLoading(false);
          }
        });
    },
    [],
  );

  return {
    appStarts,
    appStartsLoading,
    sessions,
    sessionsLoading,
    faults,
    faultsLoading,
    frames,
    framesLoading,
    lastAppStart,
    lastFrameEvent,
    load,
  };
}
