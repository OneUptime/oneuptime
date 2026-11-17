import { fireEvent, screen } from "@testing-library/react";
import { MORE_WAYS_TO_SIGN_IN_TOGGLE_TEST_ID } from "../../../../App/FeatureSet/Accounts/src/Components/MoreWaysToSignIn/MoreWaysToSignIn";

/*
 * Opens "More ways to sign in" on the sign-in page, where single sign-on, a
 * sign-in link and a passkey are folded (#9023), and leaves it open if it
 * already is: the fold remembers in the browser's storage that it was left
 * open, so a test after one that opened it may find it open.
 */
export const openMoreWaysToSignIn: () => void = (): void => {
  const toggle: HTMLElement = screen.getByTestId(
    MORE_WAYS_TO_SIGN_IN_TOGGLE_TEST_ID,
  );

  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }
};

export default openMoreWaysToSignIn;
