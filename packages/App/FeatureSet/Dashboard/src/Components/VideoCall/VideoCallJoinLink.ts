/*
 * The address a call's Join link opens: the call's link as the browser reads
 * it, when that is an http or https address, and nothing otherwise - so no
 * other kind of link, a javascript: one say, is ever opened from the page.
 * A call's link is checked to be https when the call is added; this holds
 * every place that opens one to that too.
 */
export function getOpenableJoinUrl(
  joinUrl: string | undefined | null,
): string | undefined {
  const link: string = readLink((joinUrl || "").trim()) || "";
  const httpAddress: RegExp = /^https?:\/\/[!-~]+$/;

  return httpAddress.test(link) ? link : undefined;
}

/*
 * The link as the browser reads it: the scheme in lower case, and spaces and
 * letters beyond ASCII encoded. Undefined for text that is no link at all.
 */
function readLink(text: string): string | undefined {
  try {
    return new URL(text).href;
  } catch {
    return undefined;
  }
}
