import Phone from "Common/Types/Phone";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import {
  CodeBlock,
  HclAttribute,
  HclBlock,
  HclBody,
  HclValue,
  ProviderAttribute,
  ProviderSchema,
  ProviderType,
  attributeNamed,
  codeBlocks,
  parseHcl,
  readProvider,
  referencesInBody,
} from "./TerraformDocsSupport";
import { beforeAll, describe, expect, it } from "@jest/globals";

/*
 * A project's own Twilio account and mail server in the Terraform provider
 * (#7737), as the two pages that set them up describe them, in every docs
 * language.
 *
 *   - self-hosted/twilio-integration.md, "Manage project configurations with
 *     Terraform": a project configuration is `oneuptime_call_and_sms_config`,
 *     an example that takes the Auth Token from a sensitive variable, and
 *     what someone managing one from Terraform must know - Terraform sends
 *     `false` for a project default left out, OneUptime sets the defaults
 *     for SMS and calls, a number may be grouped (OneUptime keeps its
 *     digits, and Terraform reads them as the number written), the API key
 *     must be able to read the token, and what takes a configuration's
 *     `id`.
 *   - emails/smtp.md, the Terraform paragraph: `oneuptime_smtp_config`, its
 *     sensitive credentials, the API key, and a status page's
 *     `smtp_config_id`.
 *
 * Held to the provider the generator builds from the real spec
 * (readProvider): a page cannot name an attribute the provider lacks, set
 * one it only reads, or call a credential sensitive that a plan prints.
 * The roles are named as each language's Dashboard draws them; permission
 * names stay English, as the Dashboard shows them.
 */

const TWILIO_PAGE: string = "self-hosted/twilio-integration";
const SMTP_PAGE: string = "emails/smtp";

const TWILIO_RESOURCE: string = "call_and_sms_config";
const SMTP_RESOURCE: string = "smtp_config";

// What a plan, a log and an output never print.
const TWILIO_SECRETS: Array<string> = ["twilio_auth_token"];
const SMTP_SECRETS: Array<string> = [
  "amazon_ses_secret_access_key",
  "client_secret",
  "mailgun_api_key",
  "password",
  "postmark_server_token",
  "resend_api_key",
  "sendgrid_api_key",
];

// Who may read them, besides the config's own Read permission.
const ROLES: Array<string> = ["Project Owner", "Project Admin"];

// Twilio shows a number as `+`, the country code and the number.
const E164: RegExp = /^\+[1-9][0-9]{7,14}$/;

// The grouped number the page writes, and what it says OneUptime keeps.
const GROUPED_NUMBER: string = "+1 415 555 0100";
const KEPT_NUMBER: string = "+14155550100";

// A Markdown heading, of any level.
const HEADING: RegExp = /^#{1,6} /;

let provider: ProviderSchema;

beforeAll(async () => {
  provider = await readProvider();
}, 300000);

function resource(name: string): ProviderType {
  const type: ProviderType | undefined = provider.resources.get(name);

  if (!type) {
    throw new Error(`The provider has no resource ${name}.`);
  }

  return type;
}

function attributeOf(type: ProviderType, name: string): ProviderAttribute {
  const attribute: ProviderAttribute | undefined = type.attributes.get(name);

  if (!attribute) {
    throw new Error(`${type.name} has no attribute ${name}.`);
  }

  return attribute;
}

function sensitiveAttributes(type: ProviderType): Array<string> {
  return Array.from(type.attributes.values())
    .filter((attribute: ProviderAttribute): boolean => {
      return attribute.sensitive;
    })
    .map((attribute: ProviderAttribute): string => {
      return attribute.name;
    })
    .sort();
}

/*
 * The page's "###" section that names the resource: from its heading to the
 * next heading, outside code fences.
 */
function headingsOf(markdown: string): Array<{ line: number; text: string }> {
  const headings: Array<{ line: number; text: string }> = [];
  let inFence: boolean = false;

  markdown.split("\n").forEach((line: string, index: number) => {
    if (line.startsWith("```")) {
      inFence = !inFence;
      return;
    }

    if (!inFence && HEADING.test(line)) {
      headings.push({ line: index, text: line });
    }
  });

  return headings;
}

interface Section {
  // Its place among the page's headings, from 0.
  index: number;
  heading: string;
  body: string;
}

function terraformSection(lang: string): Section {
  const markdown: string = readPage(lang, TWILIO_PAGE);
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<{ line: number; text: string }> = headingsOf(markdown);

  const sections: Array<Section> = headings.map(
    (heading: { line: number; text: string }, index: number): Section => {
      const end: number =
        index + 1 < headings.length ? headings[index + 1]!.line : lines.length;

      return {
        index: index,
        heading: heading.text,
        body: lines.slice(heading.line + 1, end).join("\n"),
      };
    },
  );

  const named: Array<Section> = sections.filter((section: Section) => {
    return section.body.includes(`resource "oneuptime_${TWILIO_RESOURCE}"`);
  });

  expect({ lang: lang, sections: named.length }).toEqual({
    lang: lang,
    sections: 1,
  });

  return named[0]!;
}

function bulletsOf(body: string): Array<string> {
  return body.split("\n").filter((line: string): boolean => {
    return line.startsWith("- **");
  });
}

function hclBlocksOf(body: string): Array<CodeBlock> {
  return codeBlocks(body).filter((block: CodeBlock): boolean => {
    return block.lang === "hcl";
  });
}

function blockOf(body: HclBody, type: string, label: string): HclBlock {
  const found: Array<HclBlock> = body.blocks.filter((block: HclBlock) => {
    return block.type === type && block.labels[0] === label;
  });

  expect(found).toHaveLength(1);

  return found[0]!;
}

// The Terraform paragraph of the SMTP page.
function smtpParagraph(lang: string): string {
  const paragraphs: Array<string> = readPage(lang, SMTP_PAGE)
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes(`oneuptime_${SMTP_RESOURCE}`);
    });

  expect({ lang: lang, paragraphs: paragraphs.length }).toEqual({
    lang: lang,
    paragraphs: 1,
  });

  return paragraphs[0]!;
}

describe("the provider the pages describe", () => {
  it("has a resource and a data source for each", () => {
    for (const name of [TWILIO_RESOURCE, SMTP_RESOURCE]) {
      expect(provider.resources.has(name)).toBe(true);
      expect(provider.dataSources.has(name)).toBe(true);
    }
  });

  it("keeps the Auth Token, the mail server's password, the OAuth client secret and the email providers' keys out of plans", () => {
    expect(sensitiveAttributes(resource(TWILIO_RESOURCE))).toEqual(
      TWILIO_SECRETS,
    );
    expect(sensitiveAttributes(resource(SMTP_RESOURCE))).toEqual(SMTP_SECRETS);

    for (const name of [TWILIO_RESOURCE, SMTP_RESOURCE]) {
      const dataSource: ProviderType = provider.dataSources.get(name)!;
      const secrets: Array<string> =
        name === TWILIO_RESOURCE ? TWILIO_SECRETS : SMTP_SECRETS;

      expect(sensitiveAttributes(dataSource)).toEqual(secrets);
    }
  });

  it("writes and reads back each credential, so a plan sees a token changed outside Terraform", () => {
    for (const secret of TWILIO_SECRETS) {
      const attribute: ProviderAttribute = attributeOf(
        resource(TWILIO_RESOURCE),
        secret,
      );

      expect(attribute.settable).toBe(true);
      expect(attribute.readBack).toBe(true);
    }

    for (const secret of SMTP_SECRETS) {
      const attribute: ProviderAttribute = attributeOf(
        resource(SMTP_RESOURCE),
        secret,
      );

      expect(attribute.settable).toBe(true);
      expect(attribute.readBack).toBe(true);
    }
  });

  it("lets a configuration set is_project_default, and only read the defaults for SMS and calls", () => {
    const twilio: ProviderType = resource(TWILIO_RESOURCE);
    const isProjectDefault: ProviderAttribute = attributeOf(
      twilio,
      "is_project_default",
    );

    expect(isProjectDefault.settable).toBe(true);
    expect(isProjectDefault.required).toBe(false);
    expect(isProjectDefault.type).toBe("bool");

    for (const name of [
      "is_project_default_for_sms",
      "is_project_default_for_calls",
    ]) {
      const attribute: ProviderAttribute = attributeOf(twilio, name);

      expect({ name: name, settable: attribute.settable }).toEqual({
        name: name,
        settable: false,
      });
      expect(attribute.readBack).toBe(true);
      expect(attribute.type).toBe("bool");
    }
  });

  it("takes a configuration's id where the pages say", () => {
    const references: Array<[string, string, string]> = [
      ["status_page", "call_sms_config_id", TWILIO_RESOURCE],
      ["incoming_call_policy", "project_call_sms_config_id", TWILIO_RESOURCE],
      ["status_page", "smtp_config_id", SMTP_RESOURCE],
    ];

    for (const [owner, name, target] of references) {
      const attribute: ProviderAttribute = attributeOf(resource(owner), name);

      expect({
        owner: owner,
        name: name,
        relation: attribute.relation,
      }).toEqual({ owner: owner, name: name, relation: target });
      expect(attribute.settable).toBe(true);
    }
  });
});

describe("the Twilio page's Terraform section", () => {
  it("is in the same place in every language: after the server's own account, before separate numbers", () => {
    const english: Section = terraformSection("en");

    expect(english.heading).toBe(
      "### Manage project configurations with Terraform",
    );

    const englishHeadings: Array<string> = headingsOf(
      readPage("en", TWILIO_PAGE),
    ).map((heading: { text: string }): string => {
      return heading.text;
    });

    expect(englishHeadings[english.index + 1]).toBe(
      "### Separate numbers for calls and SMS",
    );

    for (const lang of DOCS_LANGUAGES) {
      const section: Section = terraformSection(lang);
      const levels: Array<string> = headingsOf(readPage(lang, TWILIO_PAGE)).map(
        (heading: { text: string }): string => {
          return heading.text.split(" ")[0]!;
        },
      );

      expect({ lang: lang, index: section.index }).toEqual({
        lang: lang,
        index: english.index,
      });
      expect({ lang: lang, levels: levels }).toEqual({
        lang: lang,
        levels: englishHeadings.map((text: string): string => {
          return text.split(" ")[0]!;
        }),
      });
      expect(section.heading.startsWith("### ")).toBe(true);
      expect(section.heading).toContain("Terraform");
    }
  });

  it("has one example, the same in every language", () => {
    const english: Array<CodeBlock> = hclBlocksOf(terraformSection("en").body);

    expect(english).toHaveLength(1);

    for (const lang of DOCS_LANGUAGES) {
      const blocks: Array<CodeBlock> = hclBlocksOf(terraformSection(lang).body);

      expect({ lang: lang, examples: blocks.length }).toEqual({
        lang: lang,
        examples: 1,
      });
      expect({ lang: lang, code: blocks[0]!.code }).toEqual({
        lang: lang,
        code: english[0]!.code,
      });
    }
  });

  it("sets only what a configuration may set, every attribute it needs, and the values OneUptime takes", () => {
    const body: HclBody = parseHcl(
      hclBlocksOf(terraformSection("en").body)[0]!.code,
    );
    const config: HclBlock = blockOf(
      body,
      "resource",
      `oneuptime_${TWILIO_RESOURCE}`,
    );
    const twilio: ProviderType = resource(TWILIO_RESOURCE);
    const set: Array<string> = config.body.attributes.map(
      (attribute: HclAttribute): string => {
        return attribute.name;
      },
    );

    for (const name of set) {
      expect({
        name: name,
        settable: attributeOf(twilio, name).settable,
      }).toEqual({ name: name, settable: true });
    }

    const required: Array<string> = Array.from(twilio.attributes.values())
      .filter((attribute: ProviderAttribute): boolean => {
        return attribute.required;
      })
      .map((attribute: ProviderAttribute): string => {
        return attribute.name;
      });

    for (const name of required) {
      expect(set).toContain(name);
    }

    const valueOf: (name: string) => HclValue = (name: string): HclValue => {
      return attributeNamed(config.body.attributes, name)!.value;
    };

    const usedFor: HclValue = valueOf("used_for");

    expect(usedFor.kind).toBe("string");
    expect(attributeOf(twilio, "used_for").enumValues).toContain(
      (usedFor as { value: string }).value,
    );

    const phone: HclValue = valueOf("twilio_primary_phone_number");

    expect(phone.kind).toBe("string");
    expect((phone as { value: string }).value).toMatch(E164);

    expect(valueOf("is_project_default")).toMatchObject({
      kind: "bool",
      value: true,
    });
  });

  it("takes the Auth Token from a sensitive variable, never writes it out", () => {
    const body: HclBody = parseHcl(
      hclBlocksOf(terraformSection("en").body)[0]!.code,
    );
    const config: HclBlock = blockOf(
      body,
      "resource",
      `oneuptime_${TWILIO_RESOURCE}`,
    );

    expect(
      attributeNamed(config.body.attributes, "twilio_auth_token"),
    ).toMatchObject({
      value: { kind: "reference", path: "var.twilio_auth_token" },
    });
    expect(referencesInBody(config.body)).toEqual(["var.twilio_auth_token"]);

    const variable: HclBlock = blockOf(body, "variable", "twilio_auth_token");

    expect(
      attributeNamed(variable.body.attributes, "sensitive")?.value,
    ).toMatchObject({ kind: "bool", value: true });
    expect(attributeNamed(variable.body.attributes, "default")).toBeUndefined();
  });

  it("names, in every language, the attributes and the permission it is about, and links the provider", () => {
    for (const lang of DOCS_LANGUAGES) {
      const body: string = terraformSection(lang).body;
      const prose: string = body
        .split("\n")
        .filter((line: string): boolean => {
          return !line.startsWith("  ") && !line.startsWith("```");
        })
        .join("\n");

      for (const named of [
        `\`oneuptime_${TWILIO_RESOURCE}\``,
        "`is_project_default = true`",
        "`false`",
        "`used_for`",
        "`is_project_default_for_sms`",
        "`is_project_default_for_calls`",
        "`call_sms_config_id`",
        "`project_call_sms_config_id`",
        "`id`",
        "`+`",
        `\`${GROUPED_NUMBER}\``,
        `\`${KEPT_NUMBER}\``,
        "**Read Call and SMS**",
        "](/docs/terraform/index)",
      ]) {
        expect({ lang: lang, named: prose.includes(named) }).toEqual({
          lang: lang,
          named: true,
        });
      }

      expect({ lang: lang, bullets: bulletsOf(body).length }).toEqual({
        lang: lang,
        bullets: 4,
      });
    }
  });

  /*
   * The page says a grouped number applies: OneUptime keeps its digits, and
   * the provider reads them as the number written (#7777). Before, it had to
   * tell people to write no spaces.
   */
  it("says OneUptime keeps a grouped number as its digits, as it does, and the provider takes them for the number written", () => {
    expect(new Phone(GROUPED_NUMBER).toString()).toBe(KEPT_NUMBER);

    for (const type of [
      resource(TWILIO_RESOURCE),
      provider.dataSources.get(TWILIO_RESOURCE)!,
    ]) {
      expect([
        type.name,
        attributeOf(type, "twilio_primary_phone_number").isPhone,
      ]).toEqual([type.name, true]);
    }
    expect(
      attributeOf(resource(TWILIO_RESOURCE), "twilio_primary_phone_number")
        .settable,
    ).toBe(true);

    for (const lang of DOCS_LANGUAGES) {
      const bullet: string | undefined = bulletsOf(
        terraformSection(lang).body,
      ).find((candidate: string): boolean => {
        return candidate.includes("`+`");
      });

      const grouped: number = (bullet || "").indexOf(`\`${GROUPED_NUMBER}\``);
      const kept: number = (bullet || "").indexOf(`\`${KEPT_NUMBER}\``);

      // "OneUptime keeps `+1 415 555 0100` as `+14155550100`", in that order.
      expect({
        lang: lang,
        grouped: grouped !== -1,
        keptAfter: kept > grouped,
      }).toEqual({ lang: lang, grouped: true, keptAfter: true });
    }
  });

  it("names the roles that read the token as each language's Dashboard draws them", () => {
    for (const lang of DOCS_LANGUAGES) {
      const body: string = terraformSection(lang).body;

      for (const role of ROLES) {
        const drawn: string = drawnDashboardLabel(lang, role);

        expect({
          lang: lang,
          role: role,
          named: body.includes(`**${drawn}**`),
        }).toEqual({ lang: lang, role: role, named: true });
      }
    }
  });
});

describe("the SMTP page's Terraform paragraph", () => {
  it("names the resource, the status page's attribute, the permission and the roles, and links the provider, in every language", () => {
    for (const lang of DOCS_LANGUAGES) {
      const paragraph: string = smtpParagraph(lang);

      expect(paragraph.startsWith("**Terraform.** ")).toBe(true);

      for (const named of [
        `\`oneuptime_${SMTP_RESOURCE}\``,
        "`smtp_config_id`",
        "`id`",
        "**Read SMTP Config**",
        "](/docs/terraform/index)",
        ...ROLES.map((role: string): string => {
          return `**${drawnDashboardLabel(lang, role)}**`;
        }),
      ]) {
        expect({ lang: lang, named: paragraph.includes(named) }).toEqual({
          lang: lang,
          named: true,
        });
      }
    }
  });

  it("follows the Microsoft Graph paragraph, before the note on private addresses", () => {
    for (const lang of DOCS_LANGUAGES) {
      const lines: Array<string> = readPage(lang, SMTP_PAGE).split("\n");
      const at: number = lines.indexOf(smtpParagraph(lang));

      expect({
        lang: lang,
        before: lines[at - 2]!.startsWith("**Microsoft Graph.**"),
      }).toEqual({ lang: lang, before: true });
      expect(lines[at - 1]).toBe("");
      expect(lines[at + 1]).toBe("");
      expect({ lang: lang, after: lines[at + 2] }).toEqual({
        lang: lang,
        after: "> [!NOTE]",
      });
    }
  });
});
