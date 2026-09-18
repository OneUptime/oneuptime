enum EventName {
  ListenToModalEvent = "ListenToModelEvent",

  /*
   * Server -> client. A ListenToModelEvent was refused because the socket's
   * handshake carried no access token, or one that no longer decodes (the
   * dashboard's access token lives 15 minutes; the handshake cookie lives as
   * long as the connection). The payload is the refused ListenToModelEventJSON.
   *
   * The socket can not be re-authenticated in place: the cookie is read from
   * the handshake, so the client has to refresh its session and reconnect.
   */
  AuthenticationRequired = "AuthenticationRequired",
}

export default EventName;
