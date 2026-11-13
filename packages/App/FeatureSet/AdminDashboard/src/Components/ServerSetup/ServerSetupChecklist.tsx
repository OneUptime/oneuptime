import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ServerTestSendButton from "./ServerTestSendButton";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ServerSendingChannel,
  ServerSendingState,
} from "Common/Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  SERVER_SETUP_ADMIN_PATHS,
  SERVER_SETUP_CHECKED_WORDS,
  SERVER_SETUP_CHECKS,
  SERVER_SETUP_GUIDES,
  ServerSetupCheckDefinition,
  ServerSetupCheckId,
  ServerSetupCheckResult,
  ServerSetupCheckTier,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupStatus,
} from "Common/Types/ServerSetup/ServerSetupChecklist";
import { ServerTestSendAnswer } from "Common/Types/ServerSetup/ServerTestSend";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ServerSetupChecklistLoader from "Common/UI/Utils/ServerSetupChecklist";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * FINISH SETTING UP THIS SERVER: EVERY CHECK, WHERE IT STANDS, AND THE ONE
 * THING TO DO NEXT FOR EACH.
 *
 * The Admin Dashboard's Server setup page (/admin/setup) draws the server's
 * answer (Types/ServerSetup/ServerSetupChecklist, read from the server's
 * real state): required first - email, HTTPS, who can sign up - then what
 * most servers want - SMS and calls, a probe that reports, backups, update
 * checks - and, folded away, the optional ones.
 *
 * Each row says what it is for and where it stands in one line, then what
 * that was checked against in a smaller one ("smtp.example.com accepted an
 * email on 11 Nov", "Chosen by Ada Lovelace on 11 Nov"), and offers one
 * action: the page that sets it up, a test send, a guide - and, where the
 * server cannot decide, the admin's own choice ("Use email and push only",
 * "This server is backed up"), which can be undone.
 *
 * HTTPS is the one check the browser knows more about: the server reads
 * HTTP_PROTOCOL, and this page knows whether it came over HTTPS - a proxy in
 * front that OneUptime was not told about, or an http:// bookmark to a
 * server set to HTTPS, each said as what it is.
 */

export const SERVER_SETUP_COPY: {
  title: string;
  description: string;
  allDone: string;
  required: string;
  recommended: string;
  optional: string;
  progress: string;
  doneLabel: string;
  openLabel: string;
  failingLabel: string;
  opensInNewTab: string;
  https: {
    onlyBeforeOneUptime: string;
    openedOverHttp: string;
    action: string;
    openOverHttps: string;
  };
  actions: {
    setUpEmail: string;
    openSettings: string;
    chooseWhoCanSignUp: string;
    keepSignupsOpen: string;
    setUpSmsAndCalls: string;
    useEmailAndPushOnly: string;
    seeGlobalProbes: string;
    notNeeded: string;
    howToBackUp: string;
    setUpBackups: string;
    isBackedUp: string;
    readTheGuide: string;
    addAiProvider: string;
    setUpSingleSignOn: string;
    undo: string;
  };
} = {
  title: "Finish setting up this server",
  description:
    "What a new server needs before people rely on it, most important first.",
  allDone: "Everything this server needs is set up.",
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
  progress: "{{done}} of {{total}} done",
  doneLabel: "Done",
  openLabel: "Still to do",
  failingLabel: "Failing",
  opensInNewTab: "Opens in a new tab",
  https: {
    onlyBeforeOneUptime:
      "Almost: this page came over HTTPS, but OneUptime is still set to HTTP, so the links it sends start with http://. Set HTTP_PROTOCOL=https.",
    openedOverHttp:
      "Almost: OneUptime is set to HTTPS, but this page came over HTTP, so this visit is not encrypted.",
    action: "How to set up HTTPS",
    openOverHttps: "Open over HTTPS",
  },
  actions: {
    setUpEmail: "Set up email",
    openSettings: "Open settings",
    chooseWhoCanSignUp: "Choose who can sign up",
    keepSignupsOpen: "Keep sign-ups open",
    setUpSmsAndCalls: "Set up SMS and calls",
    useEmailAndPushOnly: "Use email and push only",
    seeGlobalProbes: "See global probes",
    notNeeded: "Not needed",
    howToBackUp: "How to back up",
    setUpBackups: "Set up backups",
    isBackedUp: "This server is backed up",
    readTheGuide: "Read the guide",
    addAiProvider: "Add an AI provider",
    setUpSingleSignOn: "Set up single sign-on",
    undo: "Undo",
  },
};

/*
 * Whether people reach the server over HTTPS: OneUptime is told so
 * (HTTP_PROTOCOL=https, which its links and cookies follow) and this page
 * came over HTTPS. A page that came over HTTPS to a server still set to HTTP
 * - a proxy in front that nobody told OneUptime about - is not done.
 */
export const isServedOverHttps: (
  httpProtocol: Protocol,
  pageProtocol: string,
) => boolean = (httpProtocol: Protocol, pageProtocol: string): boolean => {
  return httpProtocol === Protocol.HTTPS && pageProtocol === "https:";
};

/*
 * A proxy in front of OneUptime answers over HTTPS, and nobody told
 * OneUptime: the connection is encrypted, but the links OneUptime sends and
 * its sign-in cookies still say HTTP. The row says exactly that - not that
 * passwords cross the network unencrypted, which here they do not.
 */
export const isHttpsOnlyBeforeOneUptime: (
  httpProtocol: Protocol,
  pageProtocol: string,
) => boolean = (httpProtocol: Protocol, pageProtocol: string): boolean => {
  return httpProtocol !== Protocol.HTTPS && pageProtocol === "https:";
};

/*
 * The reverse: OneUptime is told it is reached over HTTPS, and this page
 * came over plain HTTP all the same - an http:// bookmark, the server's IP
 * address, a visit while the certificate was on its way. The links
 * OneUptime sends are right; this visit is not encrypted, and the row says
 * that - not "Not set up yet", which would send the admin to a guide whose
 * steps are done.
 */
export const isOpenedOverHttpWhileSetToHttps: (
  httpProtocol: Protocol,
  pageProtocol: string,
) => boolean = (httpProtocol: Protocol, pageProtocol: string): boolean => {
  return httpProtocol === Protocol.HTTPS && pageProtocol === "http:";
};

/*
 * This page over HTTPS, at the address OneUptime's own links point to
 * (HOST): a visit through the server's IP address moves to its name, whose
 * certificate it is. Without a HOST, the address the page came to.
 */
export const getHttpsAddress: (data: {
  host: string;
  location: { host: string; pathname: string; search: string };
}) => string = (data: {
  host: string;
  location: { host: string; pathname: string; search: string };
}): string => {
  const host: string = data.host.trim() || data.location.host;

  return `https://${host}${data.location.pathname}${data.location.search}`;
};

// One action a row offers.
export interface ServerSetupAction {
  kind: "route" | "guide" | "address" | "test" | "choose" | "undo";
  title: string;
  route?: Route | undefined;
  url?: string | undefined;
  channel?: ServerSendingChannel | undefined;
  choice?: ServerSetupChoiceKind | undefined;
  // The quieter of two actions: drawn as a link.
  isSecondary?: boolean | undefined;
}

// A row as drawn: its words and its actions.
export interface ServerSetupRow {
  id: ServerSetupCheckId;
  tier: ServerSetupCheckTier;
  title: string;
  isFinished: boolean;
  isFailing: boolean;
  // The status line: an English template and what fills it.
  status: { template: string; values: Record<string, string> };
  // What it was checked against, each an English template and its values.
  checked: Array<{ template: string; values: Record<string, string> }>;
  actions: Array<ServerSetupAction>;
}

// The browser's own view of HTTPS, for the HTTPS row.
export interface ServerSetupPageFacts {
  httpProtocol: Protocol;
  pageProtocol: string;
  httpsAddress: string;
  hasScheduledBackups?: boolean | undefined;
}

const route: (page: PageMap) => Route = (page: PageMap): Route => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
};

type FormatTime = (iso: string | null) => string;

/*
 * Every row, in the catalogue's order, from the server's answer and what
 * this page knows: what each says, and what it offers.
 */
export const getServerSetupRows: (data: {
  answer: ServerSetupChecklistAnswer;
  page: ServerSetupPageFacts;
  formatTime: FormatTime;
}) => Array<ServerSetupRow> = (data: {
  answer: ServerSetupChecklistAnswer;
  page: ServerSetupPageFacts;
  formatTime: FormatTime;
}): Array<ServerSetupRow> => {
  const rows: Array<ServerSetupRow> = [];

  for (const definition of SERVER_SETUP_CHECKS) {
    const check: ServerSetupCheckResult | null =
      ServerSetupChecklistUtil.getCheck(data.answer, definition.id);

    if (!check) {
      continue;
    }

    rows.push(getServerSetupRow({ ...data, check, definition }));
  }

  return rows;
};

const getChoiceTitle: (id: ServerSetupCheckId) => string = (
  id: ServerSetupCheckId,
): string => {
  switch (id) {
    case ServerSetupCheckId.Signups:
      return SERVER_SETUP_COPY.actions.keepSignupsOpen;
    case ServerSetupCheckId.SmsAndCalls:
      return SERVER_SETUP_COPY.actions.useEmailAndPushOnly;
    case ServerSetupCheckId.Backups:
      return SERVER_SETUP_COPY.actions.isBackedUp;
    default:
      return SERVER_SETUP_COPY.actions.notNeeded;
  }
};

export const getServerSetupRow: (data: {
  check: ServerSetupCheckResult;
  definition: ServerSetupCheckDefinition;
  page: ServerSetupPageFacts;
  formatTime: FormatTime;
}) => ServerSetupRow = (data: {
  check: ServerSetupCheckResult;
  definition: ServerSetupCheckDefinition;
  page: ServerSetupPageFacts;
  formatTime: FormatTime;
}): ServerSetupRow => {
  const check: ServerSetupCheckResult = data.check;
  const time: string = data.formatTime(check.time);
  const actions: Array<ServerSetupAction> = [];
  const checked: ServerSetupRow["checked"] = [];

  let status: ServerSetupRow["status"] = {
    template: ServerSetupChecklistUtil.getStatusWords(check),
    values: { time: time },
  };
  let isFinished: boolean = check.isFinished;

  const providerSaid: (
    sentThrough: string | null,
    reason: string | null,
  ) => void = (sentThrough: string | null, reason: string | null): void => {
    if (reason) {
      checked.push({
        template: SERVER_SETUP_CHECKED_WORDS.providerSaid,
        values: {
          sentThrough: sentThrough || "The provider",
          reason: reason,
        },
      });
    }
  };

  switch (check.id) {
    case ServerSetupCheckId.Email:
      if (check.status === ServerSetupStatus.Done && check.time) {
        checked.push({
          template: SERVER_SETUP_CHECKED_WORDS.emailAccepted,
          values: {
            sentThrough: check.sentThrough || "The mail server",
            time: time,
          },
        });
      } else if (check.status === ServerSetupStatus.Failing) {
        providerSaid(check.sentThrough, check.reason);
      } else if (check.status === ServerSetupStatus.NotSetUp && check.reason) {
        checked.push({ template: check.reason, values: {} });
      }

      if (check.status === ServerSetupStatus.NotSetUp) {
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.setUpEmail,
          route: route(PageMap.SETTINGS_SMTP),
        });
      } else if (!check.isFinished) {
        actions.push({
          kind: "test",
          title: "",
          channel: ServerSendingChannel.Email,
        });
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.openSettings,
          route: route(PageMap.SETTINGS_SMTP),
          isSecondary: true,
        });
      }
      break;

    case ServerSetupCheckId.Https: {
      const isOnlyBeforeOneUptime: boolean = isHttpsOnlyBeforeOneUptime(
        data.page.httpProtocol,
        data.page.pageProtocol,
      );
      const isThisVisitLeft: boolean =
        check.status === ServerSetupStatus.Done &&
        isOpenedOverHttpWhileSetToHttps(
          data.page.httpProtocol,
          data.page.pageProtocol,
        );

      if (isThisVisitLeft) {
        isFinished = false;
        status = {
          template: SERVER_SETUP_COPY.https.openedOverHttp,
          values: {},
        };
        actions.push({
          kind: "address",
          title: SERVER_SETUP_COPY.https.openOverHttps,
          url: data.page.httpsAddress,
        });
      } else if (!check.isFinished) {
        if (isOnlyBeforeOneUptime) {
          status = {
            template: SERVER_SETUP_COPY.https.onlyBeforeOneUptime,
            values: {},
          };
        }

        actions.push({
          kind: "guide",
          title: SERVER_SETUP_COPY.https.action,
          url: SERVER_SETUP_GUIDES.https,
        });
      }
      break;
    }

    case ServerSetupCheckId.Signups:
      if (check.status === ServerSetupStatus.NotSetUp) {
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.chooseWhoCanSignUp,
          route: route(PageMap.SETTINGS_AUTHENTICATION),
        });
      }
      break;

    case ServerSetupCheckId.SmsAndCalls:
      for (const channel of check.channels) {
        if (
          channel.state === ServerSendingState.Working &&
          channel.lastWorkedAt
        ) {
          checked.push({
            template:
              channel.channel === ServerSendingChannel.Call
                ? SERVER_SETUP_CHECKED_WORDS.callAccepted
                : SERVER_SETUP_CHECKED_WORDS.smsAccepted,
            values: {
              sentThrough: channel.sentThrough || "Twilio",
              time: data.formatTime(channel.lastWorkedAt),
            },
          });
        }
      }

      if (check.status === ServerSetupStatus.Failing) {
        providerSaid(check.sentThrough, check.reason);
      }

      if (check.status === ServerSetupStatus.NotSetUp) {
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.setUpSmsAndCalls,
          route: route(PageMap.SETTINGS_CALL_AND_SMS),
        });
      } else if (!check.isFinished) {
        for (const channel of check.tests) {
          actions.push({ kind: "test", title: "", channel: channel });
        }

        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.openSettings,
          route: route(PageMap.SETTINGS_CALL_AND_SMS),
          isSecondary: true,
        });
      }
      break;

    case ServerSetupCheckId.Probes:
      if (!check.isFinished) {
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.seeGlobalProbes,
          route: route(PageMap.SETTINGS_PROBES),
        });
      }
      break;

    case ServerSetupCheckId.Backups:
      if (check.status === ServerSetupStatus.Done && check.time) {
        checked.push({
          template: SERVER_SETUP_CHECKED_WORDS.lastBackup,
          values: { time: time },
        });
      } else if (check.status === ServerSetupStatus.Failing && check.reason) {
        checked.push({ template: check.reason, values: {} });
      }

      if (
        check.status === ServerSetupStatus.NotSetUp ||
        check.status === ServerSetupStatus.Failing
      ) {
        /*
         * Scheduled backups are the Enterprise Edition's page, linked only
         * when it is loaded: its address is Common's, never this page's own.
         */
        actions.push(
          check.hasScheduledBackups
            ? {
                kind: "route",
                title: SERVER_SETUP_COPY.actions.setUpBackups,
                route: new Route(
                  data.definition.adminPath || SERVER_SETUP_ADMIN_PATHS.backups,
                ),
              }
            : {
                kind: "guide",
                title: SERVER_SETUP_COPY.actions.howToBackUp,
                url: SERVER_SETUP_GUIDES.backups,
              },
        );
      }
      break;

    case ServerSetupCheckId.UpdateChecks:
      if (check.status === ServerSetupStatus.Done && check.time) {
        checked.push({
          template: SERVER_SETUP_CHECKED_WORDS.lastUpdateCheck,
          values: { time: time },
        });
      }

      if (!check.isFinished) {
        actions.push({
          kind: "guide",
          title: SERVER_SETUP_COPY.actions.readTheGuide,
          url: SERVER_SETUP_GUIDES.updateChecks,
        });
      }
      break;

    case ServerSetupCheckId.BrowserPush:
      if (!check.isFinished) {
        actions.push({
          kind: "guide",
          title: SERVER_SETUP_COPY.actions.readTheGuide,
          url: SERVER_SETUP_GUIDES.browserPush,
        });
      }
      break;

    case ServerSetupCheckId.AiProvider:
      if (!check.isFinished) {
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.addAiProvider,
          route: route(PageMap.SETTINGS_LLM_PROVIDERS),
        });
      }
      break;

    case ServerSetupCheckId.SingleSignOn:
      if (!check.isFinished) {
        actions.push({
          kind: "route",
          title: SERVER_SETUP_COPY.actions.setUpSingleSignOn,
          route: route(PageMap.SETTINGS_SSO),
        });
      }
      break;
  }

  // Who chose, and when; and the choice itself, or its undo.
  if (check.choice) {
    checked.push(
      check.choice.byName
        ? {
            template: SERVER_SETUP_CHECKED_WORDS.chosenBy,
            values: {
              name: check.choice.byName,
              time: data.formatTime(check.choice.at),
            },
          }
        : {
            template: SERVER_SETUP_CHECKED_WORDS.chosenOn,
            values: { time: data.formatTime(check.choice.at) },
          },
    );
    actions.push({
      kind: "undo",
      title: SERVER_SETUP_COPY.actions.undo,
      isSecondary: true,
    });
  } else if (check.canChoose && !check.isFinished) {
    actions.push({
      kind: "choose",
      title: getChoiceTitle(check.id),
      choice: check.canChoose,
      isSecondary: true,
    });
  }

  return {
    id: check.id,
    tier: check.tier,
    title: data.definition.title,
    isFinished: isFinished,
    isFailing: check.status === ServerSetupStatus.Failing,
    status: status,
    checked: checked,
    actions: actions,
  };
};

// A date as this page writes it, in the reader's language.
export const formatServerSetupTime: FormatTime = (
  iso: string | null,
): string => {
  if (!iso) {
    return "";
  }

  return OneUptimeDate.getDateAsLocalFormattedString(
    OneUptimeDate.fromString(iso),
  );
};

export interface ComponentProps {
  answer: ServerSetupChecklistAnswer;
  // A new answer from the server: after a choice, an undo or a test send.
  onAnswer: (answer: ServerSetupChecklistAnswer | null) => void;
  // For tests: the protocol this page came over (window.location.protocol).
  pageProtocol?: string | undefined;
}

const ServerSetupChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isShowingOptional, setIsShowingOptional] = useState<boolean>(false);
  const [busyCheck, setBusyCheck] = useState<ServerSetupCheckId | null>(null);
  const [error, setError] = useState<string>("");

  const rows: Array<ServerSetupRow> = getServerSetupRows({
    answer: props.answer,
    page: {
      httpProtocol: HTTP_PROTOCOL,
      pageProtocol: props.pageProtocol || window.location.protocol,
      httpsAddress: getHttpsAddress({ host: HOST, location: window.location }),
    },
    formatTime: formatServerSetupTime,
  });

  const words: (sentence: {
    template: string;
    values: Record<string, string>;
  }) => string = (sentence: {
    template: string;
    values: Record<string, string>;
  }): string => {
    return translator.translateTemplate(sentence.template, sentence.values);
  };

  const choose: (
    id: ServerSetupCheckId,
    kind: ServerSetupChoiceKind | null,
  ) => Promise<void> = async (
    id: ServerSetupCheckId,
    kind: ServerSetupChoiceKind | null,
  ): Promise<void> => {
    setBusyCheck(id);
    setError("");

    try {
      props.onAnswer(await ServerSetupChecklistLoader.choose(id, kind));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setBusyCheck(null);
    }
  };

  const onTested: (answer: ServerTestSendAnswer) => void = (): void => {
    // How the test went changes the row: read the checklist again.
    ServerSetupChecklistLoader.clear();
    ServerSetupChecklistLoader.load()
      .then((answer: ServerSetupChecklistAnswer | null): void => {
        if (answer) {
          props.onAnswer(answer);
        }
      })
      .catch((): void => {
        // load() never rejects.
      });
  };

  const drawAction: (
    row: ServerSetupRow,
    action: ServerSetupAction,
    index: number,
  ) => ReactElement = (
    row: ServerSetupRow,
    action: ServerSetupAction,
    index: number,
  ): ReactElement => {
    const key: string = `${row.id}-${action.kind}-${index}`;
    const testId: string = `server-setup-${row.id}-${action.kind}`;
    const buttonClassName: string =
      "inline-flex flex-none items-center rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50";
    const linkClassName: string =
      "inline-flex flex-none items-center text-sm font-medium text-gray-600 underline decoration-gray-300 underline-offset-2 hover:text-gray-900";

    switch (action.kind) {
      case "test":
        return (
          <ServerTestSendButton
            key={key}
            channel={action.channel!}
            onAnswer={onTested}
            dataTestId={`server-setup-${row.id}-test-${action.channel}`}
          />
        );
      case "choose":
      case "undo":
        return (
          <Button
            key={key}
            title={action.title}
            buttonStyle={ButtonStyleType.LINK}
            isLoading={busyCheck === row.id}
            disabled={busyCheck !== null}
            onClick={() => {
              void choose(
                row.id,
                action.kind === "undo" ? null : action.choice || null,
              );
            }}
            dataTestId={testId}
          />
        );
      default: {
        const isGuide: boolean = action.kind === "guide";

        return (
          <Link
            key={key}
            to={
              action.route ||
              (action.kind === "address"
                ? URL.fromString(action.url!)
                : URL.fromString(`${window.location.origin}${action.url!}`))
            }
            openInNewTab={isGuide}
            dataTestId={testId}
            className={action.isSecondary ? linkClassName : buttonClassName}
          >
            {translator.translateText(action.title)}
            {/* A guide opens in a tab of its own, and says so. */}
            {isGuide ? (
              <>
                <Icon
                  icon={IconProp.ExternalLink}
                  className="ms-1.5 h-3.5 w-3.5 text-gray-400"
                  data-testid={`${testId}-new-tab`}
                />
                <span className="sr-only">
                  {` (${translator.translateText(
                    SERVER_SETUP_COPY.opensInNewTab,
                  )})`}
                </span>
              </>
            ) : (
              <></>
            )}
          </Link>
        );
      }
    }
  };

  const drawRow: (row: ServerSetupRow) => ReactElement = (
    row: ServerSetupRow,
  ): ReactElement => {
    const isOptionalOpen: boolean =
      row.tier === ServerSetupCheckTier.Optional && !row.isFinished;

    return (
      <li
        key={row.id}
        data-testid={`server-setup-${row.id}`}
        data-done={row.isFinished ? "true" : "false"}
        className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${
              row.isFinished
                ? "bg-green-50 text-green-600"
                : row.isFailing
                  ? "bg-red-50 text-red-600"
                  : isOptionalOpen
                    ? "bg-gray-50 text-gray-400"
                    : "bg-amber-50 text-amber-600"
            }`}
          >
            <Icon
              icon={
                row.isFinished
                  ? IconProp.CheckCircle
                  : row.isFailing
                    ? IconProp.XCircle
                    : isOptionalOpen
                      ? IconProp.MinusCircle
                      : IconProp.ExclaimationCircle
              }
              className="h-4 w-4"
            />
            <span className="sr-only">
              {translator.translateText(
                row.isFinished
                  ? SERVER_SETUP_COPY.doneLabel
                  : row.isFailing
                    ? SERVER_SETUP_COPY.failingLabel
                    : SERVER_SETUP_COPY.openLabel,
              )}
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {translator.translateText(row.title)}
            </p>
            <p
              className="mt-0.5 text-sm text-gray-500 text-pretty"
              data-testid={`server-setup-${row.id}-status`}
            >
              {words(row.status)}
            </p>
            {row.checked.map(
              (
                sentence: { template: string; values: Record<string, string> },
                index: number,
              ): ReactElement => {
                return (
                  <p
                    key={index}
                    className="mt-1 break-words text-xs text-gray-400"
                    data-testid={`server-setup-${row.id}-checked`}
                  >
                    {words(sentence)}
                  </p>
                );
              },
            )}
          </div>
        </div>
        {row.actions.length > 0 ? (
          <div className="ms-9 flex flex-wrap items-center gap-x-3 gap-y-2 sm:ms-0 sm:justify-end">
            {row.actions.map(
              (action: ServerSetupAction, index: number): ReactElement => {
                return drawAction(row, action, index);
              },
            )}
          </div>
        ) : (
          <></>
        )}
      </li>
    );
  };

  const drawSection: (
    tier: ServerSetupCheckTier,
    title: string,
  ) => ReactElement = (
    tier: ServerSetupCheckTier,
    title: string,
  ): ReactElement => {
    const sectionRows: Array<ServerSetupRow> = rows.filter(
      (row: ServerSetupRow): boolean => {
        return row.tier === tier;
      },
    );

    if (sectionRows.length === 0) {
      return <></>;
    }

    const done: number = sectionRows.filter((row: ServerSetupRow): boolean => {
      return row.isFinished;
    }).length;
    const isFolded: boolean =
      tier === ServerSetupCheckTier.Optional && !isShowingOptional;

    const heading: ReactElement = (
      <>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {translator.translateText(title)}
        </span>
        <span
          className="text-xs text-gray-400"
          data-testid={`server-setup-${tier}-progress`}
        >
          {translator.translateTemplate(SERVER_SETUP_COPY.progress, {
            done: done,
            total: sectionRows.length,
          })}
        </span>
      </>
    );

    return (
      <section
        key={tier}
        data-testid={`server-setup-${tier}`}
        className="border-t border-gray-100 pt-4 first:border-t-0 first:pt-0"
      >
        {tier === ServerSetupCheckTier.Optional ? (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-start"
            aria-expanded={!isFolded}
            onClick={() => {
              setIsShowingOptional(!isShowingOptional);
            }}
            data-testid="server-setup-optional-toggle"
          >
            <span className="flex items-center gap-2">
              <Icon
                icon={isFolded ? IconProp.ChevronRight : IconProp.ChevronDown}
                className="h-3.5 w-3.5 text-gray-400"
              />
              {heading}
            </span>
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3">
            {heading}
          </div>
        )}
        {isFolded ? (
          <></>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sectionRows.map(drawRow)}
          </ul>
        )}
      </section>
    );
  };

  const isAllDone: boolean = rows
    .filter((row: ServerSetupRow): boolean => {
      return row.tier !== ServerSetupCheckTier.Optional;
    })
    .every((row: ServerSetupRow): boolean => {
      return row.isFinished;
    });

  return (
    <div data-testid="server-setup-checklist">
      <Card
        title={SERVER_SETUP_COPY.title}
        description={SERVER_SETUP_COPY.description}
      >
        <div className="space-y-4">
          {isAllDone ? (
            <Alert
              type={AlertType.SUCCESS}
              title={
                translator.translateText(SERVER_SETUP_COPY.allDone) ||
                SERVER_SETUP_COPY.allDone
              }
              dataTestId="server-setup-all-done"
            />
          ) : (
            <></>
          )}
          {error ? (
            <Alert
              type={AlertType.DANGER}
              title={error}
              dataTestId="server-setup-error"
            />
          ) : (
            <></>
          )}
          {drawSection(
            ServerSetupCheckTier.Required,
            SERVER_SETUP_COPY.required,
          )}
          {drawSection(
            ServerSetupCheckTier.Recommended,
            SERVER_SETUP_COPY.recommended,
          )}
          {drawSection(
            ServerSetupCheckTier.Optional,
            SERVER_SETUP_COPY.optional,
          )}
        </div>
      </Card>
    </div>
  );
};

export default ServerSetupChecklist;
