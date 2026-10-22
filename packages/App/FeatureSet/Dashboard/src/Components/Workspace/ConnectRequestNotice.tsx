import {
  BACK_TO_SLACK,
  ConnectRequestNoticeText,
  getConnectLinkGoneNotice,
  getConnectRequestNotice,
  getConnectingNotice,
} from "../../Utils/Workspace/ConnectRequestMessage";
import { getNotConnectedTitle } from "../../Utils/Workspace/ConnectCallbackMessage";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ConnectCallbackUtil, {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_REQUEST_OUTCOME_QUERY_PARAM,
  CONNECT_REQUEST_QUERY_PARAM,
  CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM,
  CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A CONNECTION STARTED FROM A CONNECT BUTTON IN SLACK OR MICROSOFT TEAMS.
 *
 * The Connect button OneUptime answers an unconnected press with opens the
 * person's own settings page for that workspace with `?connect=` and a token
 * for the press. The page reads it once, takes it off the address, and
 * connects the account straight away (the Slack and Microsoft Teams
 * integration components start the sign-in with it), saying meanwhile that it
 * is connecting (ConnectRequestConnecting). The sign-in comes back to the
 * page with `?pressed=` - what became of the press - which this shows, with a
 * link back to the Slack channel the press was in. Every value is read once
 * and taken off the address, so a reload or a shared link does not say it
 * again.
 *
 * The Connect Slack account link in a Slack channel's note (the people
 * OneUptime could not add to it), and the Connect button of the message an
 * admin has OneUptime send every member in Slack or Microsoft Teams
 * (WorkspaceAskToConnect), open the page with `?connectAccount=true`
 * instead: there is no press to finish, so the page only connects the
 * account of whoever opened it, when it is not connected yet.
 *
 * A sign-in that cannot start is said above the page, which loads as usual
 * with its own Connect button right below to try again - never a page that is
 * only the error.
 */

export interface ConnectRequestState {
  // The token of the `?connect=` the page was opened with, until it is used.
  connectToken: string | null;
  /*
   * Opened from a note's Connect Slack account link (`?connectAccount=`),
   * until the page has acted on it.
   */
  connectAccount: boolean;
  // What the page says once the account is connected from the chat.
  notice: ConnectRequestNoticeText | null;
  // The Slack channel the press was in, to go back to.
  backLink: string | null;
  /*
   * The `?connect=` could not be used: its press is spent or expired - for
   * somebody connected already, nothing to worry about.
   */
  linkGone: (ConnectRequestNoticeText & { isUserConnected: boolean }) | null;
  // Why the sign-in the page started on its own could not start.
  startError: ConnectRequestNoticeText | null;
  // The token was handed to the sign-in: it is not used again.
  takeToken: () => void;
  // The page acted on `?connectAccount=`: it does not act on it again.
  takeConnectAccount: () => void;
  /*
   * The sign-in refused the token: say so - and, for somebody connected
   * already, that there is nothing to connect.
   */
  markLinkGone: (isUserConnected?: boolean) => void;
  // The sign-in could not start, for `message`: say so above the page.
  markStartFailed: (message: string) => void;
  dismiss: () => void;
}

export const useConnectRequest: (data: {
  provider: ConnectProvider;
}) => ConnectRequestState = (data: {
  provider: ConnectProvider;
}): ConnectRequestState => {
  const translator: Translator = useTranslator();

  // Read once, when the page opens: the address is cleared right after.
  const [connectToken, setConnectToken] = useState<string | null>(() => {
    return ConnectCallbackUtil.readConnectRequestToken(
      Navigation.getQueryStringByName(CONNECT_REQUEST_QUERY_PARAM),
    );
  });

  const [connectAccount, setConnectAccount] = useState<boolean>(() => {
    return ConnectCallbackUtil.readConnectAccount(
      Navigation.getQueryStringByName(CONNECT_ACCOUNT_QUERY_PARAM),
    );
  });

  const [pressed, setPressed] = useState<string | null>(() => {
    return Navigation.getQueryStringByName(CONNECT_REQUEST_OUTCOME_QUERY_PARAM);
  });

  const [backLink] = useState<string | null>(() => {
    return data.provider === ConnectProvider.Slack
      ? ConnectCallbackUtil.getSlackChannelLink({
          channel: Navigation.getQueryStringByName(
            CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM,
          ),
          team: Navigation.getQueryStringByName(
            CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM,
          ),
        })
      : null;
  });

  const [isLinkGone, setIsLinkGone] = useState<boolean>(false);

  const [isLinkGoneForConnectedUser, setIsLinkGoneForConnectedUser] =
    useState<boolean>(false);

  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const params: Array<string> = [
      CONNECT_REQUEST_QUERY_PARAM,
      CONNECT_ACCOUNT_QUERY_PARAM,
      CONNECT_REQUEST_OUTCOME_QUERY_PARAM,
      CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM,
      CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM,
    ];

    const present: Array<string> = params.filter((param: string): boolean => {
      return Navigation.getQueryStringByName(param) !== null;
    });

    if (present.length > 0) {
      const cleared: { [key: string]: null } = {};

      for (const param of present) {
        cleared[param] = null;
      }

      Navigation.setQueryString(cleared);
    }
  }, []);

  return {
    connectToken: connectToken,
    connectAccount: connectAccount,
    notice: getConnectRequestNotice({
      provider: data.provider,
      pressed: pressed,
      translator: translator,
    }),
    backLink: backLink,
    linkGone: isLinkGone
      ? {
          ...getConnectLinkGoneNotice({
            provider: data.provider,
            translator: translator,
            isUserConnected: isLinkGoneForConnectedUser,
          }),
          isUserConnected: isLinkGoneForConnectedUser,
        }
      : null,
    startError: startErrorMessage
      ? {
          title: getNotConnectedTitle({
            provider: data.provider,
            translator: translator,
          }),
          message: startErrorMessage,
        }
      : null,
    takeToken: (): void => {
      setConnectToken(null);
    },
    takeConnectAccount: (): void => {
      setConnectAccount(false);
    },
    markLinkGone: (isUserConnected?: boolean): void => {
      setConnectToken(null);
      setIsLinkGoneForConnectedUser(Boolean(isUserConnected));
      setIsLinkGone(true);
    },
    markStartFailed: (message: string): void => {
      setStartErrorMessage(message);
    },
    dismiss: (): void => {
      setPressed(null);
      setIsLinkGone(false);
      setStartErrorMessage(null);
    },
  };
};

export interface ComponentProps {
  state: ConnectRequestState;
}

const ConnectRequestNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { notice, linkGone, startError, backLink } = props.state;

  if (notice) {
    return (
      <div className="mb-5">
        <Alert
          type={AlertType.SUCCESS}
          strongTitle={notice.title}
          title={
            <div>
              <p>{notice.message}</p>
              {/*
               * The way back, as its own line under what happened: the one
               * thing left to do, not a word at the end of a sentence.
               */}
              {backLink && (
                <div className="mt-2">
                  <Link
                    to={URL.fromString(backLink)}
                    className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-2"
                  >
                    <Icon icon={IconProp.Slack} className="h-4 w-4" />
                    {translator.translateText(BACK_TO_SLACK)}
                  </Link>
                </div>
              )}
            </div>
          }
          onClose={props.state.dismiss}
          dataTestId="connect-request-notice"
        />
      </div>
    );
  }

  if (linkGone) {
    return (
      <div className="mb-5">
        <Alert
          // Connected already: news, not a warning.
          type={linkGone.isUserConnected ? AlertType.INFO : AlertType.WARNING}
          strongTitle={linkGone.title}
          title={linkGone.message}
          onClose={props.state.dismiss}
          dataTestId="connect-request-link-gone"
        />
      </div>
    );
  }

  if (startError) {
    return (
      <div className="mb-5">
        <Alert
          type={AlertType.DANGER}
          strongTitle={startError.title}
          title={startError.message}
          onClose={props.state.dismiss}
          dataTestId="connect-request-start-error"
        />
      </div>
    );
  }

  return <></>;
};

export interface ConnectingComponentProps {
  provider: ConnectProvider;
}

/*
 * What the page shows while it takes the browser to Slack or Microsoft to
 * sign in, which can take a few seconds on a phone: what is happening, in a
 * card the size of what it says, on every width (a card's description is
 * hidden on a phone, so this says it in its own body). It is a status, read
 * out once by a screen reader.
 */
export const ConnectRequestConnecting: FunctionComponent<
  ConnectingComponentProps
> = (props: ConnectingComponentProps): ReactElement => {
  const translator: Translator = useTranslator();

  const connecting: ConnectRequestNoticeText = getConnectingNotice({
    provider: props.provider,
    translator: translator,
  });

  return (
    <div data-testid="connect-request-connecting">
      <Card bodyClassName="mt-0">
        <div role="status" className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"
            aria-hidden="true"
          >
            <Icon
              icon={IconProp.Spinner}
              className="h-5 w-5 motion-safe:animate-spin"
            />
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-lg font-semibold leading-6 text-gray-900 text-balance break-words">
              {connecting.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              {connecting.message}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ConnectRequestNotice;
