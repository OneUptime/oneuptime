import {
  DISPLAY_NAME_COLUMNS,
  DisplayNameModel,
  MAX_DISPLAY_NAME_LENGTH,
  NameListSummary,
  getDisplayNameColumn,
  getRecordDisplayName,
  readDisplayText,
  shortenDisplayName,
  summarizeNames,
} from "../../../UI/Utils/ModelDisplayName";
import Alert from "../../../Models/DatabaseModels/Alert";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../../Models/DatabaseModels/EnterpriseLicenseInstance";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Label from "../../../Models/DatabaseModels/Label";
import LlmModelPrice from "../../../Models/DatabaseModels/LlmModelPrice";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TelemetrySourceMap from "../../../Models/DatabaseModels/TelemetrySourceMap";
import User from "../../../Models/DatabaseModels/User";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { describe, expect, test } from "@jest/globals";

type ModelType = { new (): BaseModel };

/*
 * What a delete confirmation calls a record. "Are you sure you want to delete
 * this workflow?" named nothing; the dialogs now name the record, and this is
 * the one place that decides what its name is. These pin the choice of column
 * per model, the reading of the value, the fallbacks and the list summary the
 * bulk delete shows.
 */

describe("getDisplayNameColumn", () => {
  test.each([
    ["a workflow, by the column its slug is made from", Workflow, "name"],
    ["a monitor", Monitor, "name"],
    ["a project", Project, "name"],
    ["a label", Label, "name"],
    ["an incident, which slugs its title", Incident, "title"],
    ["an alert, which has a title and no name", Alert, "title"],
    // A template is not named by the title of the incident it creates.
    [
      "an incident template, by its templateName",
      IncidentTemplate,
      "templateName",
    ],
    [
      "a scheduled maintenance template, by its templateName",
      ScheduledMaintenanceTemplate,
      "templateName",
    ],
    [
      "an announcement template, which has a title too but no slug",
      StatusPageAnnouncementTemplate,
      "templateName",
    ],
    ["a note template", IncidentNoteTemplate, "templateName"],
    ["an inventory item", InventoryItem, "displayName"],
    ["a status page domain", StatusPageDomain, "fullDomain"],
    ["a subscriber", StatusPageSubscriber, "subscriberEmail"],
    ["a notification email", UserEmail, "email"],
    ["a user, by name first", User, "name"],
  ])("names %s", (_label: string, modelType: ModelType, column: string) => {
    expect(getDisplayNameColumn(new modelType())).toBe(column);
  });

  /*
   * Models whose name the inference would get wrong, or not find, say so on
   * the model itself.
   */
  test.each([
    [
      "an enterprise license, by company rather than contact email",
      EnterpriseLicense,
      "companyName",
    ],
    ["a license instance, by host", EnterpriseLicenseInstance, "host"],
    ["a network endpoint, by IP address", NetworkEndpoint, "ipAddress"],
    [
      "a database endpoint, by its host:port",
      DatabaseServerEndpoint,
      "endpoint",
    ],
    ["a source map, by its bundle path", TelemetrySourceMap, "bundlePath"],
    ["an LLM price, by its model prefix", LlmModelPrice, "modelPrefix"],
  ])(
    "follows the declared column for %s",
    (_label: string, modelType: ModelType, column: string) => {
      const model: BaseModel = new modelType();

      expect(model.getDisplayNameColumn()).toBe(column);
      expect(getDisplayNameColumn(model)).toBe(column);
    },
  );

  test("declares nothing on a model that does not need it", () => {
    expect(new Workflow().getDisplayNameColumn()).toBeNull();
    expect(new Monitor().getDisplayNameColumn()).toBeNull();
  });

  // A relationship row names nothing of its own.
  test.each([
    ["a team member", TeamMember],
    ["a monitor's probe", MonitorProbe],
  ])("finds no column for %s", (_label: string, modelType: ModelType) => {
    expect(getDisplayNameColumn(new modelType())).toBeNull();
  });

  test("ignores a declared column the model does not have", () => {
    const model: DisplayNameModel = {
      hasColumn: (column: string): boolean => {
        return column === "title";
      },
      getDisplayNameColumn: (): string => {
        return "notAColumn";
      },
      getSlugifyColumn: (): string => {
        return "alsoNotAColumn";
      },
    };

    expect(getDisplayNameColumn(model)).toBe("title");
  });

  test("works for a model with only hasColumn, such as an analytics model", () => {
    const model: DisplayNameModel = {
      hasColumn: (column: string): boolean => {
        return column === "email" || column === "username";
      },
    };

    expect(getDisplayNameColumn(model)).toBe("email");
  });

  test("returns null for no model at all", () => {
    expect(getDisplayNameColumn(null)).toBeNull();
    expect(getDisplayNameColumn(undefined)).toBeNull();
  });

  test("puts a template's own name before any title it carries", () => {
    expect(DISPLAY_NAME_COLUMNS.indexOf("templateName")).toBeLessThan(
      DISPLAY_NAME_COLUMNS.indexOf("title"),
    );
    expect(DISPLAY_NAME_COLUMNS.indexOf("name")).toBeLessThan(
      DISPLAY_NAME_COLUMNS.indexOf("email"),
    );
  });
});

describe("readDisplayText", () => {
  test("keeps a plain name as it is", () => {
    expect(readDisplayText("Notify on-call")).toBe("Notify on-call");
  });

  test("puts a multi-line value on one line", () => {
    expect(readDisplayText("  Checkout\n\n   is   down\t")).toBe(
      "Checkout is down",
    );
  });

  test("reads numbers", () => {
    expect(readDisplayText(42)).toBe("42");
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["true", true],
    ["false", false],
    ["a blank string", "   "],
    ["a date", new Date("2026-10-01T00:00:00Z")],
    ["an array", ["a", "b"]],
    ["a plain object", { a: 1 }],
    [
      "a function",
      (): string => {
        return "x";
      },
    ],
  ])("is empty for %s", (_label: string, value: unknown) => {
    expect(readDisplayText(value)).toBe("");
  });

  test("reads Name and Email objects by their text", () => {
    expect(readDisplayText(new Name("Jane Doe"))).toBe("Jane Doe");
    expect(readDisplayText(new Email("jane@example.com"))).toBe(
      "jane@example.com",
    );
  });

  test("reads a typed value as it arrives over the wire", () => {
    expect(readDisplayText({ _type: "Email", value: "jane@example.com" })).toBe(
      "jane@example.com",
    );
    expect(readDisplayText({ _type: "Name", value: "  Jane  " })).toBe("Jane");
  });

  test('never shows "[object Object]"', () => {
    const odd: { toString: () => string } = {
      toString: (): string => {
        return "[object Thing]";
      },
    };

    expect(readDisplayText(odd)).toBe("");
  });
});

describe("shortenDisplayName", () => {
  test("leaves a name that fits alone", () => {
    expect(shortenDisplayName("Checkout API")).toBe("Checkout API");
  });

  test("cuts a long name to the limit, ending in an ellipsis", () => {
    const long: string = "x".repeat(MAX_DISPLAY_NAME_LENGTH + 50);
    const shortened: string = shortenDisplayName(long);

    expect(Array.from(shortened)).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
    expect(shortened.endsWith("…")).toBe(true);
  });

  test("keeps a name of exactly the limit", () => {
    const exact: string = "y".repeat(MAX_DISPLAY_NAME_LENGTH);

    expect(shortenDisplayName(exact)).toBe(exact);
  });

  test("does not leave a space before the ellipsis", () => {
    expect(shortenDisplayName("alpha beta gamma", 7)).toBe("alpha…");
  });

  test("never splits an emoji", () => {
    const name: string = "🔥🔥🔥🔥🔥";
    const shortened: string = shortenDisplayName(name, 3);

    expect(shortened).toBe("🔥🔥…");
    expect(shortened).not.toContain("�");
  });

  test("keeps at least one character", () => {
    expect(shortenDisplayName("abcdef", 1)).toBe("a…");
  });
});

describe("getRecordDisplayName", () => {
  test("reads the column the caller names first", () => {
    expect(
      getRecordDisplayName(
        { name: "Jane Doe", email: "jane@example.com" },
        { column: "email" },
      ),
    ).toBe("jane@example.com");
  });

  test("reads the model's own column before the common ones", () => {
    const row: Record<string, unknown> = {
      title: "Checkout is down",
      templateName: "Checkout outage",
    };

    expect(getRecordDisplayName(row, { model: new IncidentTemplate() })).toBe(
      "Checkout outage",
    );
  });

  test("falls through to whatever name-like field the record has", () => {
    expect(getRecordDisplayName({ title: "Checkout is down" })).toBe(
      "Checkout is down",
    );
    expect(getRecordDisplayName({ fullDomain: "status.acme.com" })).toBe(
      "status.acme.com",
    );
    expect(getRecordDisplayName({ subscriberPhone: "+15551234567" })).toBe(
      "+15551234567",
    );
  });

  test("skips a blank field for the next one", () => {
    expect(getRecordDisplayName({ name: "  ", email: "a@b.co" })).toBe(
      "a@b.co",
    );
  });

  test("uses the slug as a last resort", () => {
    expect(getRecordDisplayName({ slug: "checkout-api-7d2k" })).toBe(
      "checkout-api-7d2k",
    );
    expect(
      getRecordDisplayName({ slug: "checkout-api-7d2k", name: "Checkout API" }),
    ).toBe("Checkout API");
  });

  /*
   * A team member row carries its user. Naming the row by that user would
   * have the dialog say "delete Jane Doe" about a row that only takes Jane off
   * a team.
   */
  test("does not follow relations", () => {
    expect(
      getRecordDisplayName(
        { _id: "row-1", user: { name: "Jane Doe", email: "jane@example.com" } },
        { model: new TeamMember() },
      ),
    ).toBe("");
  });

  test("reads a model instance as well as a plain object", () => {
    const monitor: Monitor = new Monitor();
    monitor.name = "Checkout API";

    expect(getRecordDisplayName(monitor, { model: new Monitor() })).toBe(
      "Checkout API",
    );
  });

  test("shortens a long name unless asked not to", () => {
    const long: string = "z".repeat(MAX_DISPLAY_NAME_LENGTH * 2);

    expect(Array.from(getRecordDisplayName({ name: long }))).toHaveLength(
      MAX_DISPLAY_NAME_LENGTH,
    );
    expect(getRecordDisplayName({ name: long }, { maxLength: 0 })).toBe(long);
    expect(
      getRecordDisplayName({ name: long }, { maxLength: 10 }),
    ).toHaveLength(10);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "Checkout"],
    ["a number", 7],
    ["an empty object", {}],
  ])("is empty for %s", (_label: string, record: unknown) => {
    expect(getRecordDisplayName(record)).toBe("");
  });

  test("never names a record by its id", () => {
    expect(
      getRecordDisplayName({
        _id: "11111111-1111-4111-8111-111111111111",
        id: new ObjectID("11111111-1111-4111-8111-111111111111"),
      }),
    ).toBe("");
  });
});

describe("summarizeNames", () => {
  test("lists every name when there are few", () => {
    const summary: NameListSummary = summarizeNames({
      names: ["A", "B", "C"],
      totalCount: 3,
    });

    expect(summary).toEqual({ shownNames: ["A", "B", "C"], remainingCount: 0 });
  });

  test('shows one past the limit rather than "and 1 more"', () => {
    const summary: NameListSummary = summarizeNames({
      names: ["A", "B", "C", "D", "E", "F"],
      totalCount: 6,
    });

    expect(summary.shownNames).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(summary.remainingCount).toBe(0);
  });

  test("names the first few and counts the rest", () => {
    const names: Array<string> = Array.from(
      { length: 40 },
      (_v: unknown, i: number) => {
        return `Monitor ${i + 1}`;
      },
    );

    const summary: NameListSummary = summarizeNames({
      names: names,
      totalCount: 40,
    });

    expect(summary.shownNames).toEqual([
      "Monitor 1",
      "Monitor 2",
      "Monitor 3",
      "Monitor 4",
      "Monitor 5",
    ]);
    expect(summary.remainingCount).toBe(35);
  });

  test("counts records without a name among the rest", () => {
    const summary: NameListSummary = summarizeNames({
      names: ["A", "", "B", "   "],
      totalCount: 4,
    });

    expect(summary.shownNames).toEqual(["A", "B"]);
    expect(summary.remainingCount).toBe(2);
  });

  test("lists nothing when nothing has a name", () => {
    expect(summarizeNames({ names: ["", ""], totalCount: 2 })).toEqual({
      shownNames: [],
      remainingCount: 2,
    });
  });

  test("keeps two records of the same name", () => {
    expect(
      summarizeNames({ names: ["API", "API"], totalCount: 2 }).shownNames,
    ).toEqual(["API", "API"]);
  });

  test("honours a smaller limit, and never goes below one", () => {
    expect(
      summarizeNames({
        names: ["A", "B", "C", "D"],
        totalCount: 4,
        maxShown: 2,
      }),
    ).toEqual({ shownNames: ["A", "B"], remainingCount: 2 });
    expect(
      summarizeNames({ names: ["A", "B", "C"], totalCount: 3, maxShown: 0 }),
    ).toEqual({ shownNames: ["A"], remainingCount: 2 });
  });

  test("never reports fewer records than names", () => {
    expect(
      summarizeNames({ names: ["A", "B"], totalCount: 1 }).remainingCount,
    ).toBe(0);
  });
});
