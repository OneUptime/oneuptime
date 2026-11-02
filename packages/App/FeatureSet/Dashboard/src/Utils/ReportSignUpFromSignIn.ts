import {
  RevenueEventName,
  RevenueFunnelStage,
} from "Common/Types/Analytics/RevenueEvent";
import Email from "Common/Types/Email";
import {
  SignedUpWithProviders,
  SignedUpWithQueryParam,
} from "Common/Types/Marketing/Attribution";
import UiAnalytics from "Common/UI/Utils/Analytics";
import UserUtil from "Common/UI/Utils/User";

/*
 * A sign-in that made a new account - with Microsoft or Google - ends here, on
 * the Dashboard, without ever reaching the sign-up page's own reporting:
 * nothing told Google Analytics about the sign-up, and nothing told product
 * analytics who this person is. The server marks the address it sends them to
 * with the provider (SignedUpWithQueryParam), and the mark is taken off first,
 * so a reload reports nothing a second time. A mark that names no such
 * provider (SignedUpWithProviders) is taken off and reports nothing, so the
 * sign-up method analytics receive is always one the server sends.
 */
const reportSignUpFromSignIn: () => void = (): void => {
  const url: URL = new URL(window.location.href);
  const signedUpWith: string | null = url.searchParams.get(
    SignedUpWithQueryParam,
  );

  if (signedUpWith === null) {
    return;
  }

  url.searchParams.delete(SignedUpWithQueryParam);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );

  if (!SignedUpWithProviders.includes(signedUpWith)) {
    return;
  }

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
