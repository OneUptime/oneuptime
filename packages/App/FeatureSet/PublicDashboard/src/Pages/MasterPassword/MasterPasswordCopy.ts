/*
 * The words of a public dashboard's password prompt: what a visitor of a
 * dashboard shared as "Anyone with the link and a password" sees before
 * the dashboard opens.
 *
 * The prompt names what the visitor is opening - the dashboard's name, as
 * its title - and says what to do once, under it. It used to say it three
 * times over: "Enter <name> Password" as the title, "Please enter the
 * password to view this dashboard." under it, and "Enter the password to
 * unlock this dashboard." under the field, with "Enter password" in the
 * field as well. The field is named by its label alone.
 *
 * React-free, so the page and App/Tests read these exact strings.
 */
export const MASTER_PASSWORD_COPY: {
  // The title when the dashboard has no name to show (it always has one).
  fallbackTitle: string;
  // Under the title: what to do.
  prompt: string;
  passwordLabel: string;
  submit: string;
  // Submitted with nothing in the field.
  passwordRequired: string;
} = {
  fallbackTitle: "Dashboard",
  prompt: "Enter the password to view this dashboard.",
  passwordLabel: "Password",
  submit: "Unlock Dashboard",
  passwordRequired: "Password is required.",
};

export const MASTER_PASSWORD_TITLE_TEST_ID: string = "master-password-title";
export const MASTER_PASSWORD_PROMPT_TEST_ID: string = "master-password-prompt";
