import SignInOptionLabel from "Common/UI/Components/SignInOption/SignInOptionLabel";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_ICON_CLASS,
} from "Common/UI/Components/SignInOption/SignInOptionStyle";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Sign in with Microsoft, as Microsoft's branding asks for it: the four-square
 * logo and the words, on a plain bordered button - the look every other way
 * in on the sign-in pages has (SignInOptionStyle), so it sits in their list
 * as one of them. A link, not a request: the server sends the browser on to
 * Microsoft (Identity/API/MicrosoftSignIn), and the sign-in ends on the
 * dashboard like every other. The page around it gives it its place and its
 * spacing.
 */

export const MICROSOFT_SIGN_IN_ROUTE: string = "/identity/microsoft/sign-in";

export interface ComponentProps {
  title: string;
}

const MicrosoftSignInButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <a
      href={MICROSOFT_SIGN_IN_ROUTE}
      data-testid="microsoft-sign-in"
      className={getSignInOptionClassName("ready")}
    >
      {/*
       * The logo in the box every option's icon has (20px), so it sits on
       * the words exactly as the shield and the fingerprint do.
       */}
      <SignInOptionLabel
        icon={
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 21 21"
            xmlns="http://www.w3.org/2000/svg"
            className={SIGN_IN_OPTION_ICON_CLASS}
          >
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
        }
        title={props.title}
      />
    </a>
  );
};

export default MicrosoftSignInButton;
