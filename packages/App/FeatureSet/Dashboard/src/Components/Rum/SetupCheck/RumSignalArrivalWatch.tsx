import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../../AppLink/AppLink";
import { getIngestRefusalFixRoute } from "../../Telemetry/IngestRefusalRoutes";
import {
  INGEST_REFUSAL_FIXES,
  INGEST_REFUSAL_FIX_LABELS,
  IngestRefusalFix,
  getIngestRefusalReasonText,
} from "../../Telemetry/IngestRefusalWords";
import { RUM_EMPTY_SIGNALS_DOCS_URL } from "../RumSignalSetupGuide";
import {
  IngestRefusalFact,
  RumKindRefusal,
  getRumKindRefusal,
} from "./RumIngestRefusals";
import {
  ARRIVAL_ARRIVED,
  ARRIVAL_CHECK_AGAIN,
  ARRIVAL_FAILED,
  ARRIVAL_NOTHING_YET,
  ARRIVAL_PICK_ANOTHER_KEY,
  ARRIVAL_STOPPED,
  ARRIVAL_WAITING,
  RUM_SIGNAL_ARRIVAL_POLL_MS,
  RumSignalArrivalState,
  getRumSignalArrivalState,
  isRumSignalArrivalWatching,
} from "./RumSignalArrival";
import {
  fetchNewestRumExceptionAt,
  fetchRecentIngestRefusals,
} from "./RumSignalReads";
import { toDateOrNull } from "./RumSignalFacts";
import { RumPanelSignal, WHY_NOTHING_ARRIVES } from "./RumSignalWords";

/*
 * The live last step of "Set up logs" and "Set up exceptions" (issue
 * #6379): it looks for the application's first log or exception every few
 * seconds while the dialog is open, and says when one arrives, what was
 * refused if something was, or what to check. RumSignalArrival decides
 * what to say; this does the reads.
 *
 * Each look is one row: the application's logsLastReceivedAt (with its
 * tracesLastReceivedAt, which the refusal check compares against for
 * exceptions), or its newest exception. What the project's keys were
 * refused is read every third look, and only while nothing has arrived.
 */

export interface ComponentProps {
  rumApplicationId: ObjectID;
  signal: RumPanelSignal;
  // The application's service.name, as the sentences name it.
  appName: string;
}

interface ArrivalRead {
  // When the signal last arrived, null for never.
  latest: Date | null;
  // When what carries it (traces for exceptions) last arrived.
  carrierLatest: Date | null;
}

// One look: when the signal, and what carries it, last arrived.
export async function readRumSignalArrival(data: {
  rumApplicationId: ObjectID;
  signal: RumPanelSignal;
}): Promise<ArrivalRead> {
  const application: RumApplication | null =
    await ModelAPI.getItem<RumApplication>({
      modelType: RumApplication,
      id: data.rumApplicationId,
      select: {
        logsLastReceivedAt: true,
        tracesLastReceivedAt: true,
      },
    });

  if (data.signal === "logs") {
    const logsAt: Date | null = toDateOrNull(application?.logsLastReceivedAt);

    return { latest: logsAt, carrierLatest: logsAt };
  }

  return {
    latest: await fetchNewestRumExceptionAt(data.rumApplicationId),
    carrierLatest: toDateOrNull(application?.tracesLastReceivedAt),
  };
}

// The look on which refusals are read again: the first, then every third.
const REFUSALS_EVERY_NTH_LOOK: number = 3;

const RumSignalArrivalWatch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [startedAt, setStartedAt] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());
  const [baseline, setBaseline] = useState<Date | null | undefined>(undefined);
  const [read, setRead] = useState<ArrivalRead | undefined>(undefined);
  const [lastLookFailed, setLastLookFailed] = useState<boolean>(false);
  const [refusals, setRefusals] = useState<Array<IngestRefusalFact> | null>(
    null,
  );
  const [look, setLook] = useState<number>(0);

  const refusal: RumKindRefusal | null = getRumKindRefusal({
    refusals,
    kind: props.signal === "logs" ? "logs" : "traces",
    lastArrivalAt: read?.carrierLatest ?? null,
    app: { client: "browser", appIdentifier: props.appName || null },
    now,
  });

  const state: RumSignalArrivalState = getRumSignalArrivalState({
    startedAt,
    now,
    baseline,
    latest: read?.latest,
    lastLookFailed,
    refusal,
  });

  const isWatching: boolean = isRumSignalArrivalWatching(state);
  const id: string = props.rumApplicationId.toString();

  // One look, now, and the next one RUM_SIGNAL_ARRIVAL_POLL_MS later.
  useEffect(() => {
    if (!isWatching) {
      return undefined;
    }

    let isCurrent: boolean = true;
    const lookedAt: Date = OneUptimeDate.getCurrentDate();

    const run: () => Promise<void> = async (): Promise<void> => {
      try {
        const answer: ArrivalRead = await readRumSignalArrival({
          rumApplicationId: new ObjectID(id),
          signal: props.signal,
        });

        if (!isCurrent) {
          return;
        }

        setBaseline((current: Date | null | undefined) => {
          return current === undefined ? answer.latest : current;
        });
        setRead(answer);
        setLastLookFailed(false);
      } catch {
        if (isCurrent) {
          setLastLookFailed(true);
        }
      }

      if (look % REFUSALS_EVERY_NTH_LOOK === 0) {
        try {
          const facts: Array<IngestRefusalFact> =
            await fetchRecentIngestRefusals(lookedAt);

          if (isCurrent) {
            setRefusals(facts);
          }
        } catch {
          // A reader who may not read the keys watches without them.
        }
      }

      if (isCurrent) {
        setNow(OneUptimeDate.getCurrentDate());
      }
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (): void => {
        run()
          .catch(() => {})
          .finally(() => {
            if (isCurrent) {
              setLook((value: number): number => {
                return value + 1;
              });
            }
          });
      },
      look === 0 ? 0 : RUM_SIGNAL_ARRIVAL_POLL_MS,
    );

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [id, props.signal, look, isWatching]);

  const application: string = props.appName;

  const box: (data: {
    tone: "waiting" | "done" | "warning" | "error";
    testId: string;
    children: ReactElement;
  }) => ReactElement = (data: {
    tone: "waiting" | "done" | "warning" | "error";
    testId: string;
    children: ReactElement;
  }): ReactElement => {
    const toneClass: string =
      data.tone === "done"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : data.tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : data.tone === "error"
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-gray-200 bg-gray-50 text-gray-600";

    return (
      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${toneClass}`}
        role="status"
        aria-live="polite"
        data-testid={data.testId}
        data-state={state}
      >
        {data.tone === "done" ? (
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-shrink-0 text-emerald-600"
          />
        ) : data.tone === "error" ? (
          <Icon
            icon={IconProp.Error}
            className="h-5 w-5 flex-shrink-0 text-red-600"
          />
        ) : (
          <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0">
            {/* The dot's own mid-tone reads the same in the dark theme. */}
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:animate-none ${
                data.tone === "warning" ? "bg-amber-500" : "bg-indigo-500"
              }`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                data.tone === "warning" ? "bg-amber-500" : "bg-indigo-500"
              }`}
            />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-2 break-words">
          {data.children}
        </div>
      </div>
    );
  };

  if (state === "arrived" && read?.latest) {
    return box({
      tone: "done",
      testId: "rum-signal-arrival-arrived",
      children: (
        <p>
          {translator.translateTemplate(
            ARRIVAL_ARRIVED[props.signal],
            {
              application,
              time: OneUptimeDate.fromNow(read.latest, now),
            },
            { setsValuesApart: true },
          )}
        </p>
      ),
    });
  }

  // Why what carries the signal is refused, and how to put it right.
  const renderRefusal: (kindRefusal: RumKindRefusal) => ReactElement = (
    kindRefusal: RumKindRefusal,
  ): ReactElement => {
    const fix: IngestRefusalFix | null =
      INGEST_REFUSAL_FIXES[kindRefusal.refusal.reason];
    const route: Route | null =
      fix && fix !== "pick-key"
        ? getIngestRefusalFixRoute({ fix, keyId: kindRefusal.refusal.keyId })
        : null;

    return (
      <>
        <p data-testid="rum-signal-arrival-refusal">
          {getIngestRefusalReasonText(kindRefusal.refusal, translator)}
        </p>
        {fix === "pick-key" ? (
          <p>{translator.translateText(ARRIVAL_PICK_ANOTHER_KEY)}</p>
        ) : (
          <></>
        )}
        {route && fix ? (
          <AppLink
            to={route}
            className="inline-flex items-center gap-1 font-medium text-red-700 underline hover:text-red-900"
            dataTestId="rum-signal-arrival-fix"
          >
            <span>
              {translator.translateText(INGEST_REFUSAL_FIX_LABELS[fix])}
            </span>
          </AppLink>
        ) : (
          <></>
        )}
      </>
    );
  };

  if (state === "refused" && refusal) {
    return box({
      tone: "error",
      testId: "rum-signal-arrival-refused",
      children: renderRefusal(refusal),
    });
  }

  if (state === "nothing-yet") {
    return box({
      tone: "warning",
      testId: "rum-signal-arrival-nothing-yet",
      children: (
        <>
          <p>{translator.translateText(ARRIVAL_NOTHING_YET[props.signal])}</p>
          <a
            href={RUM_EMPTY_SIGNALS_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-amber-900 underline hover:text-amber-950"
          >
            <span>{translator.translateText(WHY_NOTHING_ARRIVES)}</span>
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
          </a>
        </>
      ),
    });
  }

  if (state === "stopped") {
    const stillRefused: boolean = refusal?.state === "refused";

    return box({
      tone: stillRefused ? "error" : "warning",
      testId: "rum-signal-arrival-stopped",
      children: (
        <>
          {stillRefused && refusal ? (
            renderRefusal(refusal)
          ) : (
            <p>{translator.translateText(ARRIVAL_STOPPED)}</p>
          )}
          <div>
            <Button
              title={ARRIVAL_CHECK_AGAIN}
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={(): void => {
                const restartedAt: Date = OneUptimeDate.getCurrentDate();
                setStartedAt(restartedAt);
                setNow(restartedAt);
                setLook(0);
              }}
              dataTestId="rum-signal-arrival-check-again"
            />
          </div>
        </>
      ),
    });
  }

  if (state === "failed") {
    return box({
      tone: "waiting",
      testId: "rum-signal-arrival-failed",
      children: <p>{translator.translateText(ARRIVAL_FAILED)}</p>,
    });
  }

  return box({
    tone: "waiting",
    testId: "rum-signal-arrival-waiting",
    children: (
      <p>
        {translator.translateTemplate(
          ARRIVAL_WAITING[props.signal],
          { application },
          { setsValuesApart: true },
        )}
      </p>
    ),
  });
};

export default RumSignalArrivalWatch;
