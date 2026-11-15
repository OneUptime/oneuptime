import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { visibleText } from "Common/Tests/Helpers/HtmlText";

/*
 * Registers the product's real `concat` / `ifCond` helpers as an import
 * side effect, so this suite renders with the helpers the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * A PERSON'S PAGE'S EMAIL OPENS WITH WHO PAGED (block 31).
 *
 * Paging somebody from an incident's own Slack or Teams channel is a page
 * about that incident (OnCallPersonPage), declared perhaps an hour before.
 * Its email opened "A new incident has been created in the project - Acme"
 * as every page's did. Its generator now hands the template the line to
 * open with (personPageInfo) - "Alice Kim paged Platform about this
 * incident in the project Acme. You're a member of Platform." - and what
 * Alice wrote (personPageMessage). Only incidents and alerts are paged
 * that way; every other page's email opens as it always did, and a page
 * again keeps its own line.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

function render(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(
    fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), { encoding: "utf8" }),
  )(vars);
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (!filename.endsWith(".hbs")) {
      continue;
    }

    Handlebars.registerPartial(
      filename.slice(0, -".hbs".length),
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

interface PageEmail {
  file: string;
  noun: string;
  titleVar: string;
}

const PAGE_EMAILS: Array<PageEmail> = [
  {
    file: "AcknowledgeIncident.hbs",
    noun: "incident",
    titleVar: "incidentTitle",
  },
  { file: "AcknowledgeAlert.hbs", noun: "alert", titleVar: "alertTitle" },
];

function varsFor(
  email: PageEmail,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [email.titleVar]: "Checkout is down",
    currentState: "Acknowledged",
    resourcesAffected: "checkout-api",
    projectName: "Acme",
    rootCause: "<p>Pool exhausted.</p>",
    incidentNumber: "INC-42",
    alertNumber: "ALR-12",
    acknowledgeIncidentLink: "https://oneuptime.example.com/ack",
    acknowledgeAlertLink: "https://oneuptime.example.com/ack",
    passOnLink: "https://oneuptime.example.com/escalate",
    ...overrides,
  };
}

function infoFor(email: PageEmail): string {
  return `Alice Kim paged Platform about this ${email.noun} in the project Acme. You're a member of Platform.`;
}

const MESSAGE_LINE: string = "Alice Kim wrote: “Can you check the database?”";

describe.each(PAGE_EMAILS)("$file", (email: PageEmail) => {
  test("a person's page opens with who paged whom and why, then what they wrote - not with a new record", () => {
    const text: string = visibleText(
      render(
        email.file,
        varsFor(email, {
          personPageInfo: infoFor(email),
          personPageMessage: MESSAGE_LINE,
        }),
      ),
    );

    expect(text).toContain(infoFor(email));
    expect(text).toContain(MESSAGE_LINE);
    expect(text.indexOf(infoFor(email))).toBeLessThan(
      text.indexOf(MESSAGE_LINE),
    );
    expect(text).not.toContain(`A new ${email.noun} has been created`);
    // The rest is the page email it always was.
    expect(text).toContain("Checkout is down");
    expect(text).toContain("Acknowledge");
    expect(text).toContain("Escalate");
  });

  test("a person's page with no message has the one line", () => {
    const text: string = visibleText(
      render(email.file, varsFor(email, { personPageInfo: infoFor(email) })),
    );

    expect(text).toContain(infoFor(email));
    expect(text).not.toContain("wrote:");
  });

  test("a message alone is never shown: it belongs to a person's page", () => {
    const text: string = visibleText(
      render(email.file, varsFor(email, { personPageMessage: MESSAGE_LINE })),
    );

    expect(text).toContain(
      `A new ${email.noun} has been created in the project - Acme`,
    );
    expect(text).not.toContain(MESSAGE_LINE);
  });

  test("a page again keeps its own line", () => {
    const line: string = `This ${email.noun} in the project Acme is still not resolved 30 minutes after it was acknowledged.`;
    const text: string = visibleText(
      render(
        email.file,
        varsFor(email, {
          pageAgainInfo: line,
          personPageInfo: infoFor(email),
        }),
      ),
    );

    expect(text).toContain(line);
    expect(text).not.toContain("paged Platform");
  });

  test("every other page opens as it always did", () => {
    const text: string = visibleText(render(email.file, varsFor(email)));

    expect(text).toContain(
      `A new ${email.noun} has been created in the project - Acme`,
    );
    expect(text).not.toContain("paged Platform");
    expect(text).not.toContain("wrote:");
  });

  test("names and the message are text: what a person typed never becomes markup", () => {
    const html: string = render(
      email.file,
      varsFor(email, {
        personPageInfo:
          'Eve <img src=x onerror="alert(1)"> paged you about this incident.',
        personPageMessage: 'Eve wrote: “<a href="https://evil.example">x</a>”',
      }),
    );

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(visibleText(html)).toContain("paged you about this incident.");
  });
});

/*
 * A POLICY A PERSON STARTED BY HAND OPENS ITS EMAIL WITH WHO STARTED IT
 * (#7838).
 *
 * Execute On-Call Policy, or a page that names a policy, starts a policy for
 * an incident, an alert or an episode that is there already: its generator
 * hands every one of the four templates the line to open with
 * (personPageInfo) - "Alice Kim started Database escalation for Incident
 * INC-42 in the project Acme. You're getting this because ..." - and the
 * message (personPageMessage). An episode's email had no place for them.
 */

interface PolicyEmail {
  file: string;
  noun: string;
  vars: Record<string, unknown>;
}

const POLICY_EMAILS: Array<PolicyEmail> = [
  {
    file: "AcknowledgeIncident.hbs",
    noun: "incident",
    vars: {
      incidentTitle: "Checkout is down",
      incidentNumber: "INC-42",
      acknowledgeIncidentLink: "https://oneuptime.example.com/ack",
    },
  },
  {
    file: "AcknowledgeAlert.hbs",
    noun: "alert",
    vars: {
      alertTitle: "Checkout is down",
      alertNumber: "ALR-12",
      acknowledgeAlertLink: "https://oneuptime.example.com/ack",
    },
  },
  {
    file: "AcknowledgeIncidentEpisode.hbs",
    noun: "incident episode",
    vars: {
      incidentEpisodeTitle: "Checkout is down",
      episodeNumber: "EP-7",
      acknowledgeIncidentEpisodeLink: "https://oneuptime.example.com/ack",
    },
  },
  {
    file: "AcknowledgeAlertEpisode.hbs",
    noun: "alert episode",
    vars: {
      alertEpisodeTitle: "Checkout is down",
      episodeNumber: "AEP-3",
      acknowledgeAlertEpisodeLink: "https://oneuptime.example.com/ack",
    },
  },
];

const POLICY_INFO: string =
  "Alice Kim started Database escalation for this record in the project Acme. You're getting this because you're a member of Platform, on level 2 of Database escalation.";

function policyVars(
  email: PolicyEmail,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    currentState: "Acknowledged",
    resourcesAffected: "checkout-api",
    projectName: "Acme",
    rootCause: "<p>Pool exhausted.</p>",
    passOnLink: "https://oneuptime.example.com/escalate",
    ...email.vars,
    ...overrides,
  };
}

describe.each(POLICY_EMAILS)(
  "$file, for a policy started by hand",
  (email: PolicyEmail) => {
    test("opens with who started which policy and why, then the message - not with a new record", () => {
      const text: string = visibleText(
        render(
          email.file,
          policyVars(email, {
            personPageInfo: POLICY_INFO,
            personPageMessage: MESSAGE_LINE,
          }),
        ),
      );

      expect(text).toContain(POLICY_INFO);
      expect(text).toContain(MESSAGE_LINE);
      expect(text.indexOf(POLICY_INFO)).toBeLessThan(
        text.indexOf(MESSAGE_LINE),
      );
      expect(text).not.toContain(`A new ${email.noun} has been created`);
      expect(text).toContain("Checkout is down");
      expect(text).toContain("Acknowledge");
      expect(text).toContain("Escalate");
    });

    test("with no message, has the one line", () => {
      const text: string = visibleText(
        render(email.file, policyVars(email, { personPageInfo: POLICY_INFO })),
      );

      expect(text).toContain(POLICY_INFO);
      expect(text).not.toContain("wrote:");
    });

    test("a page again of it keeps the page-again line", () => {
      const line: string = `This ${email.noun} in the project Acme is still not resolved 30 minutes after it was acknowledged.`;
      const text: string = visibleText(
        render(
          email.file,
          policyVars(email, {
            pageAgainInfo: line,
            personPageInfo: POLICY_INFO,
            personPageMessage: MESSAGE_LINE,
          }),
        ),
      );

      expect(text).toContain(line);
      expect(text).not.toContain("started Database escalation");
      expect(text).not.toContain(MESSAGE_LINE);
    });

    test("a run OneUptime started opens as it always did", () => {
      const text: string = visibleText(render(email.file, policyVars(email)));

      expect(text).toContain(
        `A new ${email.noun} has been created in the project - Acme`,
      );
      expect(text).not.toContain("started Database escalation");
    });

    test("the policy's name and the message are text: what a person typed never becomes markup", () => {
      const html: string = render(
        email.file,
        policyVars(email, {
          personPageInfo:
            'Eve started <img src=x onerror="alert(1)"> for this record.',
          personPageMessage:
            'Eve wrote: “<a href="https://evil.example">x</a>”',
        }),
      );

      expect(html).not.toContain('<img src=x onerror="alert(1)">');
      expect(html).not.toContain('<a href="https://evil.example">');
      expect(visibleText(html)).toContain("for this record.");
    });
  },
);
