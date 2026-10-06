import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  getApiKeysStoppedMessage,
  getScimStoppedMessage,
} from "Common/Types/Billing/PlanCutoffCredentials";

/*
 * On OneUptime Cloud, a project's API keys stop working below Growth and its
 * SCIM connections below Scale, until the project is back on the plan
 * (Common/Types/Billing/PlanCutoffCredentials). This changes what existing
 * customers, API clients and Terraform see, so every guide that tells them
 * how to authenticate says it - with the exact refusal the server sends,
 * read from the same module, so the guides cannot drift from it. Markdown
 * is not compiled, so nothing else notices a guide that falls behind.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text of a heading's section, up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const marker: string = `\n${heading}\n`;
  const start: number = page.indexOf(marker);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const level: string = heading.split(" ")[0] as string;
  const rest: string = page.slice(start + marker.length);
  const stops: Array<number> = [
    "\n# ",
    "\n## ",
    level === "###" ? "\n### " : "",
  ]
    .filter((stop: string): boolean => {
      return Boolean(stop);
    })
    .map((stop: string): number => {
      return rest.indexOf(stop);
    })
    .filter((position: number): boolean => {
      return position >= 0;
    });

  return stops.length > 0 ? rest.slice(0, Math.min(...stops)) : rest;
}

// The anchor the docs renderer gives a heading.
function anchorOf(heading: string): string {
  return slugify(heading.replace(/^#+\s*/, ""));
}

const KEYS_HEADING: string = "### API keys and SCIM below their plan";
const KEYS_LINK: string = `/docs/api-reference/api-reference#${anchorOf(KEYS_HEADING)}`;

describe("the API reference", () => {
  const section: string = sectionOf(
    readPage("en/api-reference/api-reference.md"),
    KEYS_HEADING,
  );

  it("names the plan each needs", () => {
    expect(section).toContain(
      "a project's API keys work only while the project is on **Growth** or above, and its SCIM connections - the project's own and its status pages' - only while it is on **Scale** or above.",
    );
  });

  it("says every request made with a key is refused with 402, whatever uses the key", () => {
    expect(section).toContain(
      "Every request made with one of the project's API keys is refused with `402 Payment Required`, whatever it asks for: the REST API, and everything that calls it with an API key - Terraform, the `oneuptime` CLI, MCP clients connected with an API key, workflows that send one in a request header, and your own scripts.",
    );
  });

  it("quotes the exact refusal the server sends", () => {
    expect(section).toContain(`\`${getApiKeysStoppedMessage("Growth")}\``);
  });

  it("says SCIM is refused in the SCIM error format, and that deprovisioning stops too", () => {
    expect(section).toContain(
      "Every SCIM request for one of its connections is refused with `402`, in the SCIM error format, so your identity provider shows why. That stops deprovisioning as well as provisioning",
    );
  });

  it("says nothing is deleted, an upgrade turns them back on as they are, and how soon", () => {
    expect(section).toContain("Nothing is deleted or switched off.");
    expect(section).toContain(
      "they work again as they are as soon as the project is back on the plan: no new keys to make, nothing to set up again in your identity provider. A plan change takes effect within a minute.",
    );
  });

  it("says where to see what stopped, and that owners are told", () => {
    expect(section).toContain(
      "**Project Settings** > **Billing** names how many API keys and SCIM connections a lower plan stops, on each plan you can pick, and how many the project's plan has stopped; the project's owners get an email when a plan change stops them.",
    );
  });

  it("says what is not affected: people, other keys, self-hosted installs", () => {
    expect(section).toContain(
      "People are not affected: signing in to the dashboard, and MCP clients connected by signing in, work as before.",
    );
    expect(section).toContain(
      "Telemetry ingestion keys, probe keys and agent keys are not API keys, and keep working.",
    );
    expect(section).toContain(
      "Self-hosted installs have no plans, so nothing changes for them.",
    );
  });
});

describe("the SCIM guide", () => {
  const section: string = sectionOf(
    readPage("en/identity/scim.md"),
    "### Below the Scale plan",
  );

  it("quotes the exact refusal identity providers get", () => {
    expect(section).toContain(`\`${getScimStoppedMessage("Scale")}\``);
  });

  it("says deprovisioning stops, and to remove people by hand meanwhile", () => {
    expect(section).toContain(
      "That stops deprovisioning as well as provisioning: until the project is back on **Scale**, remove anyone who leaves from the project by hand.",
    );
  });

  it("says the same token works again, with nothing to set up again", () => {
    expect(section).toContain(
      "Upgrade to **Scale** and the connections work again as they are, with the same bearer token and nothing to set up again in your identity provider",
    );
  });

  it("says what Okta and Entra ID do meanwhile", () => {
    expect(section).toContain(
      "Okta lists the refusals among its provisioning errors, and Entra ID shows them in its provisioning logs and may quarantine a job that keeps failing - restart provisioning there after you upgrade.",
    );
  });

  it("no longer says a connection keeps provisioning below the plan", () => {
    expect(section).not.toContain("keeps provisioning people");
  });
});

describe("the MCP server guide", () => {
  const page: string = readPage("en/ai/mcp-server.md");

  it("says an API-key client is refused with 402 below Growth, and a signed-in one is not", () => {
    expect(page).toContain(
      "Below it, every tool that needs the key answers `402` with a message that names the plan, and the agent is told not to retry.",
    );
    expect(page).toContain(
      "A client connected by signing in acts as a person and keeps working",
    );
    expect(page).toContain(KEYS_LINK);
  });

  it("explains the 402 under Invalid API Key", () => {
    expect(sectionOf(page, "### Invalid API Key")).toContain(
      "a `402` that says API keys need the Growth plan means the project is below it",
    );
  });
});

describe("the Terraform troubleshooting guide", () => {
  const page: string = readPage("en/terraform/troubleshooting.md");

  it("says every request is refused below Growth, plan included, and that the same key works again", () => {
    expect(page).toContain(
      "- **402 Payment Required on every request** — `API keys need the Growth plan...`: on OneUptime Cloud, the project is below **Growth**, and a project's API keys - the provider's included - stop working below it.",
    );
    expect(page).toContain(
      "Every call the provider makes is refused, `terraform plan` too, until the project is back on Growth; then the same key works again, with nothing to change in your configuration.",
    );
    expect(page).toContain(KEYS_LINK);
  });
});

describe("the CLI authentication guide", () => {
  it("says what the CLI answers below Growth", () => {
    expect(readPage("en/cli/authentication.md")).toContain(
      "Below it, every command answers `API error (402)` with a message that names the plan, until the project is upgraded; then the same key works again.",
    );
  });
});

describe("the upgrade notes", () => {
  it("list the change for existing customers among the other changes in 14", () => {
    const section: string = sectionOf(
      readPage("en/installation/upgrading.md"),
      "### Other changes in 14",
    ).replace(/\s+/g, " ");

    expect(section).toContain(
      "**On OneUptime Cloud, API keys and SCIM stop working below their plan.**",
    );
    expect(section).toContain(
      "Until now they kept working after a trial ended or the project moved to a lower plan.",
    );
    expect(section).toContain("self-hosted installs (no plans) see no change.");
    expect(section).toContain(KEYS_LINK);
  });
});

describe("the links between the guides", () => {
  it("point at headings that exist", () => {
    expect(readPage("en/api-reference/api-reference.md")).toContain(
      `\n${KEYS_HEADING}\n`,
    );
    expect(readPage("en/api-reference/api-reference.md")).toContain(
      `/docs/identity/scim#${anchorOf("### Below the Scale plan")}`,
    );
    expect(readPage("en/identity/scim.md")).toContain(
      "\n### Below the Scale plan\n",
    );
  });
});

describe("the pricing page", () => {
  it("answers what happens to API keys and SCIM on a lower plan", () => {
    const pricing: string = fs
      .readFileSync(path.join(REPO_ROOT, "Home/Views/pricing.ejs"), "utf8")
      .replace(/\s+/g, " ");

    expect(pricing).toContain(
      "What happens to API keys and SCIM if I move to a lower plan?",
    );
    expect(pricing).toContain(
      "API keys need the Growth plan and SCIM provisioning needs the Scale plan. On a lower plan they stop working",
    );
    expect(pricing).toContain(
      "Nothing is deleted &mdash; they work again as they are as soon as you are back on the plan.",
    );
  });
});
