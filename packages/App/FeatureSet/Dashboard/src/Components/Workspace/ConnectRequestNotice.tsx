import {
  BACK_TO_SLACK,
  ConnectRequestNoticeText,
  getConnectLinkGoneNotice,
  getConnectRequestNotice,
} from "../../Utils/Workspace/ConnectRequestMessage";
import URL from "Common/Types/API/URL";
import ConnectCallbackUtil, {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_REQUEST_OUTCOME_QUERY_PARAM,
  CONNECT_REQUEST_QUERY_PARAM,
  CONNECT_REQUEST_SLACK_CHANNEL_QUERY_PARAM,
  CONNECT_REQUEST_SLACK_TEAM_QUERY_PARAM,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
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
 * integration components start the sign-in with it). The sign-in comes back
 * to the page with `?pressed=` - what became of the press - which this
 * shows, with a link back to the Slack channel the press was in. Every value
 * is read once and taken off the address, so a reload or a shared link does
 * not say it again.
 *
 * The Connect Slack account link in a Slack channel's note (the people
 * OneUptime could not add to it) opens the Slack page with
 * `?connectAccount=true` instead: there is no press to finish, so the page
 * only connects the account of whoever opened it, when it is not connected
 * yet.
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
  // The `?connect=` could not be used: its press is spent or expired.
  linkGone: ConnectRequestNoticeText | null;
  // The token was handed to the sign-in: it is not used again.
  takeToken: () => void;
  // The page acted on `?connectAccount=`: it does not act on it again.
  takeConnectAccount: () => void;
  // The sign-in refused the token: say so.
  markLinkGone: () => void;
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
      ? getConnectLinkGoneNotice({
          provider: data.provider,
          translator: translator,
        })
      : null,
    takeToken: (): void => {
      setConnectToken(null);
    },
    takeConnectAccount: (): void => {
      setConnectAccount(false);
    },
    markLinkGone: (): void => {
      setConnectToken(null);
      setIsLinkGone(true);
    },
    dismiss: (): void => {
      setPressed(null);
      setIsLinkGone(false);
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
  const { notice, linkGone, backLink } = props.state;

  if (notice) {
    return (
      <div className="mb-5">
        <Alert
          type={AlertType.SUCCESS}
          strongTitle={notice.title}
          title={
            <span>
              {notice.message}
              {backLink && (
                <>
                  {" "}
                  <Link
                    to={URL.fromString(backLink)}
                    className="font-semibold underline"
                  >
                    {translator.translateText(BACK_TO_SLACK)}
                  </Link>
                </>
              )}
            </span>
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
          type={AlertType.WARNING}
          strongTitle={linkGone.title}
          title={linkGone.message}
          onClose={props.state.dismiss}
          dataTestId="connect-request-link-gone"
        />
      </div>
    );
  }

  return <></>;
};

export default ConnectRequestNotice;
