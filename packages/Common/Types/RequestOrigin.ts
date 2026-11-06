/*
 * Where a request came from, as a security email tells its recipient: the
 * address it was sent from, roughly where that is, and the device and
 * browser that sent it. Server/Utils/RequestOrigin/RequestOriginUtil reads
 * it off a request and writes it into an email; a write a request makes
 * carries it in DatabaseCommonInteractionProps, so the emails its hooks send
 * (UserService: "Your password was changed") can say the same.
 *
 * Each field is absent when it is not known, and none of them is the
 * caller's own writing: the address is the one ClientIp trusts, the place is
 * what a CDN the operator named says, and the device is built only of names
 * UserAgentDevice spells out.
 */
export default interface RequestOrigin {
  // "203.0.113.7" or "2001:db8::1".
  ipAddress?: string | undefined;
  // "Berlin, Germany".
  location?: string | undefined;
  // "Chrome 130 on macOS", "curl".
  device?: string | undefined;
}
