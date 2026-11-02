import {
  RevenueEventName,
  RevenueFunnelStage,
} from "Common/Types/Analytics/RevenueEvent";
import Email from "Common/Types/Email";
import { SignedUpWithQueryParam } from "Common/Types/Marketing/Attribution";
import UiAnalytics from "Common/UI/Utils/Analytics";
import UserUtil from "Common/UI/Utils/User";

/*
 * A sign-in that made a new account ends here, on the Dashboard, without ever
 * reaching the sign-up page's own reporting: nothing told Google Analytics
 * about the sign-up, and nothing told product analytics who this person is.
 * The server marks the address it sends them to (SignedUpWithQueryParam), and
 * the mark is taken off first, so a reload reports nothing a second time.
 */
const reportSignUpFromSignIn: () => void = (): void => {
  const url: URL = new URL(window.location.href);
  const signedUpWith: string | null = url.searchParams.get(
    SignedUpWithQueryParam,
  );

  if (!signedUpWith) {
    return;
  }

  url.searchParams.delete(SignedUpWithQueryParam);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );

  const email: Email | null = UserUtil.getEmail();

  if (!email) {
    return;
  }

  UiAnalytics.userAuth(email);
  UiAnalytics.captureRevenueEvent(RevenueEventName.SignupCompleted, {
    funnel_stage: RevenueFunnelStage.Signup,
    signup_method: signedUpWith,
  });
};

export default reportSignUpFromSignIn;
