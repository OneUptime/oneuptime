import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import { CodeTaskBlocker, CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import {
  TelemetryAiReadinessJSON,
  TelemetryAiReadinessStep,
  getTelemetryAiReadinessSteps,
} from "Common/Types/AI/TelemetryAiActivity";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CodeBlockerNotice from "../Code/CodeBlockerNotice";
import { ENABLE_AI_COLUMN } from "../AISettings/EnableAiColumn";
import { fetchTelemetryAiReadiness } from "./TelemetryAiApi";
import {
  TELEMETRY_AI_READINESS_COPY,
  TELEMETRY_AI_RUNNER_HINT,
  TELEMETRY_AI_TEST_IDS,
} from "./TelemetryAiCopy";

/*
 * WHAT A LANE'S SWITCH LEADS TO: whether OneUptime AI can open pull
 * requests for what it finds, and when it cannot, the one thing to do
 * first - connect a repository in Code, or what Code's gate says for it
 * (the plan, AI credits, a Runner online), in Code's own words and with
 * its fix (CodeBlockerNotice). When all is ready it says where the pull
 * requests go, how many OneUptime AI may open on its own a day, and that
 * the code is changed on the Runner each repository picks.
 *
 * Drawn under the lane's switch, inside its card (TelemetryAiSettingsPage
 * hands it to ProjectAiSwitchesCard as the card's details), and only while
 * it applies: never while Enable AI is off - the notice above the page says
 * that, with its switch - nor while the lane's switch is off, when nothing
 * is looked for and so nothing is opened. Read again whenever Enable AI or
 * the lane's switch is saved anywhere on the screen.
 */

export interface TelemetryAiReadinessState {
  // The newest answer, or null before one arrives.
  readiness: TelemetryAiReadinessJSON | null;
  // Whether the newest read failed.
  hasFailed: boolean;
}

// A blocker type the Dashboard knows how to word (CodeBlockerNotice).
const isCodeTaskBlockerType: (value: string) => value is CodeTaskBlockerType = (
  value: string,
): value is CodeTaskBlockerType => {
  return (Object.values(CodeTaskBlockerType) as Array<string>).includes(value);
};

/*
 * The lane's readiness, read on mount and again each time Enable AI or the
 * lane's switch is saved anywhere on the screen. Only the newest read is
 * kept: an older answer arriving late is dropped.
 */
export function useTelemetryAiReadiness(
  lane: TelemetryAiLane,
): TelemetryAiReadinessState {
  const [readiness, setReadiness] = useState<TelemetryAiReadinessJSON | null>(
    null,
  );
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  const readNumberRef: React.MutableRefObject<number> = useRef<number>(0);

  const read: () => void = useCallback((): void => {
    const readNumber: number = ++readNumberRef.current;

    fetchTelemetryAiReadiness(lane)
      .then((answer: TelemetryAiReadinessJSON): void => {
        if (readNumber === readNumberRef.current) {
          setReadiness(answer);
          setHasFailed(false);
        }
      })
      .catch((): void => {
        if (readNumber === readNumberRef.current) {
          setHasFailed(true);
        }
      });
  }, [lane]);

  useEffect(() => {
    read();
  }, [read]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const unsubscribers: Array<() => void> = [
      ENABLE_AI_COLUMN,
      TELEMETRY_AI_LANES[lane].switchColumn,
    ].map((column: string): (() => void) => {
      return subscribeToModelSwitchSaved({
        modelType: Project,
        modelId: projectId,
        column,
        onSaved: (): void => {
          read();
        },
      });
    });

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [lane, read]);

  return { readiness, hasFailed };
}

/*
 * Whether there is anything to say under the switch: nothing while Enable
 * AI or the lane's switch is off, and - before any answer - only that a
 * read failed. `isLaneOn` is where the lane's switch is on the screen, when
 * the page knows it: a flip hides or shows the lines at once, not after the
 * readiness is read again.
 */
export function isTelemetryAiReadinessShown(
  state: TelemetryAiReadinessState,
  isLaneOn?: boolean | null | undefined,
): boolean {
  const isLaneOnNow: boolean | undefined =
    typeof isLaneOn === "boolean" ? isLaneOn : state.readiness?.isLaneOn;

  if (isLaneOnNow === false) {
    return false;
  }

  if (!state.readiness) {
    return state.hasFailed;
  }

  return state.readiness.isAiEnabled;
}

export interface ComponentProps {
  state: TelemetryAiReadinessState;
}

// The fix's link, as Code's own notices draw it (CodeBlockerNotice).
const LINK_CLASS_NAME: string =
  "mt-1 inline-flex items-center gap-1 rounded-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const TelemetryAiReadiness: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readiness: TelemetryAiReadinessJSON | null = props.state.readiness;

  if (!readiness) {
    return props.state.hasFailed ? (
      <p
        className="text-sm text-gray-500"
        data-testid={TELEMETRY_AI_TEST_IDS.readiness}
      >
        {translator.translateText(TELEMETRY_AI_READINESS_COPY.couldNotRead)}
      </p>
    ) : (
      <></>
    );
  }

  const steps: Array<TelemetryAiReadinessStep> =
    getTelemetryAiReadinessSteps(readiness);

  const getBody: () => ReactElement = (): ReactElement => {
    /*
     * No repository: the step to take, in the amber and the shape Code's
     * own notices give a step (CodeBlockerNotice), as the step after it
     * - AI credits, a Runner - is drawn.
     */
    if (steps[0] === TelemetryAiReadinessStep.ConnectRepository) {
      const codeRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE] as Route,
      );

      return (
        <div
          className="flex items-start gap-2 text-sm text-amber-900"
          data-testid={TELEMETRY_AI_TEST_IDS.readinessConnect}
        >
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
          />
          <div className="min-w-0 flex-1">
            <p className="leading-6">
              {translator.translateText(
                TELEMETRY_AI_READINESS_COPY.connectRepository,
              )}
            </p>
            <Link to={codeRoute} className={LINK_CLASS_NAME}>
              <>
                {translator.translateText(
                  TELEMETRY_AI_READINESS_COPY.connectRepositoryLink,
                )}
                <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
              </>
            </Link>
          </div>
        </div>
      );
    }

    if (
      steps[0] === TelemetryAiReadinessStep.ClearCodeBlocker &&
      readiness.blocker &&
      isCodeTaskBlockerType(readiness.blocker.type)
    ) {
      const blocker: CodeTaskBlocker = {
        type: readiness.blocker.type,
        message: readiness.blocker.message,
        ...(readiness.blocker.runnerName
          ? { runnerName: readiness.blocker.runnerName }
          : {}),
      };

      return (
        <CodeBlockerNotice
          blocker={blocker}
          repositoryId={readiness.blocker.repositoryId}
          isInline={true}
        />
      );
    }

    return (
      <div
        className="flex items-start gap-2 text-sm text-gray-700"
        data-testid={TELEMETRY_AI_TEST_IDS.readinessReady}
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600"
        />
        <div className="min-w-0 flex-1">
          <p className="leading-6">
            {translator.translatePlural(
              TELEMETRY_AI_READINESS_COPY.ready,
              readiness.connectedRepositoryCount,
            )}{" "}
            {translator.translateTemplate(
              TELEMETRY_AI_READINESS_COPY.automaticToday,
              {
                max: translator.formatNumber(readiness.maxAutomaticFixesPerDay),
                today: translator.formatNumber(readiness.automaticFixesToday),
              },
            )}
          </p>
          <p className="leading-6 text-gray-500">
            {translator.translateText(TELEMETRY_AI_RUNNER_HINT)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <section
      data-testid={TELEMETRY_AI_TEST_IDS.readiness}
      aria-label={translator.translateText(TELEMETRY_AI_READINESS_COPY.title)}
    >
      {getBody()}
    </section>
  );
};

export default TelemetryAiReadiness;
