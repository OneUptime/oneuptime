import crypto from "crypto";

/*
 * The hash of a config OneUptime sends to a host: SHA-256 of its exact
 * bytes. OpAMP carries it as raw bytes (AgentRemoteConfig.config_hash), the
 * host reports it back once it runs the config, and OneUptime stores it as
 * 64 lowercase hex characters to find the version a host runs.
 */
export function getHostCollectorConfigHash(configYaml: string): string {
  return crypto.createHash("sha256").update(configYaml, "utf8").digest("hex");
}

export function hostCollectorConfigHashToBytes(hash: string): Buffer {
  return Buffer.from(hash, "hex");
}

/*
 * A hash a host reported, as OneUptime stores it, or null when it is not
 * one OneUptime could have sent (empty, or not 32 bytes).
 */
export function hostCollectorConfigHashFromBytes(
  bytes: Uint8Array | null | undefined,
): string | null {
  if (!bytes || bytes.length !== 32) {
    return null;
  }

  return Buffer.from(bytes).toString("hex");
}
