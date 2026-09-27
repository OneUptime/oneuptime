# Discord personal paging failures before implementation

Standard: googledev-style. These cases are authored before HOM-44 production code.

A Discord notification method (`UserDiscord`) is a pointer at the user's own
verified Discord account link (`WorkspaceUserAuthToken`, written only by the
Discord OAuth flow). Pages are direct messages from the deployment bot. The
cases below must fail against the baseline and pass after implementation.

Required failures:

1. A user without a live Discord account link cannot add a Discord method. A
   project without a live Discord installation cannot add one either.
2. A client cannot choose the Discord user ID, display name or verified state.
   Generic CRUD with a forged `discordUserId`, `discordUserName` or
   `isVerified` is refused before persistence.
3. A second Discord method for the same user and project is refused.
4. Another project member, including a project administrator, cannot read the
   Discord user ID through the method, a notification rule relation or the
   on-call timeline. Administrators see only the masked display name.
5. Adding a method seeds default on-call rules, the same as Slack and Teams.
6. The test endpoint sends a direct message only to the caller's own verified
   method. Another user's item ID is refused without a provider request.
7. A blocked direct message (Discord error 50007) is reported as a failed test
   and as an `Error` timeline row. It is never reported as sent.
8. On-call delivery records a `Sending` timeline row and then `Sent` or
   `Error`. The direct message contains the acknowledgment link.
9. A method whose stored Discord user ID no longer matches the user's live link
   is not paged. The attempt is recorded as `Error`; nothing reaches the old
   Discord account.
10. Relinking to a different Discord account deletes the old method and the
    rules that reference it. Relinking the same account keeps them.
11. User unlink deletes only that user's Discord methods and rules. Project
    disconnect deletes every member's Discord methods and rules. Another
    project's methods are untouched. A user-scoped cleanup with no user ID is
    refused, never widened to the whole project.
12. Method deletion keeps historical on-call timeline rows. Their status,
    status message and resource IDs survive; only the method reference is
    cleared.
13. Method deletion removes only rules that reference the deleted method.
    Methodless opt-out rules survive, so fallback cannot re-enable a delivery
    the user switched off.
14. A method created while a disconnect runs cannot survive as a verified
    method that points at a removed link.
15. A user with no matching rule falls back to every verified zero-cost method
    in that project, Discord included. A Discord method in another project is
    never selected.
16. Readiness and the administrator views list Discord as a zero-cost channel
    with the masked display name. Deletion impact names the rules that go.
17. The notification settings direct-message path (for example, on-call
    handoff) reaches the Discord method.

18. A Discord rule added on User Settings > Incident On-Call Rules is saved
    with the chosen severity and delay, is still listed after a reload, and is
    the rule an incident page follows. Without it, the same user is paged by
    email and never by Discord.

Case 18 was added after the rule picker shipped (`7165af449a`), so it is a
regression guard, not a failure-first case.

Cases 1 to 3, 6 to 8, 10 to 12 and 18 run end to end in `PersonalPaging.spec.ts`
against the disposable Discord fixture. They need the fixture's direct-message
route, the `dm-blocked` scenario and a second Discord identity. Cases 4, 5, 9,
13 to 17 run as service tests alongside the existing Slack and Teams suites.
