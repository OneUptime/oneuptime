/*
 * Where a code repository is hosted, and so how OneUptime reaches it
 * (Types/CodeRepository/CodeHost says what each can do):
 *
 *   - GitHub: through the OneUptime GitHub App, installed on the account.
 *   - GitLab: GitLab.com or a self-managed GitLab, with an access token.
 *   - Forgejo: a Forgejo or Gitea server - Codeberg among them - with an
 *     access token. Forgejo keeps Gitea's API, so one client reads both.
 *   - Git: any Git repository over HTTPS, with a username and a password or
 *     token. AI pushes a branch there; there is no pull request API to open
 *     one with, so the person opens it on their Git server.
 */
enum CodeRepositoryType {
  GitHub = "GitHub",
  GitLab = "GitLab",
  Forgejo = "Forgejo",
  Git = "Git",
}

export default CodeRepositoryType;
