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
 * Under a lane's switch on its AI Settings page: whether OneUptime AI can
 * open pull requests for what it finds, and when it cannot, the one thing
 * to do first - connect a repository through the GitHub App, or what Code's
 * gate says for it (the plan, AI credits, a Runner online), with Code's
 * own words and fix (CodeBlockerNotice). When all is ready it says where
 * the pull requests go, how many OneUptime AI may open on its own a day,
 * and that the code is changed on the Runner each repository picks.
 *
 * Nothing is drawn while Enable AI is off: the notice above the page says
 * that, with its switch. Read again whenever Enable AI or the lane's
 * switch is saved anywhere on the screen.
 */

export interface ComponentProps {
  lane: TelemetryAiLane;
}

const PANEL_CLASS_NAME: string =
  "mb-5 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm md:px-6";

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const isCodeTaskBlockerType: (value: string) => value is CodeTaskBlockerType = (
  value: string,
): value is CodeTaskBlockerType => {
  return (Object.values(CodeTaskBlockerType) as Array<string>).includes(value);
};

const TelemetryAiReadinessCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [readiness, setReadiness] = useState<TelemetryAiReadinessJSON | null>(
    null,
  );
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  // Only the newest read is drawn: an older answer arriving late is dropped.
  const readNumberRef: React.MutableRefObject<number> = useRef<number>(0);

  const read: () => void = useCallback((): void => {
    const readNumber: number = ++readNumberRef.current;

    fetchTelemetryAiReadiness(props.lane)
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
  }, [props.lane]);

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
      TELEMETRY_AI_LANES[props.lane].switchColumn,
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
  }, [props.lane, read]);

  if (hasFailed && !readiness) {
    return (
      <p
        className="mb-5 text-sm text-gray-500"
        data-testid={TELEMETRY_AI_TEST_IDS.readiness}
      >
        {translator.translateText(TELEMETRY_AI_READINESS_COPY.couldNotRead)}
      </p>
    );
  }

  if (!readiness || !readiness.isAiEnabled) {
    return <></>;
  }

  const steps: Array<TelemetryAiReadinessStep> =
    getTelemetryAiReadinessSteps(readiness);

  const getBody: () => ReactElement = (): ReactElement => {
    if (steps[0] === TelemetryAiReadinessStep.ConnectRepository) {
      const codeRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE] as Route,
      );

      return (
        <div
          className="flex items-start gap-3"
          data-testid={TELEMETRY_AI_TEST_IDS.readinessConnect}
        >
          <Icon
            icon={IconProp.GitHub}
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
          />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="text-gray-700">
              {translator.translateText(
                TELEMETRY_AI_READINESS_COPY.connectRepository,
              )}
            </p>
            <Link to={codeRoute} className={LINK_CLASS_NAME}>
              <span>
                {translator.translateText(
                  TELEMETRY_AI_READINESS_COPY.connectRepositoryLink,
                )}
              </span>
              <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
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
        className="flex items-start gap-3"
        data-testid={TELEMETRY_AI_TEST_IDS.readinessReady}
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500"
        />
        <div className="min-w-0 space-y-1 text-sm text-gray-700">
          <p>
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
          <p className="text-gray-500">
            {translator.translateText(TELEMETRY_AI_RUNNER_HINT)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <section
      className={PANEL_CLASS_NAME}
      data-testid={TELEMETRY_AI_TEST_IDS.readiness}
      aria-label={translator.translateText(TELEMETRY_AI_READINESS_COPY.title)}
    >
      {getBody()}
    </section>
  );
};

export default TelemetryAiReadinessCard;
