import DeclaredCodeChangeDialog from "./DeclaredCodeChangeDialog";
import {
  DECLARED_CODE_ASK_AGAIN,
  DECLARED_CODE_ASK_HINT,
  DECLARED_CODE_ASK_TITLE,
  DECLARED_CODE_CHANGE_POLL_MS,
  DECLARED_CODE_STATE_WORDS,
  DECLARED_CODE_UNNAMED_REPOSITORY,
  DECLARED_CODE_VIEW_PULL_REQUEST,
  DECLARED_CODE_VIEW_TASK,
  canAskForDeclaredCodeChange,
  findDeclaredCodeChange,
  readDeclaredCodeChanges,
} from "./DeclaredCodeChangeWords";
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
 * the pull request stands - being written, open (with its link), ended
 * without one, or failed (with Ask again) - read again every few seconds
 * while it is being written. Nothing is drawn under any other step.
 */

export const DECLARED_CODE_LINE_TEST_ID: string = "declared-code-change";

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export interface ComponentProps {
  suggestionId: string;
  command: AiRemediationCommand;
}

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
        <Button
          title={DECLARED_CODE_ASK_TITLE}
          icon={IconProp.Code}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          dataTestId={`${DECLARED_CODE_LINE_TEST_ID}-ask`}
          onClick={() => {
            setIsDialogOpen(true);
          }}
        />
        <span className="text-xs text-gray-500">
          {translator.translateTemplate(DECLARED_CODE_ASK_HINT, { code })}
        </span>
        {dialog}
      </div>
    );
  }

  const taskRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: change.taskId },
  );
  const tone: string =
    change.state === DeclaredCodeChangeState.Opened
      ? "text-emerald-700"
      : change.state === DeclaredCodeChangeState.Failed
        ? "text-amber-700"
        : "text-gray-700";

  return (
    <div
      className="mt-2 space-y-1"
      data-testid={DECLARED_CODE_LINE_TEST_ID}
      data-state={change.state}
    >
      <p className={`flex items-start gap-1.5 text-xs leading-5 ${tone}`}>
        <Icon
          icon={
            change.state === DeclaredCodeChangeState.Opened
              ? IconProp.CheckCircle
              : IconProp.Code
          }
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
        />
        <span className="min-w-0">
          {translator.translateTemplate(
            DECLARED_CODE_STATE_WORDS[change.state],
            {
              repository:
                change.repositoryName ||
                translator.translateText(DECLARED_CODE_UNNAMED_REPOSITORY) ||
                DECLARED_CODE_UNNAMED_REPOSITORY,
            },
          )}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 ps-5">
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
              {change.pullRequestNumber ? (
                <span dir="ltr"> #{change.pullRequestNumber}</span>
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
          <>{translator.translateText(DECLARED_CODE_VIEW_TASK)}</>
        </Link>
        {change.state === DeclaredCodeChangeState.Failed ? (
          <button
            type="button"
            className={LINK_CLASS_NAME}
            data-testid={`${DECLARED_CODE_LINE_TEST_ID}-ask-again`}
            onClick={() => {
              setIsDialogOpen(true);
            }}
          >
            {translator.translateText(DECLARED_CODE_ASK_AGAIN)}
          </button>
        ) : (
          <></>
        )}
      </div>
      {dialog}
    </div>
  );
};

export default DeclaredCodeChangeLine;
