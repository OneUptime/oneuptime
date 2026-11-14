import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import ServerEmailEnvironment, {
  SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  SERVER_EMAIL_MAILGUN_REGION_VALUES,
  SERVER_EMAIL_SECRET_VARIABLES,
  SERVER_EMAIL_SERVER_TYPE_VALUES,
  SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES,
  SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES,
  SERVER_EMAIL_SMTP_TRANSPORT_VALUES,
  ServerEmailEnvironmentReading,
  ServerEmailEnvironmentVariable,
} from "Common/Types/Email/ServerEmailEnvironment";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { isDeepStrictEqual } from "util";

/*
 * #7738: a self-hosted server's own email set by the GLOBAL_EMAIL_
 * environment variables, as emails/email-providers tells it in every docs
 * language. The page's table is the server's list of the variables, each
 * set by the chart from the Helm value its row names, passed on by Docker
 * Compose and listed in config.env; the choices it names are the ones the
 * server reads and the chart's schema allows; and every rule it states is
 * one the chart or the server keeps.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const PAGE: string = "emails/email-providers";
const HEADING: string = "## Set the server's email with environment variables";
const CHART_HELPERS: string =
  "HelmChart/Public/oneuptime/templates/_helpers.tpl";
const CHART_VALUES: string = "HelmChart/Public/oneuptime/values.yaml";
const CHART_SCHEMA: string = "HelmChart/Public/oneuptime/values.schema.json";

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: { load: (text: string) => unknown } = require(
  path.join(REPO_DIR, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

// A row of a Markdown table.
const TABLE_ROW: RegExp = /^\|.*\|$/;

// The line under a table's header.
const TABLE_SEPARATOR: RegExp = /^\|(?:\s*:?-+:?\s*\|)+$/;

const HEADING_MARKS: RegExp = /^(#{1,6}) /;

const INLINE_CODE: RegExp = /`([^`]+)`/g;

// A setting of config.example.env.
const CONFIG_LINE: RegExp = /^([A-Z][A-Z0-9_]*)=(.*)$/;

// A fenced block: its info string and its body.
const FENCE: RegExp = /^```([a-z]*)\n([\s\S]*?)\n```$/gm;

// The Secret reader's answers: a password or key's path and its default key.
const SECRET_READ: RegExp = /^path: (email\.[A-Za-z.]+)\nkey: ([A-Za-z]+)$/gm;

/*
 * Where the chart's email template reads each block of the values from:
 * the row's Helm value email.smtp.host is $smtp.host there.
 */
const CHART_SCOPES: ReadonlyArray<{
  path: string;
  name: string;
  from: string;
}> = [
  { path: "email.smtp.oauth", name: "$oauth", from: "$smtp.oauth" },
  { path: "email.smtp", name: "$smtp", from: "$email.smtp" },
  { path: "email.sendgrid", name: "$sendgrid", from: "$email.sendgrid" },
  { path: "email.amazonSes", name: "$ses", from: "$email.amazonSes" },
  { path: "email.mailgun", name: "$mailgun", from: "$email.mailgun" },
  { path: "email.postmark", name: "$postmark", from: "$email.postmark" },
  { path: "email.resend", name: "$resend", from: "$email.resend" },
  { path: "email", name: "$email", from: ".Values.email" },
];

// The variables that pick one of a few values, and the values the server reads.
const CHOICES: ReadonlyArray<{
  variable: ServerEmailEnvironmentVariable;
  values: ReadonlyArray<string>;
}> = [
  {
    variable: V.ServerType,
    values: Object.values(SERVER_EMAIL_SERVER_TYPE_VALUES),
  },
  {
    variable: V.SmtpTransport,
    values: Object.values(SERVER_EMAIL_SMTP_TRANSPORT_VALUES),
  },
  {
    variable: V.SmtpAuthType,
    values: Object.values(SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES),
  },
  {
    variable: V.SmtpOAuthProviderType,
    values: Object.values(SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES),
  },
  {
    variable: V.AmazonSesAuthenticationType,
    values: Object.values(SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES),
  },
  {
    variable: V.MailgunRegion,
    values: Object.values(SERVER_EMAIL_MAILGUN_REGION_VALUES),
  },
];

// The senders of the server's email through an OAuth app, and how each reads an empty provider type.
const SENDERS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Notification/Services/MailService.ts",
  "packages/App/FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider.ts",
];

const SENT_PROVIDER_TYPE: string =
  "emailServer.oauthProviderType || OAuthProviderType.ClientCredentials,";

const PASSWORD: string = "smtp-password-docs-sentinel-7738";

type Environment = Readonly<Record<string, string>>;

// Settings that send, one for each way of sending, each with its password or key.
const SMTP: Environment = {
  [V.ServerType]: "custom-smtp",
  [V.FromEmail]: "alerts@example.com",
  [V.FromName]: "OneUptime",
  [V.SmtpHost]: "smtp.example.com",
  [V.SmtpPort]: "587",
  [V.SmtpUsername]: "alerts@example.com",
  [V.SmtpPassword]: PASSWORD,
};

const SMTP_OAUTH: Environment = {
  [V.ServerType]: "custom-smtp",
  [V.FromEmail]: "alerts@example.com",
  [V.FromName]: "OneUptime",
  [V.SmtpHost]: "smtp.office365.com",
  [V.SmtpPort]: "587",
  [V.SmtpAuthType]: "oauth",
  [V.SmtpUsername]: "alerts@example.com",
  [V.SmtpOAuthClientId]: "00000000-0000-0000-0000-000000000001",
  [V.SmtpOAuthClientSecret]: "oauth-client-secret-docs-sentinel-7738",
  [V.SmtpOAuthTokenUrl]:
    "https://login.microsoftonline.com/example/oauth2/v2.0/token",
  [V.SmtpOAuthScope]: "https://outlook.office365.com/.default",
};

const SENDGRID: Environment = {
  [V.ServerType]: "sendgrid",
  [V.FromEmail]: "alerts@example.com",
  [V.FromName]: "OneUptime",
  [V.SendgridApiKey]: "SG.sendgrid-key-docs-sentinel-7738",
};

const AMAZON_SES: Environment = {
  [V.ServerType]: "amazon-ses",
  [V.FromEmail]: "alerts@example.com",
  [V.AmazonSesAccessKeyId]: "AKIAIOSFODNN7EXAMPLE",
  [V.AmazonSesSecretAccessKey]: "ses-secret-access-key-docs-sentinel-7738",
  [V.AmazonSesRegion]: "us-east-1",
};

const MAILGUN: Environment = {
  [V.ServerType]: "mailgun",
  [V.FromEmail]: "alerts@example.com",
  [V.MailgunApiKey]: "mailgun-key-docs-sentinel-7738",
  [V.MailgunDomain]: "mg.example.com",
};

const POSTMARK: Environment = {
  [V.ServerType]: "postmark",
  [V.FromEmail]: "alerts@example.com",
  [V.PostmarkServerToken]: "postmark-token-docs-sentinel-7738",
};

const RESEND: Environment = {
  [V.ServerType]: "resend",
  [V.FromEmail]: "alerts@example.com",
  [V.ResendApiKey]: "re_resend-key-docs-sentinel-7738",
};

const SENDING: ReadonlyArray<Environment> = [
  SMTP,
  SMTP_OAUTH,
  SENDGRID,
  AMAZON_SES,
  MAILGUN,
  POSTMARK,
  RESEND,
];

/*
 * The variables a row says empty means a value of: that value, another
 * value the row names, and settings that send to read them with.
 */
const DEFAULTS: ReadonlyArray<{
  variable: ServerEmailEnvironmentVariable;
  emptyMeans: string;
  other: string;
  environment: Environment;
}> = [
  {
    variable: V.SmtpTransport,
    emptyMeans: "smtp",
    other: "microsoft-graph",
    environment: SMTP,
  },
  {
    variable: V.SmtpRequireTls,
    emptyMeans: "false",
    other: "true",
    environment: SMTP,
  },
  {
    variable: V.SmtpAuthType,
    emptyMeans: "username-and-password",
    other: "none",
    environment: SMTP,
  },
  {
    variable: V.SmtpOAuthProviderType,
    emptyMeans: "client-credentials",
    other: "jwt-bearer",
    environment: SMTP_OAUTH,
  },
  {
    variable: V.AmazonSesAuthenticationType,
    emptyMeans: "access-key",
    other: "server-iam-role",
    environment: AMAZON_SES,
  },
  {
    variable: V.MailgunRegion,
    emptyMeans: "us",
    other: "eu",
    environment: MAILGUN,
  },
];

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relativePath), "utf8");
}

function read(environment: Environment): ServerEmailEnvironmentReading {
  return ServerEmailEnvironment.read(environment);
}

/*
 * The settings as the mail service sends with them. The reader leaves an
 * OAuth provider type that is not set empty, as an admin who never picked
 * one; the senders read empty as Client Credentials (SENDERS).
 */
function asSent(settings: unknown): unknown {
  if (!settings || typeof settings !== "object") {
    return settings;
  }

  const record: Record<string, unknown> = settings as Record<string, unknown>;

  return {
    ...record,
    smtpOAuthProviderType:
      record["smtpOAuthProviderType"] || OAuthProviderType.ClientCredentials,
  };
}

// A cell's text without the backticks around it.
function unwrap(cell: string): string {
  if (cell.startsWith("`") && cell.endsWith("`")) {
    return cell.slice(1, -1);
  }

  return cell;
}

function inlineCodes(text: string): Array<string> {
  return [...text.matchAll(INLINE_CODE)].map(
    (match: RegExpExecArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The lines of a page outside its fenced code blocks, so a "#" comment in a
 * shell example is not read as a heading.
 */
function proseLines(markdown: string): Array<string | null> {
  let inFence: boolean = false;

  return markdown.split("\n").map((line: string): string | null => {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      return null;
    }

    return inFence ? null : line;
  });
}

// From a heading to the next heading of the same or a higher level.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const prose: Array<string | null> = proseLines(markdown);
  const start: number = prose.findIndex((line: string | null): boolean => {
    return line !== null && line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (HEADING_MARKS.exec(heading)?.[1] || "").length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const marks: RegExpExecArray | null = HEADING_MARKS.exec(
      prose[index] || "",
    );

    if (marks && (marks[1] as string).length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The heading of a page's section that holds the table of the variables.
function variablesHeadingOf(markdown: string): string {
  const prose: Array<string | null> = proseLines(markdown);
  const table: number = prose.findIndex((line: string | null): boolean => {
    return (line || "").startsWith(`| \`${V.ServerType}\` |`);
  });

  expect({ table: table >= 0 }).toEqual({ table: true });

  let heading: number = table;

  while (heading > 0 && !(prose[heading] || "").startsWith("## ")) {
    heading--;
  }

  return (prose[heading] || "").trim();
}

// The cells of every table row of a text, header rows included.
function tableRows(text: string): Array<Array<string>> {
  return proseLines(text)
    .map((line: string | null): string => {
      return (line || "").trim();
    })
    .filter((line: string): boolean => {
      return TABLE_ROW.test(line) && !TABLE_SEPARATOR.test(line);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The one table row of a text whose first cell is this text.
function rowOf(text: string, firstCell: string): Array<string> {
  const rows: Array<Array<string>> = tableRows(text).filter(
    (cells: Array<string>): boolean => {
      return cells[0] === firstCell;
    },
  );

  expect({ firstCell, rows: rows.length }).toEqual({ firstCell, rows: 1 });

  return rows[0] as Array<string>;
}

// The prose of a text outside its tables and fenced blocks.
function proseOutsideTables(text: string): string {
  return proseLines(text)
    .filter((line: string | null): boolean => {
      return line !== null && !TABLE_ROW.test(line.trim());
    })
    .join("\n");
}

// The one paragraph of a text that starts with these words.
function paragraphOf(text: string, start: string): string {
  const paragraphs: Array<string> = proseOutsideTables(text)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith(start);
    });

  expect({ start, paragraphs: paragraphs.length }).toEqual({
    start,
    paragraphs: 1,
  });

  return paragraphs[0] as string;
}

// A text's fenced blocks: each as its info string and body.
function fencesOf(text: string): Array<{ info: string; body: string }> {
  return [...text.matchAll(FENCE)].map(
    (match: RegExpExecArray): { info: string; body: string } => {
      return { info: match[1] as string, body: match[2] as string };
    },
  );
}

// A value of a parsed YAML or JSON document, by a dotted path.
function valueAt(root: unknown, dottedPath: string): unknown {
  let node: unknown = root;

  for (const part of dottedPath.split(".")) {
    if (!node || typeof node !== "object") {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

// Where the chart's schema describes a value of the chart.
function schemaPathOf(helmValue: string): string {
  return helmValue
    .split(".")
    .map((part: string): string => {
      return `properties.${part}`;
    })
    .join(".");
}

// How the chart's email template reads a value: $smtp.host for email.smtp.host.
function chartReadOf(helmValue: string): string {
  for (const scope of CHART_SCOPES) {
    const rest: string = helmValue.slice(scope.path.length + 1);

    if (helmValue.startsWith(`${scope.path}.`) && !rest.includes(".")) {
      return `${scope.name}.${rest}`;
    }
  }

  return `(read from nowhere: ${helmValue})`;
}

/*
 * The passwords and keys the chart reads from email.existingSecret: each
 * one's Helm value, and the key it is read under by default.
 */
function chartSecretKeys(): Map<string, string> {
  const helpers: string = readRepo(CHART_HELPERS);
  const start: number = helpers.indexOf(
    '{{- define "oneuptime.env.emailSecretRead" -}}',
  );

  expect(start).toBeGreaterThan(-1);

  const end: number = helpers.indexOf("{{- define ", start + 1);
  const reader: string = helpers.slice(start, end === -1 ? undefined : end);

  return new Map<string, string>(
    [...reader.matchAll(SECRET_READ)].map(
      (match: RegExpExecArray): [string, string] => {
        return [match[1] as string, match[2] as string];
      },
    ),
  );
}

// config.example.env, as the settings it ships and their first values.
function configExample(): Map<string, string> {
  const values: Map<string, string> = new Map<string, string>();

  for (const line of readRepo("config.example.env").split("\n")) {
    const match: RegExpExecArray | null = CONFIG_LINE.exec(line);

    if (match && !values.has(match[1] as string)) {
      values.set(match[1] as string, match[2] as string);
    }
  }

  return values;
}

// The TypeScript files of a folder of the repository, outside builds and tests.
function serverSourcesUnder(relativeDirectory: string): Array<string> {
  const files: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        ["node_modules", "build", "dist", "Tests"].includes(entry.name) ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        files.push(path.relative(REPO_DIR, fullPath));
      }
    }
  };

  walk(path.join(REPO_DIR, relativeDirectory));

  return files;
}

describe("Docs: the server's email from environment variables (#7738)", () => {
  const page: string = readPage("en", PAGE);
  const section: string = sectionOf(page, HEADING);
  const rows: Array<Array<string>> = tableRows(section).slice(1);

  // The variables the page's example values set, with the password its Secret holds.
  const example: () => Record<string, string> = (): Record<string, string> => {
    const yaml: { info: string; body: string } | undefined = fencesOf(
      section,
    ).find((fence: { info: string; body: string }): boolean => {
      return fence.info === "yaml";
    });
    const values: unknown = jsYaml.load(yaml?.body || "");
    const environment: Record<string, string> = {};

    for (const row of rows) {
      const value: unknown = valueAt(
        values,
        inlineCodes(row[1] as string)[0] as string,
      );

      if (value !== undefined && value !== null) {
        environment[unwrap(row[0] as string)] = String(value);
      }
    }

    return environment;
  };

  it("lists every variable the server reads, in its order, and no other", () => {
    expect(
      rows.map((row: Array<string>): string => {
        return unwrap(row[0] as string);
      }),
    ).toEqual([...SERVER_EMAIL_ENVIRONMENT_VARIABLES]);
  });

  it("each variable is set by the chart from the Helm value its row names, which ships empty", () => {
    const helpers: string = readRepo(CHART_HELPERS);
    const values: unknown = jsYaml.load(readRepo(CHART_VALUES));

    for (const scope of CHART_SCOPES) {
      expect(helpers).toContain(
        `{{- ${scope.name} := ${scope.from} | default dict }}`,
      );
    }

    for (const row of rows) {
      const variable: ServerEmailEnvironmentVariable = unwrap(
        row[0] as string,
      ) as ServerEmailEnvironmentVariable;
      const helmValue: string = inlineCodes(row[1] as string)[0] as string;
      const chartRead: string = chartReadOf(helmValue);
      const isSecret: boolean = ServerEmailEnvironment.isSecret(variable);

      expect({
        variable,
        helmValue,
        // A password or key may come from email.existingSecret instead.
        named: inlineCodes(row[1] as string),
        setByChart: isSecret
          ? helpers.includes(`(list "${helmValue}" "${variable}" ${chartRead})`)
          : helpers.includes(
              `- name: ${variable}\n  value: {{ include "oneuptime.envValue" ${chartRead} }}\n`,
            ),
        // Without email.serverType nothing reads it, and the chart says so.
        refusedAlone:
          variable === V.ServerType
            ? helpers.includes(
                `{{- $serverType := trim (toString (default "" ${chartRead})) }}`,
              )
            : helpers.includes(
                `{{- $settings = append $settings (list "${helmValue}" ${chartRead}) }}`,
              ),
        shipsEmpty: valueAt(values, helmValue) === null,
      }).toEqual({
        variable,
        helmValue,
        named: isSecret
          ? [helmValue, "email.existingSecret.name"]
          : [helmValue],
        setByChart: true,
        refusedAlone: true,
        shipsEmpty: true,
      });
    }

    expect(valueAt(values, "email.existingSecret.name")).toBeNull();
    expect(valueAt(values, "email.existingSecret.key")).toBeNull();
  });

  it("the rows a Secret may hold are the passwords and keys, each read under the key the page names", () => {
    const keys: Map<string, string> = chartSecretKeys();
    const secretRows: Array<Array<string>> = rows.filter(
      (row: Array<string>): boolean => {
        return (row[1] as string).includes("`email.existingSecret.name`");
      },
    );
    const secretValues: Array<string> = secretRows.map(
      (row: Array<string>): string => {
        return inlineCodes(row[1] as string)[0] as string;
      },
    );
    const helm: string = paragraphOf(
      section,
      "With Helm, set them under `email` in your values.",
    );

    expect(
      secretRows.map((row: Array<string>): string => {
        return unwrap(row[0] as string);
      }),
    ).toEqual([...SERVER_EMAIL_SECRET_VARIABLES]);
    expect([...keys.keys()].sort()).toEqual([...secretValues].sort());

    // The key names the page lists, in the table's order.
    expect(
      inlineCodes(helm).filter((code: string): boolean => {
        return !code.startsWith("email");
      }),
    ).toEqual(
      secretValues.map((value: string): string => {
        return keys.get(value) as string;
      }),
    );

    // The key email.existingSecret.key names comes first.
    expect(helm).toContain(
      "The chart reads it from the key named in `email.existingSecret.key`, or else from the key named for it:",
    );
    expect(readRepo(CHART_HELPERS)).toContain(
      '{{- $secretKey := trim (toString (default "" $existing.key)) | default (toString (default "" $read.key)) }}',
    );

    // The example's Secret holds the SMTP password, under that key, and the values name it.
    const fences: Array<{ info: string; body: string }> = fencesOf(section);
    const yaml: unknown = jsYaml.load(
      fences.find((fence: { info: string; body: string }): boolean => {
        return fence.info === "yaml";
      })?.body || "",
    );
    const bash: string =
      fences.find((fence: { info: string; body: string }): boolean => {
        return fence.info === "bash";
      })?.body || "";

    expect(
      fences.map((fence: { info: string }): string => {
        return fence.info;
      }),
    ).toEqual(["bash", "yaml"]);
    expect(bash).toContain(
      `kubectl create secret generic ${valueAt(yaml, "email.existingSecret.name")} `,
    );
    expect(bash).toContain(
      `--from-literal=${keys.get("email.smtp.password")}=YOUR_SMTP_PASSWORD`,
    );
    expect(valueAt(yaml, "email.smtp.password")).toBeUndefined();
  });

  it("names the choices the server reads, as the chart's schema allows them", () => {
    const schema: unknown = JSON.parse(readRepo(CHART_SCHEMA));

    for (const choice of CHOICES) {
      const row: Array<string> = rowOf(section, `\`${choice.variable}\``);
      const helmValue: string = inlineCodes(row[1] as string)[0] as string;

      expect({
        variable: choice.variable,
        named: inlineCodes(row[2] as string),
        allowed: valueAt(schema, `${schemaPathOf(helmValue)}.enum`),
      }).toEqual({
        variable: choice.variable,
        named: [...choice.values],
        allowed: [null, "", ...choice.values],
      });
    }

    // Each server type the page names is one the server reads.
    for (const serverType of Object.values(SERVER_EMAIL_SERVER_TYPE_VALUES)) {
      expect({
        serverType,
        read: read({ [V.ServerType]: serverType }).serverType !== null,
      }).toEqual({ serverType, read: true });
    }

    // true or false, as YAML writes them or as text.
    expect(
      inlineCodes(rowOf(section, `\`${V.SmtpRequireTls}\``)[2] as string),
    ).toEqual(["true", "false"]);
    expect(
      valueAt(schema, `${schemaPathOf("email.smtp.requireTls")}.type`),
    ).toEqual(["boolean", "string", "null"]);
  });

  it("each default the page names is what the server reads an empty variable as", () => {
    const saysEmpty: Array<string> = rows
      .filter((row: Array<string>): boolean => {
        return (row[2] as string).includes("(also when empty)");
      })
      .map((row: Array<string>): string => {
        return unwrap(row[0] as string);
      });

    expect(saysEmpty).toEqual(
      DEFAULTS.map((choice: { variable: string }): string => {
        return choice.variable;
      }),
    );

    for (const sender of SENDERS) {
      expect(readRepo(sender)).toContain(SENT_PROVIDER_TYPE);
    }

    for (const choice of DEFAULTS) {
      const settingsWith: (value: string) => unknown = (
        value: string,
      ): unknown => {
        return asSent(
          read({ ...choice.environment, [choice.variable]: value }).settings,
        );
      };

      expect({
        variable: choice.variable,
        row: (rowOf(section, `\`${choice.variable}\``)[2] as string).includes(
          `\`${choice.emptyMeans}\` (also when empty)`,
        ),
        sends: ServerEmailEnvironment.isUsable(read(choice.environment)),
        emptyIsTheDefault: isDeepStrictEqual(
          settingsWith(""),
          settingsWith(choice.emptyMeans),
        ),
        otherDiffers: !isDeepStrictEqual(
          settingsWith(choice.other),
          settingsWith(choice.emptyMeans),
        ),
      }).toEqual({
        variable: choice.variable,
        row: true,
        sends: true,
        emptyIsTheDefault: true,
        otherDiffers: true,
      });
    }
  });

  it("Docker Compose passes every one on, defaulted, and config.env lists each empty", () => {
    const compose: string = readRepo("docker-compose.base.yml");
    const settings: Map<string, string> = configExample();

    for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
      expect({
        variable,
        passedOn: compose.includes(`  ${variable}: \${${variable}:-}\n`),
        setting: settings.get(variable),
      }).toEqual({ variable, passedOn: true, setting: "" });
    }

    expect(section).toContain(
      "With Docker Compose, set the `GLOBAL_EMAIL_` settings in `config.env`, then run `npm run start` to recreate the containers.",
    );
    expect(
      (
        JSON.parse(readRepo("package.json")) as {
          scripts: Record<string, string>;
        }
      ).scripts["start"],
    ).toBeTruthy();
  });

  it("the chart's values and config.example.env link to the section", () => {
    const address: string = `https://oneuptime.com/docs/${PAGE}#${slugifyMarkdownHeading(HEADING.slice(3))}`;

    expect(address).toBe(
      "https://oneuptime.com/docs/emails/email-providers#set-the-servers-email-with-environment-variables",
    );
    expect(readRepo(CHART_VALUES)).toContain(`# ${address}\nemail:\n`);
    expect(readRepo("config.example.env")).toContain(`# ${address}\n`);
  });

  it("the refusals it names are the chart's", () => {
    const helpers: string = readRepo(CHART_HELPERS);

    expect(section).toContain(
      "The chart refuses other `email` values without `email.serverType`, settings without the password or key they read, a password or key given both in the values and in a Secret, and a Secret the settings read nothing from.",
    );

    for (const refusal of [
      "email.serverType is empty, so OneUptime reads none of the other email values, and these are set:",
      "is empty, and so is email.existingSecret.name:",
      "and email.existingSecret.name are both set.",
      "but the email settings these values describe read no password or key, so nothing would read the Secret",
    ]) {
      expect(helpers).toContain(refusal);
    }
  });

  it("the server type is the switch, and settings with a problem send nothing", () => {
    const values: Record<string, string> = example();
    const usable: Environment = { ...values, [V.SmtpPassword]: PASSWORD };

    expect(section).toContain(
      "Once `GLOBAL_EMAIL_SERVER_TYPE` is set, the server sends its own email the way the variables describe.",
    );
    expect(section).toContain(
      "Leave `GLOBAL_EMAIL_SERVER_TYPE` empty to set email up in the Admin Dashboard instead.",
    );
    expect(read({}).isSet).toBe(false);

    // The page's example, with the password its Secret holds, sends.
    expect(values[V.ServerType]).toBe("custom-smtp");
    expect(ServerEmailEnvironment.isUsable(read(usable))).toBe(true);

    // The same values without the type set nothing, and the server says so.
    const withoutType: ServerEmailEnvironmentReading = read({
      ...usable,
      [V.ServerType]: "",
    });

    expect(withoutType.isSet).toBe(false);
    expect(withoutType.problems.join(" ")).toContain(V.SmtpHost);

    /*
     * The page's examples of a wrong value: each sends nothing, and the
     * server's log names the variable.
     */
    expect(section).toContain(
      "such as a port that is not a number or a missing password, the server sends no email until it is fixed; the server's log, the Admin Dashboard's email settings and the checklist at `/admin/setup` name the variable.",
    );

    for (const [variable, wrong] of [
      [V.SmtpPort, "smtp"],
      [V.SmtpPassword, ""],
    ] as Array<[ServerEmailEnvironmentVariable, string]>) {
      const reading: ServerEmailEnvironmentReading = read({
        ...usable,
        [variable]: wrong,
      });

      expect({
        variable,
        sends: ServerEmailEnvironment.isUsable(reading),
        named: reading.problems.some((problem: string): boolean => {
          return problem.includes(variable);
        }),
        logged: (
          ServerEmailEnvironment.getStartupWarning(reading) || ""
        ).includes(variable),
      }).toEqual({ variable, sends: false, named: true, logged: true });
    }
  });

  it("names a variable the server type does not read as unused", () => {
    const reading: ServerEmailEnvironmentReading = read({
      ...SENDGRID,
      [V.SmtpHost]: "smtp.example.com",
      [V.MailgunDomain]: "mg.example.com",
    });

    expect(section).toContain(
      "Only the variables the server type reads are used: the `GLOBAL_EMAIL_SMTP_` ones for `custom-smtp`, and a provider's own for that provider. The server's log and the Admin Dashboard name any other that is set, as unused.",
    );
    expect(ServerEmailEnvironment.isUsable(reading)).toBe(true);
    expect(reading.ignored).toEqual([V.SmtpHost, V.MailgunDomain]);
    expect(ServerEmailEnvironment.toAnswer(reading).ignored).toEqual([
      V.SmtpHost,
      V.MailgunDomain,
    ]);
    expect(ServerEmailEnvironment.getStartupWarning(reading)).toContain(
      `${V.SmtpHost} and ${V.MailgunDomain} are set`,
    );

    // A mail server's own variables are the ones custom-smtp reads.
    for (const environment of [SMTP, SMTP_OAUTH]) {
      expect(read(environment).ignored).toEqual([]);
    }
  });

  it("never shows a password or a key", () => {
    expect(section).toContain("Passwords and keys are never shown.");

    for (const environment of SENDING) {
      const secrets: Array<string> = SERVER_EMAIL_SECRET_VARIABLES.map(
        (variable: ServerEmailEnvironmentVariable): string => {
          return environment[variable] || "";
        },
      ).filter(Boolean);
      const reading: ServerEmailEnvironmentReading = read(environment);
      const wrong: ServerEmailEnvironmentReading = read({
        ...environment,
        [V.FromEmail]: "alerts at example.com",
      });
      const told: string = JSON.stringify([
        ServerEmailEnvironment.toAnswer(reading),
        ServerEmailEnvironment.toAnswer(wrong),
        ServerEmailEnvironment.getStartupNotice(reading),
        ServerEmailEnvironment.getStartupWarning(wrong),
      ]);

      expect({
        serverType: environment[V.ServerType],
        sends: ServerEmailEnvironment.isUsable(reading),
        secrets: secrets.length,
        shown: secrets.filter((secret: string): boolean => {
          return told.includes(secret);
        }),
      }).toEqual({
        serverType: environment[V.ServerType],
        sends: true,
        secrets: 1,
        shown: [],
      });
    }
  });

  it("the Admin Dashboard does not change them: the server refuses the write", () => {
    expect(section).toContain(
      "To change the settings, change the variables and restart OneUptime: the Admin Dashboard does not change them.",
    );
    expect(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "so they cannot be changed in the Admin Dashboard",
    );
    expect(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "and restart OneUptime.",
    );
    expect(
      readRepo("packages/Common/Server/Services/GlobalConfigService.ts"),
    ).toContain("SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE");
  });

  it("no server code reads the variables but through the one reader", () => {
    // process.env["GLOBAL_EMAIL_..."] or process.env.GLOBAL_EMAIL_...
    const DIRECT_READ: RegExp =
      /process\.env\[\s*["'`]GLOBAL_EMAIL_|process\.env\.GLOBAL_EMAIL_/;
    const readers: Array<string> = [
      ...serverSourcesUnder("packages/App"),
      ...serverSourcesUnder("packages/Common/Server"),
    ].filter((file: string): boolean => {
      return DIRECT_READ.test(readRepo(file));
    });

    expect(readers).toEqual([]);
  });

  describe("in every docs language", () => {
    const englishRows: Array<Array<string>> = rows;
    const englishProse: Array<string> = inlineCodes(
      proseOutsideTables(section),
    ).sort();
    const englishFences: Array<{ info: string; body: string }> =
      fencesOf(section);

    it.each(DOCS_LANGUAGES)(
      "%s: the section has English's table, examples and values, and the page links to it",
      (language: string): void => {
        const markdown: string = readPage(language, PAGE);
        const heading: string = variablesHeadingOf(markdown);
        const translated: string = sectionOf(markdown, heading);
        const anchor: string = slugifyMarkdownHeading(heading.slice(3));
        const translatedRows: Array<Array<string>> = tableRows(translated);
        const lines: Array<string> = markdown.split("\n");
        const cardsStart: number = lines.indexOf(":::cards");
        const cards: Array<string> = lines.slice(
          cardsStart + 1,
          lines.indexOf(":::", cardsStart + 1),
        );
        const tabs: Array<number> = lines
          .map((line: string, index: number): number => {
            return line.startsWith("@tab ") ? index : -1;
          })
          .filter((index: number): boolean => {
            return index >= 0;
          });
        const selfHosted: string = lines[(tabs[1] as number) + 1] || "";

        expect({
          language,
          heading: heading.startsWith("## "),
          headings: proseLines(translated).filter(
            (line: string | null): boolean => {
              return HEADING_MARKS.test(line || "");
            },
          ).length,
          columns: (translatedRows[0] || []).length,
          rows: translatedRows.slice(1).map((row: Array<string>): unknown => {
            return [
              unwrap(row[0] as string),
              inlineCodes(row[1] as string),
              inlineCodes(row[2] as string).sort(),
            ];
          }),
          prose: inlineCodes(proseOutsideTables(translated)).sort(),
          fences: fencesOf(translated),
          // The card before Troubleshooting's, and the self-hosted tab, link to it.
          card:
            (cards[cards.length - 2] || "").startsWith("- [") &&
            (cards[cards.length - 2] || "").includes(`](#${anchor}): `),
          tab: selfHosted.includes(`[${heading.slice(3)}](#${anchor})`),
        }).toEqual({
          language,
          heading: true,
          headings: 1,
          columns: 3,
          rows: englishRows.map((row: Array<string>): unknown => {
            return [
              unwrap(row[0] as string),
              inlineCodes(row[1] as string),
              inlineCodes(row[2] as string).sort(),
            ];
          }),
          prose: englishProse,
          fences: englishFences,
          card: true,
          tab: true,
        });
      },
    );
  });
});
