/*
 * The browser client builds IDENTITY_URL (where the session is refreshed) and
 * the other service URLs from HOST once, when UI/Config is first loaded. With
 * no HOST the refresh URL degenerates to "http://identity/refresh-token", which
 * is not a URL any browser would call. Importing this module FIRST gives the
 * client the host a real Dashboard runs on. Jest gives each test file its own
 * copy of process.env, so this does not leak into other files.
 */
export const DASHBOARD_ORIGIN: string = "https://oneuptime.example.com";

process.env["HOST"] = "oneuptime.example.com";
process.env["HTTP_PROTOCOL"] = "https";
