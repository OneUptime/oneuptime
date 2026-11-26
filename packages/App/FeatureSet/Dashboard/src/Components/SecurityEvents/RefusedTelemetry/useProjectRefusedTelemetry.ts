import {
  isPeriodRefused,
  readSourceRefusedTelemetry,
} from "./RefusedTelemetryModel";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "Common/Models/DatabaseModels/SecurityTelemetrySource";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { RefusedTelemetry } from "Common/Utils/SecurityEvent/RefusedTelemetry";
import React, { useEffect, useRef, useState } from "react";

/*
 * Everything an ingestion budget or rate refused of the telemetry Security
 * Events reads (#10431), as its sources kept it: Your logs' and the Traces
 * source's, on or off - what a source missed while it was on is still
 * missing from what it found then. For a page that asks about a period of
 * its own: a hunt's runs, a case. A source the person may not read, or that
 * could not be read, adds nothing.
 */

// One source's last scan result, or nothing.
async function readLastScanResult(
  read: () => Promise<Array<{ lastScanResult?: JSONObject | undefined }>>,
): Promise<JSONObject | null> {
  try {
    return (await read())[0]?.lastScanResult || null;
  } catch {
    return null;
  }
}

export async function readProjectRefusedTelemetry(
  projectId: ObjectID,
): Promise<Array<RefusedTelemetry>> {
  const [logs, traces] = await Promise.all([
    readLastScanResult(async (): Promise<Array<SecurityLogSource>> => {
      return (
        await ModelAPI.getList<SecurityLogSource>({
          modelType: SecurityLogSource,
          query: { projectId },
          select: { _id: true, lastScanResult: true },
          limit: 1,
          skip: 0,
          sort: {},
        })
      ).data;
    }),
    readLastScanResult(async (): Promise<Array<SecurityTelemetrySource>> => {
      return (
        await ModelAPI.getList<SecurityTelemetrySource>({
          modelType: SecurityTelemetrySource,
          query: { projectId, kind: SecurityTelemetrySourceKind.Traces },
          select: { _id: true, lastScanResult: true },
          limit: 1,
          skip: 0,
          sort: {},
        })
      ).data;
    }),
  ]);

  return [
    ...readSourceRefusedTelemetry({ lastScanResult: logs }),
    ...readSourceRefusedTelemetry({ lastScanResult: traces }),
  ];
}

/*
 * Whether anything was refused between from and to: for a dashboard widget
 * that read its time range and found nothing, as part of that same read, so
 * it follows the board's refreshes. False with no project open, or when
 * nothing could be read.
 */
export async function readIsPeriodRefused(data: {
  from: Date;
  to: Date;
}): Promise<boolean> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return false;
  }

  return isPeriodRefused({
    refusals: await readProjectRefusedTelemetry(projectId),
    from: data.from,
    to: data.to,
    now: OneUptimeDate.getCurrentDate(),
  });
}

/*
 * The same, read once - the first time it is wanted, so a page that only
 * needs it when it found nothing (Correlate) reads nothing otherwise. Empty
 * until it is read.
 */
export default function useProjectRefusedTelemetry(
  isWanted: boolean = true,
): Array<RefusedTelemetry> {
  const [refusals, setRefusals] = useState<Array<RefusedTelemetry>>([]);
  const hasReadRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isWanted || hasReadRef.current) {
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    hasReadRef.current = true;

    void readProjectRefusedTelemetry(projectId).then(
      (read: Array<RefusedTelemetry>) => {
        if (isMountedRef.current) {
          setRefusals(read);
        }
      },
    );
  }, [isWanted]);

  return refusals;
}
