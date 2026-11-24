import InvitedSignUpHeader from "../InvitedSignUpHeader/InvitedSignUpHeader";
import { confirmSignUpInvitationSsoSignIn } from "../../Utils/SignUpInvitation";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { SignUpInvitation } from "Common/Types/Accounts/SignUpInvitation";
import SignInMethodsUtil, {
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import SsoProviderOptions, {
  SsoProviderOption,
} from "Common/UI/Components/SignInOption/SsoProviderOptions";
import { IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * THE PAGE AN INVITATION OPENS WHEN SINGLE SIGN-ON IS HOW ITS PERSON SIGNS
 * IN (#9819).
 *
 * When every project the person would be in manages sign-in with SSO, a
 * password is nothing they can set (claiming the account with one is
 * refused: SsoManagedSignIn), so the sign-up page their invitation opens
 * would only have them type one and be turned away. It offers the project's
 * providers instead (Common/Types/Accounts/SignUpInvitation: ssoSignIn),
 * under the same header that names the project and who invited them, and
 * says why there is no password. Picking one starts its sign-in; signing in
 * through the project's own SSO joins the project (ProjectSsoSignInGate).
 *
 * With no provider turned on yet, the page says so and whom to ask, rather
 * than offer a way in that cannot work.
 *
 * On OneUptime Cloud a project's provider signs someone in only once they
 * have confirmed it from their mailbox, which took a second email and a
 * second trip through the provider. The link this page was opened with
 * proves the mailbox already, so picking a provider first tells the server
 * so, with the link's address and token (#9898,
 * confirmSignUpInvitationSsoSignIn), and only then starts its sign-in:
 * the provider signs them in the first time. Whatever the server says, or
 * if it says nothing in time, the sign-in starts all the same.
 */

export interface ComponentProps {
  invitation: SignUpInvitation;
  // The link the page was opened with: the invited address and its token.
  link?: { email: string; token: string } | null | undefined;
}

export const INVITED_SSO_PROVIDERS_TEST_ID: string = "register-sso-providers";
export const INVITED_SSO_NO_PROVIDER_TEST_ID: string =
  "register-sso-no-provider";

const InvitedSsoSignIn: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  // A provider was picked: the browser is on its way to its sign-in.
  const [isLeaving, setIsLeaving] = useState<boolean>(false);

  if (isLeaving) {
    return <AuthPageSkeleton fields={1} />;
  }

  const providers: Array<SsoSignInProvider> =
    props.invitation.ssoSignIn?.providers || [];

  // The link said first, then the provider's sign-in, whatever came of it.
  const signInWith: (route: string) => Promise<void> = async (
    route: string,
  ): Promise<void> => {
    setIsLeaving(true);

    if (props.link) {
      await confirmSignUpInvitationSsoSignIn({
        email: props.link.email,
        token: props.link.token,
        projectId: props.invitation.projectId,
      });
    }

    Navigation.navigate(URL.fromURL(IDENTITY_URL).addRoute(new Route(route)));
  };

  /*
   * "Sign in with Okta", in the reader's language, unless the admin wrote a
   * description of their own: then the provider's name, and the
   * description under it - as the other sign-in pages draw a provider.
   */
  const options: Array<SsoProviderOption> = providers.map(
    (provider: SsoSignInProvider): SsoProviderOption => {
      const hasOwnDescription: boolean =
        SignInMethodsUtil.hasOwnDescription(provider);

      return {
        key: `${provider.type}:${provider.id}`,
        title: hasOwnDescription
          ? provider.name
          : t("sso.signInWithProvider", { name: provider.name }),
        description: hasOwnDescription ? provider.description : undefined,
        dataTestId: "register-sso-provider",
        onClick: (): void => {
          const route: string | null = SignInMethodsUtil.getSignInRoute({
            provider: provider,
            projectId: props.invitation.projectId,
          });

          if (!route) {
            return;
          }

          void signInWith(route);
        },
      };
    },
  );

  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <ProductLogo />
        <InvitedSignUpHeader invitation={props.invitation} />
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
          {options.length > 0 ? (
            <SsoProviderOptions
              options={options}
              // One provider is the page's filled button, as on Sign in with SSO.
              isOnlyWayIn={options.length === 1}
              dataTestId={INVITED_SSO_PROVIDERS_TEST_ID}
            />
          ) : (
            <p
              className="text-center text-sm text-gray-600 text-balance"
              data-testid={INVITED_SSO_NO_PROVIDER_TEST_ID}
            >
              {t("register.ssoNoProvider")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default InvitedSsoSignIn;
