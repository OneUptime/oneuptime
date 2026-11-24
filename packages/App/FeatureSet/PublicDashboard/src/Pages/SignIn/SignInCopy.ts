/*
 * The words of a dashboard's sign-in pages (#10250): what a visitor of a
 * dashboard shared as "Only people who sign in" reads before it opens -
 * signing in, a forgotten password, and the page its reset link opens.
 *
 * Each is an English key of the public dashboard's locales, looked up in
 * the visitor's language where it is drawn (useTranslator), as the error
 * pages' words are. They say what to do once, with the dashboard's name as
 * the page's title, as the password prompt does; and every answer to a
 * forgotten password reads the same, whoever the address is.
 *
 * React-free, so the pages and the suites read these exact strings.
 */
export const SIGN_IN_COPY: {
  // The title when the dashboard has no name to show (it always has one).
  fallbackTitle: string;
  prompt: string;
  ssoOnlyPrompt: string;
  emailLabel: string;
  passwordLabel: string;
  forgotPassword: string;
  submit: string;
  or: string;
  // A single sign-on provider's button, by the name its team gave it.
  signInWithProvider: string;
  noWayToSignIn: string;
  emailRequired: string;
  passwordRequired: string;
  signOut: string;
  signedInAs: string;
} = {
  fallbackTitle: "Dashboard",
  prompt: "Sign in to view this dashboard.",
  ssoOnlyPrompt:
    "Sign in with your organization's single sign-on to view this dashboard.",
  emailLabel: "Email",
  passwordLabel: "Password",
  forgotPassword: "Forgot password?",
  submit: "Sign In",
  or: "or",
  signInWithProvider: "Sign in with {{provider}}",
  noWayToSignIn:
    "No way to sign in is set up for this dashboard yet. Ask the person who shared it with you.",
  emailRequired: "Enter your email address.",
  passwordRequired: "Enter your password.",
  signOut: "Sign Out",
  signedInAs: "Signed in as {{email}}",
};

export const FORGOT_PASSWORD_COPY: {
  title: string;
  prompt: string;
  submit: string;
  // The one answer to every address, sent or not.
  sent: string;
  backToSignIn: string;
} = {
  title: "Forgot your password?",
  prompt:
    "Enter your email address and we'll send you a link to choose a new password.",
  submit: "Send Link",
  sent: "If this address can sign in to this dashboard, a link to choose a new password is on its way. The link works for 24 hours.",
  backToSignIn: "Back to sign in",
};

export const RESET_PASSWORD_COPY: {
  title: string;
  prompt: string;
  passwordLabel: string;
  submit: string;
  done: string;
  signIn: string;
  requestNewLink: string;
} = {
  title: "Choose a new password",
  prompt: "Enter the password you'll sign in to this dashboard with.",
  passwordLabel: "New Password",
  submit: "Save Password",
  done: "Your password is saved. Sign in with it to view the dashboard.",
  signIn: "Sign In",
  requestNewLink: "Request a new link",
};

// Every English key the sign-in pages look up, for the locale suites.
export const SIGN_IN_PAGE_WORDS: ReadonlyArray<string> = [
  ...Object.values(SIGN_IN_COPY),
  ...Object.values(FORGOT_PASSWORD_COPY),
  ...Object.values(RESET_PASSWORD_COPY),
].filter((word: string, index: number, words: Array<string>): boolean => {
  return words.indexOf(word) === index;
});

// Test ids.
export const SIGN_IN_PAGE_TEST_ID: string = "dashboard-sign-in";
export const SIGN_IN_FORM_TEST_ID: string = "dashboard-sign-in-form";
export const SIGN_IN_PROVIDERS_TEST_ID: string = "dashboard-sign-in-providers";
export const SIGN_IN_NO_WAY_TEST_ID: string = "dashboard-sign-in-no-way";
export const FORGOT_PASSWORD_SENT_TEST_ID: string =
  "dashboard-forgot-password-sent";
export const RESET_PASSWORD_DONE_TEST_ID: string =
  "dashboard-reset-password-done";
export const SIGN_OUT_BUTTON_TEST_ID: string = "dashboard-sign-out";
