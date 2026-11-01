/*
 * Where the visitor's answer on the cookie banner is kept. Must match
 * Common/Server/Views/Partials/AnalyticsConsent.ejs; the origins share one
 * hostname on OneUptime Cloud, so the product reads the marketing site's
 * answer here.
 */
export const COOKIE_CONSENT_STORAGE_KEY: string = "cookiesAccepted";
