enum EventName {
  ListenToModalEvent = "ListenToModelEvent",

  /*
   * Server -> client. The socket's session cannot be used for live updates,
   * and a fresh one would fix that:
   *
   *   - a ListenToModelEvent was refused because the socket's handshake
   *     carried no access token, one that no longer decodes, or a blocked
   *     user's (the dashboard's access token lives 15 minutes; the handshake
   *     cookie lives as long as the connection). The payload is the refused
   *     ListenToModelEventJSON.
   *   - the session the socket joined its rooms with has ended: its access
   *     token expired, or the session was signed out or revoked. The socket
   *     has left every room and joins nothing more. The payload is {}.
   *
   * The socket can not be re-authenticated in place: the cookie is read from
   * the handshake, so the client has to refresh its session and reconnect.
   * When the session cannot be refreshed, the refresh sends the person to
   * sign in.
   */
  AuthenticationRequired = "AuthenticationRequired",

  /*
   * Server -> client. The access token this socket joined with expires in
   * about a minute (RealtimeSessions.RENEWAL_NOTICE_IN_MS), and its live
   * updates end then. The socket still hears until that time: the client
   * refreshes its session and reconnects first, so the new handshake carries
   * the new cookie and its live updates carry on without a break. The
   * payload is {}.
   */
  SessionExpiring = "SessionExpiring",

  /*
   * Server -> client. A project requires an SSO sign-in that the socket's
   * handshake does not carry, as an API request of the same session would
   * be refused: a ListenToModelEvent was refused, or the project's sign-in
   * rules changed and the socket has left the project's rooms. The payload
   * names the project in tenantId (a refused join sends the refused
   * ListenToModelEventJSON); signing in with SSO to that project and
   * reconnecting lets the subscriptions through.
   */
  SsoAuthorizationRequired = "SsoAuthorizationRequired",
}

export default EventName;
