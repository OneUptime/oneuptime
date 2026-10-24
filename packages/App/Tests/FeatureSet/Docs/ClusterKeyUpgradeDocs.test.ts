import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  ShippedSecretFallback,
  ShippedSecretPlaceholderMark,
  isShippedSecretValue,
} from "Common/Server/EnvironmentConfig";
import { readExampleEnvClusterKey } from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note on a placeholder ONEUPTIME_SECRET (installation/upgrading,
 * "Other changes in 14"), held to the code it describes:
 *
 *   - the values it calls placeholders are the ones the server refuses as
 *     shipped (EnvironmentConfig.isShippedSecretValue: unset, "secret", and
 *     anything containing "please-change-this"), config.example.env's
 *     ONEUPTIME_SECRET among them;
 *   - what it says the app's processes use instead is what
 *     ClusterKeyAuthorization derives, from the installation's token signing
 *     key;
 *   - the commands it says give config.env a random value are the ones
 *     that run Scripts/Install/ReplacePlaceholderSecrets.js (a step of
 *     npm start, which npm run update ends with), and the Helm
 *     value it names is the chart's;
 *   - it sits after the note on HTTPS cookies and before the note on the
 *     header the key travels in, and points at the Docker Compose
 *     guide's "Generate random secrets" step, in every language at that
 *     language's own heading;
 *   - every translation carries it in the English note's place, under a lead
 *     of its own, with the English note's code.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const NOTE_LEAD: string =
  "**OneUptime refuses a placeholder `ONEUPTIME_SECRET`.**";
// The note before it (HttpsCookiesUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**Sign-in cookies stay on HTTPS, and an HTTPS installation tells browsers to stay there.**";
// The note after it (ClusterKeyHeaderUpgradeDocs).
const NEXT_LEAD: string =
  "**OneUptime's own services send `ONEUPTIME_SECRET` in a header, and only to the routes that take it.**";

const SECRETS_HEADING: string = "### Generate random secrets";
const DOCKER_COMPOSE_PAGE: string = "installation/docker-compose";

const LINK_TARGET: RegExp = /\]\(([^)\s]+)\)/g;
const HEADING_LINE: RegExp = /^#{1,6}\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_MARKER: RegExp = /^#+\s+/;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function page(language: string, name: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${name}.md`),
    "utf8",
  );
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The headings of a page, in order, outside code blocks.
function headings(markdown: string): Array<string> {
  const found: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
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

// The anchor of a language's "Generate random secrets" step.
function secretsAnchor(language: string): string {
  const index: number = headings(page("en", DOCKER_COMPOSE_PAGE)).indexOf(
    SECRETS_HEADING,
  );

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headings(
    page(language, DOCKER_COMPOSE_PAGE),
  )[index];

  expect({ language, heading: Boolean(heading) }).toEqual({
    language,
    heading: true,
  });

  return slugifyMarkdownHeading(
    (heading as string).replace(HEADING_MARKER, ""),
  );
}

function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_TARGET)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on a placeholder ONEUPTIME_SECRET", () => {
  it("is a note of the 13 → 14 changes, once, after the note on HTTPS cookies and before the note on the header the key travels in", () => {
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

  it("names as placeholders exactly the values the server refuses as shipped", () => {
    const code: Array<string> = inlineCode(ENGLISH_NOTE);

    expect(code).toEqual(
      expect.arrayContaining([
        ShippedSecretFallback,
        ShippedSecretPlaceholderMark,
        "config.example.env",
      ]),
    );
    expect(ENGLISH_NOTE).toContain("unset, `secret`, or a placeholder from");
    expect(isShippedSecretValue(undefined)).toBe(true);
    expect(isShippedSecretValue(ShippedSecretFallback)).toBe(true);
    expect(isShippedSecretValue(readExampleEnvClusterKey())).toBe(true);
    expect(
      readExampleEnvClusterKey().includes(ShippedSecretPlaceholderMark),
    ).toBe(true);
  });

  it("says the app's processes use a key derived from the token signing key, as ClusterKeyAuthorization does", () => {
    expect(ENGLISH_NOTE).toContain(
      "they call each other with a key derived from the installation's own token signing key instead",
    );
    expect(
      source("packages/Common/Server/Middleware/ClusterKeyAuthorization.ts"),
    ).toContain("TokenSigningKey.deriveKey(INSTALLATION_CLUSTER_KEY_LABEL)");
  });

  it("names the commands that give config.env a random value, which are the ones that run the script", () => {
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      expect.arrayContaining(["npm start", "npm run update", "config.env"]),
    );

    const scripts: Record<string, string> = JSON.parse(
      source("package.json"),
    ).scripts;

    /*
     * A step of the start script, not a prestart hook npm skips under
     * ignore-scripts.
     */
    expect(scripts["start"]).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    // npm run update ends with npm start, which runs the step itself.
    expect(scripts["update"]).toMatch(/&& npm run start$/);
    expect(scripts["update"]).toContain("node ./Scripts/Install/Update.js");
    expect(scripts["prerun"]).toContain("Scripts/Install/configure.sh");
    expect(source("Scripts/Install/configure.sh")).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
  });

  it("names the chart's value for the key", () => {
    expect(inlineCode(ENGLISH_NOTE)).toContain("oneuptimeSecret");
    expect(source("HelmChart/Public/oneuptime/values.yaml")).toContain(
      "\noneuptimeSecret:",
    );
  });

  it("asks for a value of its own only where something of the operator's calls OneUptime with it, and says an installation with its own key sees no change", () => {
    expect(ENGLISH_NOTE).toContain(
      "and a script of yours calls OneUptime with `ONEUPTIME_SECRET`, give it a long random value",
    );
    expect(ENGLISH_NOTE).toContain(
      "An installation that set its own `ONEUPTIME_SECRET` sees no change.",
    );
  });

  it("says nothing of the Runner, which registers with its own key and holds no ONEUPTIME_SECRET (SharedRunnerOwnKeyUpgradeDocs)", () => {
    expect(ENGLISH_NOTE).not.toContain("Runner");
    expect(source("packages/Runner/Services/RegisterRunner.ts")).not.toContain(
      "ShippedClusterKeyError",
    );
  });

  it("points at the Docker Compose guide's step that generates the secrets", () => {
    expect(linkTargets(ENGLISH_NOTE)).toEqual([
      `/docs/${DOCKER_COMPOSE_PAGE}#${secretsAnchor("en")}`,
    ]);
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on a placeholder ONEUPTIME_SECRET",
  (language: string) => {
    const note: string = flattened(
      otherChangesItems(language)[NOTE_INDEX] || "",
    );

    it("is in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      /*
       * This note names the placeholder it refuses. A sibling note (the
       * global-probe and Runner key note) names it too, so this is not a
       * uniqueness check: the note in the cluster-key note's own place says
       * it.
       */
      expect(note).toContain("`please-change-this`");
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });

    it("points at its own language's step that generates the secrets", () => {
      expect(linkTargets(note)).toEqual([
        `/docs/${DOCKER_COMPOSE_PAGE}#${secretsAnchor(language)}`,
      ]);
    });
  },
);
