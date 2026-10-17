import {
  MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ,
  maintenanceDescriptionToPlainText,
} from "../../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarPlainText";
import { describe, expect, test } from "@jest/globals";

/*
 * A maintenance event's description is Markdown; a calendar app shows plain
 * text. Links read as their words, images as their alt text, and a
 * description of megabytes is never read whole.
 */

describe("maintenanceDescriptionToPlainText", () => {
  test("no description is no text", () => {
    expect(maintenanceDescriptionToPlainText(undefined)).toBe("");
    expect(maintenanceDescriptionToPlainText(null)).toBe("");
    expect(maintenanceDescriptionToPlainText("")).toBe("");
  });

  test("Markdown reads as the words a reader sees", () => {
    const text: string = maintenanceDescriptionToPlainText(
      "## Database upgrade\n\nWe move to **Postgres 18**. See [the runbook](https://example.com/runbook) and ![the plan](https://example.com/plan.png).",
    );

    expect(text).toContain("Database upgrade");
    expect(text).toContain("Postgres 18");
    expect(text).toContain("the runbook");
    expect(text).toContain("the plan");
    expect(text).not.toContain("**");
    expect(text).not.toContain("](");
    expect(text).not.toContain("##");
  });

  test("a description far longer than a calendar shows is read only up to its limit", () => {
    const text: string = maintenanceDescriptionToPlainText(
      "a".repeat(MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ * 50),
    );

    expect(text.length).toBeLessThanOrEqual(
      MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ,
    );
  });

  test("never cuts a character in two at the limit", () => {
    const text: string = maintenanceDescriptionToPlainText(
      `${"a".repeat(MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ - 1)}😀 and more`,
    );

    const last: number = text.charCodeAt(text.length - 1);

    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(text.endsWith("a")).toBe(true);
  });
});
