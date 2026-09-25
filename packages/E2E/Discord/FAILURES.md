# Discord installation E2E failures before implementation

Standard: googledev-style. These cases are authored before phase 2 production code.

The tests use real OneUptime signup, project creation, authenticated routes and persisted CRUD reads. Only Discord's external OAuth/REST boundary is replaced by an HTTPS fixture at `discord.com` on an internal Docker network. Keep production API URLs fixed.

Required failures:

1. Missing feature endpoints must fail explicitly, never pass as an authorization refusal.
2. Anonymous and foreign-project callers cannot initiate or configure a connection.
3. Consent denial, malformed/missing/wrong-browser/replayed state and a duplicate callback cannot write bindings. A wrong-browser attempt consumes state.
4. An OAuth token failure, identity failure, forged guild, missing guild authority or absent bot cannot leave a partial binding.
5. A parent from another guild, a voice channel, an existing thread or a channel without required thread permissions cannot be selected.
6. Reconnecting the same guild preserves the parent. A different guild cannot replace a current binding.
7. Account linking requires membership in the connected guild. Client-provided IDs cannot forge a trusted account through generic CRUD.
8. User unlink and project disconnect remove local dependent links without revoking the shared bot or affecting another project's binding.
9. Public config, frontend environment and CRUD responses contain no bot, client, access or refresh tokens.
10. Valid raw-body signed PING succeeds; altered bytes or signatures fail without provider side effects.
11. The browser uses a trusted disposable test CA. External network access, unknown provider routes and uncaught browser errors fail verification.
12. Every test produces a trace plus sanitized provider/persistence evidence. Record the baseline failures before enabling production implementation.

Expired state, membership removal during OAuth and callback-after-disconnect require deterministic setup against the existing cache/membership APIs. Add them before the corresponding lifecycle code is implemented; do not claim that malformed state proves expiry or cancellation races.

Executable lifecycle coverage now includes pending reinstall after disconnect,
initial pending install across another install and disconnect, pending user link
after project disconnect, and pending relink after explicit unlink. Expiry,
OneUptime membership removal during OAuth, and multi-user identity races remain
separate gaps until executed. Signed route cases were added after handler code;
the failure inventory and isolated signature cases preceded that code.
