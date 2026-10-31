import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import {
  DocsAddress,
  DocsAddressTarget,
  docsAddressesIn,
  targetOfDocsAddress,
} from "Common/Tests/Helpers/DocsAddresses";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  parsePage,
} from "Common/Tests/RenderedMarkup";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import path from "path";

/*
 * Website links into the docs land on real pages.
 *
 * Every docs address the website (packages/Home) writes - in its views and
 * partials, its data (Utils: SEO entries, product lists, the AI discovery
 * files it builds) and its routes - is asked of the docs' real routes and
 * templates here, and followed through every redirect. It has to end on a
 * page the docs serve, the page it names, and at a heading that page has
 * when it names one. And it has to name that page: a category's own
 * address (/docs/terraform) opens the category's first page, but eight
 * website cards linked such addresses (/docs/compliance, /docs/rbac,
 * /docs/api, ...), which the docs answered with a 404 while every check
 * looked only at pages.
 *
 * Home's Tests/DocsLinks holds the same links to the docs' nav from Home's
 * own CI job, with the AI discovery files as Home renders them.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fileSystem: typeof fs = jest.requireActual("fs") as typeof fs;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fileSystem.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fileSystem.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendMarkdownResponse: (
        _req: ExpressRequest,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.type("text/markdown").send(content);
      },
      sendTextResponse: (
        _req: ExpressRequest,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.status(200).send(content);
      },
    },
  };
});
jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHomeUrl: async (): Promise<{ toString: () => string }> => {
        return {
          toString: (): string => {
            return "https://oneuptime.com/";
          },
        };
      },
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn() },
  };
});
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    GoogleTagManagerEnabled: false,
    Host: "oneuptime.com",
    HttpProtocol: "https://",
  };
});
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/Placeholders", () => {
  return {
    __esModule: true,
    default: {
      render: (content: string): string => {
        return content;
      },
    },
  };
});

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const HOME: string = path.join(REPOSITORY, "packages", "Home");
// The installers the docs serve at /docs/static/scripts, which a command downloads.
const DOCS_INSTALLERS: string = path.join(
  REPOSITORY,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Static",
  "scripts",
);

/*
 * One of the docs' installers (/docs/static/scripts/<agent>/install.sh): no
 * page, but a file the website may name where it sends a reader to it - the
 * infrastructure agent's short address redirects there (Home's
 * Utils/Config.ts). It must be a file the docs have.
 */
const isDocsInstaller: (address: DocsAddress) => boolean = (
  address: DocsAddress,
): boolean => {
  const [endpoint, folder, ...rest] = address.names;

  return (
    endpoint === "static" &&
    folder === "scripts" &&
    rest.length > 0 &&
    !rest.includes("..") &&
    address.anchor === null &&
    fs.existsSync(path.join(DOCS_INSTALLERS, ...rest)) &&
    fs.statSync(path.join(DOCS_INSTALLERS, ...rest)).isFile()
  );
};

// What the website is written in. Stylesheets are left out: a selector such as a[href^="/docs/api"] is no link.
const WEBSITE_FILE: RegExp = /\.(?:ts|ejs|js|json|html|md|txt)$/;
const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  ".git",
];
const SKIPPED_FILES: Array<string> = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];
// The docs' endpoints: an address under one of them is no page.
const DOCS_ENDPOINTS: Array<string> = ["static", "as-markdown", "search-index"];
// A redirect the docs answer with.
const REDIRECT_STATUSES: Array<number> = [301, 302, 307, 308];
const MAX_REDIRECTS: number = 5;

const websiteFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
          walk(full);
        }
      } else if (
        WEBSITE_FILE.test(entry.name) &&
        !SKIPPED_FILES.includes(entry.name)
      ) {
        files.push(full);
      }
    }
  };
  walk(HOME);
  return files;
};

interface WebsiteDocsLink {
  // Where it is written: "packages/Home/Views/cli.ejs:45".
  where: string;
  address: DocsAddress;
  target: DocsAddressTarget;
}

const websiteLinks: Array<WebsiteDocsLink> = websiteFiles().flatMap(
  (file: string): Array<WebsiteDocsLink> => {
    const text: string = fs.readFileSync(file, "utf8");
    return docsAddressesIn(text).map(
      (address: DocsAddress): WebsiteDocsLink => {
        return {
          where: `${path.relative(REPOSITORY, file)}:${address.line}`,
          address: address,
          target: targetOfDocsAddress(address, SUPPORTED_DOCS_LANGUAGE_CODES),
        };
      },
    );
  },
);

// Each address once, with every place it is written.
const addressesWritten: Map<string, Array<WebsiteDocsLink>> = new Map();
for (const link of websiteLinks) {
  const places: Array<WebsiteDocsLink> =
    addressesWritten.get(link.address.address) || [];
  places.push(link);
  addressesWritten.set(link.address.address, places);
}

// An address as the browser asks for it: the anchor stays in the browser.
const requestPathOf: (address: string) => string = (
  address: string,
): string => {
  const anchorAt: number = address.indexOf("#");
  return anchorAt === -1 ? address : address.slice(0, anchorAt);
};

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
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
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

interface Landing {
  // Every address asked for, with the status it answered.
  hops: Array<string>;
  // The address it ended on, and what that answered.
  path: string;
  status: number;
  body: string;
}

const landings: Map<string, Landing> = new Map();

// Where an address ends up, through every redirect, as a reader follows it.
const landingOf: (address: string) => Promise<Landing> = async (
  address: string,
): Promise<Landing> => {
  const requestPath: string = requestPathOf(address);
  const known: Landing | undefined = landings.get(requestPath);

  if (known) {
    return known;
  }

  const hops: Array<string> = [];
  let current: string = requestPath;
  let landing: Landing | null = null;

  for (let hop: number = 0; hop <= MAX_REDIRECTS; hop++) {
    const response: Response = await fetch(`${origin}${current}`, {
      redirect: "manual",
    });
    const location: string | null = response.headers.get("location");
    hops.push(`${current} ${response.status}`);

    if (REDIRECT_STATUSES.includes(response.status) && location !== null) {
      await response.arrayBuffer();
      const next: URL = new URL(location, origin);
      // A redirect stays on this site, never another origin.
      if (next.origin !== origin) {
        landing = {
          hops: [...hops, location],
          path: location,
          status: response.status,
          body: "",
        };
        break;
      }
      current = `${next.pathname}${next.search}`;
      continue;
    }

    landing = {
      hops: hops,
      path: current,
      status: response.status,
      body: await response.text(),
    };
    break;
  }

  const result: Landing = landing || {
    hops: hops,
    path: current,
    status: 0,
    body: "",
  };
  landings.set(requestPath, result);
  return result;
};

const placesOf: (address: string) => string = (address: string): string => {
  return (addressesWritten.get(address) || [])
    .map((link: WebsiteDocsLink): string => {
      return link.where;
    })
    .join(", ");
};

// The ids of a page's elements: what an anchor can scroll to.
const idsOf: (html: string) => Set<string> = (html: string): Set<string> => {
  const page: RenderedPage = parsePage(html);
  return new Set(
    page.elements
      .map((element: RenderedElement): string | null => {
        return attributeOf(element, "id");
      })
      .filter((id: string | null): id is string => {
        return id !== null && id !== "";
      }),
  );
};

describe("the website's links into the docs", () => {
  it("are found, in views, partials and data alike", () => {
    const addresses: Array<string> = [...addressesWritten.keys()];

    expect(addresses.length).toBeGreaterThan(25);
    expect(addresses).toEqual(
      expect.arrayContaining([
        // The docs' root, from the nav, footer and a partial.
        "/docs",
        // Views.
        "/docs/cli/index#install-the-cli",
        "/docs/telemetry/databases#alerts-on-a-database",
        // The eight cards that linked a category's own address.
        "/docs/monitor/external-status-page-monitor",
        "/docs/terraform/index",
        "/docs/permissions/index",
        "/docs/api-reference/api-reference",
        "/docs/incidents/index",
        // Data the AI discovery files are built from, after their origin.
        "/docs/ai/mcp-server",
        "/docs/llms.txt",
      ]),
    );
    /*
     * Partials are read as well as views: some partial links the docs'
     * root. Which one is the homepage's business - its redesigns have moved
     * the link from partial to partial - so any partial will do.
     */
    expect(placesOf("/docs")).toContain(
      path.join("packages", "Home", "Views", "Partials") + path.sep,
    );
    expect(placesOf("/docs/ai/mcp-server")).toContain(
      path.join("packages", "Home", "Utils", "AIDiscovery.ts"),
    );
  });

  it("are written out whole, so the page each opens is known before it runs", () => {
    const built: Array<string> = websiteLinks
      .filter((link: WebsiteDocsLink): boolean => {
        return !link.address.writtenWhole;
      })
      .map((link: WebsiteDocsLink): string => {
        return `${link.where}: ${link.address.address}`;
      });

    expect(built).toEqual([]);
  });

  it("name a page, the docs' root or one of the docs' files: never a category's own address", () => {
    const notPages: Array<string> = websiteLinks
      .filter((link: WebsiteDocsLink): boolean => {
        const firstName: string = (link.target.name || "").split("/")[0]!;
        return (
          link.target.kind === "category" ||
          (link.target.kind === "other" && !isDocsInstaller(link.address)) ||
          (link.target.kind === "page" && DOCS_ENDPOINTS.includes(firstName))
        );
      })
      .map((link: WebsiteDocsLink): string => {
        return `${link.where}: ${link.address.address} (${link.target.kind})`;
      });

    expect(notPages).toEqual([]);
  });

  it("land on a page the docs serve, through every redirect", async () => {
    const broken: Array<string> = [];

    for (const address of addressesWritten.keys()) {
      const landing: Landing = await landingOf(address);

      if (landing.status !== 200) {
        broken.push(
          `${placesOf(address)}: ${address} -> ${landing.hops.join(" -> ")}`,
        );
      }
    }

    expect(broken).toEqual([]);
  }, 300000);

  it("land on the page they name, in English or in the language they name", async () => {
    const elsewhere: Array<string> = [];

    for (const [address, places] of addressesWritten) {
      const target: DocsAddressTarget = places[0]!.target;

      if (target.kind !== "page") {
        continue;
      }

      const expected: string = `/docs/${target.lang || "en"}/${target.name!.toLowerCase()}`;
      const landing: Landing = await landingOf(address);

      if (landing.path.split("?")[0] !== expected) {
        elsewhere.push(
          `${placesOf(address)}: ${address} -> ${landing.path} (expected ${expected})`,
        );
      }
    }

    expect(elsewhere).toEqual([]);
  }, 300000);

  it("land on a heading the page has, when they name one", async () => {
    const missing: Array<string> = [];
    let checked: number = 0;

    for (const [address, places] of addressesWritten) {
      const anchor: string | null = places[0]!.address.anchor;

      if (anchor === null) {
        continue;
      }

      const landing: Landing = await landingOf(address);
      checked += 1;

      if (!idsOf(landing.body).has(anchor)) {
        missing.push(`${placesOf(address)}: ${address} -> ${landing.path}`);
      }
    }

    expect(checked).toBeGreaterThanOrEqual(4);
    expect(missing).toEqual([]);
  }, 300000);
});

describe("the docs' 404 for the addresses the website used to link", () => {
  it("is what an address of no page answers, so the checks above can tell", async () => {
    for (const address of ["/docs/compliance", "/docs/rbac", "/docs/api"]) {
      const landing: Landing = await landingOf(address);

      expect({ address, status: landing.status }).toEqual({
        address,
        status: 404,
      });
    }

    // A heading a page does not have is not among its ids.
    const page: Landing = await landingOf("/docs/cli/index");
    expect(idsOf(page.body).has("install-the-cli")).toBe(true);
    expect(idsOf(page.body).has("no-such-heading")).toBe(false);
  });
});
