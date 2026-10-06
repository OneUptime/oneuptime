import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed. A project that drops below a feature's plan keeps what it set up -
 * SSO providers that still sign people in, SCIM connections that still
 * provision them, Slack and Microsoft Teams rules that still post, API keys
 * that still authenticate, schedules that still page people - and every plan
 * can read it, switch it off and delete it (Common/Types/Billing/
 * PlanGatedTable); creating, changing and switching back on still need the
 * plan. The English guides say where that is done and what is left gated.
 * Markdown is not compiled, so nothing else notices a guide that falls
 * behind.
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

describe("the API reference", () => {
  const section: string = sectionOf(
    readPage("en/api-reference/api-reference.md"),
    "### Features your plan does not include",
  );

  it("names what each plan sells and the 402 that names the plan", () => {
    expect(section).toContain(
      "single sign-on providers and SCIM connections on **Scale**; API keys, on-call schedules, and Slack and Microsoft Teams notification rules and summaries on **Growth**",
    );
    expect(section).toContain(
      "Creating one, changing one or switching one on needs that plan. Below it, the request is refused with `402 Payment Required`, and the message names the plan.",
    );
  });

  it("says what a project may still do with what it has: read, switch off with isEnabled alone, delete", () => {
    expect(section).toContain("- you can list and read those records;");
    expect(section).toContain(
      '- you can switch one off, on a resource with an `isEnabled` field, by sending `"isEnabled": false` and nothing else;',
    );
    expect(section).toContain("- you can delete them.");
  });

  it("says the permissions are unchanged, and which reads stay gated", () => {
    expect(section).toContain(
      "The usual permissions still decide who can do each, exactly as on the plan.",
    );
    expect(section).toContain(
      "such as on-call logs and form submissions; reading those is part of what the plan sells, so it still needs the plan.",
    );
  });

  it("says a leaked API key can always be revoked", () => {
    expect(section).toContain(
      "Below **Growth**, **Project Settings** > **API Keys** lists the keys the project still has, so any of them can be deleted (revoked) on every plan.",
    );
  });
});

describe("the SSO guide", () => {
  const section: string = sectionOf(
    readPage("en/identity/sso.md"),
    "## Providers left below the Scale plan",
  );

  it("lists the providers under the upsell, with Turn off and Delete", () => {
    expect(section).toContain(
      "below Scale, the **SSO** and **OIDC** pages list the project's providers under the upsell (**SAML providers still set up**, **OIDC providers still set up**):",
    );
    expect(section).toContain("- **Turn off** stops a provider at once.");
    expect(section).toContain("- **Delete** removes it.");
    expect(section).toContain(
      "Adding a provider, changing one or turning it on again needs **Scale**.",
    );
  });

  it("says who can do it is unchanged", () => {
    expect(section).toContain(
      "turning a provider off needs permission to edit it, deleting it permission to delete it.",
    );
  });

  it("warns to let a status page's private users back in first", () => {
    expect(section).toContain(
      "While the status page still requires SSO, its **SSO** page also shows **Require SSO for Login**: turn it off before you turn its providers off, or its private users cannot sign in at all.",
    );
  });
});

describe("the SCIM guide", () => {
  const section: string = sectionOf(
    readPage("en/identity/scim.md"),
    "### Below the Scale plan",
  );

  it("lists the connections under the upsell, and deleting is how one stops", () => {
    expect(section).toContain(
      "list the connections under the plan's upsell (**SCIM connections still set up**). Delete a connection to stop it.",
    );
    expect(section).toContain(
      "Adding a connection, changing one or replacing its bearer token needs **Scale**.",
    );
  });

  it("keeps the bearer token owner-only", () => {
    expect(section).toContain(
      "The list does not show bearer tokens, and only project owners can read a token, on every plan.",
    );
  });
});

describe("the Slack and Microsoft Teams guides", () => {
  it.each([
    ["en/workspace-connections/slack.md", "Slack"],
    ["en/workspace-connections/microsoft-teams.md", "Microsoft Teams"],
  ])(
    "%s says the rules and summaries still post, and what can be done with them",
    (page: string, name: string) => {
      const section: string = sectionOf(
        readPage(page),
        "## Notification rules below the Growth plan",
      );

      expect(section).toContain(
        `A project below it keeps the rules and summaries it already has, and they keep posting to ${name}.`,
      );
      expect(section).toContain(
        "(**Notification rules still set up**, **Summaries still set up**): delete a rule, or turn a summary off or delete it. Adding or changing rules and summaries needs **Growth**.",
      );
    },
  );
});

describe("the on-call schedules guide", () => {
  /*
   * In the page's opening, before its first section: the page keeps its
   * three sections in every language (OnCallSchedulesDocsPage.test.ts).
   */
  it("says a schedule keeps paging, and where to delete it", () => {
    const page: string = readPage("en/on-call/schedules.md");
    const opening: string = page.slice(0, page.indexOf("\n## "));

    expect(opening).toContain(
      "On OneUptime Cloud, on-call schedules are on the **Growth** plan and above.",
    );
    expect(opening).toContain(
      "A schedule a project still has keeps paging the people on it, through the escalation rules that name it, after a Growth trial ends or the plan goes down.",
    );
    expect(opening).toContain(
      "So below **Growth**, the **On-Call Schedules** page shows the plan note with the schedules still set up under it, where you can delete them. Creating or changing a schedule needs **Growth**.",
    );
  });
});

describe("the Terraform troubleshooting guide", () => {
  it("says plan, import and destroy work below the plan, and what still answers 402", () => {
    const page: string = readPage("en/terraform/troubleshooting.md");

    expect(page).toContain(
      "below the plan, the ones the project already has can still be read (so `terraform plan` and `import` work), deleted (so removing them from the configuration, or `terraform destroy`, applies), and switched off where they have an `is_enabled` attribute. Creating them, changing them or switching them on again still answers 402.",
    );
  });
});
