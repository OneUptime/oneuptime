import { rememberAttributionForSignIn } from "../../Utils/SignInAttribution";
import SignInOptionLabel from "Common/UI/Components/SignInOption/SignInOptionLabel";
import {
  SIGN_IN_OPTION_GOOGLE_CLASS,
  SIGN_IN_OPTION_GOOGLE_ICON_SLOT_CLASS,
  SIGN_IN_OPTION_ICON_CLASS,
} from "Common/UI/Components/SignInOption/SignInOptionStyle";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Continue with Google, as Google's sign-in branding asks for it: Google's
 * standard full-colour "G", unchanged, 10px before words Google approves
 * ("Continue with Google", in the page's language), on a button in Google's
 * colours for the page's theme, as large as every other way in on the page so
 * it is at least as prominent as they are (SIGN_IN_OPTION_GOOGLE_CLASS).
 * https://developers.google.com/identity/branding-guidelines
 *
 * A link, not a request: the server sends the browser on to Google
 * (Identity/API/GoogleSignIn), and the sign-in ends on the dashboard like
 * every other. The page around it gives it its place and its spacing.
 */

export const GOOGLE_SIGN_IN_ROUTE: string = "/identity/google/sign-in";

export interface ComponentProps {
  title: string;
  // Told as the button is pressed, before the browser leaves the page.
  onPress?: (() => void) | undefined;
}

const GoogleSignInButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <a
      href={GOOGLE_SIGN_IN_ROUTE}
      data-testid="google-sign-in"
      className={SIGN_IN_OPTION_GOOGLE_CLASS}
      onClick={() => {
        // A new account is made on the way back, where localStorage is out of reach.
        rememberAttributionForSignIn();
        props.onPress?.();
      }}
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
            viewBox="0 0 48 48"
            xmlns="http://www.w3.org/2000/svg"
            className={SIGN_IN_OPTION_ICON_CLASS}
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        }
        iconSlotClassName={SIGN_IN_OPTION_GOOGLE_ICON_SLOT_CLASS}
        title={props.title}
      />
    </a>
  );
};

export default GoogleSignInButton;
