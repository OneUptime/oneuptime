import APIReferenceFeatureSet from "../../../FeatureSet/APIReference/Index";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  parsePage,
} from "Common/Tests/RenderedMarkup";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import fs from "fs";
import path from "path";

/*
 * The API Reference links no web app manifest. Every page linked
 * /manifest.json (issue #5607), which neither kind of installation has for
 * the reference: on OneUptime Cloud, Nginx sends that address to Home, which
 * has no such file, so every reference page logged two console errors for
 * its 404; self-hosted, the App answers with the Dashboard's manifest, so
 * the reference called itself the Dashboard. The reference is not an app to
 * install. The Lighthouse check's errors-in-console audit
 * (packages/E2E/Lighthouse) failed on the reference pages.
 *
 * No view names a manifest, and the pages the reference's routes serve - its
 * introduction, a model's page, a page read right to left, and the page for
 * an address with no page - link none.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );

  return {
    ViewsPath: nodePath.join(root, "views"),
    StaticPath: nodePath.join(root, "Static"),
    CodeExamplesPath: nodePath.join(root, "CodeExamples"),
  };
});

const VIEWS: string = path.resolve(
  __dirname,
  "../../../FeatureSet/APIReference/views",
);

// Every .ejs file under a folder, by its path from that folder.
function viewsIn(folder: string, prefix: string = ""): Array<string> {
  return fs
    .readdirSync(path.join(folder, prefix), { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const relative: string = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        return viewsIn(folder, relative);
      }

      return entry.name.endsWith(".ejs") ? [relative] : [];
    });
}

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
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

describe("the API Reference's views", () => {
  const views: Array<string> = viewsIn(VIEWS);

  it("are found, the head every page includes among them", () => {
    expect(views).toContain(path.join("partials", "head.ejs"));
  });

  it("name no manifest", () => {
    // A link to one, or its address.
    const manifest: RegExp = /rel\s*=\s*["']?manifest\b|manifest\.json/i;

    expect(
      views.filter((view: string): boolean => {
        return manifest.test(fs.readFileSync(path.join(VIEWS, view), "utf8"));
      }),
    ).toEqual([]);
  });
});

describe("a page the API Reference serves", () => {
  it.each([
    ["its introduction", "/reference/en/introduction", 200],
    ["a model's page", "/reference/en/monitor", 200],
    ["a page read right to left", "/reference/fa/introduction", 200],
    ["an address with no page", "/reference/en/no-such-page", 404],
  ])(
    "%s (%s) links no manifest",
    async (_name: string, pathname: string, status: number) => {
      const response: Response = await fetch(`${origin}${pathname}`, {
        redirect: "manual",
      });
      const page: RenderedPage = parsePage(await response.text());
      const manifests: Array<string> = page.elements
        .filter((element: RenderedElement): boolean => {
          return (
            element.tagName === "link" &&
            (attributeOf(element, "rel") || "")
              .toLowerCase()
              .split(/\s+/)
              .includes("manifest")
          );
        })
        .map((element: RenderedElement): string => {
          return attributeOf(element, "href") || "";
        });

      expect({ status: response.status, manifests }).toEqual({
        status,
        manifests: [],
      });
    },
  );
});
