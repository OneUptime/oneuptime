import { readPage } from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  InboundEmailSetupDocsUrl,
  getUsableInboundEmailWebhookSecret,
} from "Common/Server/EnvironmentConfig";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says incoming email now needs a webhook secret of
 * the installation's own, and the setup guide it sends operators to - held
 * to the code that makes them true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on the bundled datastores' passwords (DatastorePasswordUpgradeDocs)
 * and before the endpoint pointer, and every translation carries it in the
 * English note's place, with the English note's code and a link that lands
 * on the setup step in the reader's language. What it claims is what the
 * code does:
 *
 *   - while INBOUND_EMAIL_WEBHOOK_SECRET is empty, or a placeholder the setup
 *     guide prints, the webhook refuses every email with 503
 *     (EnvironmentConfig.getUsableInboundEmailWebhookSecret, the provider
 *     base class, the route);
 *   - the app says so at startup (InboundEmailWebhookSecretWarning, logged by
 *     App/Index.ts), and helm upgrade says so too (NOTES.txt);
 *   - Docker Compose hands config.env's value to the app, and the Helm chart
 *     hands inboundEmail.webhookSecret to it;
 *   - the step it links to is the one that sets the secret, which the app's
 *     warning links to as well.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**Incoming email needs a webhook secret of your own.**";
// The note before it (DatastorePasswordUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**The bundled ClickHouse and Valkey get passwords of their own.**";
const POINTER_START: string = "- See [API and endpoint changes]";

const SETUP_PAGE: string = "self-hosted/sendgrid-inbound-email";
const SETUP_STEP: string = "Configure OneUptime";
const SETUP_LINK_PATH: string = `/docs/${SETUP_PAGE}#`;

// A Markdown link's address: [words](address).
const LINK_ADDRESS: RegExp = /\]\(([^)\s]+)\)/g;
const HEADING_LINE: RegExp = /^#{1,6}\s+(.+?)\s*$/;
const FENCE_LINE: RegExp = /^\s*```/;
// What a Destination URL ends with on the setup guide, in a code span.
const GUIDE_URL_ENDING: RegExp = /`[^`]*\/incoming-email\/sendgrid\/([^`/]+)`/g;
// The value the setup guide's config examples set.
const GUIDE_ENV_VALUE: RegExp = /^INBOUND_EMAIL_WEBHOOK_SECRET=(.+)$/gm;
const GUIDE_HELM_VALUE: RegExp = /^\s*webhookSecret:\s*"([^"]+)"\s*$/gm;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The headings of a page below its title, in order, outside code samples.
function headingsOf(markdown: string): Array<string> {
  const headings: Array<string> = [];
  let inFence: boolean = false;

  markdown.split("\n").forEach((line: string, index: number) => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return;
    }

    const match: RegExpExecArray | null = HEADING_LINE.exec(line);

    if (!inFence && index > 0 && match) {
      headings.push(match[1]!);
    }
  });

  return headings;
}

// The anchor of the setup step on the guide in `language`.
function setupStepAnchor(language: string): string {
  const index: number = headingsOf(readPage("en", SETUP_PAGE)).indexOf(
    SETUP_STEP,
  );

  expect(index).toBeGreaterThan(-1);

  return slugifyMarkdownHeading(
    headingsOf(readPage(language, SETUP_PAGE))[index]!,
  );
}

function linksIn(markdown: string): Array<string> {
  return [...markdown.matchAll(LINK_ADDRESS)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the inbound email webhook secret", () => {
  it("is a note of the 13 → 14 changes, once, after the note on the bundled datastores' passwords and before the endpoint pointer", () => {
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
    expect(ENGLISH_ITEMS[NOTE_INDEX + 1]!.startsWith(POINTER_START)).toBe(true);
  });

  it("names the settings it is about and the commands an operator runs", () => {
    // inlineCode lists a text's code spans sorted, each as often as it appears.
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      [
        "INBOUND_EMAIL_DOMAIN",
        "INBOUND_EMAIL_WEBHOOK_SECRET",
        "503",
        "helm upgrade",
        "INBOUND_EMAIL_WEBHOOK_SECRET",
        "config.env",
        "npm start",
        "inboundEmail.webhookSecret",
        "helm upgrade",
      ].sort(),
    );
  });

  it("says what changes, what an operator does, and who sees no change", () => {
    for (const claim of [
      "Once `INBOUND_EMAIL_DOMAIN` is set, OneUptime takes an email from SendGrid only when the webhook URL ends with `INBOUND_EMAIL_WEBHOOK_SECRET`.",
      "While that is empty, or a placeholder from the setup guide, every email is refused with `503` and none reaches an Incoming Email Monitor or a workflow",
      "the app says so at startup, and so does `helm upgrade`",
      "If the Destination URL in SendGrid's Inbound Parse settings already ends with a long random value of your own, set `INBOUND_EMAIL_WEBHOOK_SECRET` to that value",
      "otherwise set it to a new one and make that URL end with it",
      "With Docker Compose, set it in `config.env` and run `npm start`; with Helm, set `inboundEmail.webhookSecret` and run `helm upgrade`.",
      "SendGrid retries a refused email for up to three days",
      "An installation that set its own secret sees no change.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }
  });

  it("links to the step of the setup guide that sets the secret, the one the app's warning names", () => {
    const anchor: string = setupStepAnchor("en");

    expect(anchor).toBe("configure-oneuptime");
    expect(linksIn(ENGLISH_NOTE)).toEqual([`${SETUP_LINK_PATH}${anchor}`]);
    expect(InboundEmailSetupDocsUrl).toBe(
      `https://oneuptime.com${SETUP_LINK_PATH}${anchor}`,
    );
  });
});

describe("the note and the setup guide are true to the code", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "every placeholder the %s setup guide prints is no secret to the server",
    (language: string) => {
      const guide: string = readPage(language, SETUP_PAGE);
      const placeholders: Array<string> = [
        ...[...guide.matchAll(GUIDE_URL_ENDING)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
        ...[...guide.matchAll(GUIDE_ENV_VALUE)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
        ...[...guide.matchAll(GUIDE_HELM_VALUE)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ];

      // YOUR_SECRET, your-secret and replace-with-a-strong-random-secret.
      expect(new Set(placeholders).size).toBe(3);

      for (const placeholder of placeholders) {
        expect({
          placeholder,
          secret: getUsableInboundEmailWebhookSecret(placeholder),
        }).toEqual({ placeholder, secret: undefined });
      }
    },
  );

  it("an empty secret is no secret either, and config.example.env ships it empty", () => {
    expect(getUsableInboundEmailWebhookSecret("")).toBeUndefined();
    expect(getUsableInboundEmailWebhookSecret(undefined)).toBeUndefined();
    expect(source("config.example.env").split("\n")).toContain(
      "INBOUND_EMAIL_WEBHOOK_SECRET=",
    );
  });

  it("the webhook refuses every email with 503 while there is no secret, for every provider", () => {
    const base: string = source(
      "packages/Common/Server/Services/InboundEmail/InboundEmailProvider.ts",
    );
    expect(base).toContain(
      "webhookSecret: getUsableInboundEmailWebhookSecret(config.webhookSecret),",
    );
    expect(base).toContain("if (!webhookSecret) {\n      return false;\n    }");

    const route: string = source(
      "packages/App/FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail.ts",
    );
    const missing: string = route.slice(
      route.indexOf("if (!provider.hasWebhookSecret()) {"),
      route.indexOf("const isFromProvider: boolean"),
    );

    expect(missing).toContain("new ServiceUnavailableException(");
  });

  it("the app says so at startup", () => {
    expect(source("packages/Common/Server/EnvironmentConfig.ts")).toContain(
      "export const InboundEmailWebhookSecretWarning: string | null =\n  InboundEmailDomain && !InboundEmailWebhookSecret",
    );
    expect(source("packages/App/Index.ts")).toContain(
      "logger.warn(InboundEmailWebhookSecretWarning);",
    );
  });

  it("helm upgrade says so, and the chart and Docker Compose hand the secret to the app", () => {
    expect(source("HelmChart/Public/oneuptime/templates/NOTES.txt")).toContain(
      "ACTION REQUIRED -- incoming email is refused until inboundEmail.webhookSecret is set.",
    );
    expect(
      source("HelmChart/Public/oneuptime/templates/_helpers.tpl"),
    ).toContain(
      '- name: INBOUND_EMAIL_WEBHOOK_SECRET\n  value: {{ default "" $.Values.inboundEmail.webhookSecret | quote }}',
    );
    expect(source("docker-compose.base.yml")).toContain(
      "INBOUND_EMAIL_WEBHOOK_SECRET: ${INBOUND_EMAIL_WEBHOOK_SECRET}",
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the English code, linking to its own setup step",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(
          language,
          "Incoming email needs a webhook secret of your own.",
        ),
      );

      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
      expect(note.startsWith("- **")).toBe(true);

      expect(linksIn(note)).toEqual([
        `${SETUP_LINK_PATH}${setupStepAnchor(language)}`,
      ]);
    },
  );
});
