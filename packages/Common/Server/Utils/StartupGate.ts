import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import { ExpressRequest, ExpressResponse, NextFunction } from "./Express";
import ProductBrandingText from "./ProductBrandingText";

/*
 * What the App answers while it is still starting (issue #2825).
 *
 * The App's HTTP server listens early - so its status endpoints answer - and
 * then spends a while mounting every feature set: the enterprise module,
 * every API, the workers (which, without a dedicated migrate Job, first sync
 * the ClickHouse schema), and only then the ingest routes. A request that
 * arrived in between found no route and got Express's bare 404 - and an
 * OpenTelemetry collector does not retry a 404: it drops the batch. So every
 * restart lost the data sent while the App was starting, on top of the data
 * nginx turned away with a 502 while the App was not listening at all
 * (which collectors do retry).
 *
 * Until the App opens the gate, every route mounted after it answers 503
 * Service Unavailable with Retry-After instead. Collectors, the probe and
 * other well-behaved clients retry that; a browser gets a page that reloads
 * itself. The status endpoints are mounted before the gate and keep
 * answering, and readiness reports "not ready" until the gate opens, so an
 * orchestrator does not send this replica traffic it cannot serve yet.
 */
const AMPERSAND: RegExp = /&/g;
const LESS_THAN: RegExp = /</g;
const GREATER_THAN: RegExp = />/g;
const DOUBLE_QUOTE: RegExp = /"/g;

export default class StartupGate {
  public static readonly RETRY_AFTER_SECONDS: number = 5;

  private static isGateOpen: boolean = false;

  public static isOpen(): boolean {
    return this.isGateOpen;
  }

  // Called once every route is mounted.
  public static open(): void {
    this.isGateOpen = true;
  }

  // Back to starting. For tests.
  public static reset(): void {
    this.isGateOpen = false;
  }

  // For readiness: throws while the App is still starting.
  public static assertOpen(): void {
    if (!this.isGateOpen) {
      throw new ServiceUnavailableException(this.getStartingMessage());
    }
  }

  public static getStartingMessage(): string {
    return `${ProductBrandingText.getProductName()} is starting. Please try again in a few seconds.`;
  }

  /*
   * Express middleware: once the gate is open, every request goes on to its
   * route; until then it is answered here.
   */
  public static middleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (StartupGate.isGateOpen) {
      next();
      return;
    }

    StartupGate.answerStarting(req, res);
  }

  private static answerStarting(req: ExpressRequest, res: ExpressResponse): void {
    const message: string = StartupGate.getStartingMessage();

    res.setHeader("Retry-After", String(StartupGate.RETRY_AFTER_SECONDS));
    res.setHeader("Cache-Control", "no-store");
    res.status(503);

    if (StartupGate.wantsPage(req)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(StartupGate.buildStartingPage(message));
      return;
    }

    res.json({ error: message });
  }

  // A person's browser navigating to a page, rather than an API client.
  private static wantsPage(req: ExpressRequest): boolean {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return false;
    }

    const accept: string = String(req.headers?.["accept"] || "");
    return accept.includes("text/html");
  }

  /*
   * A page that says what is happening and reloads itself. Nothing from the
   * request goes into it; the message is the product name and fixed text,
   * escaped all the same.
   */
  public static buildStartingPage(message: string): string {
    const safeMessage: string = message
      .replace(AMPERSAND, "&amp;")
      .replace(LESS_THAN, "&lt;")
      .replace(GREATER_THAN, "&gt;")
      .replace(DOUBLE_QUOTE, "&quot;");

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="${StartupGate.RETRY_AFTER_SECONDS}"><title>${safeMessage}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;color:#111827}@media (prefers-color-scheme:dark){body{background:#111827;color:#f9fafb}}p{margin:0 16px;font-size:15px;text-align:center}</style></head><body><p>${safeMessage}</p></body></html>`;
  }
}
