/*
 * WHAT A TOKEN THAT NAMES A PERSON IS FOR.
 *
 * OneUptime signs every one of its tokens with the same key
 * (TokenSigningKey), so a signature that verifies says only that this
 * server made the token - not what for. A dashboard session, an SSO sign-in
 * and a status page session all name a person, so read without asking
 * which it is, each one could stand in for the others. Each says what it is
 * for in its `purpose` claim instead, and every place that reads one asks
 * for its own kind (JSONWebToken.decode): a token made for anything else is
 * refused there exactly as one that does not verify.
 */
enum JsonWebTokenPurpose {
  /*
   * A dashboard sign-in: the fifteen-minute access token of one UserSession
   * (JSONWebToken.signUserLoginToken), renewed by that session's refresh
   * token and ended with it. The only kind the API takes as a session, from
   * the access-token cookie or an Authorization: Bearer header.
   */
  UserSession = "user-session",

  /*
   * A sign-in through an SSO provider - a project's own SAML or OIDC
   * provider, or a Global one (CookieUtil.getSSOToken, getGlobalSSOToken):
   * for thirty days, proof that the person signed in through that provider,
   * so that a project requiring SSO lets their session in. Read only next to
   * a session of the same person, from its own cookie or header, and never
   * a session itself.
   */
  SsoSignIn = "sso-sign-in",

  /*
   * A status page private user's sign-in: the access token of one
   * StatusPagePrivateUserSession (CookieUtil.setStatusPagePrivateUserCookie),
   * for that one status page.
   */
  StatusPageSession = "status-page-session",
}

export default JsonWebTokenPurpose;
