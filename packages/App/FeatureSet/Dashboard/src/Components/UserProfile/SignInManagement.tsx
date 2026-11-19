import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import SignInManagementUtil, {
  SIGN_IN_MANAGEMENT_API_ROUTE,
  SignInManagement,
} from "Common/Types/SSO/SsoManagedSignIn";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatNameList } from "../AiAccess/AiAccessModes";
import React, {
  createContext,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

/*
 * WHO MANAGES HOW YOU SIGN IN, AS USER PROFILE READS IT (issue #9688).
 *
 * While the server requires single sign-on, everyone but a master admin
 * signs in with SSO alone, and sets no password, passkey or two-factor
 * authentication in OneUptime (Common/Types/SSO/SsoManagedSignIn - the
 * server refuses each of them). For them, User Profile has no Security
 * section, and its Overview, and any Security page they still reach (a
 * bookmark, Search), says who manages their sign-in instead of offering
 * settings that would do nothing.
 *
 * The layout asks the server once (GET /user/sign-in-management) and hands
 * the answer to its side menu and its pages (SignInManagementContext). While
 * it is on its way the Security pages draw their skeleton and the menu holds
 * the Security section back, so nobody is shown a setting they cannot use.
 * An answer that does not come - a failed request, a server too old to know
 * the route - shows the settings, as for everybody the rule does not cover:
 * the server refuses what it must either way, with why.
 */

// The answer, or null while it is on its way.
export type SignInManagementState = SignInManagement | null;

// Everybody the rule does not cover, and what an answer that does not come reads as.
export const LOCAL_SIGN_IN: SignInManagement = {
  isManagedBySso: false,
  ssoProviderNames: [],
};

export const SignInManagementContext: React.Context<
  SignInManagementState | undefined
> = createContext<SignInManagementState | undefined>(undefined);

/*
 * The signed-in person's answer, or LOCAL_SIGN_IN when it cannot be had.
 * Never throws.
 */
export const fetchSignInManagement: (
  signal?: AbortSignal | undefined,
) => Promise<SignInManagement> = async (
  signal?: AbortSignal | undefined,
): Promise<SignInManagement> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          SIGN_IN_MANAGEMENT_API_ROUTE,
        ),
        ...(signal ? { options: { signal: signal } } : {}),
      });

    if (response instanceof HTTPErrorResponse) {
      return LOCAL_SIGN_IN;
    }

    return SignInManagementUtil.parse(response.data) || LOCAL_SIGN_IN;
  } catch {
    return LOCAL_SIGN_IN;
  }
};

// For the layout: asks once, and keeps the answer while it is mounted.
export const useLoadSignInManagement: () => SignInManagementState =
  (): SignInManagementState => {
    const [state, setState] = useState<SignInManagementState>(null);

    useEffect(() => {
      const controller: AbortController = new AbortController();

      void fetchSignInManagement(controller.signal).then(
        (answer: SignInManagement): void => {
          if (!controller.signal.aborted) {
            setState(answer);
          }
        },
      );

      return () => {
        controller.abort();
      };
    }, []);

    return state;
  };

/*
 * For the side menu and the pages: the layout's answer. A page drawn without
 * the layout around it shows its settings, as for everybody the rule does
 * not cover.
 */
export const useSignInManagement: () => SignInManagementState =
  (): SignInManagementState => {
    const fromLayout: SignInManagementState | undefined = useContext(
      SignInManagementContext,
    );

    return fromLayout === undefined ? LOCAL_SIGN_IN : fromLayout;
  };

export const SSO_MANAGED_SIGN_IN_COPY: {
  title: string;
  description: string;
  sentence: string;
  unnamedProvider: string;
} = {
  // The card's title, as the project's and the server's SSO settings name it.
  title: translationKey("Single Sign-On"),
  description: translationKey(
    "Your organization manages how you sign in to OneUptime.",
  ),
  sentence: translationKey(
    "You sign in with {{providers}}. Your password, passkeys and two-factor authentication are managed there, not in OneUptime.",
  ),
  // Said in the providers' place when the server names none.
  unnamedProvider: translationKey("single sign-on (SSO)"),
};

export interface SsoManagedSignInNoticeProps {
  ssoProviderNames: Array<string>;
}

/*
 * What User Profile says to somebody whose sign-in their organization
 * manages, in place of the Security settings: who manages it, and with
 * which providers - the server's own that are on, the buttons its sign-in
 * page draws - or "single sign-on" when it names none.
 */
export const SsoManagedSignInNotice: FunctionComponent<
  SsoManagedSignInNoticeProps
> = (props: SsoManagedSignInNoticeProps): ReactElement => {
  const translator: Translator = useTranslator();

  const providers: ReactNode =
    props.ssoProviderNames.length > 0 ? (
      <IsolatedText
        text={formatNameList(props.ssoProviderNames, "or", translator)}
      />
    ) : (
      translator.translateText(SSO_MANAGED_SIGN_IN_COPY.unnamedProvider)
    );

  return (
    <Card
      title={SSO_MANAGED_SIGN_IN_COPY.title}
      description={SSO_MANAGED_SIGN_IN_COPY.description}
    >
      <div
        className="flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3"
        data-testid="sso-managed-sign-in"
      >
        <Icon
          icon={IconProp.ShieldCheck}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <p className="text-sm leading-6 text-gray-600">
          <TranslatedSentence
            template={SSO_MANAGED_SIGN_IN_COPY.sentence}
            slots={{ providers: providers }}
          />
        </p>
      </div>
    </Card>
  );
};

export interface LocalSignInSettingsProps {
  children: ReactNode;
}

/*
 * A Security page's settings, for somebody who manages their own sign-in:
 * the page's skeleton while the answer is on its way, who manages it for
 * somebody whose organization does, and the settings otherwise.
 */
export const LocalSignInSettings: FunctionComponent<
  LocalSignInSettingsProps
> = (props: LocalSignInSettingsProps): ReactElement => {
  const state: SignInManagementState = useSignInManagement();

  if (state === null) {
    return (
      <Card>
        <DetailListSkeleton fields={2} columns={1} />
      </Card>
    );
  }

  if (state.isManagedBySso) {
    return <SsoManagedSignInNotice ssoProviderNames={state.ssoProviderNames} />;
  }

  return <>{props.children}</>;
};
