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
       * The "G" exactly as Google's own sample buttons draw it, on every
       * theme's fill (developers.google.com/identity/branding-guidelines),
       * in the box every option's icon has (20px), so it sits on the words
       * exactly as the shield and the fingerprint do.
       */}
      <SignInOptionLabel
        icon={
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="10 10 20 20"
            xmlns="http://www.w3.org/2000/svg"
            className={SIGN_IN_OPTION_ICON_CLASS}
          >
            <path
              fill="#4285F4"
              d="M29.6 20.2273C29.6 19.5182 29.5364 18.8364 29.4182 18.1818H20V22.05H25.3818C25.15 23.3 24.4455 24.3591 23.3864 25.0682V27.5773H26.6182C28.5091 25.8364 29.6 23.2727 29.6 20.2273Z"
            />
            <path
              fill="#34A853"
              d="M20 30C22.7 30 24.9636 29.1045 26.6181 27.5773L23.3863 25.0682C22.4909 25.6682 21.3454 26.0227 20 26.0227C17.3954 26.0227 15.1909 24.2636 14.4045 21.9H11.0636V24.4909C12.7091 27.7591 16.0909 30 20 30Z"
            />
            <path
              fill="#FBBC04"
              d="M14.4045 21.9C14.2045 21.3 14.0909 20.6591 14.0909 20C14.0909 19.3409 14.2045 18.7 14.4045 18.1V15.5091H11.0636C10.3864 16.8591 10 18.3864 10 20C10 21.6136 10.3864 23.1409 11.0636 24.4909L14.4045 21.9Z"
            />
            <path
              fill="#E94235"
              d="M20 13.9773C21.4681 13.9773 22.7863 14.4818 23.8227 15.4727L26.6909 12.6045C24.9591 10.9909 22.6954 10 20 10C16.0909 10 12.7091 12.2409 11.0636 15.5091L14.4045 18.1C15.1909 15.7364 17.3954 13.9773 20 13.9773Z"
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
