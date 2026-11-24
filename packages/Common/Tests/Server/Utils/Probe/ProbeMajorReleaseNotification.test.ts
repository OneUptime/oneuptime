import ProbeMajorReleaseNotification, {
  PROBE_MISSED_FEATURE_MONITORS,
  PROBE_MISSED_FEATURE_SENTENCES,
  ProbeMajorReleaseNotificationContent,
  ProbeMajorReleaseNotificationInput,
} from "../../../../Server/Utils/Probe/ProbeMajorReleaseNotification";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  ProbeFeature,
  ProbeMajorReleaseLag,
} from "../../../../Types/Probe/ProbeReportedVersion";
import {
  NOTIFICATION_SMS_SENDER,
  NOTIFICATION_SMS_TURN_OFF,
} from "../../../../Utils/Sms/NotificationSms";
import { hasWhatsAppTemplate } from "../../../../Types/WhatsApp/WhatsAppEventTemplates";
import { FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY } from "../../../../Types/Probe/ProbeCapability";
import { describe, expect, test } from "@jest/globals";

/*
 * What a custom probe's owners are told when it falls a major release
 * behind the OneUptime it reports to (OneUptime issue #9977), on each
 * channel: which probe, how far behind it is, what it misses until it is
 * updated, and how to update it - and never the release a feature first
 * shipped in (#10798).
 */

const TWO_BEHIND: ProbeMajorReleaseLag = {
  majorReleasesBehind: 2,
  isAtLeast: false,
  serverMajor: 18,
  serverRelease: "18.1.0",
  probeRelease: "16.4.0",
};

const ONE_BEHIND: ProbeMajorReleaseLag = {
  majorReleasesBehind: 1,
  isAtLeast: false,
  serverMajor: 18,
  serverRelease: "18.0.0",
  probeRelease: "17.2.0",
};

const SAYS_NONE: ProbeMajorReleaseLag = {
  majorReleasesBehind: 1,
  isAtLeast: true,
  serverMajor: 18,
  serverRelease: "18.0.0",
  probeRelease: null,
};

const VIEW_PROBE_LINK: string =
  "https://oneuptime.example.com/dashboard/project-1/monitors/settings/probes/probe-1";
const DOCS_LINK: string =
  "https://oneuptime.example.com/docs/probe/custom-probe#update-a-probe";

function build(
  overrides: Partial<ProbeMajorReleaseNotificationInput> = {},
): ProbeMajorReleaseNotificationContent {
  return ProbeMajorReleaseNotification.buildContent({
    probeName: "office-probe",
    probeDescription: "The office network",
    projectName: "Acme Production",
    lag: TWO_BEHIND,
    missedFeatures: [ProbeFeature.OneTimeCodes, ProbeFeature.AnyRequestBody],
    viewProbeLink: VIEW_PROBE_LINK,
    updateProbeDocsUrl: DOCS_LINK,
    isOwner: true,
    ...overrides,
  });
}

describe("how far behind it is", () => {
  test("one, several, and at least so many", () => {
    expect(
      ProbeMajorReleaseNotification.getMajorReleasesLabel(ONE_BEHIND),
    ).toBe("1 major release");
    expect(
      ProbeMajorReleaseNotification.getMajorReleasesLabel(TWO_BEHIND),
    ).toBe("2 major releases");
    expect(ProbeMajorReleaseNotification.getMajorReleasesLabel(SAYS_NONE)).toBe(
      "at least 1 major release",
    );
    expect(
      ProbeMajorReleaseNotification.getMajorReleasesLabel({
        ...SAYS_NONE,
        majorReleasesBehind: 3,
      }),
    ).toBe("at least 3 major releases");
  });

  test("the probe's version, or what is known of it", () => {
    expect(ProbeMajorReleaseNotification.getProbeVersionLabel(TWO_BEHIND)).toBe(
      "16.4.0",
    );
    expect(ProbeMajorReleaseNotification.getProbeVersionLabel(SAYS_NONE)).toBe(
      `older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}`,
    );
  });

  test("the line every short channel opens with", () => {
    expect(
      ProbeMajorReleaseNotification.getLagSentence({
        probeName: "office-probe",
        lag: TWO_BEHIND,
      }),
    ).toBe(
      "Probe office-probe runs 16.4.0, 2 major releases behind OneUptime 18.1.0, which it reports to.",
    );
    expect(
      ProbeMajorReleaseNotification.getLagSentence({
        probeName: "office-probe",
        lag: SAYS_NONE,
      }),
    ).toBe(
      `Probe office-probe runs a version older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}, at least 1 major release behind OneUptime 18.0.0, which it reports to.`,
    );
  });
});

describe("what it misses", () => {
  test("every feature a probe can miss has its sentence and its monitors", () => {
    for (const feature of Object.values(ProbeFeature)) {
      expect(PROBE_MISSED_FEATURE_SENTENCES[feature]).toMatch(/\.$/);
      expect(PROBE_MISSED_FEATURE_MONITORS[feature]).toMatch(/monitors/);
    }
  });

  test("none, one, and every one, joined as a sentence", () => {
    expect(ProbeMajorReleaseNotification.getMissedSentence([])).toBe("");
    expect(
      ProbeMajorReleaseNotification.getMissedSentence([
        ProbeFeature.OneTimeCodes,
      ]),
    ).toBe(
      "Until it is updated, monitors that use a one-time code secret fail their check on it.",
    );
    expect(
      ProbeMajorReleaseNotification.getMissedSentence([
        ProbeFeature.OneTimeCodes,
        ProbeFeature.AnyRequestBody,
      ]),
    ).toBe(
      "Until it is updated, monitors that use a one-time code secret and API monitors whose request body is a JSON array, a single value or text fail their check on it.",
    );
  });

  test("no sentence names the release a feature first shipped in", () => {
    for (const feature of Object.values(ProbeFeature)) {
      expect(PROBE_MISSED_FEATURE_SENTENCES[feature]).not.toMatch(/\d+\.\d+/);
      expect(PROBE_MISSED_FEATURE_MONITORS[feature]).not.toMatch(/\d+\.\d+/);
    }

    expect(JSON.stringify(build())).not.toContain(
      FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
    );
  });
});

describe("the email", () => {
  test("its own template and setting, with a subject the mailer names the product in", () => {
    const content: ProbeMajorReleaseNotificationContent = build();

    expect(content.emailEnvelope.templateType).toBe(
      EmailTemplateType.ProbeMajorReleaseBehind,
    );
    // A template subject: MailService writes the installation's own name for OneUptime.
    expect(content.emailEnvelope.isSubjectLiteral).toBeUndefined();
    expect(content.emailEnvelope.subject).toBe(
      "[Probe Update Available] office-probe is 2 major releases behind OneUptime",
    );
    expect(ProbeMajorReleaseNotification.EVENT_TYPE).toBe(
      NotificationSettingEventType.SEND_PROBE_MAJOR_RELEASE_BEHIND_OWNER_NOTIFICATION,
    );
  });

  test("what the template reads: the pieces, never a sentence that names the product", () => {
    expect(build().emailEnvelope.vars).toEqual({
      probeName: "office-probe",
      probeDescription: "The office network",
      probeRelease: "16.4.0",
      probeVersionPhrase: "16.4.0",
      majorReleasesLabel: "2 major releases",
      serverRelease: "18.1.0",
      majorReleasesBehind: "2",
      projectName: "Acme Production",
      hasMissedFeatures: "true",
      missedFeatures: [
        PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.OneTimeCodes],
        PROBE_MISSED_FEATURE_SENTENCES[ProbeFeature.AnyRequestBody],
      ],
      viewProbeLink: VIEW_PROBE_LINK,
      updateProbeDocsUrl: DOCS_LINK,
      isOwner: "true",
    });
  });

  test("a project owner told in place of the probe's owners is not called its owner", () => {
    expect(build({ isOwner: false }).emailEnvelope.vars).not.toHaveProperty(
      "isOwner",
    );
  });

  test("nothing missed: no list", () => {
    const vars: Record<string, unknown> = build({ missedFeatures: [] })
      .emailEnvelope.vars;

    expect(vars["hasMissedFeatures"]).toBe("");
    expect(vars["missedFeatures"]).toEqual([]);
  });

  test("the probe's page is the link the email rollup knows it by", () => {
    expect(build().emailEnvelope.vars["viewProbeLink"]).toBe(VIEW_PROBE_LINK);
    // The docs link is no record, so it is named as none.
    expect(
      Object.keys(build().emailEnvelope.vars).filter((key: string): boolean => {
        return key.endsWith("Link");
      }),
    ).toEqual(["viewProbeLink"]);
  });

  test("a probe named with braces never makes an expression of the subject, nor joins two into one", () => {
    expect(
      build({ probeName: "{{#each x}}probe{{/each}}" }).emailEnvelope.subject,
    ).toBe(
      "[Probe Update Available] #each xprobe/each is 2 major releases behind OneUptime",
    );
    expect(build({ probeName: "a{}}{b" }).emailEnvelope.subject).toBe(
      "[Probe Update Available] ab is 2 major releases behind OneUptime",
    );
    expect(build({ probeName: "a{}}{b" }).emailEnvelope.subject).not.toMatch(
      /[{}]/,
    );
  });

  test("a probe that says no release: what is known of its version, in a sentence and on its own", () => {
    const vars: Record<string, unknown> = build({ lag: SAYS_NONE })
      .emailEnvelope.vars;

    expect(vars["probeRelease"]).toBe(
      `older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}`,
    );
    expect(vars["probeVersionPhrase"]).toBe(
      `a version older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}`,
    );
    expect(vars["majorReleasesLabel"]).toBe("at least 1 major release");
  });

  test("no value the template reads names the product: the template names it as the installation goes by", () => {
    for (const [key, value] of Object.entries(build().emailEnvelope.vars)) {
      expect({
        key,
        names: JSON.stringify(value).includes("OneUptime"),
      }).toEqual({ key, names: false });
    }
  });
});

describe("the short channels", () => {
  test("SMS - and the chat messages and webhooks made from it - stands alone, with how to update it", () => {
    const sms: string = build().smsMessage.message!;

    expect(sms.startsWith(`${NOTIFICATION_SMS_SENDER}: `)).toBe(true);
    expect(sms.endsWith(NOTIFICATION_SMS_TURN_OFF)).toBe(true);
    expect(sms).toContain(
      "Probe office-probe runs 16.4.0, 2 major releases behind OneUptime 18.1.0, which it reports to.",
    );
    expect(sms).toContain(
      "Until it is updated, monitors that use a one-time code secret and API monitors whose request body is a JSON array, a single value or text fail their check on it.",
    );
    expect(sms).toContain(`How to update it: ${DOCS_LINK}`);
  });

  test("a probe that misses nothing: the line alone", () => {
    const sms: string = build({ missedFeatures: [], lag: ONE_BEHIND })
      .smsMessage.message!;

    expect(sms).not.toContain("Until it is updated");
    expect(sms).toContain(
      "Probe office-probe runs 17.2.0, 1 major release behind OneUptime 18.0.0, which it reports to. How to update it:",
    );
  });

  test("push: the title, the line, and a tap to the probe's page", () => {
    const push: ReturnType<typeof build>["pushNotificationMessage"] =
      build().pushNotificationMessage;

    expect(push.title).toBe(
      "office-probe is 2 major releases behind OneUptime",
    );
    expect(push.body).toContain(
      "Probe office-probe runs 16.4.0, 2 major releases behind OneUptime 18.1.0",
    );
    expect(push.body.endsWith("Tap to see the probe.")).toBe(true);
    expect(push.clickAction).toBe(VIEW_PROBE_LINK);
    expect(push.tag).toBe(ProbeMajorReleaseNotification.PUSH_TAG);
  });

  test("a call says the line, and what to do", () => {
    const said: string = build().callRequestMessage.data[0]!.sayMessage!;

    expect(said.startsWith("This is a message from OneUptime.")).toBe(true);
    expect(said).toContain("2 major releases behind OneUptime 18.1.0");
    expect(said).toContain("Update the probe to the latest OneUptime release.");
  });

  test("WhatsApp has no approved template whose words are true of it: the setting offers no switch for it", () => {
    expect(hasWhatsAppTemplate(ProbeMajorReleaseNotification.EVENT_TYPE)).toBe(
      false,
    );
  });
});
