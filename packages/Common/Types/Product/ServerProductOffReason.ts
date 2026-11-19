/*
 * Why a product is off on this server, in a module that imports nothing.
 * ServerProducts reads it, and exports it as before; the mobile app's suite
 * that holds the app's copy of these values to the server's
 * (MobileApp/src/api/serverProducts.test.ts) reads it here. Read through
 * ServerProducts, its JSON types reach the database models and typeorm,
 * which the mobile app neither installs nor can resolve, so its compile
 * failed on them (6b5fb4325cc).
 */
export enum ServerProductOffReason {
  // An admin switched it off, or SERVER_PRODUCTS left it out.
  SwitchedOff = "switched-off",
  // DISABLE_TELEMETRY_INGESTION is set: nothing new can reach it.
  TelemetryIngestionStopped = "telemetry-ingestion-stopped",
}
