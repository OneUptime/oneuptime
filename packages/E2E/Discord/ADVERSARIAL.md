# Discord adversarial HTTP verification

Writing standard: googledev-style. Status: failure inventory and mutation plan, recorded before `Adversarial.spec.ts`; no execution or pass claim.

## Failure inventory

Send at most 200 deterministic requests through the real OneUptime app. Use the existing HTTPS Discord fixture and its disposable signing key. Do not mock application routes, persistence, or signature verification.

1. Valid signed PING bodies, including valid whitespace and harmless extra fields, return HTTP 200 and exactly `{ "type": 1 }`.
2. Changed raw bytes, changed signatures, missing signature headers, malformed hex, malformed timestamps, and timestamps outside the allowed window return HTTP 401. No provider request occurs.
3. Valid signatures do not authorize a different application or an unsupported interaction type. Reject them with HTTP 400.
4. Malformed JSON, unexpected top-level JSON shapes, and missing required interaction fields return HTTP 400 or 401 as appropriate. They never return HTTP 500.
5. Missing, malformed, and well-formed but unknown OAuth state reaches the real callback and returns an explicit refusal. It must not exchange an authorization code or write through the provider. A redirect, missing route, or server error is not a passing refusal.
6. The full run leaves the provider transcript unchanged. Unknown fixture routes are failures. Missing signing keys, fixture credentials, or a reachable app are hard failures, not skipped tests.

These cases strengthen the existing installation and signed-interaction E2E specs. They do not prove OAuth state replay, database authorization, or stale-binding handling; those remain in the installation suite.

## Repeatable artifacts

Use `DISCORD_ADVERSARIAL_SEED` to set a 32-bit unsigned seed; the default is `0x44534344`. The vector list and its input digest are deterministic for that seed. Timestamp vectors use offsets from the recorded run time so a rerun can remain within the valid signature window.

The Playwright attachment `discord-adversarial-vectors` records the seed, vector digest, run timestamp, each request digest, expected and observed status, response digest, and provider transcript before and after. It contains no private key, control token, bot token, or OAuth credentials. Retain the Playwright trace and candidate source/image manifest with it.

Run only against the disposable stack described in `Fixture/README.md`, using the existing runner and `--config=playwright.discord.config.ts Discord/Adversarial.spec.ts`. A successful run is HTTP E2E against the external-provider fixture, not live Discord evidence.

## Mutation plan

Run mutations only after the unchanged candidate passes its baseline E2E suite. Copy the candidate into a disposable container or image layer. Never modify the shared worktree or the baseline image.

| Mutation | Required detecting scenario |
| --- | --- |
| Bypass signature verification | Tampered raw bytes and changed signatures must fail their expected-401 assertions. |
| Remove timestamp freshness verification | Correctly signed stale and future timestamps must fail their expected-401 assertions. |
| Remove application-ID or interaction-type checks | Signed wrong-application and unsupported-interaction vectors must fail their expected-400 assertions. |
| Skip OAuth state consumption or binding snapshot comparison | Existing wrong-browser, replay, and callback-after-disconnect installation scenarios must detect an unexpected exchange, binding, or success. |

Apply one mutation at a time. Record the baseline image digest, exact source mutation and SHA-256, invoked spec, failing assertion, and result. A crash or unrelated startup failure is an invalid experiment, not a killed mutation. Restore the baseline container for each mutation. A surviving authorization mutation blocks readiness until its cause is understood.
