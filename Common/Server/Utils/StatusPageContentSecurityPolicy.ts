import { ExpressRequest, ExpressResponse } from "./Express";

export const STATUS_PAGE_CONTENT_SECURITY_POLICY_HEADER_NAME: string =
  "Content-Security-Policy";

/*
 * Fallback status pages share the authenticated application's origin. Custom
 * domains do not, so this policy is deliberately limited to documents served
 * below /status-page on the application host/path.
 *
 * The status-page template currently contains inline script elements for its
 * Tailwind configuration and optional Google Tag Manager bootstrap. Keeping
 * 'unsafe-inline' in script-src lets those elements continue to run, while
 * script-src-attr 'none' uses CSP3's more-specific directive to block inline
 * event handlers such as <img onerror>. Omitting 'unsafe-eval' separately
 * blocks eval/new Function, which is the custom-JavaScript execution sink.
 * HTTPS script sources remain available for Tag Manager and the tags it loads.
 */
export const STATUS_PAGE_FALLBACK_CONTENT_SECURITY_POLICY: string = [
  "script-src 'self' 'unsafe-inline' https:",
  "script-src-attr 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

export const isStatusPageFallbackDocumentPath: (path: string) => boolean = (
  path: string,
): boolean => {
  const normalizedPath: string = (path || "").split("?")[0] || "";

  return (
    normalizedPath === "/status-page" ||
    normalizedPath === "/status-page/" ||
    normalizedPath.startsWith("/status-page/")
  );
};

/**
 * Adds the fallback status page's CSP before its HTML document is rendered.
 * Custom-domain documents (normally served from "/") are intentionally left
 * alone because arbitrary customization remains a supported isolated-origin
 * feature there.
 */
export default function applyStatusPageContentSecurityPolicy(
  req: ExpressRequest,
  res: ExpressResponse,
): void {
  if (!isStatusPageFallbackDocumentPath(req.path || "") || res.headersSent) {
    return;
  }

  res.set(
    STATUS_PAGE_CONTENT_SECURITY_POLICY_HEADER_NAME,
    STATUS_PAGE_FALLBACK_CONTENT_SECURITY_POLICY,
  );
}
