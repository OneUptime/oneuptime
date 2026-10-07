import { SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS } from "Common/Server/Services/NotificationService";
import { AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS } from "Common/Server/Services/AIBillingService";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say what the product does with the balance SMS, calls, WhatsApp
 * and Telegram are paid from, and with a failed Auto Recharge:
 *
 * - every message pays its exact cost, however many go out at once;
 * - messages that find the balance low together charge the card once;
 * - a failed charge is tried again an hour later, and the page that holds
 *   the balance says so at the top until then - Notification Settings for
 *   messages, AI Credits for AI - with what to do, or who can;
 * - pages keep going out on what is left while Auto Recharge cannot charge
 *   the card.
 */

const DOCS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

function readPage(relative: string): string {
  return fs
    .readFileSync(path.join(DOCS_ROOT, "en", relative), "utf8")
    .replace(/\s*\n\s*/g, " ");
}

describe("Escalation rules: the balance pages are paid from", () => {
  const page: string = readPage("on-call/escalation-rules.md");

  test("names the page that holds the balance and Auto Recharge", () => {
    expect(page).toContain(
      "each SMS, call, WhatsApp and Telegram message is paid from the project's balance on **Project Settings > Notifications > Notification Settings**",
    );
  });

  test("every message pays its exact cost, however many go out at once", () => {
    expect(page).toContain(
      "its exact cost comes off the balance when the provider takes it, however many messages go out at once.",
    );
  });

  test("messages that find the balance low together charge the card once", () => {
    expect(page).toContain(
      "messages that find it low at the same moment charge the card once.",
    );
  });

  test("a failed charge is tried again an hour later, and Notification Settings says so at the top", () => {
    expect(SMS_OR_CALL_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(60 * 60);
    expect(page).toContain(
      "Auto Recharge tries the card again an hour later, and **Notification Settings** says so at the top until then.",
    );
    expect(page).toContain(
      "Adding balance by hand, or saving Auto Recharge again, tries at once.",
    );
  });

  test("pages keep going out on what is left", () => {
    expect(page).toContain(
      "Pages keep going out on the balance that is left while Auto Recharge cannot charge the card.",
    );
  });
});

describe("AI SRE: a failed Auto Recharge shows on AI Credits", () => {
  const page: string = readPage("ai/ai-sre.md");

  test("AI Credits says so at the top, with what to do or who can", () => {
    expect(AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(60 * 60);
    expect(page).toContain(
      "Until then **AI Credits** says so at the top, to everyone who opens it: a project owner or someone with **Manage Billing** is asked to check the payment method or add credits, and everyone else is told who can.",
    );
  });
});
