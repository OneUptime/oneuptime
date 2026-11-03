import APIReferenceFeatureSet from "../../FeatureSet/APIReference/Index";
import DocsFeatureSet from "../../FeatureSet/Docs/Index";
import { getTailwindStylesheetFileName } from "../../Utils/TailwindStylesheet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";

/*
 * Where the image built the docs' and the API reference's Tailwind
 * stylesheets (issue #5615), their pages link them in place of the Tailwind
 * runtime: last in the head, where the runtime's styles used to land, so
 * every rule keeps its place in the cascade. Each site serves its own under
 * its path - this build's for a year, another build's address with this
 * build's file, never kept.
 *
 * Both feature sets run through their real routes and views, with a built
 * stylesheet in a folder of this file's own (DocsTailwind.test.ts holds the
 * build; where nothing is built, the pages keep the runtime, as every other
 * docs and reference test sees them).
 */

const DOCS_CSS: string = "/* the docs */.flex{display:flex}";
const REFERENCE_CSS: string = "/* the reference */.grid{display:grid}";

jest.mock("../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../FeatureSet/Docs");

  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});

jest.mock("../../FeatureSet/APIReference/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../FeatureSet/APIReference");

  return {
    ViewsPath: path.join(root, "views"),
    StaticPath: path.join(root, "Static"),
    CodeExamplesPath: path.join(root, "CodeExamples"),
  };
});

// Each site's build, in a folder of its own, as the image writes it.
jest.mock("../../Utils/DocsTailwind", () => {
  const actual: typeof import("../../Utils/DocsTailwind") = jest.requireActual(
    "../../Utils/DocsTailwind",
  ) as typeof import("../../Utils/DocsTailwind");
  const fs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const os: typeof import("os") = jest.requireActual(
    "os",
  ) as typeof import("os");
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const stylesheet: typeof import("../../Utils/TailwindStylesheet") =
    jest.requireActual(
      "../../Utils/TailwindStylesheet",
    ) as typeof import("../../Utils/TailwindStylesheet");
  const builds: Record<string, string> = {
    docs: "/* the docs */.flex{display:flex}",
    reference: "/* the reference */.grid{display:grid}",
  };
  const directories: Record<string, string> = {};

  for (const [name, css] of Object.entries(builds)) {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), `docs-tailwind-${name}-`),
    );

    fs.writeFileSync(
      path.join(directory, stylesheet.getTailwindStylesheetFileName(css)),
      css,
    );
    directories[name] = directory;
  }

  return {
    ...actual,
    getDocsTailwindSite: (name: string) => {
      return {
        ...actual.getDocsTailwindSite(name),
        directory: directories[name],
      };
    },
  };
});

const DOCS_HREF: string = `/docs/tailwind/${getTailwindStylesheetFileName(DOCS_CSS)}`;
const REFERENCE_HREF: string = `/reference/tailwind/${getTailwindStylesheetFileName(REFERENCE_CSS)}`;

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  await APIReferenceFeatureSet.init();
  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) {
    return;
  }

  // fetch keeps its connections open for reuse; close them with the server.
  server.closeAllConnections();
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

// The last element of a page's head, with its comments and spaces left out.
function lastInHead(html: string): string {
  const head: string = html.slice(0, html.indexOf("</head>"));
  const tags: Array<string> = head
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .split(/(?=<)/)
    .map((tag: string): string => {
      return tag.trim();
    })
    .filter((tag: string): boolean => {
      return tag !== "" && !tag.startsWith("</");
    });

  return tags[tags.length - 1] || "";
}

describe.each([
  ["a docs page", "/docs/en/introduction/getting-started", 200, DOCS_HREF],
  [
    "a docs page read right to left",
    "/docs/fa/introduction/getting-started",
    200,
    DOCS_HREF,
  ],
  [
    "the docs' page for an address with no page",
    "/docs/en/no-such-page",
    404,
    DOCS_HREF,
  ],
  ["the API reference", "/reference/en/introduction", 200, REFERENCE_HREF],
  [
    "a model in the API reference",
    "/reference/en/monitor",
    200,
    REFERENCE_HREF,
  ],
])(
  "%s (%s)",
  (_name: string, pathname: string, status: number, href: string) => {
    let html: string = "";

    beforeAll(async () => {
      const response: Response = await fetch(`${origin}${pathname}`, {
        redirect: "manual",
      });

      expect(response.status).toBe(status);
      html = await response.text();
    });

    it("links the site's built stylesheet, last in its head", () => {
      expect(lastInHead(html)).toBe(`<link rel="stylesheet" href="${href}">`);
    });

    it("loads no Tailwind runtime and gives it no config", () => {
      expect(html).not.toContain("tailwind-3.4.5.js");
      expect(html).not.toContain("tailwind.config");
    });
  },
);

describe.each([
  ["the docs", DOCS_HREF, DOCS_CSS, "/docs/tailwind/"],
  ["the API reference", REFERENCE_HREF, REFERENCE_CSS, "/reference/tailwind/"],
])(
  "%s' stylesheet",
  (_name: string, href: string, css: string, prefix: string) => {
    it("is served at its address, cached for a year", async () => {
      const response: Response = await fetch(`${origin}${href}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^text\/css/);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(await response.text()).toBe(css);
    });

    it("answers another build's address too, but never to be kept", async () => {
      const response: Response = await fetch(
        `${origin}${prefix}tailwind.0123456789ab.css`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe(css);
    });
  },
);

describe("an address under the stylesheets' paths that no build has", () => {
  it("is not served as a stylesheet", async () => {
    const response: Response = await fetch(
      `${origin}/docs/tailwind/not-a-build.css`,
      { redirect: "manual" },
    );

    expect(response.headers.get("content-type") || "").not.toMatch(
      /^text\/css/,
    );
  });
});
