# Discord history acceptance gates

Standard: googledev-style. Authored before HOM-46 implementation at baseline
`4e1b7a424efbbefd74c60b8dd7ea56231a668e85`.

## Scope and decisions

Connect the shared history dispatcher to Discord without changing AI opt-in,
schema, actions, or capture settings. Return at most 500 text messages, oldest
first, from at most 20 provider pages of at most 100 records. The page budget
also bounds empty, redacted, and malformed histories. Preserve message text;
do not fetch attachments, quoted messages, or other channels to reconstruct it.

Use the existing `Discord.getMessageHistory` for every page. It revalidates the
current project binding and remote channel guild before reading messages.
Reject a provider or scope failure rather than returning partial context from
a connection that was revoked during pagination.

## Failure-first checklist

1. The shared dispatcher returns no Discord messages despite available history.
2. A 500-message request stops after one provider page, exceeds 100 per request,
   exceeds 500 results, or returns newest-first ordering.
3. Duplicate or overlapping pages repeat messages. A repeated or forward-only
   cursor loops forever. Empty and malformed pages also terminate safely.
4. Cutoff filtering includes older messages, excludes an equal timestamp, or
   continues reading after a complete page is older than the cutoff.
5. Missing IDs, invalid timestamps, foreign `channel_id`, system records, and
   empty content enter context. Snowflake comparison loses precision.
6. Bot and webhook messages lose their bot flag. Human author IDs or display
   names disappear. Missing author fields fabricate an identity.
7. Missing installation, token mismatch, wrong guild, or disconnect between
   pages permits a message fetch or leaks accumulated context.
8. Provider refusal or malformed response reports partial success.
9. Invalid limits and cutoff dates cause an unbounded read. An excessive valid
   limit is capped at 500; the default is 100.
10. Content redacted by Discord is reconstructed from another field or fetched
    through a different endpoint. Empty content stays omitted.
11. Incident or episode builders fetch chat when `includeWorkspaceMessages`
    is absent or false. Opt-in fails to forward the resource creation cutoff
    or retrieve Discord messages through the real dispatcher.
12. Slack and Teams history dispatch changes unintentionally.

## Evidence

`packages/Common/Tests/Integration/DiscordHistory.test.ts` runs the shared
dispatcher, Discord provider scoping, and HTTP client against a recorded HTTP
contract. Database reads and external HTTP responses are controlled. It is an
isolated integration contract, not a live Discord or PostgreSQL test. Runner
source manifests and logs record the baseline red and implementation results.

The fixture owner provides seeded message pages for later real-stack acceptance.
Do not claim live message-content intent from a fixture pass. Discord can redact
message content when the privileged intent is not enabled or approved. See the
[message API](https://docs.discord.com/developers/resources/message) and
[message-content intent](https://docs.discord.com/developers/events/gateway#message-content-intent).
