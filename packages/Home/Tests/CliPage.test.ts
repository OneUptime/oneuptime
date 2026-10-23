import {
  CliCommandName,
  CliPackageName,
  CliPageContent,
  CliTerminalStep,
  CliTerminals,
  getCliPageContent,
} from "../Utils/CliPage";
import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  generateLlmsFullTxt,
  generateLlmsTxt,
  generatePageMarkdown,
  generateProductsJson,
} from "../Utils/AIDiscovery";
import {
  ShellWords,
  commandText,
  isPlaceholder,
  readPipeline,
} from "./Helpers/CliCommandLine";
import {
  CliCommand,
  CliInvocation,
  CliManifest,
  CliOption,
  CliProgram,
  CliResource,
  RESOURCE,
  REPOSITORY_ROOT,
  enumValues,
  optionValue,
  outputOption,
  readCliManifest,
  readCliProgram,
  readCliResources,
  readCliSource,
  readInvocation,
} from "./Helpers/CliProgram";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs, { IncluderResult } from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * The website's CLI page (/tool/cli) tells people what to type and shows
 * what the CLI answers. It used to name a package that does not exist
 * (npm install -g oneuptime-cli), a Homebrew tap and a Docker image that do
 * not exist either, and commands the CLI does not have (monitor status,
 * incident acknowledge, --severity, --state, ...). Docs task 29 (#4818)
 * found it while auditing the CLI docs against packages/CLI.
 *
 * So everything the page says to type is held here to the CLI's own
 * sources (Helpers/CliProgram reads its Commander definitions): the package
 * and the command it installs, every command, argument, option and value,
 * and the fields the JSON on the page names. What the page says the CLI
 * does is held to the code that does it, and the page itself is rendered to
 * check it shows exactly those commands and links only to docs pages that
 * exist. packages/CLI/Tests/HomeCliPage.test.ts runs the same commands
 * through the real program and compares what it prints with the
 * transcripts.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const CLI_PAGE_PATH: string = "/tool/cli";
const DOCS_CONTENT: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);
const DATABASE_MODELS: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "Models",
  "DatabaseModels",
);

const TITLE_LIMIT: number = 60;
const DESCRIPTION_LIMIT: number = 160;

// A docs page address: /docs/<category>/<page>[#anchor].
const DOCS_PAGE_LINK: RegExp = /^\/docs\/([a-z0-9-]+)\/([a-z0-9-]+)(?:#(.+))?$/;
const MARKDOWN_HEADING: RegExp = /^#{1,6}\s+(.+)$/;
const CODE_FENCE: RegExp = /^\s*```/;
const WHOLE_NUMBER: RegExp = /^\d+$/;
const CONTINUED_LINE: RegExp = / \\$/;
// What an option's flags say its value is: "--query <json>" gives "json".
const OPTION_VALUE_NAME: RegExp = /<([a-z-]+)>/;
const WHITESPACE_RUN: RegExp = /\s+/g;
// The page's own partial: the others are shared with every page.
const OWN_PARTIAL: string = "./Partials/cli-transcript";

/*
 * What the page used to promise and the CLI does not do, in any of the
 * words the page, its SEO entry or the AI discovery files could put it.
 */
const RETIRED_CLAIMS: ReadonlyArray<RegExp> = [
  // A package, a tap and an image that do not exist.
  /\boneuptime-cli\b/i,
  /\bbrew\b/i,
  /homebrew/i,
  /oneuptime\/tap/i,
  /docker run[^\n]*oneuptime\/cli/i,
  /\bbinar(?:y|ies)\b/i,
  // Things the CLI cannot do.
  /\byaml\b/i,
  /\btail(?:ing|s)?\b/i,
  /\bbulk\b/i,
  /via the browser/i,
  /browser authentication/i,
  /uptime history/i,
  /component status/i,
  /\bjenkins\b/i,
  /everything you can do in the dashboard/i,
  /entire observability stack/i,
  // Commands and flags the CLI does not have.
  /monitor status\b/i,
  /incident (?:acknowledge|resolve)\b/i,
  /--(?:severity|state|title|interval|note)\b/,
];

type NamedStep = [label: string, step: CliTerminalStep];

const page: CliPageContent = getCliPageContent();
const program: CliProgram = readCliProgram();
const resources: Array<CliResource> = readCliResources();
const manifest: CliManifest = readCliManifest();

const TRANSCRIPT_NAMES: ReadonlyArray<keyof CliTerminals> = [
  "overview",
  "monitors",
  "incidents",
];

// Every step of every transcript, labelled "monitors[1]".
const namedSteps: Array<NamedStep> = TRANSCRIPT_NAMES.flatMap(
  (name: keyof CliTerminals): Array<NamedStep> => {
    return page.terminals[name].map(
      (step: CliTerminalStep, index: number): NamedStep => {
        return [`${name}[${index}]`, step];
      },
    );
  },
);

// Every oneuptime command the page shows: the transcripts' and the first three.
const pageCommands: Array<[label: string, text: string]> = [
  ...namedSteps.map((entry: NamedStep): [string, string] => {
    return [entry[0], commandText(entry[1].command)];
  }),
  ["first command: login", page.firstCommands.login],
  ["first command: run", page.firstCommands.run],
];

const resourceNamed: (name: string) => CliResource = (
  name: string,
): CliResource => {
  const resource: CliResource | undefined = resources.find(
    (candidate: CliResource): boolean => {
      return candidate.name === name;
    },
  );

  if (!resource) {
    throw new Error(`The CLI has no resource command ${name}`);
  }

  return resource;
};

const operationsOf: (name: string) => Array<string> = (
  name: string,
): Array<string> => {
  return program.operationsByType[resourceNamed(name).type] || [];
};

// The words of a page command after "oneuptime", for the CLI.
const cliWordsOf: (text: string) => ShellWords = (text: string): ShellWords => {
  const [cli] = readPipeline(text) as [ShellWords, ...Array<ShellWords>];

  expect(cli[0]).toBe(CliCommandName);
  return cli.slice(1);
};

const invocationOf: (text: string) => CliInvocation = (
  text: string,
): CliInvocation => {
  return readInvocation(cliWordsOf(text), program, resources);
};

/*
 * The type a model declares a field with ("public title?: string" gives
 * "string"), or null when it declares no such field.
 */
const declaredType: (modelFile: string, field: string) => string | null = (
  modelFile: string,
  field: string,
): string | null => {
  const declaration: RegExp = new RegExp(
    `public ${escapeRegExp(field)}\\?: ([A-Za-z]+)`,
  );

  return fs.readFileSync(modelFile, "utf8").match(declaration)?.[1] || null;
};

/*
 * The fields JSON on the page names, each with the model it is a field of:
 * a field of a record ("title"), and a field of a record it refers to
 * ("currentIncidentState": {"isResolvedState": false}). An object with a
 * _type is a value the API reads ({"_type": "Search", ...}), not a record.
 */
const undeclaredFields: (
  modelFile: string,
  json: JSONObject,
) => Array<string> = (modelFile: string, json: JSONObject): Array<string> => {
  const missing: Array<string> = [];

  for (const [field, value] of Object.entries(json)) {
    const type: string | null = declaredType(modelFile, field);

    if (!type) {
      missing.push(`${path.basename(modelFile, ".ts")}.${field}`);
      continue;
    }

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !("_type" in value)
    ) {
      const related: string = path.join(DATABASE_MODELS, `${type}.ts`);

      if (!fs.existsSync(related)) {
        missing.push(`${path.basename(modelFile, ".ts")}.${field} (${type})`);
        continue;
      }

      missing.push(...undeclaredFields(related, value as JSONObject));
    }
  }

  return missing;
};

// The anchors of an English docs page: its headings, slugged as the docs do.
const anchorsOfDocsPage: (page: string) => Set<string> = (
  docsPage: string,
): Set<string> => {
  const anchors: Set<string> = new Set();
  let inFence: boolean = false;

  for (const line of fs
    .readFileSync(path.join(DOCS_CONTENT, `${docsPage}.md`), "utf8")
    .split("\n")) {
    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(MARKDOWN_HEADING);

    if (heading) {
      anchors.add(slugifyMarkdownHeading(heading[1] as string));
    }
  }

  return anchors;
};

const seoForTemplate: () => PageSEOData & {
  fullCanonicalUrl: string;
} = (): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(CLI_PAGE_PATH);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

/*
 * The page as Routes.ts renders it: exactly the locals the route hands the
 * template, plus homeUrl, which request middleware puts on res.locals. With
 * ownOnly, every partial the page shares with the rest of the site (the
 * head, nav, logo roll, enterprise and product tables, CTA and footer) is
 * left out, so what is left is what this page says itself.
 */
const renderCliPage: (ownOnly: boolean) => Promise<Document> = async (
  ownOnly: boolean,
): Promise<Document> => {
  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, "cli.ejs"),
    {
      enableGoogleTagManager: false,
      seo: seoForTemplate(),
      cli: getCliPageContent(),
      homeUrl: HOME_URL,
    },
    {
      views: [VIEWS_ROOT],
      ...(ownOnly
        ? {
            includer: (included: string, resolved: string): IncluderResult => {
              return included === OWN_PARTIAL
                ? { filename: resolved }
                : { template: `<!-- ${included} -->` };
            },
          }
        : {}),
    },
  )) as string;

  return new JSDOM(html).window.document;
};

describe("the CLI as its sources define it", () => {
  test("is read from the sources: its commands, options and resources", () => {
    /*
     * The reading itself, held to what the CLI plainly has, so a reading
     * that broke cannot pass every check below by finding nothing.
     */
    const paths: Array<string> = program.commands.map(
      (command: CliCommand): string => {
        return command.path;
      },
    );

    expect(paths).toEqual(
      expect.arrayContaining([
        "login",
        "context list",
        "context use",
        "whoami",
        "resources",
        "version",
        "help",
        `${RESOURCE} list`,
        `${RESOURCE} update`,
        `${RESOURCE} count`,
      ]),
    );
    expect(
      program.globalOptions.map((option: CliOption): string => {
        return option.flags;
      }),
    ).toEqual(
      expect.arrayContaining([
        "--api-key <key>",
        "--url <url>",
        "--context <name>",
        "-o, --output <format>",
        "--no-color",
      ]),
    );
    expect(program.operationsByType["database"]).toEqual([
      "list",
      "get",
      "create",
      "update",
      "delete",
      "count",
    ]);
    expect(program.operationsByType["analytics"]).toEqual([
      "list",
      "create",
      "count",
    ]);
    expect(outputOption().choices).toEqual(enumValues("OutputFormat"));
    expect(outputOption().choices).toEqual(["json", "table", "wide"]);

    for (const [name, type] of [
      ["monitor", "database"],
      ["incident", "database"],
      ["incident-state", "database"],
      ["status-page-announcement", "database"],
      ["log", "analytics"],
    ]) {
      expect(resourceNamed(name as string).type).toBe(type);
    }
  });

  test("refuses what Commander refuses, so a wrong command on the page fails here", () => {
    for (const [words, refusal] of [
      [["monitor", "status", "x"], "has no operation status"],
      [["incident", "acknowledge", "x"], "has no operation acknowledge"],
      [["log", "get", "x"], "has no operation get"],
      [["incident", "list", "--state", "active"], "Unknown option --state"],
      [["monitor", "create", "--query", "{}"], "has no option --query"],
      [["incident", "list", "-o", "yaml"], "takes json, table, wide"],
      [["incident", "update", "x"], "needs --data <json>"],
      [["incident", "get"], "not 0 arguments"],
      [["login", "only-a-key"], "not 1 arguments"],
      [["status"], "No command status"],
    ] as Array<[Array<string>, string]>) {
      expect(() => {
        return readInvocation(words, program, resources);
      }).toThrow(refusal);
    }
  });
});

describe("what the page says to install", () => {
  test("is the package the CLI is published as, and runs the command it installs", () => {
    expect(CliPackageName).toBe(manifest.name);
    expect(Object.keys(manifest.bin)).toEqual([CliCommandName]);
    expect(page.packageName).toBe(manifest.name);
    expect(page.commandName).toBe(CliCommandName);
    expect(page.installCommand).toBe(`npm install -g ${manifest.name}`);
    expect(page.firstCommands.install).toBe(page.installCommand);
    // The release publishes this package (Scripts/NPM/PublishAllPackages.sh).
    expect(
      fs.readFileSync(
        path.join(REPOSITORY_ROOT, "Scripts", "NPM", "PublishAllPackages.sh"),
        "utf8",
      ),
    ).toContain('publish_to_npm "packages/CLI"');
  });

  test("on a self-hosted OneUptime, is the CLI of that OneUptime's version", () => {
    // The CLI is released with OneUptime, under the version in VERSION.
    expect(manifest.version).toBe(
      fs.readFileSync(path.join(REPOSITORY_ROOT, "VERSION"), "utf8").trim(),
    );
    expect(page.selfHostedInstallCommand).toBe(
      `npm install -g ${manifest.name}@<your-oneuptime-version>`,
    );
  });

  test("in Docker, is an image of the reader's own that installs the package and runs the CLI", () => {
    const [from, run, entrypoint] = page.dockerfile as [string, string, string];

    expect(page.dockerfile).toHaveLength(3);
    expect(from).toBe("FROM node:lts-slim");
    expect(run).toBe(`RUN ${page.installCommand}`);
    expect(JSON.parse(entrypoint.replace("ENTRYPOINT ", ""))).toEqual([
      CliCommandName,
    ]);
  });
});

describe("every command on the page", () => {
  test("covers the transcripts and the first commands", () => {
    // An empty list would pass every check below without checking a thing.
    expect(namedSteps.length).toBeGreaterThanOrEqual(6);
    expect(pageCommands.length).toBe(namedSteps.length + 2);
  });

  test.each(pageCommands)(
    "%s is a command the CLI has, with arguments and options it takes",
    (_label: string, text: string) => {
      const invocation: CliInvocation = invocationOf(text);

      for (const given of invocation.options) {
        // What the option's flags say it takes: <json>, <n>, <path>, ...
        const placeholder: string | undefined =
          given.option.flags.match(OPTION_VALUE_NAME)?.[1];

        if (placeholder === "json") {
          const value: JSONValue = JSON.parse(given.value as string);

          expect([given.name, Array.isArray(value), typeof value]).toEqual([
            given.name,
            false,
            "object",
          ]);
        }

        if (placeholder === "n") {
          expect([
            given.name,
            WHOLE_NUMBER.test(given.value as string),
          ]).toEqual([given.name, true]);
        }
      }

      if (invocation.command.path === `${RESOURCE} create`) {
        // The CLI refuses a create with neither.
        expect(
          optionValue(invocation, "--data") !== null ||
            optionValue(invocation, "--file") !== null,
        ).toBe(true);
      }
    },
  );

  test.each(pageCommands)(
    "%s names only fields its records have",
    (_label: string, text: string) => {
      const invocation: CliInvocation = invocationOf(text);

      for (const name of ["--data", "--query", "--sort"]) {
        const value: string | null = optionValue(invocation, name);

        if (value === null) {
          continue;
        }

        expect(invocation.resource).not.toBeNull();

        /*
         * Telemetry declares its columns in a list, not as fields: the CLI's
         * own suite (HomeCliPage) checks those against the real models.
         */
        if (invocation.resource?.type !== "database") {
          continue;
        }

        expect([
          name,
          undeclaredFields(
            (invocation.resource as CliResource).modelFile,
            JSON.parse(value) as JSONObject,
          ),
        ]).toEqual([name, []]);
      }
    },
  );

  test.each(pageCommands)(
    "%s pipes only to jq, and writes JSON when it does",
    (_label: string, text: string) => {
      const pipeline: Array<ShellWords> = readPipeline(text);

      for (const next of pipeline.slice(1)) {
        expect(next[0]).toBe("jq");
      }

      if (pipeline.length > 1) {
        /*
         * The CLI writes JSON to a pipe anyway, but the page writes -o json
         * as the docs tell scripts to, so it shows the reliable form.
         */
        expect(optionValue(invocationOf(text), "--output")).toBe("json");
      }
    },
  );

  test("leaves no placeholder where the CLI needs a real value, except the ones a reader fills in", () => {
    const filledIn: Array<string> = [];

    for (const [, text] of pageCommands) {
      for (const word of cliWordsOf(text)) {
        if (isPlaceholder(word)) {
          filledIn.push(word);
        }
      }
    }

    // The two the docs write the same way: oneuptime login <api-key> <instance-url>.
    expect(filledIn).toEqual(["<api-key>", "<instance-url>"]);
  });
});

describe("the transcripts", () => {
  test.each(namedSteps)(
    "%s is typed as a shell reads it: each line but the last continues with a backslash",
    (_label: string, step: CliTerminalStep) => {
      step.command.forEach((line: string, index: number) => {
        const isLast: boolean = index === step.command.length - 1;

        expect([line, CONTINUED_LINE.test(line)]).toEqual([line, !isLast]);
      });
      expect(step.command[0]?.startsWith(`${CliCommandName} `)).toBe(true);
    },
  );

  test("tell one story: the monitors listed are the monitors counted, and the incident resolved is the one listed open", () => {
    const [created, listed, counted] = page.terminals.monitors as [
      CliTerminalStep,
      CliTerminalStep,
      CliTerminalStep,
    ];

    expect(listed.output[0]).toBe("Checkout API");
    expect(created.output).toHaveLength(1);
    expect(counted.output).toEqual([String(listed.output.length)]);
    // The hero lists the same monitors before Checkout API was created.
    expect((page.terminals.overview[0] as CliTerminalStep).output).toEqual(
      listed.output.slice(1),
    );

    const [open, resolve, stillOpen] = page.terminals.incidents as [
      CliTerminalStep,
      CliTerminalStep,
      CliTerminalStep,
    ];
    const openIncidentId: string = (open.output[0] as string).split(" ")[0]!;

    expect(invocationOf(commandText(resolve.command)).arguments).toEqual([
      openIncidentId,
    ]);
    expect(open.output).toHaveLength(1);
    expect(stillOpen.output).toEqual(["0"]);
    // The query that found it open is the one that counts none left.
    expect(
      optionValue(invocationOf(commandText(stillOpen.command)), "--query"),
    ).toBe(optionValue(invocationOf(commandText(open.command)), "--query"));
    expect((page.terminals.overview[1] as CliTerminalStep).output).toEqual([
      (open.output[0] as string).slice(openIncidentId.length + 1),
    ]);
  });
});

describe("the rendered page", () => {
  let document: Document;
  let main: Element;
  // The page's own words: main without the partials every page shares.
  let own: Element;

  beforeAll(async () => {
    document = await renderCliPage(false);
    main = document.querySelector("main") as Element;
    own = (await renderCliPage(true)).querySelector("main") as Element;
  });

  test("is rendered by the route with the page's content", () => {
    const routes: string = fs.readFileSync(
      path.join(__dirname, "..", "Routes.ts"),
      "utf8",
    );
    const start: number = routes.indexOf(`app.get("${CLI_PAGE_PATH}"`);
    const route: string = routes.slice(
      start,
      routes.indexOf("app.get(", start + 1),
    );

    expect(start).toBeGreaterThan(-1);
    expect(route).toContain("cli: getCliPageContent(),");
    expect(main).not.toBeNull();
    expect(own.textContent).toContain("Power users love the terminal");
    // The shared product index is on the page, and not in its own words.
    expect(main.textContent).toContain("Every product, built in.");
    expect(own.textContent).not.toContain("Every product, built in.");
    expect(document.querySelector("h1")?.textContent?.trim()).toBe(
      "Observability from your terminal",
    );
  });

  test.each(TRANSCRIPT_NAMES as Array<keyof CliTerminals>)(
    "shows the %s transcript line for line, a prompt before each command",
    (name: keyof CliTerminals) => {
      const transcript: Element | null = main.querySelector(
        `[data-cli-transcript="${name}"]`,
      );
      const steps: Array<Element> = Array.from(
        transcript?.querySelectorAll("[data-cli-step]") || [],
      );

      expect(steps).toHaveLength(page.terminals[name].length);

      page.terminals[name].forEach((step: CliTerminalStep, index: number) => {
        const shown: Element = steps[index] as Element;
        const commandLines: Array<string> = Array.from(
          shown.querySelectorAll("[data-cli-command-line]"),
        ).map((line: Element): string => {
          return line.textContent || "";
        });
        const prompts: Array<Element> = Array.from(
          shown.querySelectorAll("[data-cli-prompt]"),
        );

        expect(commandLines).toEqual(
          step.command.map((line: string, lineIndex: number): string => {
            return lineIndex === 0 ? `$ ${line}` : line;
          }),
        );
        // One prompt, on the first line, and not copied with the command.
        expect(prompts).toHaveLength(1);
        expect(prompts[0]?.classList.contains("select-none")).toBe(true);
        expect(
          Array.from(shown.querySelectorAll("[data-cli-output-line]")).map(
            (line: Element): string => {
              return line.textContent || "";
            },
          ),
        ).toEqual(step.output);
      });
    },
  );

  test("writes every line of code in the monospace font, on the element that holds it", () => {
    /*
     * head-basic.ejs sets the site's font on every element (*), so a
     * parent's font-mono is not inherited: the transcripts used to render
     * in Geist.
     */
    const code: Array<Element> = Array.from(
      main.querySelectorAll(
        "[data-cli-command-line], [data-cli-prompt], [data-cli-output-line], [data-cli-first-command], [data-cli-install]",
      ),
    );

    expect(code.length).toBeGreaterThan(30);

    for (const element of code) {
      expect([
        element.textContent,
        element.classList.contains("font-mono"),
      ]).toEqual([element.textContent, true]);
    }
  });

  test("shows the install commands and the first three commands from the page's content", () => {
    const shown: (selector: string) => string = (selector: string): string => {
      return main.querySelector(selector)?.textContent || "";
    };

    expect(shown('[data-cli-first-command="install"]')).toBe(
      page.firstCommands.install,
    );
    expect(shown('[data-cli-first-command="login"]')).toBe(
      page.firstCommands.login,
    );
    expect(shown('[data-cli-first-command="run"]')).toBe(
      page.firstCommands.run,
    );
    expect(shown('[data-cli-install="npm"]')).toBe(page.installCommand);
    expect(shown('[data-cli-install="self-hosted"]')).toBe(
      page.selfHostedInstallCommand,
    );
    expect(shown('[data-cli-install="docker"]')).toBe(
      page.dockerfile.join("\n"),
    );
  });

  test("links to docs pages that exist, at headings they have", () => {
    const links: Array<string> = Array.from(
      own.querySelectorAll('a[href^="/docs"]'),
    ).map((link: Element): string => {
      return link.getAttribute("href") || "";
    });

    expect(links).toEqual([
      "/docs/cli/index",
      "/docs/cli/resource-operations",
      "/docs/cli/resource-operations#update-a-record",
      "/docs/cli/index#install-the-cli",
      "/docs/cli/scripting",
      "/docs/cli/command-reference",
    ]);

    for (const link of links) {
      const parts: RegExpMatchArray | null = link.match(DOCS_PAGE_LINK);

      // /docs/cli, one segment, is not a docs page: the docs answer 404.
      expect([link, parts !== null]).toEqual([link, true]);

      const docsPage: string = `${parts![1]}/${parts![2]}`;

      expect([
        link,
        fs.existsSync(path.join(DOCS_CONTENT, `${docsPage}.md`)),
      ]).toEqual([link, true]);

      if (parts![3]) {
        expect([link, anchorsOfDocsPage(docsPage).has(parts![3])]).toEqual([
          link,
          true,
        ]);
      }
    }
  });

  test("keeps the incident feature's text before its terminal on a phone", () => {
    /*
     * The feature puts its terminal first in the markup and orders it after
     * the text with order-2. Order applies only to the children of a flex or
     * grid box, and the box was a grid from lg up only, so on a phone the
     * terminal came first and ran into the heading below it.
     */
    const heading: Element = Array.from(main.querySelectorAll("h3")).find(
      (candidate: Element): boolean => {
        return candidate.textContent?.trim() === "Respond to Incidents Faster";
      },
    ) as Element;
    const feature: Element = main
      .querySelector('[data-cli-transcript="incidents"]')!
      .closest(".lg\\:grid") as Element;
    const [terminalSide, textSide] = Array.from(feature.children) as [
      Element,
      Element,
    ];

    expect(feature.classList.contains("flex")).toBe(true);
    expect(feature.classList.contains("flex-col")).toBe(true);
    expect(
      terminalSide.querySelector('[data-cli-transcript="incidents"]'),
    ).not.toBeNull();
    expect(terminalSide.classList.contains("order-2")).toBe(true);
    expect(textSide.contains(heading)).toBe(true);
    expect(textSide.classList.contains("order-1")).toBe(true);
  });

  test("promises nothing the CLI does not do", () => {
    const text: string = own.textContent || "";

    for (const claim of RETIRED_CLAIMS) {
      expect([claim.source, claim.test(text)]).toEqual([claim.source, false]);
    }
  });

  test("carries the SEO entry's features in its structured data", () => {
    const schemas: Array<JSONObject> = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map((script: Element): JSONObject => {
      return JSON.parse(script.textContent || "{}") as JSONObject;
    });
    const application: JSONObject | undefined = schemas.find(
      (schema: JSONObject): boolean => {
        return schema["@type"] === "SoftwareApplication";
      },
    );

    expect(application?.["name"]).toBe("OneUptime CLI");
    expect(application?.["featureList"]).toEqual(
      PageSEOConfig[CLI_PAGE_PATH]!.softwareApplication!.features,
    );
  });
});

describe("what the page says the CLI does", () => {
  let pageText: string;

  beforeAll(async () => {
    pageText = (
      (await renderCliPage(true)).querySelector("main")?.textContent || ""
    ).replace(WHITESPACE_RUN, " ");
  });

  /*
   * Each claim, as the page words it, with the commands that make it true.
   * A claim the page drops, or a command the CLI drops, fails its row.
   */
  test.each([
    ["Read each monitor's status history", "monitor-status-event", ["list"]],
    ["Add internal and public notes", "incident-internal-note", ["create"]],
    ["Add internal and public notes", "incident-public-note", ["create"]],
    ["post status page announcements", "status-page-announcement", ["create"]],
    ["Manage status pages", "status-page", ["list", "update"]],
    [
      "List and count logs, spans, metrics and exceptions",
      "log",
      ["list", "count"],
    ],
    [
      "List and count logs, spans, metrics and exceptions",
      "span",
      ["list", "count"],
    ],
    [
      "List and count logs, spans, metrics and exceptions",
      "metric",
      ["list", "count"],
    ],
    [
      "List and count logs, spans, metrics and exceptions",
      "exception-instance",
      ["list", "count"],
    ],
    ["on-call policies, teams", "on-call-policy", ["list"]],
    ["on-call policies, teams", "team", ["list"]],
    ["monitors, incidents, alerts, status pages", "alert", ["list"]],
    ["change their severity", "incident", ["update"]],
    [
      "Create, list, update and delete monitors",
      "monitor",
      ["create", "list", "update", "delete"],
    ],
  ] as Array<[string, string, Array<string>]>)(
    "'%s' is the CLI's %s command",
    (claim: string, resource: string, operations: Array<string>) => {
      expect(pageText).toContain(claim);
      expect(operationsOf(resource)).toEqual(
        expect.arrayContaining(operations),
      );
    },
  );

  test("acknowledging and resolving is changing the incident's state, which goes on its timeline", () => {
    const service: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "Common",
        "Server",
        "Services",
        "IncidentService.ts",
      ),
      "utf8",
    );
    const onUpdateSuccess: string = service.slice(
      service.indexOf("protected override async onUpdateSuccess("),
    );
    const changeIncidentState: string = service.slice(
      service.indexOf("public async changeIncidentState("),
    );

    expect(pageText).toContain("Acknowledge and resolve them");
    expect(pageText).toContain(
      "A state you set from the CLI is recorded on the incident's timeline, as it is from the dashboard.",
    );
    expect(
      declaredType(
        path.join(DATABASE_MODELS, "Incident.ts"),
        "currentIncidentStateId",
      ),
    ).toBe("ObjectID");
    for (const field of ["isAcknowledgedState", "isResolvedState"]) {
      expect(
        declaredType(path.join(DATABASE_MODELS, "IncidentState.ts"), field),
      ).toBe("boolean");
    }
    // An update that writes the state runs the state change the dashboard runs.
    expect(onUpdateSuccess).toContain("await this.changeIncidentState({");
    expect(changeIncidentState).toContain(
      "IncidentStateTimelineService.create(",
    );
  });

  test("filters, sorts and pages lists, with JSON for the filter", () => {
    const list: CliCommand = program.commands.find(
      (command: CliCommand): boolean => {
        return command.path === `${RESOURCE} list`;
      },
    )!;

    expect(pageText).toContain("Filter, sort and page through them");
    expect(pageText).toContain("with a JSON filter");
    expect(
      list.options.map((option: CliOption): string => {
        return option.flags;
      }),
    ).toEqual(
      expect.arrayContaining([
        "--query <json>",
        "--sort <json>",
        "--limit <n>",
        "--skip <n>",
      ]),
    );
  });

  test("reads its API key from environment variables, and tells a job what happened with its exit code", () => {
    const configManager: string = readCliSource("Core/ConfigManager.ts");
    const errorHandler: string = readCliSource("Core/ErrorHandler.ts");

    expect(pageText).toContain(
      "It reads its API key from environment variables, and its exit codes tell the job what happened.",
    );
    expect(configManager).toContain('process.env["ONEUPTIME_API_KEY"]');
    expect(configManager).toContain('process.env["ONEUPTIME_URL"]');
    for (const member of [
      "Success = 0",
      "GeneralError = 1",
      "AuthError = 2",
      "NotFound = 3",
    ]) {
      expect(errorHandler).toContain(member);
    }
  });

  test("prints tables in a terminal and JSON when piped", () => {
    expect(pageText).toContain("Tables in a terminal, JSON when piped.");
    expect(readCliSource("Core/OutputFormatter.ts")).toContain(
      "// If stdout is not a TTY (piped), default to JSON\n  if (!process.stdout.isTTY) {\n    return OutputFormat.JSON;\n  }\n\n  return OutputFormat.Table;",
    );
  });

  test("logs in with an API key and saves it for the commands that follow", () => {
    const login: CliCommand = program.commands.find(
      (command: CliCommand): boolean => {
        return command.path === "login";
      },
    )!;

    expect(pageText).toContain(
      "Log in with an API key of your project. The CLI saves it for the commands that follow.",
    );
    expect(login.arguments).toEqual(["<api-key>", "<instance-url>"]);
    expect(readCliSource("Commands/ConfigCommands.ts")).toContain(
      "ConfigManager.addContext(context);\n          ConfigManager.setCurrentContext(context.name);",
    );
  });
});

describe("the page's SEO entry and what it feeds", () => {
  const seo: PageSEOData = PageSEOConfig[CLI_PAGE_PATH]!;
  const features: Array<string> = seo.softwareApplication!.features;

  test("fits in a search result", () => {
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(seo.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(seo.canonicalPath).toBe(CLI_PAGE_PATH);
    expect(seo.pageType).toBe("product");
  });

  test("promises nothing the CLI does not do", () => {
    const copy: string = [
      seo.title,
      seo.description,
      seo.softwareApplication!.description,
      ...features,
    ].join("\n");

    for (const claim of RETIRED_CLAIMS) {
      expect([claim.source, claim.test(copy)]).toEqual([claim.source, false]);
    }
  });

  test("names the package to install", () => {
    expect(features).toContain(`Install from npm: ${manifest.name}`);
    expect(seo.description).toContain("Install it from npm");
  });

  test("goes out the same in llms.txt, llms-full.txt, the page's Markdown and products.json", () => {
    const markdown: string = generatePageMarkdown(
      getPageSEO(CLI_PAGE_PATH),
      HOME_URL,
    );
    const llmsFull: string = generateLlmsFullTxt(HOME_URL, []);
    const llms: string = generateLlmsTxt(HOME_URL, []);
    const product: JSONObject | undefined = (
      generateProductsJson(HOME_URL)["products"] as Array<JSONObject>
    ).find((entry: JSONObject): boolean => {
      return entry["name"] === "OneUptime CLI";
    });

    expect(product?.["features"]).toEqual(features);
    expect(product?.["description"]).toBe(seo.description);
    // The page's line of llms.txt, whole.
    expect(
      llms.split("\n").find((line: string): boolean => {
        return line.startsWith("- [OneUptime CLI](");
      }),
    ).toBe(
      `- [OneUptime CLI](${HOME_URL}${CLI_PAGE_PATH}.md): ${seo.description}`,
    );

    for (const feature of features) {
      expect(markdown).toContain(`- ${feature}`);
      expect(llmsFull).toContain(`- ${feature}`);
    }

    for (const claim of RETIRED_CLAIMS) {
      expect([claim.source, claim.test(markdown)]).toEqual([
        claim.source,
        false,
      ]);
    }
  });
});
