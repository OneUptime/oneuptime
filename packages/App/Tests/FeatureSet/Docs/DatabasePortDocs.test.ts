import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about PostgreSQL's port and password on Docker Compose,
 * held to the compose files, the backup scripts and npm start:
 *
 *   - the Docker Compose guide says PostgreSQL's port 5400 is published on
 *     127.0.0.1 only (docker-compose.yml), reached there by npm run backup
 *     and restore.sh, and from another machine through an SSH tunnel to
 *     that address, or a private address a docker-compose.override.yml adds
 *     - which Compose reads when npm start runs it;
 *   - its Change the database password section is where npm start's
 *     warning points (Scripts/Install/GenerateDatabasePassword.js), and its
 *     commands name the compose service and the config.env settings that
 *     exist; ComposeDatabaseRuntime (Tests/Ops) runs them for real;
 *   - the upgrade note (installation/upgrading, "Other changes in 14") sits
 *     after the note on the header ONEUPTIME_SECRET travels in and before the
 *     note on the bundled Runner, says the same, and links to those two
 *     sections - in
 *     every language at that language's own headings;
 *   - every translation carries the guide's sections and the note in the
 *     English places, worded its own way, with the English commands and code.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const COMPOSE_PAGE: string = "installation/docker-compose";
const COMPOSE_DOCS_PATH: string = "/docs/installation/docker-compose";

const CHECKLIST_HEADING: string = "## Production checklist";
const CHANGE_HEADING: string = "### Change the database password";
const BACKUP_HEADING: string = "## Back up and restore";
const OVERRIDE_DETAILS: string =
  ":::details Publish PostgreSQL on a private network address";
const TUNNEL_SENTENCE: string =
  "Only the server itself reaches PostgreSQL: it answers on port 5400 of `127.0.0.1`. To back it up from another machine, open an SSH tunnel from that machine, then connect to its own port 5400:";

/*
 * One && chain, so config.env takes the new password only once PostgreSQL
 * has: a PostgreSQL that is not running, or a failed openssl, leaves both as
 * they were. npm start then runs either way.
 */
const CHANGE_COMMANDS: Array<string> = [
  "NEW_PASSWORD=$(openssl rand -hex 32) &&",
  `  echo "ALTER USER CURRENT_USER PASSWORD '$NEW_PASSWORD';" | sh Scripts/Install/WithConfig.sh sh -c 'docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DATABASE_USERNAME" -d "$DATABASE_NAME"' &&`,
  `  sed -i "s/^DATABASE_PASSWORD=.*/DATABASE_PASSWORD=$NEW_PASSWORD/" config.env`,
  "npm start",
];
const SSH_TUNNEL: string =
  "ssh -N -L 5400:127.0.0.1:5400 you@oneuptime.example.com";
const OVERRIDE_EXAMPLE: Array<string> = [
  "services:",
  "  postgres:",
  "    ports:",
  '      - "10.0.0.5:5401:5432"',
];

const NOTE_LEAD: string =
  "**PostgreSQL answers only on the server itself, and a new install starts with a database password of its own.**";
// The note before it (ClusterKeyHeaderUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**OneUptime's own services send `ONEUPTIME_SECRET` in a header, and only to the routes that take it.**";
// The note after it (SharedRunnerUpgradeDocs).
const NEXT_LEAD: string =
  "**The bundled Runner no longer runs a repository's commands, and holds only what it needs.**";

const HEADING_LINE: RegExp = /^#{1,6}\s/;
const HEADING_MARKER: RegExp = /^#+\s+/;
const FENCE_LINE: RegExp = /^\s*```/;
/*
 * A link's target. The target may hold neither bracket, so each try stops at
 * the next "]" and the scan stays linear.
 */
const LINK_TARGET: RegExp = /\]\(([^()[\]\s]+)\)/g;
/*
 * The docs address the script's warning names: the value it gives
 * CHANGE_PASSWORD_DOCS_URL, parsed below as a URL.
 */
const SCRIPT_DOCS_URL: RegExp = /CHANGE_PASSWORD_DOCS_URL =\s*"([^"]+)"/;
const SSH_FORWARD: RegExp = /-L (\d+):([\d.]+):(\d+) /;
const OVERRIDE_PORT: RegExp = /^ {6}- "(\d+)\.\d+\.\d+\.\d+:(\d+):(\d+)"$/;
const COMPOSE_PORT: RegExp = /^([\d.]+):(\d+):(\d+)$/;
// docker-compose.yml's PostgreSQL port, which config.env can move.
const PUBLISHED_PORT_ENTRY: string =
  "127.0.0.1:${DATABASE_PUBLISHED_PORT:-5400}:5432";
// A Compose interpolation with a default, read as its default.
const INTERPOLATION_WITH_DEFAULT: RegExp = /\$\{[A-Z][A-Z0-9_]*:-([^}]*)\}/g;
const CONFIG_KEY: RegExp = /^([A-Z][A-Z0-9_]*)=/;
const SETTING_IN_COMMAND: RegExp = /\$([A-Z][A-Z0-9_]+)/g;
const GENERATE_STEP: string =
  "node ./Scripts/Install/GenerateDatabasePassword.js";
// One `node ./Scripts/Install/<Name>.js` command of an npm script.
const INSTALL_STEP: RegExp = /^node \.\/Scripts\/Install\/[\w.-]+\.js$/;

function isConfigWrite(command: string): boolean {
  return command.trim().startsWith("sed -i ");
}

function isPasswordChange(command: string): boolean {
  return command.includes("ALTER USER");
}

function endsTheChainLink(command: string): boolean {
  return command.endsWith(" &&");
}

/*
 * The install steps npm start's script runs before it reads config.env and
 * starts Compose: the step that gives a new install its password is one.
 */
function leadingInstallSteps(start: string): Array<string> {
  const commands: Array<string> = start.split(" && ");
  const firstOther: number = commands.findIndex((command: string): boolean => {
    return !INSTALL_STEP.test(command);
  });

  return commands.slice(0, firstOther);
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: { load: (text: string) => unknown } = require(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

interface ComposeFile {
  services: Record<string, { ports?: Array<string> }>;
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function lines(markdown: string): Array<string> {
  return markdown.split("\n");
}

const ENGLISH_GUIDE: string = readPage("en", COMPOSE_PAGE);

// The headings of a page, in order, outside code blocks, as written.
function headings(markdown: string): Array<string> {
  const found: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines(markdown)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && HEADING_LINE.test(line)) {
      found.push(line.trim());
    }
  }

  return found;
}

// A language's heading in the place the English heading has, and its anchor.
function headingIn(
  language: string,
  englishHeading: string,
): { heading: string; anchor: string } {
  const index: number = headings(ENGLISH_GUIDE).indexOf(englishHeading);

  expect(index).toBeGreaterThan(-1);

  const heading: string =
    headings(readPage(language, COMPOSE_PAGE))[index] || "";

  expect({ language, englishHeading, found: heading !== "" }).toEqual({
    language,
    englishHeading,
    found: true,
  });

  return {
    heading,
    anchor: slugifyMarkdownHeading(heading.replace(HEADING_MARKER, "")),
  };
}

// A page's ":::details" lines, in order.
function detailsLines(markdown: string): Array<string> {
  return lines(markdown).filter((line: string): boolean => {
    return line.startsWith(":::details ");
  });
}

// A language's private-address details line, in the English one's place.
function detailsLineIn(language: string): string {
  const index: number = detailsLines(ENGLISH_GUIDE).indexOf(OVERRIDE_DETAILS);

  expect(index).toBeGreaterThan(-1);
  return detailsLines(readPage(language, COMPOSE_PAGE))[index] || "";
}

// The first fenced block of `info` after the line `from`, as its lines.
function blockAfter(
  markdown: string,
  from: string,
  info: string,
): Array<string> {
  const all: Array<string> = lines(markdown);
  const start: number = all.indexOf(from);

  expect({ from, found: start > -1 }).toEqual({ from, found: true });

  const open: number = all.indexOf(`\`\`\`${info}`, start);
  const close: number = all.indexOf("```", open + 1);

  expect(open).toBeGreaterThan(start);
  return all.slice(open + 1, close);
}

function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_TARGET)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function configKeys(): Set<string> {
  const keys: Set<string> = new Set<string>();

  for (const line of lines(source("config.example.env"))) {
    const match: RegExpExecArray | null = CONFIG_KEY.exec(line);

    if (match) {
      keys.add(match[1] as string);
    }
  }

  return keys;
}

// A compose file's services, and the postgres service's port entries.
function composeFacts(relativePath: string): {
  services: Array<string>;
  postgresPorts: Array<string>;
} {
  const compose: ComposeFile = jsYaml.load(source(relativePath)) as ComposeFile;

  return {
    services: Object.keys(compose.services),
    // As Compose renders them with config.example.env, which leaves the defaults.
    postgresPorts: (compose.services["postgres"]?.ports || []).map(
      (entry: string): string => {
        return entry.replace(INTERPOLATION_WITH_DEFAULT, "$1");
      },
    ),
  };
}

function rootScripts(): Record<string, string> {
  return (
    JSON.parse(source("package.json")) as { scripts: Record<string, string> }
  ).scripts;
}

function changeAnchor(): string {
  return `#${slugifyMarkdownHeading(CHANGE_HEADING.replace(HEADING_MARKER, ""))}`;
}

describe("the Docker Compose guide on PostgreSQL's port", () => {
  const compose: { services: Array<string>; postgresPorts: Array<string> } =
    composeFacts("docker-compose.yml");

  it("matches docker-compose.yml: port 5400, on 127.0.0.1 only, moved by DATABASE_PUBLISHED_PORT", () => {
    expect(compose.postgresPorts).toEqual(["127.0.0.1:5400:5432"]);
    expect(source("docker-compose.yml")).toContain(`"${PUBLISHED_PORT_ENTRY}"`);
    expect(configKeys().has("DATABASE_PUBLISHED_PORT")).toBe(true);
    expect(ENGLISH_GUIDE).toContain(
      "| 5400 | `postgres` | `DATABASE_PUBLISHED_PORT` | Lets `npm run backup` and `restore.sh` reach PostgreSQL from the server itself. It is published on `127.0.0.1` only. |",
    );
    expect(ENGLISH_GUIDE).toContain(
      "OneUptime publishes PostgreSQL's port 5400 on `127.0.0.1` only.",
    );
    expect(ENGLISH_GUIDE).not.toContain("Keep it closed to the internet.");
  });

  it("sends another machine through an SSH tunnel to the address and port docker-compose.yml publishes", () => {
    const tunnel: Array<string> = blockAfter(
      ENGLISH_GUIDE,
      TUNNEL_SENTENCE,
      "bash",
    );
    const forward: RegExpExecArray | null = SSH_FORWARD.exec(tunnel[0] || "");
    const published: RegExpExecArray | null = COMPOSE_PORT.exec(
      compose.postgresPorts[0] || "",
    );

    expect(tunnel).toEqual([SSH_TUNNEL]);
    expect(forward).not.toBeNull();
    expect(published).not.toBeNull();
    // The far end of the tunnel is the published address and port.
    expect(`${forward![2]}:${forward![3]}`).toBe(
      `${published![1]}:${published![2]}`,
    );
    // The near end is the same port number, as the sentence says.
    expect(forward![1]).toBe(published![2]);
  });

  it("adds a private address through docker-compose.override.yml, which npm start and npm run update read", () => {
    const example: Array<string> = blockAfter(
      ENGLISH_GUIDE,
      OVERRIDE_DETAILS,
      'yaml title="docker-compose.override.yml"',
    );
    const port: RegExpExecArray | null = OVERRIDE_PORT.exec(example[3] || "");
    const published: RegExpExecArray | null = COMPOSE_PORT.exec(
      compose.postgresPorts[0] || "",
    );
    const scripts: Record<string, string> = rootScripts();

    expect(example).toEqual(OVERRIDE_EXAMPLE);
    expect(compose.services).toContain("postgres");
    // 10.0.0.0/8: a private address, onto PostgreSQL's container port.
    expect(port).not.toBeNull();
    expect(port![1]).toBe("10");
    expect(port![3]).toBe(published![3]);
    /*
     * On a host port of its own: Compose adds the override's port to
     * docker-compose.yml's, and the same host port on a second address
     * collides with the loopback one as soon as that address is 0.0.0.0.
     */
    expect(port![2]).not.toBe(published![2]);
    expect(ENGLISH_GUIDE).toContain(
      `Then run \`npm start\`, and PostgreSQL also answers on port ${port![2]} of that address.`,
    );
    // Compose reads docker-compose.override.yml by itself when no -f is given.
    expect(scripts["start"]).toContain("docker compose up");
    expect(scripts["start"]).not.toContain(" -f ");
    expect(scripts["update"]).toContain("npm run start");
    expect(ENGLISH_GUIDE).toContain(
      "publish it on the server's address in that network too, on a port of its own. Create `docker-compose.override.yml` next to `docker-compose.yml`; `npm start` and `npm run update` read it:",
    );
    expect(ENGLISH_GUIDE).toContain(
      "Put the server's own private address in place of `10.0.0.5`, never a public one",
    );
  });
});

describe("the Docker Compose guide on the database password", () => {
  it("says npm start gives a placeholder DATABASE_PASSWORD a random value on a new install only - its script does, before Compose starts", () => {
    expect(leadingInstallSteps(rootScripts()["start"] as string)).toContain(
      GENERATE_STEP,
    );
    expect(ENGLISH_GUIDE).toContain(
      "That is why `npm start` sets `DATABASE_PASSWORD` and `ENCRYPTION_SECRET` only on a new install, before PostgreSQL creates its database.",
    );
  });

  it("has a Change the database password section under the production checklist, where npm start's warning points", () => {
    const all: Array<string> = headings(ENGLISH_GUIDE);
    const url: RegExpExecArray | null = SCRIPT_DOCS_URL.exec(
      source("Scripts/Install/GenerateDatabasePassword.js"),
    );

    expect(all.indexOf(CHANGE_HEADING)).toBe(
      all.indexOf(CHECKLIST_HEADING) + 1,
    );
    expect(all.indexOf(BACKUP_HEADING)).toBe(all.indexOf(CHANGE_HEADING) + 1);
    expect(url).not.toBeNull();

    const target: URL = new URL(url![1] as string);

    expect(target.origin).toBe("https://oneuptime.com");
    expect(target.pathname).toBe(COMPOSE_DOCS_PATH);
    expect(target.hash).toBe(changeAnchor());
  });

  it("changes the password in PostgreSQL and in config.env together, with the compose service and settings that exist", () => {
    const commands: Array<string> = blockAfter(
      ENGLISH_GUIDE,
      CHANGE_HEADING,
      "bash",
    );
    const keys: Set<string> = configKeys();
    const named: Array<string> = Array.from(
      commands.join("\n").matchAll(SETTING_IN_COMMAND),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .filter((setting: string): boolean => {
        return setting !== "NEW_PASSWORD";
      });

    expect(commands).toEqual(CHANGE_COMMANDS);
    // config.env is written last in the chain, after PostgreSQL took the value.
    expect(commands.findIndex(isConfigWrite)).toBe(commands.length - 2);
    expect(commands.findIndex(isPasswordChange)).toBe(commands.length - 3);
    expect(commands.slice(0, -2).every(endsTheChainLink)).toBe(true);
    expect(composeFacts("docker-compose.yml").services).toContain("postgres");
    expect(named).toEqual(
      expect.arrayContaining(["DATABASE_USERNAME", "DATABASE_NAME"]),
    );
    for (const setting of [...named, "DATABASE_PASSWORD"]) {
      expect({ setting, inConfigExample: keys.has(setting) }).toEqual({
        setting,
        inConfigExample: true,
      });
    }
    expect(rootScripts()["start"]).toBeDefined();
    expect(ENGLISH_GUIDE).toContain(
      "If you set `DATABASE_BACKUP_PASSWORD` and `DATABASE_RESTORE_PASSWORD`, give them the new value too.",
    );
    expect(keys.has("DATABASE_BACKUP_PASSWORD")).toBe(true);
    expect(keys.has("DATABASE_RESTORE_PASSWORD")).toBe(true);
  });

  it("is linked from the checklist and from the private-address section", () => {
    expect(
      ENGLISH_GUIDE.split(`[Change the database password](${changeAnchor()})`)
        .length - 1,
    ).toBe(2);
  });
});

describe.each(TRANSLATED_LANGUAGES)(
  "the %s Docker Compose guide on PostgreSQL's port and password",
  (language: string) => {
    const translated: string = readPage(language, COMPOSE_PAGE);

    it("has the Change the database password section in the English place, under a heading of its own", () => {
      const { heading } = headingIn(language, CHANGE_HEADING);

      expect(heading.startsWith("### ")).toBe(true);
      expect(heading).not.toBe(CHANGE_HEADING);
    });

    it("runs the English commands", () => {
      const { heading } = headingIn(language, CHANGE_HEADING);

      expect(blockAfter(translated, heading, "bash")).toEqual(CHANGE_COMMANDS);
      expect(lines(translated)).toContain(SSH_TUNNEL);
      expect(
        blockAfter(
          translated,
          detailsLineIn(language),
          'yaml title="docker-compose.override.yml"',
        ),
      ).toEqual(OVERRIDE_EXAMPLE);
    });

    it("words the private-address section in its own language", () => {
      expect(detailsLines(translated)).toHaveLength(
        detailsLines(ENGLISH_GUIDE).length,
      );
      expect(detailsLineIn(language)).not.toBe(OVERRIDE_DETAILS);
    });

    it("points its links at its own heading", () => {
      const { anchor } = headingIn(language, CHANGE_HEADING);

      expect(translated.split(`](#${anchor})`).length - 1).toBe(2);
      expect(translated).not.toContain(`](${changeAnchor()})`);
    });

    it("names 127.0.0.1, the backup settings and the override file as often as the English page", () => {
      for (const code of [
        "`127.0.0.1`",
        "`restore.sh`",
        "`DATABASE_BACKUP_PASSWORD`",
        "`DATABASE_RESTORE_PASSWORD`",
        "`docker-compose.override.yml`",
      ]) {
        expect({ code, times: translated.split(code).length - 1 }).toEqual({
          code,
          times: ENGLISH_GUIDE.split(code).length - 1,
        });
      }
    });
  },
);

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

function noteLinks(language: string): Array<string> {
  return [
    `${COMPOSE_DOCS_PATH}#${headingIn(language, BACKUP_HEADING).anchor}`,
    `${COMPOSE_DOCS_PATH}#${headingIn(language, CHANGE_HEADING).anchor}`,
  ];
}

describe("the English upgrade note on PostgreSQL's port and password", () => {
  it("is a note of the 13 → 14 changes, once, after the note on the header ONEUPTIME_SECRET travels in and before the note on the bundled Runner", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says what the compose files publish now, and that backups reach it as before", () => {
    const dev: string = source("Scripts/Dev/docker-compose.dev.yml");

    expect(composeFacts("docker-compose.yml").postgresPorts).toEqual([
      "127.0.0.1:5400:5432",
    ]);
    expect(ENGLISH_NOTE).toContain(
      "It is now published on `127.0.0.1` only, where `npm run backup` and `restore.sh` reach it as before",
    );
    expect(ENGLISH_NOTE).toContain(
      "the development stack publishes its PostgreSQL, ClickHouse and Valkey ports the same way.",
    );
    for (const published of [
      `"${PUBLISHED_PORT_ENTRY}"`,
      '"127.0.0.1:6310:6379"',
      '"127.0.0.1:8189:8123"',
      '"127.0.0.1:9034:9000"',
    ]) {
      expect(dev).toContain(published);
    }
  });

  it("says what npm start does on a new install and on one whose database exists, as its first step does", () => {
    const script: string = source(
      "Scripts/Install/GenerateDatabasePassword.js",
    );

    expect(leadingInstallSteps(rootScripts()["start"] as string)).toContain(
      GENERATE_STEP,
    );
    expect(script).toContain('const PLACEHOLDER_MARK = "please-change-this";');
    expect(script).toContain('"warn-created"');
    expect(ENGLISH_NOTE).toContain(
      "On a new install, `npm start` replaces a `DATABASE_PASSWORD` still at its `config.example.env` placeholder with a random value before PostgreSQL creates its database.",
    );
    expect(ENGLISH_NOTE).toContain(
      "An installation whose database already exists keeps its password, and `npm start` warns while that is the placeholder:",
    );
  });

  it("says what an operator does: a tunnel or a private address, and the shipped docker-compose.yml put back", () => {
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      expect.arrayContaining([
        "docker-compose.yml",
        "git pull",
        "git checkout docker-compose.yml",
      ]),
    );
    expect(ENGLISH_NOTE).toContain("now needs an SSH tunnel");
    expect(ENGLISH_NOTE).toContain("Helm installs see no change.");
  });

  it("links to Back up and restore and to Change the database password", () => {
    expect(linkTargets(ENGLISH_NOTE)).toEqual(noteLinks("en"));
  });
});

describe.each(TRANSLATED_LANGUAGES)(
  "the %s upgrade note on PostgreSQL's port and password",
  (language: string) => {
    const note: string = flattened(
      otherChangesItems(language)[NOTE_INDEX] || "",
    );

    it("is in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(note).toContain("`127.0.0.1`");
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });

    it("links to its own language's Back up and restore and Change the database password", () => {
      expect(linkTargets(note)).toEqual(noteLinks(language));
    });
  },
);
