/*
 * HOW LONG SECURITY EVENTS' USER VAULT KEEPS A USER (#10632).
 *
 * A user stays this many days after a Hash rule last hid them, and a read
 * never takes one older than that: the vault's TTL and its lookups both
 * count from it (Models/AnalyticsModels/SecurityUserVault,
 * Server/Services/SecurityUserVaultService). As long as the address vault
 * keeps an address (SecurityAddressVaultRetention), so a later finding can
 * name the user and the address of the same request alike.
 *
 * A number only, in a file of its own: the vault's model is imported by
 * its service and nothing else (SecurityUserVaultGuard.test.ts), and the
 * record of processing says how long the vault keeps users without
 * reaching the vault (Types/DataSecurity/DeclaredDataStore, #10398).
 */
export const SECURITY_USER_VAULT_RETENTION_IN_DAYS: number = 30;
