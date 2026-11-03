import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import fs from "fs";
import path from "path";

/*
 * Every docs page starts with a doctype, so browsers draw it in standards
 * mode. Without one (issue #5606) every docs page was drawn in quirks mode:
 * a table's cells did not take the page's line height, and percentage
 * heights and the box model followed old browsers' rules rather than the
 * CSS the pages are written for. The Lighthouse check's doctype audit
 * (packages/E2E/Lighthouse) failed on every docs page.
 *
 * Every view that opens a document starts with the doctype, and the pages
 * the docs' routes serve - a page, one in a right-to-left language, and the
 * page for an address with no page - arrive with it first.
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

const VIEWS: string = path.resolve(__dirname, "../../../FeatureSet/Docs/Views");
const DOCTYPE: string = "<!DOCTYPE html>";

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

describe("the docs' views", () => {
  const documents: Array<string> = viewsIn(VIEWS).filter(
    (view: string): boolean => {
      return fs.readFileSync(path.join(VIEWS, view), "utf8").includes("<html");
    },
  );

  it("are found: the page, the not-found page and the server-error page open documents", () => {
    expect(documents).toEqual(
      expect.arrayContaining(["Index.ejs", "NotFound.ejs", "ServerError.ejs"]),
    );
  });

  it.each(documents)("%s starts with the doctype", (view: string) => {
    const source: string = fs.readFileSync(path.join(VIEWS, view), "utf8");

    expect(source.startsWith(`${DOCTYPE}\n<html`)).toBe(true);
  });
});

describe("a page the docs serve", () => {
  it.each([
    ["a page", "/docs/en/introduction/getting-started", 200],
    ["a page read right to left", "/docs/fa/introduction/getting-started", 200],
    ["an address with no page", "/docs/en/no-such-page", 404],
  ])(
    "%s (%s) arrives with the doctype first",
    async (_name: string, pathname: string, status: number) => {
      const response: Response = await fetch(`${origin}${pathname}`, {
        redirect: "manual",
      });
      const html: string = await response.text();

      expect({ status: response.status, start: html.slice(0, 21) }).toEqual({
        status,
        start: `${DOCTYPE}\n<html`,
      });
    },
  );
});
