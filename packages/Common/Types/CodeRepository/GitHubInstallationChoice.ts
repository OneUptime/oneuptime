/*
 * Connecting a GitHub App installation that already exists.
 *
 * GitHub sends nobody back from an installation that is only reconfigured,
 * so Code Repositories connects one by having the person sign in to GitHub
 * instead. When their GitHub account administers more than one installation
 * of the app, the callback sends the browser back with
 * `?github_installations=` and a one-use token; the page reads the choice
 * with that token and shows it, and picking one goes back through the
 * callback, which connects it only if it was offered.
 */

export const GITHUB_INSTALLATION_CHOICE_QUERY_PARAM: string =
  "github_installations";

// One installation of the GitHub App the person may connect.
export interface GitHubInstallationChoice {
  installationId: string;
  // The GitHub account or organization the app is installed on.
  accountLogin: string;
  // "User" or "Organization".
  accountType: string;
}
