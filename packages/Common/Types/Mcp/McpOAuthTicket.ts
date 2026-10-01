/*
 * The ticket: the signed description of an MCP authorization request that
 * travels through the browser - from the authorization endpoint to the
 * consent screen in the URL, across a sign-in in a cookie, and back to the
 * server in the request that approves it.
 *
 * Its size limit lives here because both ends have to agree on it. The server
 * issues tickets and the consent screen receives them; when each kept its own
 * number, the server would issue a ticket (up to 6000 characters) that the
 * page then turned away as no request at all (it stopped at 3500). With one
 * limit, a request too large to carry is refused where it is made, with a
 * message that says so.
 *
 * The limit is what fits in a cookie: browsers cap one at about 4 KB including
 * its name and attributes. An ordinary request's ticket is well under 1 KB.
 */
export const MCP_OAUTH_TICKET_MAX_LENGTH: number = 3500;

// "v1.<payload>.<signature>", all base64url (McpOAuthSignedToken).
export const MCP_OAUTH_TICKET_PATTERN: RegExp =
  /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
