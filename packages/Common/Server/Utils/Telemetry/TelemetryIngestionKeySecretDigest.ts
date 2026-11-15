import SecretDigest from "./SecretDigest";

/*
 * A DIGEST OF AN INGESTION KEY'S SECRET, FOR WHAT HAS TO REMEMBER WHICH
 * SECRET IT WAS GIVEN (issue #8147).
 *
 * An MQTT session proves it holds a key's secret once, at CONNECT, and then
 * publishes for as long as it stays open - days or weeks. To stop it when the
 * key's secret is reset, the broker has to compare the secret the session
 * connected with against the key's current one on later publishes. Keeping
 * the secret itself per connection would leave every connected key's live
 * credential in the heap, where a heap snapshot, a core file or a debugger
 * reads it; the key service keys its own cache on a SHA-256 of the token for
 * the same reason. So both sides keep this digest instead: the broker of the
 * secret a session presented, the key service of each key's current secret.
 *
 * The secret is a UUID, so it is normalised first: Postgres compares uuid
 * values without regard to case, and a key presented in capitals at CONNECT
 * must not read as "the secret changed" on its first publish. The digest is
 * SecretDigest's, which an IoT device credential's secret uses too.
 */
export default class TelemetryIngestionKeySecretDigest extends SecretDigest {}
