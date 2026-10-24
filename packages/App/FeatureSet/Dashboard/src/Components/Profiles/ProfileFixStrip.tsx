import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import API from "Common/UI/Utils/API/API";
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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ProfileCategory,
  formatProfileShare,
} from "Common/Utils/Profiles/ProfileTypes";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import {
  NO_PROFILE_FIX_SUGGESTION,
  ProfileFixReason,
  ProfileFixRepository,
  ProfileFixSuggestion,
} from "Common/Utils/Suggestions/ProfileFixSuggestion";
import PageMap from "../../Utils/PageMap";
import { PROFILE_KIND_NOUNS } from "../../Utils/ProfilesView";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import CodeBlockerNotice from "../Code/CodeBlockerNotice";
import {
  FIX_CONNECT_REPOSITORY,
  FIX_COULD_NOT_START,
  FIX_GREW_SENTENCE,
  FIX_HOT_SENTENCE,
  FIX_PICK_REPOSITORY,
  FIX_PICK_REPOSITORY_PLACEHOLDER,
  FIX_VIEW_TASK,
  FIX_WITH_AI,
  FIX_WITH_AI_TOOLTIP,
  FIX_WORKING,
} from "./ProfileCopy";
import {
  ProfileFixRequestBody,
  createProfileFixTask,
  fetchProfileFixSuggestion,
} from "./ProfilesApi";
import useProfileRequest, { ProfileRequestState } from "./UseProfileRequest";

/*
 * "FIX WITH AI", ONLY WHERE IT APPLIES, SAYING WHY.
 *
 * Drawn in the function panel for a function of one service. The server
 * decides what is offered (POST /ai-investigation/profile-fix-suggestion,
 * the same gates the create route enforces) and the strip draws exactly
 * that:
 *
 *   Act         why it is worth a fix ("This is your code, and ... takes
 *               23% of the CPU time"), then Fix with AI - with a picker
 *               first when no repository was found to hold the file for
 *               certain;
 *   SetUp       the one step in the way: connect GitHub, or what Code's
 *               gate says (credits, a Runner, the plan) with its fix;
 *   InProgress  a link to the Code task already working on it;
 *   None        nothing at all.
 *
 * With AI off for the project nothing is asked or drawn. The fix is a Code
 * task with the profile as its context: it opens in Code, where the
 * person follows it, replies, or stops it.
 */

export interface ComponentProps {
  request: ProfileFixRequestBody;
  /*
   * The slow-code finding the strip is drawn on, when it is (an AI rule
   * that asks before fixing offers the pull request there): the task names
   * it, and the finding links the task.
   */
  insightId?: string | undefined;
  // Told once a task has started, with its id.
  onTaskStarted?: ((taskId: string) => void) | undefined;
  /*
   * Whether the strip says what was found first ("This is your code, and
   * ... takes 23% of the CPU time"). Off on a finding's own page, whose
   * title and evidence say it already: the strip says what Fix with AI
   * does instead.
   */
  isFindingShown?: boolean | undefined;
}

// The strip's links: quiet, and plain to see under the keyboard.
const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export function getProfileFixRequestKey(
  request: ProfileFixRequestBody,
): string {
  return [
    request.serviceId,
    request.functionName,
    request.fileName,
    request.profileType,
    request.window.startTime.toISOString(),
    request.window.endTime.toISOString(),
    request.beforeWindow?.startTime.toISOString() || "",
    request.beforeWindow?.endTime.toISOString() || "",
  ].join("\u0000");
}

export function buildCodeTaskRoute(taskId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: taskId },
  );
}

const ProfileFixStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const requestKey: string = getProfileFixRequestKey(props.request);

  const answer: ProfileRequestState<ProfileFixSuggestion> =
    useProfileRequest<ProfileFixSuggestion>(
      isAiOffered ? requestKey : null,
      async (): Promise<ProfileFixSuggestion> => {
        try {
          return await fetchProfileFixSuggestion(props.request);
        } catch {
          // A suggestion is a bonus: a failed read offers nothing.
          return NO_PROFILE_FIX_SUGGESTION;
        }
      },
    );

  // What a refusal turned the answer into (someone else's fix, a set-up step).
  const [override, setOverride] = useState<{
    key: string;
    suggestion: ProfileFixSuggestion;
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

  const suggestion: ProfileFixSuggestion =
    override && override.key === requestKey
      ? override.suggestion
      : answer.data || NO_PROFILE_FIX_SUGGESTION;

  const taskId: string | null =
    startedTask && startedTask.key === requestKey
      ? startedTask.taskId
      : suggestion.offer === SuggestionOffer.InProgress
        ? suggestion.taskId
        : null;

  if (
    !taskId &&
    (!suggestion.evidence || suggestion.offer === SuggestionOffer.None)
  ) {
    return null;
  }

  const strong: (text: string) => ReactNode = (text: string): ReactNode => {
    return <span className="font-semibold text-gray-900">{text}</span>;
  };

  // Translated along with the sentence it is in, never on its own.
  const kind: TranslatableTerm = translatableTerm(
    PROFILE_KIND_NOUNS[suggestion.evidence?.category || ProfileCategory.Cpu],
    { inSentence: true },
  );

  const isFindingShown: boolean = props.isFindingShown !== false;

  const finding: ReactNode = !isFindingShown ? (
    suggestion.offer === SuggestionOffer.Act && !taskId ? (
      translator.translateText(FIX_WITH_AI_TOOLTIP)
    ) : null
  ) : suggestion.evidence ? (
    suggestion.reason === ProfileFixReason.Grew &&
    suggestion.evidence.ownShareBefore !== undefined ? (
      <TranslatedSentence
        template={FIX_GREW_SENTENCE}
        values={{ kind }}
        slots={{
          before: strong(
            formatProfileShare(suggestion.evidence.ownShareBefore),
          ),
          after: strong(formatProfileShare(suggestion.evidence.ownShare)),
        }}
      />
    ) : (
      <TranslatedSentence
        template={FIX_HOT_SENTENCE}
        values={{ kind }}
        slots={{
          share: strong(formatProfileShare(suggestion.evidence.ownShare)),
        }}
      />
    )
  ) : null;

  const needsRepositoryPick: boolean =
    suggestion.offer === SuggestionOffer.Act &&
    !suggestion.repository &&
    suggestion.repositories.length > 0;

  const startFix: () => Promise<void> = async (): Promise<void> => {
    const key: string = requestKey;
    setIsCreating(true);
    setError(null);

    try {
      const createdTaskId: string = await createProfileFixTask({
        ...props.request,
        ...(needsRepositoryPick && pickedRepositoryId
          ? { repositoryId: pickedRepositoryId }
          : {}),
        ...(props.insightId ? { insightId: props.insightId } : {}),
      });

      if (createdTaskId) {
        setStartedTask({ key, taskId: createdTaskId });
        props.onTaskStarted?.(createdTaskId);
      }
    } catch (err) {
      const reason: string = API.getFriendlyMessage(err as Error);
      let latest: ProfileFixSuggestion = NO_PROFILE_FIX_SUGGESTION;

      try {
        latest = await fetchProfileFixSuggestion(props.request);
      } catch {
        latest = NO_PROFILE_FIX_SUGGESTION;
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
          data-testid="profiles-fix-progress"
        >
          <span
            className="relative mt-1.5 flex h-2 w-2 flex-none"
            aria-hidden="true"
          >
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <p>
            {translator.translateText(FIX_WORKING)}{" "}
            <Link
              className={`sm:whitespace-nowrap ${LINK_CLASS_NAME}`}
              to={buildCodeTaskRoute(taskId)}
              dataTestId="profiles-fix-task-link"
            >
              {translator.translateText(FIX_VIEW_TASK)}
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
            dataTestId="profiles-fix-connect"
          >
            <>
              <Icon icon={IconProp.Code} className="mt-0.5 h-4 w-4 flex-none" />
              <span>{translator.translateText(FIX_CONNECT_REPOSITORY)}</span>
            </>
          </Link>
        );
      }

      // In the strip's own amber, not a box of its own inside it.
      return <CodeBlockerNotice blocker={suggestion.blocker} isInline={true} />;
    }

    const repositoryOptions: Array<DropdownOption> =
      suggestion.repositories.map(
        (repository: ProfileFixRepository): DropdownOption => {
          return {
            value: repository.id,
            label: repository.name,
            isUserContent: true,
          };
        },
      );

    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {needsRepositoryPick ? (
          <div className="w-full sm:w-64" data-testid="profiles-fix-repository">
            <p
              className="mb-1 text-sm font-medium text-gray-700"
              id="profiles-fix-repository-label"
            >
              {translator.translateText(FIX_PICK_REPOSITORY)}
            </p>
            <Dropdown
              options={repositoryOptions}
              value={repositoryOptions.find(
                (option: DropdownOption): boolean => {
                  return option.value === pickedRepositoryId;
                },
              )}
              placeholder={translator.translateText(
                FIX_PICK_REPOSITORY_PLACEHOLDER,
              )}
              ariaLabelledby="profiles-fix-repository-label"
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
          title={FIX_WITH_AI}
          icon={IconProp.Bolt}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          isLoading={isCreating}
          disabled={needsRepositoryPick && !pickedRepositoryId}
          // Said above it already where the finding is not.
          tooltip={isFindingShown ? FIX_WITH_AI_TOOLTIP : undefined}
          dataTestId="profiles-fix-with-ai"
          /*
           * Waiting for a repository to be picked, it looks it: the shared
           * Button draws no disabled state of its own.
           */
          className="md:!ml-0 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            void startFix();
          }}
        />
      </div>
    );
  };

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      data-testid="profiles-fix"
      data-offer={taskId ? SuggestionOffer.InProgress : suggestion.offer}
    >
      {finding ? (
        <p
          className="text-sm text-gray-700 [overflow-wrap:anywhere]"
          data-testid="profiles-fix-finding"
        >
          {finding}
        </p>
      ) : (
        <></>
      )}
      <div className={finding ? "mt-3" : ""} data-testid="profiles-fix-action">
        {getAction()}
      </div>
      {error && error.key === requestKey ? (
        <p
          className="mt-2 text-sm text-red-700"
          role="alert"
          data-testid="profiles-fix-error"
        >
          {translator.translateTemplate(FIX_COULD_NOT_START, {
            reason: error.reason,
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProfileFixStrip;
