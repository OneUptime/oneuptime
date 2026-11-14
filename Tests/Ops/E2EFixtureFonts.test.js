"use strict";

/**
 * Every offline fixture draws its pages in the product's font.
 *
 * Production draws every page in Inter: the Dashboard's index.ejs declares
 * the font and gives every element Inter with a universal `*` rule. A
 * fixture server that serves no Inter draws its pages in the machine's font
 * instead - DejaVu on a CI runner - so its screenshots do not show the
 * product's font, and its layout tests measure widths no reader sees.
 * (2026-11-01: the ChartTimeZoom and EventOverview servers learned to serve
 * it, and a bucket inspector test that had been aimed by DejaVu's widths was
 * aimed again.)
 *
 * This holds, for every server.js under packages/E2E that serves a page:
 *   - it serves InterVariable.woff2, or it is one of KNOWN_WITHOUT_INTER;
 *   - every server on that list still exists and still serves no Inter: a
 *     server that learns it leaves the list, so the list only shrinks.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");
const INTER_FILE = "InterVariable.woff2";

// The fixture servers that still draw in the machine's font. Only shrinks.
const KNOWN_WITHOUT_INTER = [
  "Alerts/server.js",
  "Discovery/server.js",
  "ExceptionDetail/Fixture/server.js",
  "HomeOverview/Fixture/server.js",
  "IncomingCallPolicies/Fixture/server.js",
  "LabelRules/Fixture/server.js",
  "MonitorOverview/Fixture/server.js",
  "NavigationSearch/server.js",
  "PacketCapture/server.js",
  "PencilButton/Fixture/server.js",
  "SessionReplay/Fixture/server.js",
  "SloBurnRate/Fixture/server.js",
  "StatusPageSearch/server.js",
  "TraceDetail/Fixture/server.js",
  "UserFlows/Fixture/server.js",
  "WorkflowBuilder/Fixture/server.js",
];

// Every server.js under packages/E2E, as a path from it ("Alerts/server.js").
function fixtureServers(directory, prefix = "") {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      found.push(...fixtureServers(path.join(directory, entry.name), relative));
    } else if (entry.name === "server.js") {
      found.push(relative);
    }
  }

  return found.sort();
}

function read(relative) {
  return fs.readFileSync(path.join(E2E_DIR, relative), "utf8");
}

// An HTML document's first line, in any case.
const DOCTYPE_PATTERN = /<!doctype html>/i;

// A server that answers with a page of its own: an HTML document.
function servesAPage(source) {
  return DOCTYPE_PATTERN.test(source) || source.includes("text/html");
}

function servesInter(source) {
  return source.includes(INTER_FILE);
}

const servers = fixtureServers(E2E_DIR).filter((file) => {
  return servesAPage(read(file));
});

describe("the offline fixtures' servers", () => {
  test("are found where the suites keep them", () => {
    expect(servers.length).toBeGreaterThan(50);
    expect(servers).toContain("ChartTimeZoom/Fixture/server.js");
    expect(servers).toContain("EventOverview/Fixture/server.js");
  });

  test("serve Inter, as production does, unless known not to yet", () => {
    const unlisted = servers.filter((file) => {
      return !servesInter(read(file)) && !KNOWN_WITHOUT_INTER.includes(file);
    });

    expect(unlisted).toEqual([]);
  });

  test("ChartTimeZoom and EventOverview give every element Inter, with the rule index.ejs gives it", () => {
    for (const file of [
      "ChartTimeZoom/Fixture/server.js",
      "EventOverview/Fixture/server.js",
    ]) {
      const source = read(file);

      expect({ file, servesInter: servesInter(source) }).toEqual({
        file,
        servesInter: true,
      });
      // The font face, and index.ejs's own universal rule read from it.
      expect(source).toMatch(/@font-face\{font-family:"Inter"/);
      expect(source).toContain("views/index.ejs");
      expect(source).toContain(`url.pathname === "/fonts/${INTER_FILE}"`);
    }
  });

  test("list only servers that still exist and still serve no Inter: the list only shrinks", () => {
    const stale = KNOWN_WITHOUT_INTER.filter((file) => {
      return !servers.includes(file) || servesInter(read(file));
    });

    expect(stale).toEqual([]);
    expect(new Set(KNOWN_WITHOUT_INTER).size).toBe(KNOWN_WITHOUT_INTER.length);
  });

  test("read the font the Dashboard ships, and index.ejs still gives every element Inter", () => {
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "packages/Common/Server/Static/Vendor/fonts",
          INTER_FILE,
        ),
      ),
    ).toBe(true);

    const index = fs.readFileSync(
      path.join(REPO_ROOT, "packages/App/FeatureSet/Dashboard/views/index.ejs"),
      "utf8",
    );

    expect(index).toMatch(/^\s*\*\s*\{\s*font-family:\s*Inter,/m);
  });
});
