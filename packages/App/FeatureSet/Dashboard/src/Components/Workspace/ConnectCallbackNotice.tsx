import {
  ConnectCallbackNoticeText,
  getConnectCallbackNotice,
} from "../../Utils/Workspace/ConnectCallbackMessage";
import {
  CONNECT_ERROR_QUERY_PARAM,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
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
 * The answer a Slack, Microsoft Teams or GitHub connection came back to its
 * page with, when it was not made (Utils/Workspace/ConnectCallbackMessage
 * says what each code reads as).
 *
 * The page reads `?error=` once, when it opens, and takes it off the address
 * at once, so a reload or a shared link does not say it again. Everything
 * else on the page loads as usual - the Connect button the person needs to
 * try again stays right below the notice - and the notice stays until it is
 * closed or the page is left.
 */

export interface ConnectCallbackNoticeState {
  // What to show, in the reader's language, or null for nothing.
  notice: ConnectCallbackNoticeText | null;
  dismiss: () => void;
}

export const useConnectCallbackNotice: (data: {
  provider: ConnectProvider;
  // The page's own sentence for a plan refusal, naming the plan, if it has one.
  planRequiredMessage?: string | undefined;
}) => ConnectCallbackNoticeState = (data: {
  provider: ConnectProvider;
  planRequiredMessage?: string | undefined;
}): ConnectCallbackNoticeState => {
  const translator: Translator = useTranslator();

  // Read once, when the page opens: the address is cleared right after.
  const [error, setError] = useState<string | null>(() => {
    return Navigation.getQueryStringByName(CONNECT_ERROR_QUERY_PARAM);
  });

  useEffect(() => {
    if (error) {
      Navigation.setQueryString({ [CONNECT_ERROR_QUERY_PARAM]: null });
    }
  }, []);

  return {
    notice: getConnectCallbackNotice({
      provider: data.provider,
      error: error,
      translator: translator,
      planRequiredMessage: data.planRequiredMessage,
    }),
    dismiss: (): void => {
      setError(null);
    },
  };
};

export interface ComponentProps {
  state: ConnectCallbackNoticeState;
}

const ConnectCallbackNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const notice: ConnectCallbackNoticeText | null = props.state.notice;

  if (!notice) {
    return <></>;
  }

  return (
    <div className="mb-5">
      <Alert
        type={AlertType.DANGER}
        strongTitle={notice.title}
        title={notice.message}
        onClose={props.state.dismiss}
        dataTestId="connect-callback-notice"
      />
    </div>
  );
};

export default ConnectCallbackNotice;
