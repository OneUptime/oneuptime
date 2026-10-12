import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English guides say about global and status page SSO providers
 * ending their sign-ins, about changes that would leave a project with no
 * provider to sign in with, and about turning Require SSO for Login on:
 *
 *   - a global provider turned off or deleted ends its sign-ins, and turning
 *     it on again does not bring them back (Common/Server/Utils/
 *     SsoSignInsEnded);
 *   - a change to a global provider or its attachments that would strand a
 *     project that requires SSO is refused, naming the projects
 *     (Common/Server/Utils/GlobalSsoProviderChanges);
 *   - Require SSO for Login, for a project or for the whole server, needs a
 *     provider that signs people in (Common/Server/Utils/
 *     SsoRequirementChanges);
 *   - a new project needs a global provider that signs people in to every
 *     project while the server requires SSO, or when it is created with
 *     Require SSO for Login on (SsoRequirementChanges.beforeProjectCreate);
 *   - changes that let people sign in reach every server at once
 *     (RealtimeAccessChanges SignInRulesChanged);
 *   - a status page provider turned off or deleted signs out the private
 *     users it signed in (StatusPagePrivateUserSessionService.addSignInRule);
 *   - a save that sends Require SSO for Login on, or names the provider a
 *     project requires, is checked even when the setting has that value
 *     already (SsoRequirementChanges.beforeProjectUpdate /
 *     beforeServerUpdate);
 *   - the app cancels a statement it stops waiting for, and closes its
 *     connection (Common/Server/Infrastructure/Postgres/
 *     CancelOnTimeoutClient); behind PgBouncer, the statement timeout the
 *     app relies on when the cancel cannot reach the database is set on the
 *     app's database role (HelmChart/Docs/Postgres.md): a change to who can
 *     sign in whose write got no answer is held until it would have been
 *     cancelled (ProjectSsoProviderChanges.giveBackAfterFailedWrite); and
 *     PgBouncer gives up on a statement still in its queue before the app
 *     does (pgbouncer.queryWaitTimeoutSeconds).
 *
 * Markdown is not compiled, so nothing else notices a guide that falls
 * behind. Other languages follow in the translated docs catch-up.
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

  const level: number = heading.indexOf(" ");
  const rest: string = page.slice(start + marker.length);
  const stops: Array<number> = [];

  for (let hashes: number = 1; hashes <= level; hashes++) {
    const position: number = rest.indexOf(`\n${"#".repeat(hashes)} `);

    if (position >= 0) {
      stops.push(position);
    }
  }

  return stops.length > 0 ? rest.slice(0, Math.min(...stops)) : rest;
}

describe("the Global SSO guide", () => {
  const page: string = readPage("en/identity/global-sso.md");

  describe("turning a provider off or deleting it", () => {
    const section: string = sectionOf(
      page,
      "## Turning a provider off or deleting it",
    );

    it("says turning it on again does not bring the sign-ins back, and that providers off at the upgrade count as turned off then", () => {
      expect(section).toContain(
        "Turning the provider on again does not bring those sign-ins back: people sign in with it again. A provider that was already off when you upgraded counts as turned off at the upgrade.",
      );
    });

    it("says MCP clients connected with such a sign-in stop", () => {
      expect(section).toContain(
        "an MCP client someone connected after signing in with it stops working in the project.",
      );
    });
  });

  describe("every project that requires SSO keeps a way in", () => {
    const section: string = sectionOf(
      page,
      "### Every project that requires SSO keeps a way in",
    );

    it("lists the changes that are refused, provider and attachment alike", () => {
      expect(section).toContain(
        "- turning a global provider off, deleting it, or restricting it to its attached projects;",
      );
      expect(section).toContain(
        "- for a provider restricted to its attached projects: attaching its first project (until then it signs people in to every project), turning an attachment off, moving it to another project or provider, or removing it.",
      );
    });

    it("says the refusal names the projects, and what to do first", () => {
      expect(section).toContain(
        "The message names the projects, or the first few and how many there are. Turn on another provider for them first, one of their own or a global one, or turn off **Require SSO for Login** there.",
      );
      expect(section).toContain(
        "A project that requires this very provider is named apart: require another provider there, or turn off **Require SSO for Login**, first.",
      );
    });

    it("says a change saved while another takes long is refused, to be saved again", () => {
      expect(section).toContain(
        'a change is refused with "Another change to who can sign in with SSO is being saved. Try again in a moment.": save it again.',
      );
    });

    it("says a project created while such a change is saved waits for it, and in what words it is refused when it waits too long", () => {
      expect(section).toContain(
        'A project created at that moment waits for the change too, and if it waits too long it is refused with "The server\'s SSO settings are being changed. Create the project again in a moment."',
      );
    });

    it("says changes that let a provider sign more people in are never refused, and reach every app server at once", () => {
      expect(section).toContain(
        "Changes that let a provider sign more people in - turning it or an attachment on, lifting the restriction - are never refused.",
      );
      expect(section).toContain(
        "They reach every app server at once, as turning **Require SSO for Login** off does: people can sign in with the provider straight away.",
      );
    });

    it("says an app server can take up to a minute to follow only when another change to the same provider is saved at that very moment", () => {
      expect(section).toContain(
        "Only when another change to the same provider is saved at that very moment can an app server take up to a minute to follow.",
      );
    });
  });

  describe("enforcing SSO", () => {
    const section: string = sectionOf(page, "## Enforcing SSO");

    it("says turning the instance-wide switch on needs a provider for every project, naming those without one", () => {
      expect(section).toContain(
        "Turning **Require SSO for Login** on needs an SSO provider that signs people in, so nobody is locked out by it:",
      );
      expect(section).toContain(
        "While a project has none, turning the switch on is refused, and the message names the projects (or, when there are many, the first few and how many). Turn on a global provider, or a provider in those projects, first.",
      );
      expect(section).toContain(
        "A project that requires a specific provider needs that one: while it is off, deleted, or does not sign people in to the project, the message names the project apart - turn that provider on, or require another one there, first.",
      );
    });

    it("says a new project needs a global provider that signs people in to every project while the instance requires SSO, and master admins can still create projects", () => {
      expect(section).toContain(
        "- For a new project, which has no provider of its own yet: while the instance requires SSO, creating a project needs a global provider that is on and signs people in to every project, or nobody, its creator included, could open it.",
      );
      expect(section).toContain(
        "Without one, creating a project is refused, and the message asks a server admin to turn one on. Master admins can still create projects.",
      );
      expect(section).toContain(
        "A project created with **Require SSO for Login** already on needs the same, whoever creates it.",
      );
    });

    it("keeps master admins exempt, and turning it off never refused", () => {
      expect(section).toContain(
        "Master admins remain exempt so they cannot be locked out.",
      );
      expect(section).toContain("Turning it off is never refused.");
    });

    it("says a save that sends the switch on while it is on already is checked the same way", () => {
      expect(section).toContain(
        "- A save that sends **Require SSO for Login** on while it is on already - with other settings, or from the API - is checked the same way, for the instance or for a project, and so is one that names the provider a project requires already.",
      );
    });
  });
});

describe("the SSO guide", () => {
  const page: string = readPage("en/identity/sso.md");

  it("says requiring SSO for a project needs a provider that signs people in to it", () => {
    const section: string = sectionOf(
      page,
      "## Requiring SSO for Your Project",
    );

    expect(section).toContain(
      "Turning **Require SSO for Login** on needs a provider that signs people in to the project: one of its own SAML or OIDC providers that is on, or a global provider that is on and signs people in to it.",
    );
    expect(section).toContain(
      "If you pick a provider the project requires, it has to be one of those, and the same is asked when you require another provider later.",
    );
  });

  it("says a save that sends Require SSO for Login on again, or names the provider the project requires already, is checked the same way, and what to do first", () => {
    const section: string = sectionOf(
      page,
      "## Requiring SSO for Your Project",
    );

    expect(section).toContain(
      "A save that sends **Require SSO for Login** on while it is on already, or names the provider the project requires already, is checked the same way - the API, Terraform and other tools often send every setting with each save.",
    );
    expect(section).toContain(
      "So while the project has no provider that signs people in, or the provider it requires was turned off since, such a save is refused in the same words, whatever else it changes: turn a provider on, require another one, or turn **Require SSO for Login** off, first.",
    );
  });

  it("says a new project is held to the same rule, and what to do instead", () => {
    const section: string = sectionOf(
      page,
      "## Requiring SSO for Your Project",
    );

    expect(section).toContain(
      "A new project is held to the same rule. It has no provider of its own yet, so creating one with **Require SSO for Login** already on - only a master admin can - needs a global provider that is on and signs people in to every project, and is refused in the same words without one. Create the project, set up and test its provider, then turn the switch on.",
    );
  });

  it("says creating a project while the server requires SSO needs a global provider, and master admins can still create projects", () => {
    const section: string = sectionOf(
      page,
      "## Requiring SSO for Your Project",
    );

    expect(section).toContain(
      "While the whole server requires SSO (**Admin** > **Settings** > **Authentication** > **Require SSO for Login**), creating any project needs such a global provider too, or nobody, its creator included, could open the project.",
    );
    expect(section).toContain(
      "Without one, creating a project is refused, and the message asks a server admin to turn one on. Master admins can still create projects.",
    );
  });

  it("says turning Require SSO for Login off lets members back in straight away, unless it is turned on again at that very moment", () => {
    const section: string = sectionOf(
      page,
      "## Requiring SSO for Your Project",
    );

    expect(section).toContain(
      "Turning **Require SSO for Login** off saves as soon as you flip it and lets members back in with their password straight away - unless someone turns it on again at that very moment, when an app server can take up to a minute to follow.",
    );
  });

  it("points to the global providers' rule", () => {
    const section: string = sectionOf(
      page,
      "## Turning a provider off or deleting it",
    );

    expect(section).toContain(
      "[Global SSO](/docs/identity/global-sso#turning-a-provider-off-or-deleting-it)",
    );
  });
});

describe("the status pages guide", () => {
  const section: string = sectionOf(
    readPage("en/status-pages/index.md"),
    "### SSO and OIDC",
  );

  it("says turning a provider off or deleting it signs out the private users it signed in", () => {
    expect(section).toContain(
      "Turning a status page's SSO or OIDC provider off, or deleting it, signs out the private users it signed in: their sessions end at their next request, and turning the provider on again does not bring them back - they sign in with it again.",
    );
  });

  it("says turning off the last provider of a page that requires SSO leaves nobody able to sign in, and how to move providers", () => {
    expect(section).toContain(
      "On a page that requires SSO, turning off its last provider leaves nobody able to sign in until you turn one on again or turn **Require SSO for Login** off; to move to another provider, set up and test the new one before you turn the old one off.",
    );
  });

  it("says a page that requires SSO keeps only sessions a provider signed in", () => {
    expect(section).toContain(
      "While it is on, a private user signed in with an email and password is signed out at their next request too: only sessions an SSO or OIDC provider signed in count.",
    );
  });
});

describe("the upgrade notes", () => {
  // Markdown wraps the note's lines; read it as one line of text.
  const page: string = readPage("en/installation/upgrading.md").replace(
    /\s+/g,
    " ",
  );

  it("say what changes for global and status page providers and for Require SSO for Login, and link to the guides", () => {
    expect(page).toContain(
      "**Global and status page SSO providers end their sign-ins the same way, and turning on Require SSO for Login needs a provider.**",
    );
    expect(page).toContain(
      "Turning on Require SSO for Login, for a project or for the whole server, is refused while no provider would sign people in there; the message says what to set up first.",
    );
    expect(page).toContain(
      "Private users whom only SSO ever signed in sign in once more after the upgrade.",
    );
    expect(page).toContain(
      "[Global SSO](/docs/identity/global-sso#turning-a-provider-off-or-deleting-it)",
    );
    expect(page).toContain(
      "[Status Pages](/docs/status-pages/index#sso-and-oidc)",
    );
  });

  it("say that creating a project follows the SSO rules, and that changes that let people sign in reach every app server at once", () => {
    expect(page).toContain(
      "**Creating a project follows the SSO rules too, and changes that let people sign in reach every app server at once.**",
    );
    expect(page).toContain(
      "While the whole server requires SSO for login, creating a project needs a global SSO provider that is on and signs people in to every project, since a new project has no provider of its own yet; without one, creating a project is refused, and the message asks a server admin to turn one on. Master admins can still create projects.",
    );
    expect(page).toContain(
      "now reach every app server at once, as changes that end sign-ins already did, rather than when another server's cached answer runs out a minute later.",
    );
    expect(page).toContain(
      "Only when two changes to the same setting are saved at the very same moment can an app server still take up to a minute to follow.",
    );
    expect(page).toContain(
      "[SSO](/docs/identity/sso#requiring-sso-for-your-project) and [Global SSO](/docs/identity/global-sso#enforcing-sso).",
    );
  });

  it("say that saving Require SSO for Login on again is checked as turning it on is, and that turning it off never is", () => {
    expect(page).toContain(
      "**Saving Require SSO for Login on again is checked as turning it on is.**",
    );
    expect(page).toContain(
      "A save that sends Require SSO for Login on - for a project or for the whole server - or names the provider a project requires is now checked even when the setting has that value already, as the API, Terraform and other tools that send every setting with each save do.",
    );
    expect(page).toContain(
      "such a save is refused with the message turning it on gives, whatever else it changes: turn a provider on, or turn the setting off, first. Turning it off and clearing the required provider are never refused.",
    );
  });
});

describe("the Postgres operations guide", () => {
  // Markdown wraps the guide's lines; read it as one line of text.
  const page: string = fs
    .readFileSync(path.join(REPO_ROOT, "../HelmChart/Docs/Postgres.md"), "utf8")
    .replace(/\s+/g, " ");

  it("says the app cancels a statement it stops waiting for, and never hands its connection on", () => {
    expect(page).toContain(
      "When the app stops waiting for a statement (`DATABASE_QUERY_TIMEOUT_MS`, 35 seconds by default) it cancels it on the database",
    );
    expect(page).toContain(
      "A transaction the statement was part of is rolled back with that connection, so a write the app reported as failed is never committed later by the next request to borrow the connection.",
    );
  });

  it("says behind the pooler the statement timeout the app relies on when the cancel cannot reach is set on its database role, and why", () => {
    expect(page).toContain("#### Statement timeout behind the pooler");
    expect(page).toContain(
      "A cancel cannot reach the database once the connection to it is gone - a network partition, a pooler restarting. Only the backend's `statement_timeout` (`DATABASE_STATEMENT_TIMEOUT_MS`, 30 seconds by default) ends such a statement",
    );
    expect(page).toContain(
      `ALTER ROLE "postgres" IN DATABASE "oneuptimedb" SET statement_timeout = '30s';`,
    );
    expect(page).toContain(
      "[Statement timeout behind the pooler](#statement-timeout-behind-the-pooler)",
    );
  });

  it("says PgBouncer gives up on a queued statement before the app does, and why", () => {
    expect(page).toContain("#### Statements queued in the pooler");
    expect(page).toContain(
      "PgBouncer cannot cancel a statement still waiting in its own queue for a free server connection",
    );
    expect(page).toContain(
      "`pgbouncer.queryWaitTimeoutSeconds` (PgBouncer's `query_wait_timeout`, 30 seconds by default, below the app's 35)",
    );
    expect(page).toContain(
      "With your own PgBouncer, or a managed pooled endpoint, set its `query_wait_timeout` the same way.",
    );
  });
});
