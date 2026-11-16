import HashedApiKey from "./APIKey/HashedApiKey";

/*
 * THE SERVER'S MASTER API KEY, STORED HASHED (#7901).
 *
 * The master API key (Admin Dashboard > Settings > API Key) has root access
 * to every project on the server. It is made, hashed and matched by the
 * rules every API key is (Utils/APIKey/HashedApiKey): a random version 4
 * uuid made on the server and shown once, kept as the SHA-256 of the key,
 * lower-cased, with the server's ENCRYPTION_SECRET, and compared in
 * constant time. A project's API keys are kept the same way (#8902).
 *
 * This is the master key's name for those rules, for the writer
 * (GlobalConfigService.createMasterApiKey), the lookup
 * (ProjectAuthorization.isMasterApiKey) and the data migration that hashes
 * the key stored before (HashMasterApiKey). Unlike a project's keys, which
 * are looked up by their hash, the master key's settings row is read by its
 * id and the key presented is compared with what it holds (matches), so the
 * key is in no query at all.
 */
export default class MasterApiKey extends HashedApiKey {}
