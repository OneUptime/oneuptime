import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import { registerEmailDetailCardHelpers } from "../../FeatureSet/Notification/Utils/EmailDetailCard";
import {
  registerEmailBrandHelpers,
  registerJoiningConcat,
} from "./Fixtures/EmailBrandHelpers";

/*
 * AuditLogExportFailed.hbs - what the people who can fix a failing audit
 * log export get (ee/Server/AuditLogExport/AuditLogExportNotifications): a
 * project's owners for a project's export, every master admin (through the
 * instance health sender) for the instance's. One template serves both
 * emails of a run of failures - "is failing" and "will start losing
 * entries" - so its own sentence says only what an export does; the
 * subject, the badge, the details and the remediation say which it is.
 *
 * The export's name and the destination's answer are written by people and
 * by outside services, and are escaped like every other value. Why the
 * email came is the owner sentence the sender gives, or the master admin
 * one when it gives none.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const handlebars: typeof Handlebars = Handlebars.create();

const ERROR: string =
  "The webhook answered HTTP 401 (Unauthorized). <b>Check</b> the token.";

function render(data: {
  isInstanceExport: boolean;
  isLosing: boolean;
}): string {
  const vars: Record<string, string> = {
    subject: data.isInstanceExport
      ? data.isLosing
        ? 'The audit log export "Instance archive" of your OneUptime instance will start losing entries'
        : 'The audit log export "Instance archive" of your OneUptime instance is failing'
      : data.isLosing
        ? 'The audit log export "SIEM <webhook>" will start losing entries'
        : 'The audit log export "SIEM <webhook>" is failing',
    badgeType: data.isLosing ? "critical" : "warning",
    badgeText: data.isLosing ? "Entries about to be lost" : "Export failing",
    oneuptimeHost: "oneuptime.acme.test",
    homeURL: "https://oneuptime.acme.test",
    healthPageLink: data.isInstanceExport
      ? "https://oneuptime.acme.test/admin/settings/audit-log-export"
      : "https://oneuptime.acme.test/dashboard/0f9e8d7c-6b5a-4493-8211-00aa11bb22cc/settings/audit-logs/export",
    healthPageButtonText: "Open Audit Log Export",
    remediation: data.isLosing
      ? "From about Oct 31, 2026, 11:55 AM UTC, the entries this export has not sent are deleted as they pass the audit log's retention of 7 days, and are never sent. Fix the destination before then, and the export sends them, oldest first."
      : "Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: the audit log keeps each entry for 7 days.",
    detail1Title: "Export: ",
    detail1Text: "SIEM <webhook>",
    detail2Title: "Destination: ",
    detail2Text: "Webhook",
    detail3Title: "Failing since: ",
    detail3Text: "Oct 24, 2026, 12:00 PM UTC",
    detail4Title: "Oldest entry not sent: ",
    detail4Text: "Oct 24, 2026, 11:55 AM UTC",
    year: "2026",
  };

  if (data.isLosing) {
    vars["detail5Title"] = "Entries lost from: ";
    vars["detail5Text"] = "about Oct 31, 2026, 11:55 AM UTC";
    vars["detail6Title"] = "Why: ";
    vars["detail6Text"] = ERROR;
  } else {
    vars["detail5Title"] = "Why: ";
    vars["detail5Text"] = ERROR;
  }

  if (!data.isInstanceExport) {
    vars["reasonText"] =
      "You are receiving this email because you are an owner of the project Payments, which exports its audit log.";
  }

  return handlebars.compile(
    fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, "AuditLogExportFailed.hbs"),
      "utf8",
    ),
  )(vars);
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const name: string | undefined = filename.endsWith(".hbs")
      ? filename.slice(0, -".hbs".length)
      : undefined;

    if (name) {
      handlebars.registerPartial(
        name,
        fs.readFileSync(Path.resolve(partialsDir, filename), "utf8"),
      );
    }
  }

  handlebars.registerHelper(
    "ifCond",
    function (this: unknown, v1: unknown, v2: unknown, options: any) {
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );
  registerJoiningConcat(handlebars);
  registerEmailBrandHelpers(handlebars);
  registerEmailDetailCardHelpers(handlebars);
});

const EVERY_EMAIL: Array<{ isInstanceExport: boolean; isLosing: boolean }> = [
  { isInstanceExport: false, isLosing: false },
  { isInstanceExport: false, isLosing: true },
  { isInstanceExport: true, isLosing: false },
  { isInstanceExport: true, isLosing: true },
];

describe("AuditLogExportFailed.hbs", () => {
  test("says what an export does, in words true of both emails", () => {
    for (const email of EVERY_EMAIL) {
      expect(visibleText(render(email))).toContain(
        "An audit log export sends each audit log entry, as it is recorded, to a destination you chose.",
      );
    }
  });

  test("the subject, the badge and the details say which email it is", () => {
    const failing: string = visibleText(
      render({ isInstanceExport: false, isLosing: false }),
    );
    const losing: string = visibleText(
      render({ isInstanceExport: false, isLosing: true }),
    );

    expect(failing).toContain(
      'The audit log export "SIEM <webhook>" is failing',
    );
    expect(failing).toContain("Export failing");
    expect(failing).toContain("Oldest entry not sent:");
    expect(failing).not.toContain("Entries lost from:");
    expect(losing).toContain(
      'The audit log export "SIEM <webhook>" will start losing entries',
    );
    expect(losing).toContain("Entries about to be lost");
    expect(losing).toContain("Entries lost from: about Oct 31, 2026");
    expect(losing).toContain("Fix the destination before then");
  });

  test("all six detail rows show, the destination's answer last", () => {
    const text: string = visibleText(
      render({ isInstanceExport: false, isLosing: true }),
    );

    const order: Array<number> = [
      "Export:",
      "Destination:",
      "Failing since:",
      "Oldest entry not sent:",
      "Entries lost from:",
      "Why:",
    ].map((title: string): number => {
      return text.indexOf(title);
    });

    expect(
      order.every((index: number): boolean => {
        return index >= 0;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
  });

  test("the button opens the export's page", () => {
    const project: string = render({
      isInstanceExport: false,
      isLosing: false,
    });
    const instance: string = render({
      isInstanceExport: true,
      isLosing: false,
    });

    expect(project).toContain(
      'href="https://oneuptime.acme.test/dashboard/0f9e8d7c-6b5a-4493-8211-00aa11bb22cc/settings/audit-logs/export"',
    );
    expect(instance).toContain(
      'href="https://oneuptime.acme.test/admin/settings/audit-log-export"',
    );
    expect(visibleText(project)).toContain("Open Audit Log Export");
  });

  test("says why it was sent: the owner sentence it is given, else the master admin one", () => {
    const project: string = visibleText(
      render({ isInstanceExport: false, isLosing: false }),
    );
    const instance: string = visibleText(
      render({ isInstanceExport: true, isLosing: false }),
    );

    expect(project).toContain(
      "You are receiving this email because you are an owner of the project Payments, which exports its audit log.",
    );
    expect(project).not.toContain("master admin");
    expect(instance).toContain(
      "You are receiving this email because you are a master admin on this OneUptime instance and it exports its audit log.",
    );
  });

  test("shows the export's name and the destination's answer as written, escaped", () => {
    const html: string = render({ isInstanceExport: false, isLosing: true });

    expect(visibleText(html)).toContain(
      "(Unauthorized). <b>Check</b> the token.",
    );
    expect(visibleText(html)).toContain("SIEM <webhook>");
    expect(html).not.toContain("<b>Check</b>");
    expect(html).not.toContain("<webhook>");
  });
});
