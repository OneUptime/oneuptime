import RunnerPicker from "../Runner/RunnerPicker";
import RunnerChoicesLoader, { RunnerChoices } from "../Runner/RunnerChoices";
import { RunnerLiveStatusBubble } from "../Runner/RunnerStatus";
import {
  CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  CODE_HIDDEN_RUNNER_LABEL,
  CODE_OWN_RUNNER_HELPER_TEXT,
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_CHOICE_VALUE,
  RunnerPickerModel,
  RunnerPickerOptionKind,
  RunnerPickerOutcome,
  RunnerPickerWork,
  buildRunnerPickerModel,
} from "../Runner/RunnerPickerModel";
import useRefreshRunnerChoicesOnFocus from "../Runner/useRefreshRunnerChoicesOnFocus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { getRepositoryRunnerId } from "Common/Types/Runner/CodeRepositoryRunner";
import Link from "Common/UI/Components/Link/Link";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A code repository's Runner setting in Code (CodeRepository.runnerId): the
 * Runner AI works in the repository on - Global Runner, one OneUptime runs
 * for every project, unless the repository picks one of the project's own
 * (Common/Types/Runner/CodeRepositoryRunner).
 *
 * Each half reads the choices (RunnerChoicesLoader.loadForCodeRepository,
 * again when the person comes back to the tab - useCodeRepositoryRunnerChoices),
 * so the Settings page's card and its edit form always draw the choices as
 * they are now:
 *
 *   - CodeRepositoryRunnerPicker, the form's field: the one Runner picker
 *     (RunnerPicker), for a repository, drawn as a field of the form - the
 *     form gives it its title and description, as every other field;
 *   - CodeRepositoryRunnerValue, the card's value: what the repository
 *     runs on, with how it is doing, drawn as the Runners page draws a
 *     Runner's status (RunnerLiveStatusBubble). The Settings page reads the
 *     choices itself, once for the card and for what its folded More
 *     settings says of the Runner, and draws the value from them
 *     (CodeRepositoryRunnerValueView).
 *
 * While the choices are on their way, each holds the room it will take - a
 * line of text, a menu - so nothing below it jumps when they arrive.
 */

export const CODE_REPOSITORY_RUNNER_PICKER_TEST_ID: string =
  "code-repository-runner-picker";

export const CODE_REPOSITORY_RUNNER_VALUE_TEST_ID: string =
  "code-repository-runner";

// The line under Global Runner: it does not build or test AI's change.
export const CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID: string =
  "code-repository-runner-skips";

export const CodeRepositoryRunnerCopy: {
  fieldTitle: string;
  fieldDescription: string;
  /*
   * The card's value for a pick the reader is not shown: one of the
   * project's Runners they may not see (a repository can pick no other, and
   * a deleted one leaves it on Global Runner).
   */
  hiddenRunner: string;
  // The card's value for no pick, in a project that does not use global Runners.
  noneGlobalRunnersOff: string;
  // The card's value for no pick, on a server that runs no global Runner.
  noneNoGlobalRunner: string;
} = {
  fieldTitle: translationKey("Runner"),
  fieldDescription: translationKey("Where AI works in this repository."),
  hiddenRunner: CODE_HIDDEN_RUNNER_LABEL,
  noneGlobalRunnersOff: translationKey(
    "None: this project does not use global Runners",
  ),
  noneNoGlobalRunner: translationKey("None: this server runs no global Runner"),
};

// The choices of a code repository's picker, read now and on focus.
export function useCodeRepositoryRunnerChoices(): RunnerChoices | null {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectIdText: string = projectId?.toString() || "";
  const [choices, setChoices] = useState<RunnerChoices | null>(null);

  useEffect(() => {
    if (!projectIdText) {
      return;
    }

    let isMounted: boolean = true;

    RunnerChoicesLoader.loadForCodeRepository(new ObjectID(projectIdText))
      .then((loaded: RunnerChoices) => {
        if (isMounted) {
          setChoices(loaded);
        }
      })
      .catch(() => {
        /*
         * With nothing read (the loader answers what it could read on its
         * own, so this is a failure it did not expect), the picker offers
         * what a project starts with: none of its own Runners, no global one
         * known.
         */
        if (isMounted) {
          setChoices({
            projectRunners: [],
            globalRunners: [],
            projectUsesGlobalRunners: true,
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [projectIdText]);

  useRefreshRunnerChoicesOnFocus(
    projectId,
    setChoices,
    RunnerChoicesLoader.loadForCodeRepository,
  );

  return choices;
}

export interface CodeRepositoryRunnerPickerProps {
  // The Runner the repository picks, as the form holds it; empty for none.
  value: unknown;
  // The Runner picked: its id, or null for Global Runner.
  onChange: (runnerId: string | null) => void;
  // The label the form drew for the field, read out with the menu.
  ariaLabelledby?: string | undefined;
}

export const CODE_REPOSITORY_RUNNER_LOADING_TEST_ID: string =
  "code-repository-runner-loading";

export const CodeRepositoryRunnerPicker: FunctionComponent<
  CodeRepositoryRunnerPickerProps
> = (props: CodeRepositoryRunnerPickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: RunnerChoices | null = useCodeRepositoryRunnerChoices();

  if (!choices) {
    // The menu's own height, so the step does not jump when it arrives.
    return (
      <Skeleton
        className="h-10 w-full rounded-md"
        dataTestId={CODE_REPOSITORY_RUNNER_LOADING_TEST_ID}
      />
    );
  }

  return (
    <RunnerPicker
      work={RunnerPickerWork.CodeRepository}
      isFormField={true}
      ariaLabelledby={props.ariaLabelledby}
      stepType=""
      value={getRepositoryRunnerId(props.value)}
      onChange={(runnerId: string): void => {
        props.onChange(
          runnerId === GLOBAL_RUNNER_CHOICE_VALUE ? null : runnerId,
        );
      }}
      choices={choices}
      ownRunnerHelperText={translator.translateText(
        CODE_OWN_RUNNER_HELPER_TEXT,
      )}
      dataTestId={CODE_REPOSITORY_RUNNER_PICKER_TEST_ID}
    />
  );
};

export interface CodeRepositoryRunnerValueProps {
  runnerId: unknown;
}

/*
 * What the repository runs on, as the card shows it, reading the choices
 * itself (CodeRepositoryRunnerValueView draws it).
 */
export const CodeRepositoryRunnerValue: FunctionComponent<
  CodeRepositoryRunnerValueProps
> = (props: CodeRepositoryRunnerValueProps): ReactElement => {
  const choices: RunnerChoices | null = useCodeRepositoryRunnerChoices();

  return (
    <CodeRepositoryRunnerValueView
      runnerId={props.runnerId}
      choices={choices}
    />
  );
};

export interface CodeRepositoryRunnerValueViewProps {
  runnerId: unknown;
  /*
   * The choices, as a page read them (useCodeRepositoryRunnerChoices) - the
   * Settings page reads them once for this value and for what More settings
   * says of the Runner while it is folded. Null while they are on their way.
   */
  choices: RunnerChoices | null;
}

/*
 * What the repository runs on, as the card shows it: "Global Runner", or
 * the Runner's name - a link to its page - and how it is doing, as the
 * Runners page draws it (a green dot for Connected, red for Disconnected,
 * grey for Never connected). It stays still: a settings value, not a live
 * view. On Global Runner the line under it says that Runner does not build
 * or test AI's change before the pull request opens - what a Runner of the
 * project's own does, the way the repository's AGENTS.md says.
 */
export const CodeRepositoryRunnerValueView: FunctionComponent<
  CodeRepositoryRunnerValueViewProps
> = (props: CodeRepositoryRunnerValueViewProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: RunnerChoices | null = props.choices;
  const runnerId: string = getRepositoryRunnerId(props.runnerId);

  if (!choices) {
    // A value's own line, so the rows below do not jump when it arrives.
    return (
      <Skeleton
        className="my-1 h-4 w-40"
        dataTestId={CODE_REPOSITORY_RUNNER_LOADING_TEST_ID}
      />
    );
  }

  const model: RunnerPickerModel = buildRunnerPickerModel({
    work: RunnerPickerWork.CodeRepository,
    stepType: "",
    currentRunnerId: runnerId,
    projectRunners: choices.projectRunners,
    globalRunners: choices.globalRunners,
    projectUsesGlobalRunners: choices.projectUsesGlobalRunners,
  });

  const withStatus: (
    name: ReactElement,
    note?: string | undefined,
  ) => ReactElement = (
    name: ReactElement,
    note?: string | undefined,
  ): ReactElement => {
    return (
      <div data-testid={CODE_REPOSITORY_RUNNER_VALUE_TEST_ID}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {name}
          {model.selected?.liveStatus ? (
            <RunnerLiveStatusBubble
              status={model.selected.liveStatus}
              isConnectedAnimated={false}
            />
          ) : (
            <></>
          )}
        </div>
        {note ? (
          <p
            className="mt-0.5 text-xs text-gray-500"
            data-testid={CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID}
          >
            {translator.translateText(note)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  if (model.selected?.kind === RunnerPickerOptionKind.Project) {
    return withStatus(
      <Link
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW] as Route,
          { modelId: model.selected.value },
        )}
        className="min-w-0 break-words font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
      >
        <>{model.selected.name}</>
      </Link>,
    );
  }

  /*
   * A pick the reader is not shown: one of the project's Runners they may
   * not see. Nothing is wrong with it, so it is said in the value's own
   * colour.
   */
  if (model.outcome === RunnerPickerOutcome.UnknownRunner) {
    return (
      <span data-testid={CODE_REPOSITORY_RUNNER_VALUE_TEST_ID}>
        {translator.translateText(CodeRepositoryRunnerCopy.hiddenRunner)}
      </span>
    );
  }

  /*
   * No pick and no global Runner to run on: the project turned them off, or
   * the server runs none. Said as it is, so nobody reads "Global Runner"
   * for a repository AI cannot work in.
   */
  if (
    model.outcome === RunnerPickerOutcome.GlobalRunnersOff ||
    model.outcome === RunnerPickerOutcome.NoGlobalRunner
  ) {
    return (
      <span
        className="text-amber-700"
        data-testid={CODE_REPOSITORY_RUNNER_VALUE_TEST_ID}
      >
        {translator.translateText(
          model.outcome === RunnerPickerOutcome.GlobalRunnersOff
            ? CodeRepositoryRunnerCopy.noneGlobalRunnersOff
            : CodeRepositoryRunnerCopy.noneNoGlobalRunner,
        )}
      </span>
    );
  }

  return withStatus(
    <span>{translator.translateText(GLOBAL_RUNNER_CHOICE_LABEL)}</span>,
    CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  );
};
