import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import {
  decodeHtmlEntities,
  htmlAsText,
  visibleText,
} from "Common/Tests/Helpers/HtmlText";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * renders with the helpers MailService renders with. The partials are
 * registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE "YOU WERE ADDED AS AN OWNER" EMAIL OF 23 KINDS OF RECORD (#9700).
 *
 * One template for a service, a host, a cluster, a dashboard, an on-call
 * policy and the rest, named by the kind of record the job hands it
 * (Workers ResourceOwnersAdded; ResourceOwnerAddedNotificationJobs pins
 * the vars each job sends). Rendered the way MailService renders it - the
 * template file on the shared Handlebars instance, with the real partials
 * and helpers - it says which record, of which kind, links to its page,
 * escapes what a person typed, closes with what owning it means only when
 * the job says so, and ends with where its notifications are turned off.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const LINK: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/host/22222222-2222-4222-8222-222222222222";

// Injected centrally by UserNotificationSettingService for every owner email.
const PREFERENCES_URL: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/user-settings/notification-settings";

const XSS_NAME: string = '<img src=x onerror="alert(1)">web-1';

// What the job sends a host's new owners (ResourceOwnersAdded).
function hostVars(overrides: Dictionary<string> = {}): Dictionary<string> {
  return {
    resourceType: "Host",
    resourceNoun: "host",
    resourceName: "web-1",
    resourceDescription: "<p>Serves the <strong>checkout</strong></p>",
    projectName: "Acme",
    resourceViewLink: LINK,
    notificationPreferencesUrl: PREFERENCES_URL,
    ...overrides,
  };
}

function render(vars: Dictionary<string>): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, EmailTemplateType.ResourceOwnerAdded),
      "utf8",
    ),
  )({ year: "2026", ...vars }).toString();
}

function headings(html: string): Array<string> {
  return Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)).map(
    (match: RegExpMatchArray): string => {
      return decodeHtmlEntities(match[1] ?? "").trim();
    },
  );
}

// The detail card, label -> the value's text.
function detailFields(html: string): Dictionary<string> {
  const fields: Dictionary<string> = {};

  for (const match of html.matchAll(
    /<p class="st-DetailCard-label"[^>]*>([^<]*)<\/p>\s*<div class="st-DetailCard-value[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
  )) {
    fields[decodeHtmlEntities(match[1] ?? "").trim()] = htmlAsText(
      match[2] ?? "",
    ).trim();
  }

  return fields;
}

interface Anchor {
  href: string;
  text: string;
  isButton: boolean;
}

function anchors(html: string): Array<Anchor> {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match: RegExpMatchArray): Anchor => {
      const attributes: string = match[1] ?? "";

      return {
        href: decodeHtmlEntities(
          attributes.match(/\bhref="([^"]*)"/i)?.[1] ?? "",
        ),
        text: htmlAsText(match[2] ?? "").trim(),
        isButton: attributes.includes("st-Button-link"),
      };
    },
  );
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("the ResourceOwnerAdded email", () => {
  test("is the template file the enum names", () => {
    expect(EmailTemplateType.ResourceOwnerAdded).toBe("ResourceOwnerAdded.hbs");
    expect(
      fs.existsSync(
        Path.resolve(TEMPLATES_DIR, EmailTemplateType.ResourceOwnerAdded),
      ),
    ).toBe(true);
  });

  test("is titled by the kind of record and its name, and says what happened", () => {
    const html: string = render(hostVars());

    expect(headings(html)).toEqual(["Host: web-1"]);
    expect(visibleText(html)).toContain(
      "You have been added as an owner of this host.",
    );
  });

  test("names the record and shows its description in the detail card", () => {
    expect(detailFields(render(hostVars()))).toEqual({
      "Host:": "web-1",
      "Description:": "Serves the checkout",
    });
  });

  test("leaves a record with no description without a Description row", () => {
    expect(detailFields(render(hostVars({ resourceDescription: "" })))).toEqual(
      { "Host:": "web-1" },
    );
  });

  test("links to the record's page, by its button and as a link to copy", () => {
    const links: Array<Anchor> = anchors(render(hostVars()));

    expect(
      links.filter((anchor: Anchor): boolean => {
        return anchor.isButton;
      }),
    ).toEqual([{ href: LINK, text: "View on Dashboard", isButton: true }]);
    expect(
      links.filter((anchor: Anchor): boolean => {
        return !anchor.isButton && anchor.href === LINK;
      }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(visibleText(render(hostVars()))).toContain(
      "You can view this host by clicking on the button below",
    );
  });

  test("words every kind of record its own way", () => {
    const html: string = render(
      hostVars({
        resourceType: "On-Call Policy",
        resourceNoun: "on-call policy",
        resourceName: "Primary",
      }),
    );

    expect(headings(html)).toEqual(["On-Call Policy: Primary"]);
    expect(visibleText(html)).toContain(
      "You have been added as an owner of this on-call policy.",
    );
    expect(detailFields(html)["On-Call Policy:"]).toBe("Primary");
  });

  test("closes with what owning the record means when the job says so, and with nothing otherwise", () => {
    const note: string =
      "You are told when a call to this incoming call policy reaches nobody.";

    expect(visibleText(render(hostVars({ ownershipNote: note })))).toContain(
      note,
    );
    expect(visibleText(render(hostVars()))).not.toContain("You are told when");
  });

  test("escapes a name a person typed, in the title and the card alike", () => {
    const html: string = render(hostVars({ resourceName: XSS_NAME }));

    expect(html).not.toContain("<img");
    expect(headings(html)).toEqual([`Host: ${XSS_NAME}`]);
    expect(detailFields(html)["Host:"]).toBe(XSS_NAME);
  });

  test("ends with where its notifications are managed", () => {
    const links: Array<Anchor> = anchors(render(hostVars()));

    expect(
      links.find((anchor: Anchor): boolean => {
        return anchor.href === PREFERENCES_URL;
      })?.text,
    ).toBe("Manage notification preferences");
  });
});
