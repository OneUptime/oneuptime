import { AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS } from "Common/Server/Services/AIBillingService";
import {
  getProjectBalanceWhoCanAddSentence,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say what happens when a project's AI credits run out, the way
 * the product does it:
 *
 * - with Auto Recharge on, the call that finds them used up recharges them
 *   first and runs, calls arriving together charge the card once, and
 *   turning Auto Recharge on below its threshold tops up at once;
 * - with it off, AI stops: refusals name who can add credits, the AI Logs
 *   list them as Insufficient Balance, investigations are not started;
 * - a failed charge stops AI too, the card is tried again an hour later,
 *   and a recharge by hand tries at once;
 * - the owners are emailed once each time the credits run out.
 *
 * And the on-call docs say a page that is not sent shows why in the
 * person's On-Call Logs, instead of "Sending" for ever.
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

// The text of one "### " section of a page, up to the next heading.
function section(page: string, heading: string): string {
  const start: number = page.indexOf(heading);

  expect(start).toBeGreaterThan(-1);

  const rest: string = page.slice(start + heading.length);
  const next: number = rest.search(/ #{2,3} /);

  return next === -1 ? rest : rest.slice(0, next);
}

describe("AI SRE: when AI credits run out", () => {
  const page: string = readPage("ai/ai-sre.md");
  const credits: string = section(page, "### When AI credits run out");

  test("sits under Cost controls, after the project's own daily limits", () => {
    const costControls: number = page.indexOf("## Cost controls");
    const dailyLimits: number = page.indexOf(
      "### The project's own daily limits",
    );
    const runOut: number = page.indexOf("### When AI credits run out");
    const trust: number = page.indexOf("## Trust and safety");

    expect(costControls).toBeGreaterThan(-1);
    expect(dailyLimits).toBeGreaterThan(costControls);
    expect(runOut).toBeGreaterThan(dailyLimits);
    expect(trust).toBeGreaterThan(runOut);
  });

  test("names the page that holds the credits and Auto Recharge", () => {
    expect(credits).toContain("**Project Settings > AI > AI Credits**");
    expect(credits).toContain("**Auto Recharge**");
  });

  test("Auto Recharge on: the call recharges first and runs, the card is charged once, turning it on tops up at once", () => {
    expect(credits).toContain(
      "**Auto Recharge on**: the AI call that finds the credits used up first adds the amount Auto Recharge is set to, charging the project's card, and then runs.",
    );
    expect(credits).toContain(
      "Calls that arrive at the same moment charge the card once.",
    );
    expect(credits).toContain(
      "Turning Auto Recharge on while the credits are below its threshold adds them straight away",
    );
  });

  test("Auto Recharge off: AI stops, refusals say who can add credits, in the product's own words", () => {
    expect(credits).toContain("**Auto Recharge off**: OneUptime AI stops.");
    expect(credits).toContain(
      `"${getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI)}"`,
    );
    expect(credits).toContain("**Insufficient Balance**");
    expect(credits).toContain(
      "Automatic investigations and postmortem drafts are not started",
    );
  });

  test("a failed charge: AI stops, the card is tried again an hour later, a recharge by hand tries at once", () => {
    expect(AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS).toBe(60 * 60);
    expect(credits).toContain(
      "**Auto Recharge could not charge the card** (there is no payment method, or the card was declined)",
    );
    expect(credits).toContain("Auto Recharge tries the card again an hour later.");
    expect(credits).toContain(
      "Adding credits by hand, or saving Auto Recharge again, tries at once.",
    );
  });

  test("the owners are emailed once each time the credits run out, with a link to AI Credits", () => {
    expect(credits).toContain(
      "**The project's owners are emailed** the first time OneUptime AI stops for want of credits",
    );
    expect(credits).toContain("links to **AI Credits**");
    expect(credits).toContain("It comes once each time the credits run out");
  });

  test("no longer says Auto Recharge only works before the credits run out", () => {
    expect(page).not.toMatch(/recharged (only )?after a call/i);
    expect(page).not.toMatch(/stays used up/i);
  });
});

describe("Escalation rules: a page that is not sent", () => {
  const page: string = readPage("on-call/escalation-rules.md");

  test("says why in the person's On-Call Logs, instead of Sending for ever", () => {
    expect(page).toContain(
      "A page that is not sent says why in the person's **On-Call Logs** (User Settings): its row shows **Error**, and its status message gives the reason",
    );
    expect(page).toContain("It no longer stays at **Sending**.");
  });

  test("names both reasons: the balance, and a channel that is off", () => {
    expect(page).toContain(
      "the project's balance could not pay for it, and who can add balance",
    );
    expect(page).toContain(
      "the channel is off in the project, and who can turn it on",
    );
  });
});
