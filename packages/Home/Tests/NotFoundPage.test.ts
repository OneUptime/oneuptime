/*
 * Relative rather than the "Common/..." alias other Home files use: the alias
 * resolves through Home/node_modules/Common, which in a git worktree points at
 * the main checkout.
 */
import { GoogleTagManagerEnabled } from "../../Common/Server/EnvironmentConfig";
import { ExpressResponse } from "../../Common/Server/Utils/Express";
import { ViewsPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import ejs from "ejs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The marketing site's 404 page and Google Analytics.
 *
 * Every other page is rendered with enableGoogleTagManager; the 404 page was
 * not, so it loaded no Google tag and a broken link - an old URL, a mistyped
 * one, a link from another site - never showed up in Google Analytics. These
 * render the page with exactly what the route hands it.
 */

interface RenderedNotFound {
  status: number | undefined;
  view: string;
  locals: Record<string, unknown>;
}

type CaptureNotFoundFunction = () => RenderedNotFound;

const captureNotFound: CaptureNotFoundFunction = (): RenderedNotFound => {
  const captured: RenderedNotFound = {
    status: undefined,
    view: "",
    locals: {},
  };

  const res: unknown = {
    status: (code: number): unknown => {
      captured.status = code;
      return res;
    },
    render: (view: string, locals: Record<string, unknown>): void => {
      captured.view = view;
      captured.locals = locals;
    },
  };

  NotFoundUtil.renderNotFound(res as ExpressResponse);

  return captured;
};

// Where the image keeps Home's views (ViewsPath), in this checkout.
const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

type RenderPageFunction = (enableGoogleTagManager: boolean) => Promise<string>;

// The view, with the route's own locals and only the flag overridden.
const renderPage: RenderPageFunction = async (
  enableGoogleTagManager: boolean,
): Promise<string> => {
  const rendered: RenderedNotFound = captureNotFound();

  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, path.relative(ViewsPath, rendered.view)),
    { ...rendered.locals, enableGoogleTagManager },
    { views: [VIEWS_ROOT] },
  )) as string;
};

const CONTAINER_URL: string =
  "https://www.googletagmanager.com/gtm.js?id=GTM-PKQD5WH";

describe("the 404 page", () => {
  test("answers 404 with the not-found view", () => {
    const rendered: RenderedNotFound = captureNotFound();

    expect(rendered.status).toBe(404);
    expect(rendered.view).toBe(`${ViewsPath}/not-found.ejs`);
  });

  test("is told whether to load the Google tag, like every other page", () => {
    const locals: Record<string, unknown> = captureNotFound().locals;

    expect(locals).toHaveProperty("enableGoogleTagManager");
    expect(locals["enableGoogleTagManager"]).toBe(GoogleTagManagerEnabled);
  });

  describe("on OneUptime Cloud", () => {
    test("loads the Google tag through the consent gate", async () => {
      const html: string = await renderPage(true);
      const loader: number = html.indexOf("function loadGoogleTag()");

      expect(html).toContain("window.oneUptimeConsent = (function");
      expect(loader).toBeGreaterThan(-1);
      expect(html.indexOf(CONTAINER_URL)).toBeGreaterThan(loader);
      expect(html).toContain(
        "window.oneUptimeConsent.whenAllowed(loadGoogleTag)",
      );
    });

    /*
     * What makes the visit findable in Google Analytics: its page view
     * carries this title, at the URL that was asked for.
     */
    test("titles the page so its views can be found", async () => {
      expect(await renderPage(true)).toContain(
        "<title>OneUptime | Page not found</title>",
      );
    });

    test("declares no canonical URL", async () => {
      expect(await renderPage(true)).not.toContain('rel="canonical"');
    });
  });

  describe("on a self-hosted install", () => {
    test("loads no Google tag", async () => {
      const html: string = await renderPage(false);

      expect(html).not.toContain("googletagmanager.com");
    });
  });
});
