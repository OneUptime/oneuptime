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
13. A verified Discord account link does not preserve authorization after the OneUptime user is removed from the project. Every incident button click must revalidate accepted project membership.
14. A linked project member cannot acknowledge or resolve an incident unless their current permissions allow both creating the resulting `IncidentStateTimeline` and updating the incident's current state. Explicit block permissions must deny the action.
15. Incident update permission alone cannot authorize an acknowledge or resolve action. The handler must check create permission on the actual timeline model that the mutation writes.
16. Timeline create permission alone cannot authorize an action against a hidden, private, label-scoped, deleted, or foreign-project incident. The resource lookup must use the current member's scoped props.
17. A valid linked account with stale membership must fail before any resource lookup or mutation runs.
18. Authorization and mutation must use the same project and incident ID. A custom ID cannot switch the target after authorization.
19. Repeated delivery of one signed interaction ID must execute at most one incident mutation and create at most one state timeline.
20. An authorized member can acknowledge and resolve a visible incident. A replay or an already-completed transition returns an explicit result without adding another timeline.
21. A second delivery while the first handler is running returns an explicit in-progress result and never queues another handler.
22. A delivery replayed after the handler completes returns the stored terminal response and never repeats the mutation.
23. Emptying or restarting Redis inside the five-minute signature window cannot remove the interaction claim or repeat a note, create, paging, or state-change mutation. PostgreSQL is the replay authority.
24. The receipt becomes completed only after the domain handler reports persistence success. A crash or receipt-write failure after a domain commit remains in progress and requires explicit reconciliation; it must not rerun automatically or claim exactly-once delivery.
25. A database outage while claiming an interaction fails closed before identity resolution or domain work. A terminal handler error is stored and replayed without rerunning the failed request.
26. A receipt is bound to the verified application, guild, Discord actor, project, and OneUptime user before domain work. Reusing an interaction ID with a different signed actor or tenant fails closed and never returns or overwrites another actor's replay response.
27. Immediate picker responses are ephemeral and disable implicit mentions. They must not expose action controls to the rest of a channel.
28. A picker continuation token stolen by another Discord actor cannot read choices, search, paginate, or submit an action. The picker remains bound to its opening Discord actor, OneUptime user, project, and guild.
29. Disconnecting or reinstalling the same Discord guild invalidates existing picker continuations. The installation generation must match before a provider read or domain handler runs.
30. Picker pagination and search do not renew the original absolute expiry. Every continuation token in the flow expires at the same bounded time.
31. Interaction-receipt retention is registered with the hard-delete worker without mounting a CRUD route. An unregistered retention declaration is inert.

Expired state, membership removal during OAuth and callback-after-disconnect require deterministic setup against the existing cache/membership APIs. Add them before the corresponding lifecycle code is implemented; do not claim that malformed state proves expiry or cancellation races.

Executable lifecycle coverage now includes pending reinstall after disconnect,
initial pending install across another install and disconnect, pending user link
after project disconnect, and pending relink after explicit unlink. Expiry,
OneUptime membership removal during OAuth, and multi-user identity races remain
separate gaps until executed. Signed route cases were added after handler code;
the failure inventory and isolated signature cases preceded that code.
