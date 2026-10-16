import { getSignInOptionClassName } from "Common/UI/Components/SignInOption/SignInOptionStyle";
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
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 21 21"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
      {/* Laid out by its own first letter, like every option's label. */}
      <span dir="auto">{props.title}</span>
    </a>
  );
};

export default MicrosoftSignInButton;
