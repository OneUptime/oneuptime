/*
 * Where the status page fixture is read from, for issue #5132's copy checks.
 *
 * STATUS_PAGE_PLAIN_HTTP_HOST is a name the suite's browser resolves to the
 * fixture server (playwright.maintenance-calendar-ui.config.ts maps it with
 * --host-resolver-rules): a status page served over plain http from a name
 * that is not localhost - a self-hosted install reached by a LAN hostname.
 * That is not a secure context, so the browser has no navigator.clipboard
 * there. 127.0.0.1 and localhost are secure contexts, and have one.
 */
export const STATUS_PAGE_PLAIN_HTTP_HOST: string = "status.calendar-copy.test";

export const HOST_RESOLVER_RULE: string = `--host-resolver-rules=MAP ${STATUS_PAGE_PLAIN_HTTP_HOST} 127.0.0.1`;
