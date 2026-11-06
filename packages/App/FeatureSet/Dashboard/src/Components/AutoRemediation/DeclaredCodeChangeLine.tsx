import DeclaredCodeChangeDialog from "./DeclaredCodeChangeDialog";
import {
  DECLARED_CODE_ANSWER,
  DECLARED_CODE_ASK_HINT,
  DECLARED_CODE_ASK_TITLE,
  DECLARED_CODE_CHANGE_POLL_MS,
  DECLARED_CODE_STATE_TONES,
  DECLARED_CODE_STATE_WORDS,
  DECLARED_CODE_TRY_AGAIN,
  DECLARED_CODE_UNNAMED_REPOSITORY,
  DECLARED_CODE_VIEW_PROGRESS,
  DECLARED_CODE_VIEW_PULL_REQUEST,
  DECLARED_CODE_VIEW_TASK,
  DeclaredCodeChangeTone,
  canAskForDeclaredCodeChange,
  findDeclaredCodeChange,
  readDeclaredCodeChanges,
} from "./DeclaredCodeChangeWords";
import { REMEDIATION_FIX_STEP_MARK_CLASS_NAMES } from "./RemediationFixStepList";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { AiRemediationCommand } from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  DECLARED_CODE_CHANGES_PATH,
  DeclaredCodeChangeJSON,
  DeclaredCodeChangeState,
  readDeclaredCode,
} from "Common/Utils/AiRemediation/DeclaredCodeChange";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FIX THAT LASTS, UNDER ITS STEP: THE PULL REQUEST TO THE CODE.
 *
 * Under a step whose change sets a value of a cloud resource declared as
 * code: before anything is asked, "Open a pull request to the code", which
 * opens the dialog that asks first (DeclaredCodeChangeDialog); after, where
 * the pull request stands, as the fix in the code beside it on the same card
 * says it (RemediationCodeFix) - a mark in the card's colours, a sentence,
 * and what to do: View progress while it is written (read again every few
 * seconds), View pull request once it is open, Answer in Code while it
 * waits for the reader, Try again once it failed. Nothing is drawn under any
 * other step.
 */

export const DECLARED_CODE_LINE_TEST_ID: string = "declared-code-change";

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const MARK_ICONS: Readonly<
  Record<Exclude<DeclaredCodeChangeTone, "live">, IconProp>
> = {
  done: IconProp.Check,
  attention: IconProp.HandRaised,
  idle: IconProp.Minus,
  failed: IconProp.Close,
};

export interface ComponentProps {
  suggestionId: string;
  command: AiRemediationCommand;
  /*
   * Whether the line says why next to its button. The plan's list says it
   * just above (the note on the declared code), so there it does not.
   */
  showsWhy?: boolean | undefined;
}

// Where the pull request stands, as a small mark in the AI card's colours.
const DeclaredCodeChangeMark: FunctionComponent<{
  tone: DeclaredCodeChangeTone;
}> = (props: { tone: DeclaredCodeChangeTone }): ReactElement => {
  return (
    <span
      aria-hidden="true"
      data-testid={`${DECLARED_CODE_LINE_TEST_ID}-mark`}
      data-tone={props.tone}
      className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full ${
        REMEDIATION_FIX_STEP_MARK_CLASS_NAMES[props.tone]
      }`}
    >
      {props.tone === "live" ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
        </span>
      ) : (
        <Icon icon={MARK_ICONS[props.tone]} className="h-2.5 w-2.5" />
      )}
    </span>
  );
};

const DeclaredCodeChangeLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isOffered: boolean = canAskForDeclaredCodeChange(props.command);
  const [change, setChange] = useState<DeclaredCodeChangeJSON | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [readToken, setReadToken] = useState<number>(0);

  // Where the step's pull request stands, read as the line opens and again while it is written.
  useEffect(() => {
    if (!isOffered || !props.suggestionId) {
      return undefined;
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              DECLARED_CODE_CHANGES_PATH,
            ),
            data: { suggestionId: props.suggestionId },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (isCurrent && !(response instanceof HTTPErrorResponse)) {
          setChange(
            findDeclaredCodeChange(
              readDeclaredCodeChanges(response.data),
              props.command.sequence,
            ),
          );
        }
      } catch {
        // The line keeps what it knew; it asks again at the next read.
      }
    };

    read().catch(() => {
      // handled inside read
    });

    return () => {
      isCurrent = false;
    };
  }, [isOffered, props.suggestionId, props.command.sequence, readToken]);

  // Read again while the pull request is being written.
  useEffect(() => {
    if (change?.state !== DeclaredCodeChangeState.Writing) {
      return undefined;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setReadToken((token: number) => {
        return token + 1;
      });
    }, DECLARED_CODE_CHANGE_POLL_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [change]);

  if (!isOffered || !props.suggestionId) {
    return <></>;
  }

  const code: string =
    readDeclaredCode(props.command.managedAsCode)?.name ||
    props.command.managedAsCode ||
    "";
  const showsWhy: boolean = props.showsWhy !== false;

  const openDialog: () => void = (): void => {
    setIsDialogOpen(true);
  };

  const dialog: ReactElement = isDialogOpen ? (
    <DeclaredCodeChangeDialog
      suggestionId={props.suggestionId}
      command={props.command}
      onClose={() => {
        setIsDialogOpen(false);
      }}
      onAsked={() => {
        setIsDialogOpen(false);
        setReadToken((token: number) => {
          return token + 1;
        });
      }}
    />
  ) : (
    <></>
  );

  if (!change) {
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
        data-testid={DECLARED_CODE_LINE_TEST_ID}
        data-state="offered"
      >
        {/* OUTLINE: sized to its words at every width, with no dialog footer's margin. */}
        <Button
          title={DECLARED_CODE_ASK_TITLE}
          icon={IconProp.Code}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          dataTestId={`${DECLARED_CODE_LINE_TEST_ID}-ask`}
          onClick={openDialog}
        />
        {showsWhy ? (
          <span
            className="text-xs text-gray-500"
            data-testid={`${DECLARED_CODE_LINE_TEST_ID}-why`}
          >
            {translator.translateTemplate(
              DECLARED_CODE_ASK_HINT,
              { code },
              { setsValuesApart: true },
            )}
          </span>
        ) : (
          <></>
        )}
        {dialog}
      </div>
    );
  }

  const taskRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: change.taskId },
  );
  // The task's link, in the words of what is to do with it now.
  const taskLinkWords: string =
    change.state === DeclaredCodeChangeState.Writing
      ? DECLARED_CODE_VIEW_PROGRESS
      : change.state === DeclaredCodeChangeState.WaitingForYou
        ? DECLARED_CODE_ANSWER
        : DECLARED_CODE_VIEW_TASK;

  return (
    <div
      className="mt-2 flex items-start gap-2"
      data-testid={DECLARED_CODE_LINE_TEST_ID}
      data-state={change.state}
    >
      <DeclaredCodeChangeMark tone={DECLARED_CODE_STATE_TONES[change.state]} />
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className="break-words text-xs leading-5 text-gray-700"
          data-testid={`${DECLARED_CODE_LINE_TEST_ID}-text`}
        >
          {translator.translateTemplate(
            DECLARED_CODE_STATE_WORDS[change.state],
            {
              repository:
                change.repositoryName ||
                translator.translateText(DECLARED_CODE_UNNAMED_REPOSITORY) ||
                DECLARED_CODE_UNNAMED_REPOSITORY,
            },
            // A repository's Latin name keeps its place in a Persian sentence.
            { setsValuesApart: true },
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {change.pullRequestUrl ? (
            <a
              href={change.pullRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS_NAME}
              data-testid={`${DECLARED_CODE_LINE_TEST_ID}-pull-request`}
            >
              <span>
                {translator.translateText(DECLARED_CODE_VIEW_PULL_REQUEST)}
                {/*
                 * The space outside the number's own direction: inside it, a
                 * right-to-left line drew it on the far side - "#482Pull".
                 */}
                {change.pullRequestNumber ? (
                  <>
                    {" "}
                    <span dir="ltr">#{change.pullRequestNumber}</span>
                  </>
                ) : (
                  <></>
                )}
              </span>
              <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
            </a>
          ) : (
            <></>
          )}
          <Link
            to={taskRoute}
            className={LINK_CLASS_NAME}
            dataTestId={`${DECLARED_CODE_LINE_TEST_ID}-task`}
          >
            <>{translator.translateText(taskLinkWords)}</>
          </Link>
          {change.state === DeclaredCodeChangeState.Failed ? (
            <button
              type="button"
              className={LINK_CLASS_NAME}
              data-testid={`${DECLARED_CODE_LINE_TEST_ID}-try-again`}
              onClick={openDialog}
            >
              {translator.translateText(DECLARED_CODE_TRY_AGAIN)}
            </button>
          ) : (
            <></>
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
};

export default DeclaredCodeChangeLine;
