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
   * Server -> client. A ListenToModelEvent was refused because the project
   * requires an SSO sign-in that the socket's handshake does not carry, as
   * an API request of the same session would be refused. The payload is
   * the refused ListenToModelEventJSON, so the client knows which project
   * asks for it; signing in with SSO to that project and reconnecting lets
   * the subscription through.
   */
  SsoAuthorizationRequired = "SsoAuthorizationRequired",
}

export default EventName;
