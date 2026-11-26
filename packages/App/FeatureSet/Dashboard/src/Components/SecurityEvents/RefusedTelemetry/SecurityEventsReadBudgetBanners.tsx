import {
  fetchProjectTelemetryIngestionBudgetStatus,
  getTelemetryIngestionBudgetsRoute,
} from "../../TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "Common/Models/DatabaseModels/SecurityTelemetrySource";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import {
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStatus,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionBudgetBanner from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetBanner";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * THE BUDGET BANNERS OF WHAT SECURITY EVENTS READS (#10431), over every
 * Security Events page beside its own budget's.
 *
 * Security Events reads more than its own signal: "Your logs" reads the
 * project's logs, and the Traces source its traces. A used-up logs budget
 * refuses the very logs an attack writes, so the banner says so where
 * Security Events is read, not only on the Logs explorer: the logs' while
 * Your logs is on, and the traces' while the Traces source is. Each says
 * nothing until its budget is past its warning or used up
 * (TelemetryIngestionBudgetBanner), and they share one read of the
 * project's budgets.
 */

export interface SecurityEventsReadSignals {
  readsLogs: boolean;
  readsTraces: boolean;
}

// The signals whose budget banner is drawn for the sources that are on.
export function getSecurityEventsReadBudgetBannerSignals(
  reads: SecurityEventsReadSignals,
): Array<TelemetryIngestionBudgetSignal> {
  const signals: Array<TelemetryIngestionBudgetSignal> = [];

  if (reads.readsLogs) {
    signals.push(ProductType.Logs);
  }

  if (reads.readsTraces) {
    signals.push(ProductType.Traces);
  }

  return signals;
}

/*
 * Which of the sources whose telemetry a budget can refuse are on. One that
 * cannot be read (a role that may not, a network error) is read as off: a
 * banner is a notice, never a reason for the page to fail.
 */
export async function readSecurityEventsReadSignals(
  projectId: ObjectID,
): Promise<SecurityEventsReadSignals> {
  const isOn: (read: () => Promise<number>) => Promise<boolean> = async (
    read: () => Promise<number>,
  ): Promise<boolean> => {
    try {
      return (await read()) > 0;
    } catch {
      return false;
    }
  };

  const [readsLogs, readsTraces] = await Promise.all([
    isOn(async (): Promise<number> => {
      return (
        await ModelAPI.getList<SecurityLogSource>({
          modelType: SecurityLogSource,
          query: { projectId, isEnabled: true },
          select: { _id: true },
          limit: 1,
          skip: 0,
          sort: {},
        })
      ).data.length;
    }),
    isOn(async (): Promise<number> => {
      return (
        await ModelAPI.getList<SecurityTelemetrySource>({
          modelType: SecurityTelemetrySource,
          query: {
            projectId,
            kind: SecurityTelemetrySourceKind.Traces,
            isEnabled: true,
          },
          select: { _id: true },
          limit: 1,
          skip: 0,
          sort: {},
        })
      ).data.length;
    }),
  ]);

  return { readsLogs, readsTraces };
}

/*
 * One read of the project's budgets for every banner that asks: the first
 * ask reads them, and the others are handed the same answer. A Security
 * Events page draws its own budget's banner and these, so its layout hands
 * them all one such read, and the page reads the budgets once.
 */
export function shareOneBudgetsRead(
  read: () => Promise<TelemetryIngestionBudgetStatus>,
): () => Promise<TelemetryIngestionBudgetStatus> {
  let shared: Promise<TelemetryIngestionBudgetStatus> | null = null;

  return (): Promise<TelemetryIngestionBudgetStatus> => {
    if (!shared) {
      shared = read();
    }

    return shared;
  };
}

export interface SecurityEventsReadBudgetBannersProps {
  // The page's one read of the budgets; a read of their own otherwise.
  fetchStatus?: (() => Promise<TelemetryIngestionBudgetStatus>) | undefined;
}

const SecurityEventsReadBudgetBanners: FunctionComponent<
  SecurityEventsReadBudgetBannersProps
> = (props: SecurityEventsReadBudgetBannersProps): ReactElement => {
  const [reads, setReads] = useState<SecurityEventsReadSignals>({
    readsLogs: false,
    readsTraces: false,
  });

  // One read of the project's budgets, for both banners.
  const ownRead: () => Promise<TelemetryIngestionBudgetStatus> =
    useMemo((): (() => Promise<TelemetryIngestionBudgetStatus>) => {
      return shareOneBudgetsRead(fetchProjectTelemetryIngestionBudgetStatus);
    }, []);
  const fetchStatus: () => Promise<TelemetryIngestionBudgetStatus> =
    props.fetchStatus || ownRead;

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      void readSecurityEventsReadSignals(projectId).then(
        (read: SecurityEventsReadSignals) => {
          if (isCurrent) {
            setReads(read);
          }
        },
      );
    }

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <>
      {getSecurityEventsReadBudgetBannerSignals(reads).map(
        (signal: TelemetryIngestionBudgetSignal): ReactElement => {
          return (
            <TelemetryIngestionBudgetBanner
              key={signal}
              signal={signal}
              fetchStatus={fetchStatus}
              budgetsRoute={getTelemetryIngestionBudgetsRoute()}
            />
          );
        },
      )}
    </>
  );
};

export default SecurityEventsReadBudgetBanners;
