import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import ProbeMajorReleaseNotification, {
  PROBE_MISSED_FEATURE_SENTENCES,
  ProbeMajorReleaseNotificationContent,
  ProbeMajorReleaseNotificationInput,
} from "Common/Server/Utils/Probe/ProbeMajorReleaseNotification";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  ProbeFeature,
} from "Common/Types/Probe/ProbeReportedVersion";
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
 * The email a custom probe's owners get once when it falls a major release
 * behind the OneUptime it reports to (OneUptime issue #9977). Built the way
 * the job builds it - the vars from ProbeMajorReleaseNotification.buildContent
 * - and rendered the way MailService renders it: the template the envelope
 * names, on the shared Handlebars instance with the real partials and
 * helpers. So a var the template stops reading, or a branch the builder
 * never selects, fails here.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const VIEW_PROBE_LINK: string =
  "https://oneuptime.example.com/dashboard/6f1c2b9a-1111-4111-8111-111111111111/monitors/settings/probes/7a2d3c4b-2222-4222-8222-222222222222";
const DOCS_LINK: string =
  "https://oneuptime.example.com/docs/probe/custom-probe#update-a-probe";
const PREFERENCES_URL: string =
  "https://oneuptime.example.com/dashboard/6f1c2b9a-1111-4111-8111-111111111111/user-settings/notification-settings";
const XSS_NAME: string = '<img src=x onerror="alert(1)">';

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function build(
  overrides: Partial<ProbeMajorReleaseNotificationInput> = {},
): ProbeMajorReleaseNotificationContent {
  return ProbeMajorReleaseNotification.buildContent({
    probeName: "office-probe",
    probeDescription: "The office network",
    projectName: "Acme Production",
    lag: {
      majorReleasesBehind: 2,
      isAtLeast: false,
      serverMajor: 18,
      serverRelease: "18.1.0",
      probeRelease: "16.4.0",
    },
    missedFeatures: [ProbeFeature.OneTimeCodes, ProbeFeature.AnyRequestBody],
    viewProbeLink: VIEW_PROBE_LINK,
    updateProbeDocsUrl: DOCS_LINK,
    isOwner: true,
    ...overrides,
  });
}

// What MailService.compileEmailBody does with an envelope.
function render(
  content: ProbeMajorReleaseNotificationContent,
  extraVars: Dictionary<string> = {},
): string {
  const templateType: EmailTemplateType | undefined =
    content.emailEnvelope.templateType;

  if (!templateType) {
    throw new Error("The envelope does not name a template");
  }

  const vars: Dictionary<string | JSONObject> = {
    year: "2026",
    ...content.emailEnvelope.vars,
    ...extraVars,
  };

  return Handlebars.compile(templateSource(templateType))(vars).toString();
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

/*
 * The detail card, label -> value, matched only when the value holds no
 * markup at all: a name rendered as live HTML drops its row.
 */
function detailFields(html: string): Dictionary<string> {
  const fields: Dictionary<string> = {};

  for (const match of html.matchAll(
    /<p class="st-DetailCard-label"[^>]*>([^<]*)<\/p>\s*<div class="st-DetailCard-value"[^>]*>([^<]*)<\/div>/g,
  )) {
    fields[decodeHtmlEntities(match[1] ?? "").trim()] = decodeHtmlEntities(
      match[2] ?? "",
    ).trim();
  }

  return fields;
}

function heading(html: string): string {
  return decodeHtmlEntities(
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "",
  ).trim();
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

describe("ProbeMajorReleaseBehind.hbs", () => {
  test("is the template the notice names", () => {
    expect(build().emailEnvelope.templateType).toBe(
      EmailTemplateType.ProbeMajorReleaseBehind,
    );
    expect(EmailTemplateType.ProbeMajorReleaseBehind).toBe(
      "ProbeMajorReleaseBehind.hbs",
    );
  });

  test("says which probe, how far behind it is, and its version and OneUptime's", () => {
    const html: string = render(build());
    const text: string = visibleText(html);

    expect(heading(html)).toBe(
      "office-probe is 2 major releases behind OneUptime",
    );
    expect(text).toContain(
      "Probe office-probe runs 16.4.0, 2 major releases behind OneUptime 18.1.0, which it reports to. Update it to get the latest checks and fixes.",
    );
    expect(detailFields(html)).toEqual({
      "Probe Name:": "office-probe",
      "Probe Description:": "The office network",
      "Probe Version:": "16.4.0",
      "OneUptime Version:": "18.1.0",
      "Project:": "Acme Production",
    });
  });

  test("lists what it misses until it is updated, in the probe page's words", () => {
    const text: string = visibleText(render(build()));

    expect(text).toContain("Until it is updated");
    expect(text).toContain(
      PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.OneTimeCodes],
    );
    expect(text).toContain(
      PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.AnyRequestBody],
    );
    expect(
      text.indexOf(PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.OneTimeCodes]),
    ).toBeLessThan(
      text.indexOf(PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.AnyRequestBody]),
    );
  });

  test("lists nothing when it misses nothing a release added", () => {
    const text: string = visibleText(render(build({ missedFeatures: [] })));

    expect(text).not.toContain("Until it is updated");
    expect(text).not.toContain("Too old to");
  });

  test("links Update a probe as its one button, and the probe's page beside it", () => {
    const links: Array<Anchor> = anchors(
      render(build(), { notificationPreferencesUrl: PREFERENCES_URL }),
    );

    expect(
      links.filter((anchor: Anchor): boolean => {
        return anchor.isButton;
      }),
    ).toEqual([
      { href: DOCS_LINK, text: "How to Update a Probe", isButton: true },
    ]);
    expect(
      links.some((anchor: Anchor): boolean => {
        return anchor.href === VIEW_PROBE_LINK;
      }),
    ).toBe(true);
    expect(
      links.some((anchor: Anchor): boolean => {
        return anchor.href === PREFERENCES_URL;
      }),
    ).toBe(true);
  });

  test("names no release a feature first shipped in: it says to update to the latest release", () => {
    const text: string = visibleText(render(build()));

    expect(text).toContain(
      "Update the probe to the latest OneUptime release: start it again from the newest image, with the same probe ID and key.",
    );
    // The only versions named are the probe's and OneUptime's own.
    const named: Array<string> = Array.from(
      new Set(
        Array.from(text.matchAll(/\b\d+\.\d+\.\d+\b/g)).map(
          (match: RegExpMatchArray): string => {
            return match[0];
          },
        ),
      ),
    ).sort();

    expect(named).toEqual(["16.4.0", "18.1.0"]);
  });

  test("a probe that says no release: what is known of its version", () => {
    const html: string = render(
      build({
        lag: {
          majorReleasesBehind: 1,
          isAtLeast: true,
          serverMajor: 18,
          serverRelease: "18.0.0",
          probeRelease: null,
        },
      }),
    );

    expect(heading(html)).toBe(
      "office-probe is at least 1 major release behind OneUptime",
    );
    expect(detailFields(html)["Probe Version:"]).toBe(
      `older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}`,
    );
  });

  test("says why the reader is told: an owner of the probe, or an owner of the project in place of its owners", () => {
    expect(visibleText(render(build({ isOwner: true })))).toContain(
      "You are receiving this email because you are the owner of this resource.",
    );
    expect(visibleText(render(build({ isOwner: false })))).toContain(
      "You are receiving this email because no owners have been added to this resource and you are the owner of the project.",
    );
    expect(visibleText(render(build()))).toContain(
      "You are told once for each major release of OneUptime this probe falls behind.",
    );
  });

  test("a probe's name, description and project are text, never markup", () => {
    const html: string = render(
      build({
        probeName: XSS_NAME,
        probeDescription: XSS_NAME,
        projectName: XSS_NAME,
      }),
    );

    expect(html).not.toContain("<img src=x");
    expect(detailFields(html)["Probe Name:"]).toBe(XSS_NAME);
    expect(detailFields(html)["Probe Description:"]).toBe(XSS_NAME);
    expect(detailFields(html)["Project:"]).toBe(XSS_NAME);
    expect(heading(html)).toBe(
      `${XSS_NAME} is 2 major releases behind OneUptime`,
    );
  });

  test("a probe without a description has no Description row", () => {
    expect(
      detailFields(render(build({ probeDescription: null }))),
    ).not.toHaveProperty("Probe Description:");
  });

  test("the subject is literal text: a probe named with braces sends, as written without them", () => {
    const content: ProbeMajorReleaseNotificationContent = build({
      probeName: "probe {{ .Values.tag }}",
    });

    expect(content.emailEnvelope.isSubjectLiteral).toBe(true);
    expect(content.emailEnvelope.subject).toBe(
      "[Probe Update Available] probe  .Values.tag  is 2 major releases behind OneUptime",
    );
  });
});
