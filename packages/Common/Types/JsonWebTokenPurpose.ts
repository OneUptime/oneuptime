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
   * the access-token cookie or an Authorization: Bearer header - with the
   * same access token an earlier release signed before tokens said what
   * they were for (JSONWebToken.isFor).
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

  /*
   * Which UserSession a browser holds, for its sign-out and nothing else
   * (JSONWebToken.signSessionSignOutToken): the user and the session, no
   * address. A browser keeps it in its own cookie, sent only to
   * POST /identity/logout (CookieUtil.setUserCookie), for as long as the
   * session's refresh token. When a renewal's answer was lost, the
   * browser's refresh token matches no session and its access-token cookie
   * is gone after fifteen minutes; this still names the session, so the
   * sign-out ends it (issue #8638). It ends that session of that user, and
   * gets nothing anywhere: it is no session, and without an address no
   * release's reader takes it for one.
   */
  UserSessionSignOut = "user-session-sign-out",

  /*
   * Which StatusPagePrivateUserSession a browser holds on one status page,
   * for its sign-out on that page and nothing else
   * (JSONWebToken.signStatusPageSessionSignOutToken): the status page, the
   * private user and the session, no address. Kept in the page's own
   * cookie, sent only to that page's sign-out
   * (POST /status-page-identity-api/logout/<status page>,
   * CookieUtil.setStatusPagePrivateUserCookie), for as long as the
   * session's refresh token, so that a sign-out after a renewal whose
   * answer was lost still ends the session (issue #8671). It ends that
   * session of that reader on that page, and gets nothing anywhere.
   */
  StatusPageSessionSignOut = "status-page-session-sign-out",

  /*
   * A dashboard private user's sign-in (#10250): the access token of one
   * DashboardPrivateUserSession (CookieUtil.setDashboardPrivateUserCookie),
   * for that one dashboard's public link. It names the dashboard, the
   * private user and the session, and nothing else - no address, no name -
   * so it is no OneUptime session, no SSO sign-in and no status page's
   * session, and none of those is one.
   */
  DashboardPrivateUserSession = "dashboard-private-user-session",

  /*
   * Which DashboardPrivateUserSession a browser holds on one dashboard's
   * public link, for its sign-out there and nothing else
   * (JSONWebToken.signDashboardPrivateUserSessionSignOutToken): the
   * dashboard, the private user and the session. Kept in a cookie of its
   * own, sent only to that dashboard's sign-out, for as long as the
   * session's refresh token, so a sign-out after a renewal whose answer was
   * lost still ends the session - as a status page's does (issue #8671).
   */
  DashboardPrivateUserSessionSignOut = "dashboard-private-user-session-sign-out",

  /*
   * A form private user's sign-in (#10249): the access token of one
   * FormPrivateUserSession (CookieUtil.setFormPrivateUserCookie),
   * for that one form's public link. It names the form, the
   * private user and the session, and nothing else - no address, no name -
   * so it is no OneUptime session, no SSO sign-in and no status page's
   * session, and none of those is one.
   */
  FormPrivateUserSession = "form-private-user-session",

  /*
   * Which FormPrivateUserSession a browser holds on one form's
   * public link, for its sign-out there and nothing else
   * (JSONWebToken.signFormPrivateUserSessionSignOutToken): the
   * form, the private user and the session. Kept in a cookie of its
   * own, sent only to that form's sign-out, for as long as the
   * session's refresh token, so a sign-out after a renewal whose answer was
   * lost still ends the session - as a status page's does (issue #8671).
   */
  FormPrivateUserSessionSignOut = "form-private-user-session-sign-out",
}

export default JsonWebTokenPurpose;
