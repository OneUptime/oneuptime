import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import WorkspaceAskToConnectUtil, {
  WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS,
  WORKSPACE_ASK_TO_CONNECT_ROUTE,
  WorkspaceAskToConnectRun,
  WorkspaceAskToConnectState,
  WorkspaceAskToConnectStatus,
} from "Common/Types/Workspace/WorkspaceAskToConnect";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ASKING EVERY MEMBER TO CONNECT THEIR SLACK OR MICROSOFT TEAMS ACCOUNT.
 *
 * On a project's Slack or Microsoft Teams settings, for its owners and
 * admins: how many members have connected their account, and one button
 * that asks everybody else at once - OneUptime's bot sends each of them a
 * direct message whose Connect button connects their account in one click
 * (WorkspaceAskToConnect). While the messages go out, the card reads how far
 * they got; afterwards it says how it went, naming whoever OneUptime could
 * not find, so they can be told some other way.
 */

export const ASK_TO_CONNECT_TITLE: string = translationKey(
  "Members' {{workspace}} accounts",
);

export const ASK_TO_CONNECT_DESCRIPTION: string = translationKey(
  "Each member connects their own {{workspace}} account, so that buttons and commands there act as them. Ask everyone who has not connected yet: OneUptime sends each of them a direct message with a Connect button.",
);

export const CONNECTED_COUNT: PluralTemplate = {
  one: "{{connected}} of {{count}} member connected",
  other: "{{connected}} of {{count}} members connected",
};

export const EVERYONE_CONNECTED: string = translationKey(
  "Everyone has connected their {{workspace}} account.",
);

export const ASK_TO_CONNECT_BUTTON: string = translationKey(
  "Ask everyone to connect",
);

export const ASKING_ALREADY_TOOLTIP: string = translationKey(
  "The messages are going out. This takes a few minutes for a large team.",
);

export const ASK_TO_CONNECT_CONFIRM_TITLE: string = translationKey(
  "Ask everyone to connect their {{workspace}} accounts?",
);

export const ASK_TO_CONNECT_CONFIRM_DESCRIPTION: string = translationKey(
  "Each member who has not connected gets a direct message from OneUptime in {{workspace}}, with a button that connects their account in one click. Members asked in the last {{hours}} hours are not asked again.",
);

// How OneUptime finds people, by workspace.
export const FOUND_BY_EMAIL: Record<WorkspaceType, string> = {
  [WorkspaceType.Slack]: translationKey(
    "OneUptime finds them in Slack by their email address.",
  ),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "OneUptime finds them by their email address, in the teams its app is installed in.",
  ),
};

export const ASK_TO_CONNECT_CONFIRM_BUTTON: string =
  translationKey("Send messages");

export const RUN_ASKING: PluralTemplate = {
  one: "Asking {{count}} member to connect. {{asked}} messaged so far.",
  other: "Asking {{count}} members to connect. {{asked}} messaged so far.",
};

export const RUN_ASKED: PluralTemplate = {
  one: "{{name}} asked {{count}} member to connect on {{date}}.",
  other: "{{name}} asked {{count}} members to connect on {{date}}.",
};

export const RUN_NOBODY_TO_ASK: string = translationKey(
  "Nobody was asked on {{date}}: every member has connected, or was asked in the last {{hours}} hours.",
);

export const RUN_NOT_FOUND: PluralTemplate = {
  one: "{{count}} member could not be found in {{workspace}} by their email address: {{names}}.",
  other:
    "{{count}} members could not be found in {{workspace}} by their email addresses: {{names}}.",
};

export const RUN_NOT_FOUND_HINT: string = translationKey(
  "They can connect under User Settings → Workspace → {{workspace}}.",
);

export const RUN_FAILED: PluralTemplate = {
  one: "{{count}} message could not be sent. Ask again to retry.",
  other: "{{count}} messages could not be sent. Ask again to retry.",
};

export const RUN_STOPPED: string = translationKey(
  "Asking stopped before it was done. Ask again to message the rest.",
);

// How often the card reads how far the messages got, while they go out.
export const ASK_TO_CONNECT_POLL_MS: number = 3000;

/*
 * Whether the signed-in person may ask everybody: owners and admins, as the
 * server asks (WORKSPACE_ASK_TO_CONNECT_PERMISSIONS). Nobody, until the
 * permission snapshot has landed.
 */
export function mayAskToConnect(): boolean {
  return PermissionGate.holdsAnyOf([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
  ]);
}

// What the card says of the last run, sentence by sentence.
export function getRunSentences(data: {
  run: WorkspaceAskToConnectRun;
  workspaceType: WorkspaceType;
  translator: Translator;
}): Array<string> {
  const { run, translator } = data;
  const workspace: string = getWorkspaceTypeDisplayName(data.workspaceType);

  if (run.state === WorkspaceAskToConnectState.Asking) {
    return [
      translator.translatePlural(RUN_ASKING, run.toAskCount, {
        asked: translator.formatNumber(run.askedCount),
      }),
    ];
  }

  const date: string = OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    run.startedAt,
  );

  const sentences: Array<string> = [];

  if (run.toAskCount === 0) {
    sentences.push(
      translator.translateTemplate(RUN_NOBODY_TO_ASK, {
        date: date,
        hours: String(WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS),
      }),
    );
  } else {
    sentences.push(
      translator.translatePlural(RUN_ASKED, run.askedCount, {
        name: run.askedByName || "OneUptime",
        date: date,
      }),
    );
  }

  if (run.notFoundCount > 0) {
    const names: string =
      run.notFoundNames.join(", ") +
      (run.notFoundCount > run.notFoundNames.length ? ", …" : "");

    sentences.push(
      translator.translatePlural(RUN_NOT_FOUND, run.notFoundCount, {
        workspace: workspace,
        names: names,
      }),
    );

    sentences.push(
      translator.translateTemplate(RUN_NOT_FOUND_HINT, {
        workspace: workspace,
      }),
    );
  }

  if (run.failedCount > 0) {
    sentences.push(translator.translatePlural(RUN_FAILED, run.failedCount));
  }

  if (run.state === WorkspaceAskToConnectState.Stopped) {
    sentences.push(translator.translateText(RUN_STOPPED) || RUN_STOPPED);
  }

  return sentences;
}

export interface ComponentProps {
  workspaceType: WorkspaceType;
}

const AskToConnectCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const workspace: string = getWorkspaceTypeDisplayName(props.workspaceType);

  // Asked at every render: the permission snapshot can land after the page.
  const mayAsk: boolean = mayAskToConnect();
  const [status, setStatus] = useState<WorkspaceAskToConnectStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [startError, setStartError] = useState<string>("");

  const url: URL = URL.fromURL(APP_API_URL).addRoute(
    `${WORKSPACE_ASK_TO_CONNECT_ROUTE}/${props.workspaceType}`,
  );

  type ReadStatusFunction = () => Promise<void>;

  const readStatus: ReadStatusFunction = async (): Promise<void> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: url,
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setStatus(WorkspaceAskToConnectUtil.statusFromJSON(response.data));
      setError("");
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!mayAsk) {
      return;
    }

    readStatus().catch(() => {
      // readStatus says what went wrong itself.
    });
  }, [mayAsk]);

  const isAsking: boolean =
    status?.run?.state === WorkspaceAskToConnectState.Asking;

  // While the messages go out, read how far they got.
  useEffect(() => {
    if (!isAsking) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      readStatus().catch(() => {
        // readStatus says what went wrong itself.
      });
    }, ASK_TO_CONNECT_POLL_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isAsking, status]);

  if (!mayAsk) {
    return null;
  }

  type StartFunction = () => Promise<void>;

  const start: StartFunction = async (): Promise<void> => {
    try {
      setIsStarting(true);
      setStartError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: url,
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setStatus(WorkspaceAskToConnectUtil.statusFromJSON(response.data));
      setIsConfirmOpen(false);
    } catch (err) {
      setStartError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsStarting(false);
    }
  };

  const notConnectedCount: number = status
    ? Math.max(0, status.memberCount - status.connectedCount)
    : 0;

  const percent: number =
    status && status.memberCount > 0
      ? Math.round((status.connectedCount / status.memberCount) * 100)
      : 0;

  return (
    <div data-testid="ask-to-connect-card">
      <Card
        title={translator.translateTemplate(ASK_TO_CONNECT_TITLE, {
          workspace: workspace,
        })}
        description={translator.translateTemplate(ASK_TO_CONNECT_DESCRIPTION, {
          workspace: workspace,
        })}
        buttons={
          status && notConnectedCount > 0
            ? [
                {
                  title: ASK_TO_CONNECT_BUTTON,
                  buttonStyle: ButtonStyleType.NORMAL,
                  icon: IconProp.SendMessage,
                  isLoading: isAsking,
                  disabled: isAsking,
                  tooltip: isAsking ? ASKING_ALREADY_TOOLTIP : undefined,
                  onClick: () => {
                    setStartError("");
                    setIsConfirmOpen(true);
                  },
                },
              ]
            : []
        }
      >
        <div className="mt-2 space-y-3">
          {isLoading && <ComponentLoader />}

          {!isLoading && error && <ErrorMessage message={error} />}

          {!isLoading && !error && status && (
            <div className="space-y-3">
              <div>
                <div
                  className="text-sm font-medium text-gray-900"
                  data-testid="ask-to-connect-count"
                >
                  {notConnectedCount === 0 && status.memberCount > 0
                    ? translator.translateTemplate(EVERYONE_CONNECTED, {
                        workspace: workspace,
                      })
                    : translator.translatePlural(
                        CONNECTED_COUNT,
                        status.memberCount,
                        {
                          connected: translator.formatNumber(
                            status.connectedCount,
                          ),
                        },
                      )}
                </div>
                <div
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100"
                  role="presentation"
                >
                  <div
                    className="h-2 rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              {status.run && (
                <div
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 space-y-1"
                  data-testid="ask-to-connect-run"
                >
                  {getRunSentences({
                    run: status.run,
                    workspaceType: props.workspaceType,
                    translator: translator,
                  }).map((sentence: string, index: number) => {
                    return <p key={index}>{sentence}</p>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {isConfirmOpen && (
        <ConfirmModal
          title={translator.translateTemplate(ASK_TO_CONNECT_CONFIRM_TITLE, {
            workspace: workspace,
          })}
          description={
            <div className="space-y-2">
              <p>
                {translator.translateTemplate(
                  ASK_TO_CONNECT_CONFIRM_DESCRIPTION,
                  {
                    workspace: workspace,
                    hours: String(WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS),
                  },
                )}
              </p>
              <p>
                {translator.translateText(
                  FOUND_BY_EMAIL[props.workspaceType],
                ) || FOUND_BY_EMAIL[props.workspaceType]}
              </p>
            </div>
          }
          submitButtonText={ASK_TO_CONNECT_CONFIRM_BUTTON}
          isLoading={isStarting}
          error={startError || undefined}
          onClose={() => {
            setIsConfirmOpen(false);
            setStartError("");
          }}
          onSubmit={() => {
            start().catch((err: Exception) => {
              setStartError(API.getFriendlyErrorMessage(err));
            });
          }}
        />
      )}
    </div>
  );
};

export default AskToConnectCard;
