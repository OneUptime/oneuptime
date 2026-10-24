import Route from "Common/Types/API/Route";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixRepository,
  TelemetryAiFixSuggestion,
} from "Common/Utils/Suggestions/TelemetryAiFixSuggestion";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import CodeBlockerNotice from "../Code/CodeBlockerNotice";
import useProfileRequest, {
  ProfileRequestState,
} from "../Profiles/UseProfileRequest";
import {
  createTelemetryAiFix,
  fetchTelemetryAiFixSuggestion,
} from "./TelemetryAiApi";
import {
  FIX_STRIP_ACTION_CONTAINER_CLASS_NAME,
  FIX_STRIP_ACTION_ROW_CLASS_NAME,
  FIX_STRIP_BUTTON_CLASS_NAME,
  FIX_STRIP_PICKER_CLASS_NAME,
  TELEMETRY_AI_FIX_COPY,
  TELEMETRY_AI_FIX_TEST_IDS,
  getTelemetryAiFixLead,
} from "./TelemetryAiFixCopy";

/*
 * "FIX WITH AI" ON A FINDING OF A TELEMETRY PRODUCT - Traces' first: the
 * pull request OneUptime AI would open on its own, asked for by a person
 * (an AI rule that asks before fixing leaves it to them, and anyone may ask
 * on an open finding with no fix yet). The server decides what is offered
 * (POST /telemetry-ai/fix-suggestion, the gates its create route checks)
 * and the strip draws exactly that:
 *
 *   Act         what Fix with AI does, then Fix with AI - with a picker
 *               first when no repository was found to hold the code for
 *               certain;
 *   SetUp       the one step in the way: connect a repository in Code, or
 *               what Code's gate says (credits, a Runner, the plan) with
 *               its fix;
 *   InProgress  a link to the Code task already working on it;
 *   None        nothing at all.
 *
 * With AI off for the project nothing is asked or drawn. The fix is a Code
 * task: it opens in Code, where the person follows it, replies, or stops
 * it - and the finding links it once it starts.
 */

export interface ComponentProps {
  insightId: string;
  // Which kind of finding: what Fix with AI does is said for it.
  insightType?: string | undefined;
  // Told once a task has started, with its id.
  onTaskStarted?: ((taskId: string) => void) | undefined;
}

// The strip's links: quiet, and plain to see under the keyboard.
const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const REPOSITORY_LABEL_ID: string = "telemetry-ai-fix-repository-label";

export function buildTelemetryAiFixTaskRoute(taskId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: taskId },
  );
}

const TelemetryAiFixStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const requestKey: string = props.insightId;

  const answer: ProfileRequestState<TelemetryAiFixSuggestion> =
    useProfileRequest<TelemetryAiFixSuggestion>(
      isAiOffered ? requestKey : null,
      async (): Promise<TelemetryAiFixSuggestion> => {
        try {
          return await fetchTelemetryAiFixSuggestion(props.insightId);
        } catch {
          // A suggestion is a bonus: a failed read offers nothing.
          return NO_TELEMETRY_AI_FIX_SUGGESTION;
        }
      },
    );

  // What a refusal turned the answer into (someone else's fix, a set-up step).
  const [override, setOverride] = useState<{
    key: string;
    suggestion: TelemetryAiFixSuggestion;
  } | null>(null);
  const [startedTask, setStartedTask] = useState<{
    key: string;
    taskId: string;
  } | null>(null);
  const [pickedRepositoryId, setPickedRepositoryId] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<{ key: string; reason: string } | null>(
    null,
  );

  if (!isAiOffered) {
    return null;
  }

  const suggestion: TelemetryAiFixSuggestion =
    override && override.key === requestKey
      ? override.suggestion
      : answer.data || NO_TELEMETRY_AI_FIX_SUGGESTION;

  const taskId: string | null =
    startedTask && startedTask.key === requestKey
      ? startedTask.taskId
      : suggestion.offer === SuggestionOffer.InProgress
        ? suggestion.taskId
        : null;

  if (!taskId && suggestion.offer === SuggestionOffer.None) {
    return null;
  }

  const needsRepositoryPick: boolean =
    suggestion.offer === SuggestionOffer.Act &&
    !suggestion.repository &&
    suggestion.repositories.length > 0;

  const startFix: () => Promise<void> = async (): Promise<void> => {
    const key: string = requestKey;
    setIsCreating(true);
    setError(null);

    try {
      const createdTaskId: string = await createTelemetryAiFix({
        insightId: props.insightId,
        ...(needsRepositoryPick && pickedRepositoryId
          ? { repositoryId: pickedRepositoryId }
          : {}),
      });

      setStartedTask({ key, taskId: createdTaskId });
      props.onTaskStarted?.(createdTaskId);
    } catch (err) {
      const reason: string = API.getFriendlyMessage(err as Error);
      let latest: TelemetryAiFixSuggestion = NO_TELEMETRY_AI_FIX_SUGGESTION;

      try {
        latest = await fetchTelemetryAiFixSuggestion(props.insightId);
      } catch {
        latest = NO_TELEMETRY_AI_FIX_SUGGESTION;
      }

      /*
       * Someone else's fix started meanwhile, or a set-up step appeared:
       * said in the strip's own words, not as the server's refusal.
       */
      if (
        latest.offer === SuggestionOffer.InProgress ||
        latest.offer === SuggestionOffer.SetUp
      ) {
        setOverride({ key, suggestion: latest });
      } else {
        setError({ key, reason });
      }
    }

    setIsCreating(false);
  };

  const getAction: () => ReactElement = (): ReactElement => {
    if (taskId) {
      return (
        <div
          className="flex items-start gap-2 text-sm text-gray-700"
          role="status"
          data-testid={TELEMETRY_AI_FIX_TEST_IDS.progress}
        >
          <span
            className="relative mt-1.5 flex h-2 w-2 flex-none"
            aria-hidden="true"
          >
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <p>
            {translator.translateText(TELEMETRY_AI_FIX_COPY.working)}{" "}
            <Link
              className={`sm:whitespace-nowrap ${LINK_CLASS_NAME}`}
              to={buildTelemetryAiFixTaskRoute(taskId)}
              dataTestId={TELEMETRY_AI_FIX_TEST_IDS.taskLink}
            >
              {translator.translateText(TELEMETRY_AI_FIX_COPY.viewTask)}
            </Link>
          </p>
        </div>
      );
    }

    if (suggestion.offer === SuggestionOffer.SetUp && suggestion.blocker) {
      if (
        suggestion.blocker.type === CodeTaskBlockerType.RepositoryNotConnected
      ) {
        return (
          <Link
            className={`inline-flex items-start gap-1.5 text-sm ${LINK_CLASS_NAME}`}
            to={RouteUtil.populateRouteParams(RouteMap[PageMap.CODE] as Route)}
            dataTestId={TELEMETRY_AI_FIX_TEST_IDS.connect}
          >
            <>
              <Icon icon={IconProp.Code} className="mt-0.5 h-4 w-4 flex-none" />
              <span>
                {translator.translateText(
                  TELEMETRY_AI_FIX_COPY.connectRepository,
                )}
              </span>
            </>
          </Link>
        );
      }

      // In the strip's own amber, not a box of its own inside it.
      return (
        <CodeBlockerNotice
          blocker={{
            type: suggestion.blocker.type,
            message: suggestion.blocker.message,
            ...(suggestion.blocker.runnerName
              ? { runnerName: suggestion.blocker.runnerName }
              : {}),
          }}
          repositoryId={suggestion.blocker.repositoryId}
          isInline={true}
        />
      );
    }

    const repositoryOptions: Array<DropdownOption> =
      suggestion.repositories.map(
        (repository: TelemetryAiFixRepository): DropdownOption => {
          return {
            value: repository.id,
            label: repository.name,
            isUserContent: true,
          };
        },
      );

    return (
      <div className={FIX_STRIP_ACTION_CONTAINER_CLASS_NAME}>
        <div className={FIX_STRIP_ACTION_ROW_CLASS_NAME}>
          {needsRepositoryPick ? (
            <div
              className={FIX_STRIP_PICKER_CLASS_NAME}
              data-testid={TELEMETRY_AI_FIX_TEST_IDS.repository}
            >
              <p
                className="mb-1 text-sm font-medium text-gray-700"
                id={REPOSITORY_LABEL_ID}
              >
                {translator.translateText(TELEMETRY_AI_FIX_COPY.pickRepository)}
              </p>
              <Dropdown
                options={repositoryOptions}
                value={repositoryOptions.find(
                  (option: DropdownOption): boolean => {
                    return option.value === pickedRepositoryId;
                  },
                )}
                placeholder={translator.translateText(
                  TELEMETRY_AI_FIX_COPY.pickRepositoryPlaceholder,
                )}
                ariaLabelledby={REPOSITORY_LABEL_ID}
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setPickedRepositoryId(value ? value.toString() : "");
                }}
              />
            </div>
          ) : (
            <></>
          )}
          <Button
            title={TELEMETRY_AI_FIX_COPY.button}
            icon={IconProp.Bolt}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isCreating}
            disabled={needsRepositoryPick && !pickedRepositoryId}
            dataTestId={TELEMETRY_AI_FIX_TEST_IDS.button}
            /*
             * Waiting for a repository to be picked, it looks it: the shared
             * Button draws no disabled state of its own.
             */
            className={FIX_STRIP_BUTTON_CLASS_NAME}
            onClick={() => {
              void startFix();
            }}
          />
        </div>
      </div>
    );
  };

  // What Fix with AI does: said while it is offered, not once it is started.
  const lead: string | null =
    suggestion.offer === SuggestionOffer.Act && !taskId
      ? getTelemetryAiFixLead(props.insightType)
      : null;

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      data-testid={TELEMETRY_AI_FIX_TEST_IDS.strip}
      data-offer={taskId ? SuggestionOffer.InProgress : suggestion.offer}
    >
      {lead ? (
        <p
          className="text-sm text-gray-700 [overflow-wrap:anywhere]"
          data-testid={TELEMETRY_AI_FIX_TEST_IDS.lead}
        >
          {translator.translateText(lead)}
        </p>
      ) : (
        <></>
      )}
      <div className={lead ? "mt-3" : ""}>{getAction()}</div>
      {error && error.key === requestKey ? (
        <p
          className="mt-2 text-sm text-red-700"
          role="alert"
          data-testid={TELEMETRY_AI_FIX_TEST_IDS.error}
        >
          {translator.translateTemplate(TELEMETRY_AI_FIX_COPY.couldNotStart, {
            reason: error.reason,
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryAiFixStrip;
