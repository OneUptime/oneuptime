import {
  NetworkProbeFacts,
  NetworkProbeSetup,
  PROBE_WAITING_POLL_INTERVAL_IN_MS,
  getNetworkProbeSetup,
  shouldPollProbeSetup,
} from "./NetworkProbeSetup";
import Probe from "Common/Models/DatabaseModels/Probe";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { useCallback, useEffect, useRef, useState } from "react";

/*
 * The project's own probes, as the Network first-run path needs them: which
 * are checking in and which are added but not running yet - asked again
 * every few seconds while one is waiting, so the step turns green on its own
 * once the probe starts.
 *
 * Global probes are read only to say, on a self-hosted server, that the
 * server's own probe can be used too (NetworkProbeSetup explains why).
 */

export interface NetworkProbesState {
  isLoading: boolean;
  /*
   * Null when the project's probes could not be read - a role that may not
   * list them. The step then says what a probe is, and claims nothing about
   * whether there is one.
   */
  setup: NetworkProbeSetup | null;
  // A self-hosted server with a probe of its own.
  hasServerProbe: boolean;
  canAddProbe: boolean;
  refresh: () => Promise<void>;
}

function toFacts(probe: Probe): NetworkProbeFacts {
  return {
    id: probe._id?.toString() || "",
    name: probe.name || "",
    connectionStatus: probe.connectionStatus || null,
    lastAlive: probe.lastAlive || null,
  };
}

async function readProjectProbes(): Promise<Array<Probe> | null> {
  const hasSnapshot: boolean = PermissionGate.hasPermissionSnapshot();

  if (
    hasSnapshot &&
    !PermissionGate.check(new Probe(), ModelAction.Read).isAllowed
  ) {
    return null;
  }

  try {
    const result: ListResult<Probe> = await ModelAPI.getList<Probe>({
      modelType: Probe,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        connectionStatus: true,
        lastAlive: true,
      },
      sort: {},
    });

    return result.data;
  } catch (err) {
    // A refusal before the snapshot landed is the answer it would give.
    if (
      !hasSnapshot &&
      err instanceof HTTPErrorResponse &&
      err.statusCode === 422
    ) {
      return null;
    }

    throw err;
  }
}

async function hasGlobalProbe(): Promise<boolean> {
  /*
   * On OneUptime Cloud the global probes are on the internet, which is the
   * whole reason for this step: they are never offered as the way in.
   */
  if (BILLING_ENABLED) {
    return false;
  }

  try {
    const result: ListResult<Probe> = await ModelAPI.getList<Probe>({
      modelType: Probe,
      query: {},
      limit: 1,
      skip: 0,
      select: {
        _id: true,
      },
      sort: {},
      requestOptions: {
        overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
          "/probe/global-probes",
        ),
      },
    });

    return result.data.length > 0;
  } catch {
    // A note, never worth an error.
    return false;
  }
}

export default function useNetworkProbes(): NetworkProbesState {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [setup, setSetup] = useState<NetworkProbeSetup | null>(null);
  const [hasServerProbe, setHasServerProbe] = useState<boolean>(false);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);

  const refresh: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const [probes, serverProbe]: [Array<Probe> | null, boolean] =
        await Promise.all([readProjectProbes(), hasGlobalProbe()]);

      if (!isMounted.current) {
        return;
      }

      setSetup(
        probes === null
          ? null
          : getNetworkProbeSetup(probes.map(toFacts), new Date()),
      );
      setHasServerProbe(serverProbe);
    } catch {
      /*
       * The first-run path still reads well without the probe step's state:
       * it says what a probe is and offers to add one.
       */
      if (isMounted.current) {
        setSetup(null);
      }
    }

    if (isMounted.current) {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    refresh().catch(() => {
      // refresh reports its own failures as "unknown".
    });

    return () => {
      isMounted.current = false;
    };
  }, [refresh]);

  // Ask again while a probe is added and not running yet.
  const isWaiting: boolean = setup ? shouldPollProbeSetup(setup) : false;

  useEffect(() => {
    if (!isWaiting) {
      return undefined;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      refresh().catch(() => {
        // refresh reports its own failures as "unknown".
      });
    }, PROBE_WAITING_POLL_INTERVAL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isWaiting, refresh]);

  return {
    isLoading,
    setup,
    hasServerProbe,
    canAddProbe: PermissionGate.check(new Probe(), ModelAction.Create)
      .isAllowed,
    refresh,
  };
}
