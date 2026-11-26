/*
 * HOW LONG SECURITY EVENTS' ADDRESS VAULT KEEPS AN ADDRESS (#10395).
 *
 * An address stays this many days after it was last seen, and a read never
 * takes one older than that: the vault's TTL and its lookups both count
 * from it (Models/AnalyticsModels/SecurityAddressVault,
 * Server/Services/SecurityAddressVaultService).
 *
 * A number only, in a file of its own: the vault's model is imported by
 * its service and nothing else (SecurityAddressVaultGuard.test.ts), and the
 * record of processing says how long the vault keeps addresses without
 * reaching the vault (Types/DataSecurity/DeclaredDataStore, #10398).
 */
export const SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS: number = 30;
