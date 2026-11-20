/*
 * Says which of the Crossplane provider's pins are behind their newest
 * compatible release (Core/Pins.ts says what that means), from the Go
 * module proxy, the Crossplane chart repository and GitHub's releases:
 *
 *   npm run check-crossplane-provider-pins
 *   npm run check-crossplane-provider-pins -- --keep-issue
 *
 * --keep-issue keeps the one issue that lists them, as the weekly Crossplane
 * Provider Pins workflow runs it (GH_TOKEN and GH_REPO set): opens it when
 * something is behind, rewrites it while it is open, closes it, saying so,
 * once nothing is. It never fails for a pin that is behind: the issue says
 * so; it fails when the releases cannot be read.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { UPJET_MODULE } from "./Core/GoModule";
import {
  findStalePins,
  IssueAction,
  newestRelease,
  parseGoMod,
  Pins,
  PINS_ISSUE_LABELS,
  PINS_ISSUE_TITLE,
  pinsIssueAction,
  readPins,
  Releases,
  renderPinsIssue,
  StalePin,
} from "./Core/Pins";

const GO_PROXY: string = "https://proxy.golang.org";
const CROSSPLANE_CHARTS: string =
  "https://charts.crossplane.io/stable/index.yaml";
const CROSSPLANE_CLI_RELEASE: string =
  "https://api.github.com/repos/crossplane/cli/releases/latest";
const KIND_RELEASE: string =
  "https://api.github.com/repos/kubernetes-sigs/kind/releases/latest";

async function fetchText(url: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token: string | undefined = process.env["GH_TOKEN"];

  if (url.startsWith("https://api.github.com/") && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response: Response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}.`);
  }

  return await response.text();
}

// A module path as the proxy takes it: capitals as ! and the letter.
function proxyPath(module: string): string {
  return module.replace(/[A-Z]/g, (letter: string): string => {
    return `!${letter.toLowerCase()}`;
  });
}

async function fetchReleases(pins: Pins): Promise<Releases> {
  const moduleVersions: Record<string, Array<string>> = {};
  const moduleLatest: Record<string, string> = {};

  for (const pin of pins.modules) {
    moduleVersions[pin.module] = (
      await fetchText(`${GO_PROXY}/${proxyPath(pin.module)}/@v/list`)
    )
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      })
      .filter(Boolean);
    moduleLatest[pin.module] = (
      JSON.parse(
        await fetchText(`${GO_PROXY}/${proxyPath(pin.module)}/@latest`),
      ) as { Version: string }
    ).Version;
  }

  const upjet: string | null = newestRelease(
    moduleVersions[UPJET_MODULE] || [],
  );

  if (!upjet) {
    throw new Error(`The Go proxy lists no release of ${UPJET_MODULE}.`);
  }

  const charts: string = await fetchText(CROSSPLANE_CHARTS);

  return {
    moduleVersions,
    moduleLatest,
    upjetGoMod: parseGoMod(
      await fetchText(`${GO_PROXY}/${proxyPath(UPJET_MODULE)}/@v/${upjet}.mod`),
    ),
    crossplaneChartVersions: Array.from(
      charts.matchAll(/^\s+version:\s*"?([^\s"]+)"?\s*$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    }),
    crossplaneCliLatest: (
      JSON.parse(await fetchText(CROSSPLANE_CLI_RELEASE)) as {
        tag_name: string;
      }
    ).tag_name,
    kindLatest: (
      JSON.parse(await fetchText(KIND_RELEASE)) as { tag_name: string }
    ).tag_name,
  };
}

// `gh` with its arguments, its standard output back.
export type Gh = (args: Array<string>) => string;

// The open issue with exactly the title, or null.
export function findOpenPinsIssue(gh: Gh): number | null {
  const listed: Array<{ number: number; title: string }> = JSON.parse(
    gh([
      "issue",
      "list",
      "--state",
      "open",
      "--search",
      `"${PINS_ISSUE_TITLE}" in:title`,
      "--json",
      "number,title",
      "--limit",
      "20",
    ]) || "[]",
  );
  const issue: { number: number } | undefined = listed.find(
    (candidate: { title: string }): boolean => {
      return candidate.title === PINS_ISSUE_TITLE;
    },
  );

  return issue ? issue.number : null;
}

export function keepPinsIssue(data: {
  stale: Array<StalePin>;
  gh: Gh;
  bodyFile: string;
}): { action: IssueAction; openIssue: number | null } {
  const openIssue: number | null = findOpenPinsIssue(data.gh);
  const action: IssueAction = pinsIssueAction(openIssue, data.stale);

  if (action === "create") {
    data.gh([
      "issue",
      "create",
      "--title",
      PINS_ISSUE_TITLE,
      "--body-file",
      data.bodyFile,
      ...PINS_ISSUE_LABELS.flatMap((label: string): Array<string> => {
        return ["--label", label];
      }),
    ]);
  } else if (action === "update") {
    data.gh(["issue", "edit", String(openIssue), "--body-file", data.bodyFile]);
  } else if (action === "close") {
    data.gh([
      "issue",
      "close",
      String(openIssue),
      "--comment",
      "Every pin of the Crossplane provider is at its newest compatible release again.",
    ]);
  }

  return { action, openIssue };
}

/*
 * It prints with console, as the scripts in Scripts/Docs do: it runs with
 * nothing but Node.js and the root's packages, and Common's Logger needs
 * Common's.
 */
/* eslint-disable no-console */
async function main(): Promise<void> {
  const pins: Pins = readPins();
  const stale: Array<StalePin> = findStalePins(pins, await fetchReleases(pins));

  if (stale.length === 0) {
    console.log("Every pin is at its newest compatible release.");
  } else {
    for (const pin of stale) {
      console.log(`${pin.name}: ${pin.pinned} -> ${pin.newest} (${pin.where})`);
    }
  }

  if (!process.argv.includes("--keep-issue")) {
    return;
  }

  const runUrl: string | undefined =
    process.env["GITHUB_SERVER_URL"] &&
    process.env["GITHUB_REPOSITORY"] &&
    process.env["GITHUB_RUN_ID"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}/actions/runs/${process.env["GITHUB_RUN_ID"]}`
      : undefined;
  const bodyFile: string = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "crossplane-pins-")),
    "issue.md",
  );

  fs.writeFileSync(bodyFile, renderPinsIssue(stale, runUrl));

  const result: { action: IssueAction; openIssue: number | null } =
    keepPinsIssue({
      stale,
      bodyFile,
      gh: (args: Array<string>): string => {
        return execFileSync("gh", args, { encoding: "utf8" });
      },
    });

  console.log(
    `Pins issue: ${result.action}${result.openIssue ? ` (#${result.openIssue})` : ""}.`,
  );
}

if (require.main === module) {
  main().catch((error: Error): void => {
    console.error(error.message);
    process.exit(1);
  });
}
