enum Protocol {
  HTTP = "http://",
  HTTPS = "https://",
  MONGO_DB = "mongodb://",
  WS = "ws://",
  WSS = "wss://",
  MAIL = "mailto:",
  /*
   * RFC 3966 / RFC 5724. These are "opaque" schemes: what follows the colon
   * is a phone number, not an authority, so it must never be handed to
   * Hostname. Before they were listed here, "tel:1234567890" fell through to
   * the https default and was normalised on save into
   * "https://tel:1234567890/" — a host of "tel" and a "port" of 1234567890.
   */
  TEL = "tel:",
  SMS = "sms:",
}

export default Protocol;
