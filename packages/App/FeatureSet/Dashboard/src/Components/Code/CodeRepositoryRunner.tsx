import RunnerPicker from "../Runner/RunnerPicker";
import RunnerChoicesLoader, { RunnerChoices } from "../Runner/RunnerChoices";
import {
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
import { getRunnerLiveStatusLabel } from "Common/Types/Runner/RunnerLiveStatus";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Link from "Common/UI/Components/Link/Link";
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
 * Both halves read the choices themselves (RunnerChoicesLoader
 * .loadForCodeRepository, again when the person comes back to the tab), so
 * the Settings page's card and its edit form - whose elements are built
 * once - always draw the choices as they are now:
 *
 *   - CodeRepositoryRunnerPicker, the form's field: the one Runner picker
 *     (RunnerPicker), for a repository;
 *   - CodeRepositoryRunnerValue, the card's value: what the repository
 *     runs on, with how it is doing.
 */

export const CODE_REPOSITORY_RUNNER_PICKER_TEST_ID: string =
  "code-repository-runner-picker";

export const CODE_REPOSITORY_RUNNER_VALUE_TEST_ID: string =
  "code-repository-runner";

export const CodeRepositoryRunnerCopy: {
  fieldTitle: string;
  fieldDescription: string;
  // The card's value for a pick the project no longer has.
  unknownRunner: string;
  // The card's value for no pick, in a project that does not use global Runners.
  noneGlobalRunnersOff: string;
  // The card's value for no pick, on a server that runs no global Runner.
  noneNoGlobalRunner: string;
} = {
  fieldTitle: translationKey("Runner"),
  fieldDescription: translationKey("Where AI works in this repository."),
  unknownRunner: translationKey("A Runner this project no longer has"),
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
         * With nothing read, the picker offers what a project starts with:
         * none of its own Runners, no global one known.
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
}

export const CodeRepositoryRunnerPicker: FunctionComponent<
  CodeRepositoryRunnerPickerProps
> = (props: CodeRepositoryRunnerPickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: RunnerChoices | null = useCodeRepositoryRunnerChoices();

  if (!choices) {
    return <ComponentLoader />;
  }

  return (
    <RunnerPicker
      work={RunnerPickerWork.CodeRepository}
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
 * What the repository runs on, as the card shows it: "Global Runner ·
 * Connected", or the Runner's name - a link to its page - and how it is
 * doing.
 */
export const CodeRepositoryRunnerValue: FunctionComponent<
  CodeRepositoryRunnerValueProps
> = (props: CodeRepositoryRunnerValueProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: RunnerChoices | null = useCodeRepositoryRunnerChoices();
  const runnerId: string = getRepositoryRunnerId(props.runnerId);

  if (!choices) {
    return <ComponentLoader />;
  }

  const model: RunnerPickerModel = buildRunnerPickerModel({
    work: RunnerPickerWork.CodeRepository,
    stepType: "",
    currentRunnerId: runnerId,
    projectRunners: choices.projectRunners,
    globalRunners: choices.globalRunners,
    projectUsesGlobalRunners: choices.projectUsesGlobalRunners,
  });

  const status: string | null = model.selected?.liveStatus
    ? translator.translateText(
        getRunnerLiveStatusLabel(model.selected.liveStatus),
      ) || null
    : null;

  const statusSuffix: ReactElement = status ? (
    <span className="text-gray-500"> · {status}</span>
  ) : (
    <></>
  );

  if (model.selected?.kind === RunnerPickerOptionKind.Project) {
    return (
      <span data-testid={CODE_REPOSITORY_RUNNER_VALUE_TEST_ID}>
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW] as Route,
            { modelId: model.selected.value },
          )}
          className="font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
        >
          <>{model.selected.name}</>
        </Link>
        {statusSuffix}
      </span>
    );
  }

  if (model.outcome === RunnerPickerOutcome.UnknownRunner) {
    return (
      <span
        className="text-amber-700"
        data-testid={CODE_REPOSITORY_RUNNER_VALUE_TEST_ID}
      >
        {translator.translateText(CodeRepositoryRunnerCopy.unknownRunner)}
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

  return (
    <span data-testid={CODE_REPOSITORY_RUNNER_VALUE_TEST_ID}>
      {translator.translateText(GLOBAL_RUNNER_CHOICE_LABEL)}
      {statusSuffix}
    </span>
  );
};
