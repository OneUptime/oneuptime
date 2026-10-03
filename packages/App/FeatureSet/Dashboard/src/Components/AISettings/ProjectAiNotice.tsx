import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { getEnableAiConfirmation } from "./EnableAiConfirmation";
import {
  ENABLE_AI_COLUMN,
  ENABLE_AI_NOTICE_SWITCH_TEST_ID,
  EnableAiCopy,
  getProjectAiNotices,
  PROJECT_AI_NOTICE_CONTEXT_COPY,
  PROJECT_AI_OFF_NOTICE_TEST_ID,
  PROJECT_AI_OFF_SENTENCE_TEST_ID,
  PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
  ProjectAiNoticeContext,
  ProjectAiNoticeContextCopy,
  ProjectAiNoticeCopy,
  ProjectAiNoticeKind,
  ProjectAiState,
} from "./ProjectAiSettingsCopy";
import useProjectAiReadiness, {
  ProjectAiReadiness,
} from "./useProjectAiReadiness";

/*
 * At the top of an AI settings page, and only when something there needs
 * doing (see getProjectAiNotices):
 *
 * - Enable AI is off for the project. Every switch on the page still shows
 *   what it is set to, but none of it runs, and the page used to say
 *   nothing about it. The notice holds Enable AI's own switch, which saves
 *   the moment it is flipped - for someone who may change it (a project
 *   owner, or anyone who manages billing: the column's own update
 *   permissions). Everyone else gets one sentence: what is off, and who
 *   can turn it on. Turned on from here, the notice stays until the page is
 *   left, saying AI is on, so the press shows its result and can be taken
 *   back (turning it off again asks first, as everywhere).
 *
 * - The project has no LLM provider OneUptime AI can use: none at all, or
 *   providers but none is the default. The cards used to say "Requires an
 *   LLM provider to be configured in Project Settings > AI > LLM Providers"
 *   to everyone, always - untrue on OneUptime Cloud, where the global
 *   providers are used. Now it is said only when it is so, with a link to
 *   the page that fixes it.
 *
 * Nothing is drawn while all is well, while the answers are on their way,
 * or when they could not be read.
 */

export interface ComponentProps {
  context: ProjectAiNoticeContext;
}

// The quiet panel each notice is drawn in.
const PANEL_CLASS_NAME: string =
  "mb-5 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 md:px-6";

const ProjectAiNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readiness: ProjectAiReadiness = useProjectAiReadiness();
  const [isChangedHere, setIsChangedHere] = useState<boolean>(false);

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const notices: Array<ProjectAiNoticeKind> = getProjectAiNotices({
    context: props.context,
    aiState: readiness.aiState,
    providerState: readiness.providerState,
    isChangedHere: isChangedHere,
  });

  if (!projectId || notices.length === 0) {
    return <></>;
  }

  const contextCopy: ProjectAiNoticeContextCopy =
    PROJECT_AI_NOTICE_CONTEXT_COPY[props.context];

  /*
   * Read on every render rather than remembered: the permission snapshot
   * arrives on a response header, and may land after the first paint.
   */
  const mayChangeAi: boolean = PermissionGate.checkColumnUpdate(
    new Project(),
    ENABLE_AI_COLUMN,
  ).isAllowed;

  const getAiOffNotice: () => ReactElement = (): ReactElement => {
    if (!mayChangeAi && !isChangedHere) {
      return (
        <div
          key={ProjectAiNoticeKind.AiOff}
          className={`${PANEL_CLASS_NAME} flex items-start gap-3`}
          data-testid={PROJECT_AI_OFF_NOTICE_TEST_ID}
        >
          <Icon
            icon={IconProp.InformationCircle}
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
          />
          <p
            className="text-sm text-gray-700"
            data-testid={PROJECT_AI_OFF_SENTENCE_TEST_ID}
          >
            {translator.translateText(contextCopy.aiOffDescription)}{" "}
            {translator.translateText(EnableAiCopy.whoCanTurnOn)}
          </p>
        </div>
      );
    }

    return (
      <div
        key={ProjectAiNoticeKind.AiOff}
        className={PANEL_CLASS_NAME}
        data-testid={PROJECT_AI_OFF_NOTICE_TEST_ID}
      >
        <ModelSwitchRow<Project>
          modelType={Project}
          modelId={projectId}
          column={ENABLE_AI_COLUMN}
          initialValue={readiness.aiState === ProjectAiState.On}
          title={EnableAiCopy.switchTitle}
          getDescription={(isOn: boolean): string => {
            return isOn
              ? ProjectAiNoticeCopy.aiOnDescription
              : contextCopy.aiOffDescription;
          }}
          getConfirmation={getEnableAiConfirmation}
          onChange={() => {
            /*
             * At the press, not after the save: the save is announced
             * (ModelSwitchEvents) before it is reported, and the page
             * learning that AI is on must not take the switch away while
             * it is saying "Saved". The switch also moves when Enable AI
             * is saved elsewhere on the screen; the notice then stays too,
             * saying what it is now, rather than vanishing under the
             * reader.
             */
            setIsChangedHere(true);
          }}
          dataTestId={ENABLE_AI_NOTICE_SWITCH_TEST_ID}
        />
      </div>
    );
  };

  const getProviderNotice: (kind: ProjectAiNoticeKind) => ReactElement = (
    kind: ProjectAiNoticeKind,
  ): ReactElement => {
    const isMissing: boolean = kind === ProjectAiNoticeKind.ProviderMissing;

    const llmProvidersRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
    );

    return (
      <div
        key={kind}
        className={`${PANEL_CLASS_NAME} flex items-start gap-3`}
        data-testid={PROJECT_AI_PROVIDER_NOTICE_TEST_ID}
      >
        <Icon
          icon={IconProp.InformationCircle}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
        />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-gray-700">
            {translator.translateText(
              isMissing
                ? ProjectAiNoticeCopy.providerMissing
                : ProjectAiNoticeCopy.providerNoDefault,
            )}{" "}
            {translator.translateText(contextCopy.providerConsequence)}
          </p>
          <Link
            to={llmProvidersRoute}
            className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800"
          >
            <span>
              {translator.translateText(
                isMissing
                  ? ProjectAiNoticeCopy.addProviderLink
                  : ProjectAiNoticeCopy.chooseDefaultProviderLink,
              )}
            </span>
            <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  };

  return (
    <>
      {notices.map((kind: ProjectAiNoticeKind): ReactElement => {
        return kind === ProjectAiNoticeKind.AiOff
          ? getAiOffNotice()
          : getProviderNotice(kind);
      })}
    </>
  );
};

export default ProjectAiNotice;
