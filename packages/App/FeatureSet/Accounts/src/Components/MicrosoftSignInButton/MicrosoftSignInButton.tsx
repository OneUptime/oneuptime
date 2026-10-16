import React, { FunctionComponent, ReactElement } from "react";

/*
 * Sign in with Microsoft, as Microsoft's branding asks for it: the four-square
 * logo and the words, on a plain bordered button. A link, not a request: the
 * server sends the browser on to Microsoft (Identity/API/MicrosoftSignIn), and
 * the sign-in ends on the dashboard like every other.
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
      className="mt-4 flex w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 21 21"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
      <span>{props.title}</span>
    </a>
  );
};

export default MicrosoftSignInButton;
