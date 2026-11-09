import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import AuditLogChangesModal, {
  ChangeRow,
  readChangeRows,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import Email from "Common/Types/Email";
import HashedString from "Common/Types/HashedString";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import Phone from "Common/Types/Phone";
import Port from "Common/Types/Port";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * THE CHANGES DIALOG READS A PHONE NUMBER AS THE NUMBER (issue #6325),
 * whenever the entry was recorded.
 *
 * An entry recorded now holds the number as text. One recorded before holds
 * { "_type": "Phone", "value": ... } until its retention ends - and the
 * dashboard's API client turns that JSON back into a Phone before the
 * dialog sees it. Either way the dialog shows "+14155550100" in Before and
 * After, never the JSON, and not the "Changed the value" its JSON was
 * described by. A hash shows as [REDACTED]; a structure stays JSON.
 */

afterEach(() => {
  cleanup();
});

// The changes as the dialog is handed them: through the server's JSON and the API client.
function throughTheApi(changes: JSONArray): JSONArray {
  return JSONFunctions.deserializeValue(
    JSON.parse(
      JSON.stringify(JSONFunctions.serializeValue(changes as JSONValue)),
    ) as JSONValue,
  ) as JSONArray;
}

function openDialog(data: { action: string; changes: JSONArray }): HTMLElement {
  render(
    <AuditLogChangesModal
      isOpen={true}
      onClose={jest.fn()}
      action={data.action}
      resourceType="Incoming Call Policy"
      resourceName="Support line"
      changes={data.changes}
    />,
  );

  return document.body;
}

const NEW_ENTRY: JSONArray = [
  {
    field: "routingPhoneNumber",
    oldValue: "+14155550100",
    newValue: "+14155550101",
  },
];

const OLD_ENTRY: JSONArray = [
  {
    field: "routingPhoneNumber",
    oldValue: { _type: "Phone", value: "+14155550100" },
    newValue: { _type: "Phone", value: "+14155550101" },
    summary: ["Changed value"],
  },
];

describe("a changed phone number reads as the number, before and after", () => {
  test("in a new entry", () => {
    const page: HTMLElement = openDialog({
      action: "Update",
      changes: throughTheApi(NEW_ENTRY),
    });

    expect(screen.getByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("+14155550101")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(
      screen.queryByTestId("audit-log-change-summary"),
    ).not.toBeInTheDocument();
    expect(page.textContent).not.toContain("_type");
  });

  test("in an old entry that still holds the JSON, read back by the API client", () => {
    const changes: JSONArray = throughTheApi(OLD_ENTRY);

    // What the dialog is handed is a Phone again, not text.
    expect((changes[0] as JSONObject)["oldValue"]).toBeInstanceOf(Phone);

    const page: HTMLElement = openDialog({ action: "Update", changes });

    expect(screen.getByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("+14155550101")).toBeInTheDocument();
    expect(
      screen.queryByTestId("audit-log-change-summary"),
    ).not.toBeInTheDocument();
    expect(page.textContent).not.toContain("_type");
    expect(page.textContent).not.toContain("Changed value");
  });

  test("in an old entry handed over as it is stored", () => {
    const page: HTMLElement = openDialog({
      action: "Update",
      changes: OLD_ENTRY,
    });

    expect(screen.getByText("+14155550100")).toBeInTheDocument();
    expect(page.textContent).not.toContain("_type");
  });

  test("the issue's entry: the number released, and no 'Changed the value'", () => {
    const page: HTMLElement = openDialog({
      action: "Update",
      changes: throughTheApi([
        {
          field: "routingPhoneNumber",
          oldValue: { _type: "Phone", value: "+14155550100" },
          newValue: null,
          summary: ["Changed the value"],
        },
      ]),
    });

    expect(screen.getByText("+14155550100")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(page.textContent).not.toContain("Changed the value");
    expect(page.textContent).not.toContain("_type");
  });
});

describe("other typed values, created and deleted", () => {
  test("an old entry's created email address is the address", () => {
    const page: HTMLElement = openDialog({
      action: "Create",
      changes: throughTheApi([
        {
          field: "fromEmail",
          newValue: { _type: "Email", value: "alerts@example.com" },
        },
      ]),
    });

    expect(screen.getByText("Created snapshot")).toBeInTheDocument();
    expect(screen.getByText("alerts@example.com")).toBeInTheDocument();
    expect(page.textContent).not.toContain("_type");
  });

  test("an old entry's deleted port is the number", () => {
    const page: HTMLElement = openDialog({
      action: "Delete",
      changes: throughTheApi([
        { field: "port", oldValue: { _type: "Port", value: 587 } },
      ]),
    });

    expect(screen.getByText("587")).toBeInTheDocument();
    expect(page.textContent).not.toContain("_type");
  });

  test("an old entry's hash shows as [REDACTED], never the hash", () => {
    const page: HTMLElement = openDialog({
      action: "Update",
      changes: throughTheApi([
        {
          field: "masterPassword",
          oldValue: { _type: "HashedString", value: "old-hash-6325" },
          newValue: { _type: "HashedString", value: "new-hash-6325" },
          summary: ["Changed value"],
        },
      ]),
    });

    expect(screen.getAllByText(AUDIT_LOG_REDACTED_VALUE)).toHaveLength(2);
    expect(page.textContent).not.toContain("hash-6325");
  });
});

describe("what is no typed value reads as before", () => {
  test("a monitor's steps stay JSON", () => {
    openDialog({
      action: "Create",
      changes: [
        {
          field: "monitorSteps",
          newValue: JSON.parse(JSON.stringify(new MonitorSteps())),
        },
      ],
    });

    expect(
      screen.getByText((content: string): boolean => {
        return content.includes('"_type": "MonitorSteps"');
      }),
    ).toBeInTheDocument();
  });

  test("a { _type, value } with another key, or a _type nobody knows, stays JSON", () => {
    openDialog({
      action: "Update",
      changes: [
        {
          field: "a",
          oldValue: { _type: "Phone", value: "+1", label: "x" },
          newValue: null,
        },
        {
          field: "b",
          oldValue: { _type: "Telephone", value: "+1" },
          newValue: null,
        },
      ],
    });

    expect(
      screen.getByText((content: string): boolean => {
        return content.includes('"label": "x"');
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content: string): boolean => {
        return content.includes('"_type": "Telephone"');
      }),
    ).toBeInTheDocument();
  });

  test("a setting holding an address keeps its JSON and the path that changed", () => {
    openDialog({
      action: "Update",
      changes: [
        {
          field: "settings",
          oldValue: { to: { _type: "Email", value: "a@example.com" } },
          newValue: { to: { _type: "Email", value: "b@example.com" } },
          summary: ["Changed to › value"],
        },
      ],
    });

    expect(
      within(screen.getByTestId("audit-log-change-summary")).getByText(
        "Changed to › value",
      ),
    ).toBeInTheDocument();
  });
});

describe("the rows the dialog lists", () => {
  test("are each change read as recorded now, by field name", () => {
    const rows: Array<ChangeRow> = readChangeRows(
      throughTheApi([
        {
          field: "subscriberPhone",
          oldValue: { _type: "Phone", value: "+14155550100" },
          newValue: null,
          summary: ["Changed the value"],
        },
        { field: "name", oldValue: "A", newValue: "B" },
        {
          field: "graph",
          oldValue: "1 step",
          newValue: "2 steps",
          summary: ['Added "Log" (log-1)'],
        },
      ]),
    );

    expect(rows).toEqual([
      {
        field: "graph",
        oldValue: "1 step",
        newValue: "2 steps",
        summary: ['Added "Log" (log-1)'],
      },
      { field: "name", oldValue: "A", newValue: "B", summary: [] },
      {
        field: "subscriberPhone",
        oldValue: "+14155550100",
        newValue: null,
        summary: [],
      },
    ]);
  });

  test("leave out what is not a change with a field", () => {
    expect(
      readChangeRows([
        null,
        "text",
        7,
        [],
        ["x"],
        { oldValue: "a" },
        { field: "" },
        { field: 3 },
      ] as unknown as JSONArray),
    ).toEqual([]);
    expect(readChangeRows(undefined)).toEqual([]);
    expect(readChangeRows({ field: "x" })).toEqual([]);
  });
});

/*
 * A seeded sweep of entries, old and new, as the dialog is handed them:
 * typed values of several kinds as text, as their JSON and as the objects
 * the API client makes of the JSON, and hashes. The dialog shows each
 * value as what it holds, never a typed value's JSON, never a hash, and no
 * line of a typed value's JSON.
 */
describe("a seeded sweep of entries, old and new", () => {
  interface Drawn {
    // What the dialog should show for it.
    shown: string;
    // The value as the entry holds it.
    held: JSONValue;
    // A text that must never show, for a hash.
    hidden: string | null;
  }

  function drawValue(random: SeededRandom, isOld: boolean): Drawn {
    const kind: number = random(4);
    const typed: Phone | Email | Port | HashedString =
      kind === 0
        ? new Phone(`+1415555${String(1000 + random(9000))}`)
        : kind === 1
          ? new Email(`user${random(100000)}@example.com`)
          : kind === 2
            ? new Port(1 + random(65535))
            : new HashedString(`sweep-hash-${random(1000000)}`, true);
    const isHash: boolean = typed instanceof HashedString;
    const json: JSONValue = JSON.parse(JSON.stringify(typed)) as JSONValue;

    return {
      shown: isHash ? AUDIT_LOG_REDACTED_VALUE : String(typed),
      held: isOld
        ? json
        : isHash
          ? AUDIT_LOG_REDACTED_VALUE
          : ((json as JSONObject)["value"] as JSONValue),
      hidden: isHash ? typed.toString() : null,
    };
  }

  test("60 entries, rendered: every value as what it holds", () => {
    const random: SeededRandom = seededRandom(6325);
    const problems: Array<string> = [];

    for (let index: number = 0; index < 60; index++) {
      const isOld: boolean = random(2) === 0;
      const before: Drawn = drawValue(random, isOld);
      const after: Drawn = drawValue(random, isOld);
      const changes: JSONArray = [
        {
          field: "value",
          oldValue: before.held,
          newValue: after.held,
          ...(isOld ? { summary: ["Changed value"] } : {}),
        },
      ];
      const page: HTMLElement = openDialog({
        action: "Update",
        changes: random(2) === 0 ? throughTheApi(changes) : changes,
      });
      const text: string = page.textContent || "";

      for (const drawn of [before, after]) {
        if (!text.includes(drawn.shown)) {
          problems.push(`${index}: does not show ${drawn.shown}`);
        }

        if (drawn.hidden && text.includes(drawn.hidden)) {
          problems.push(`${index}: shows a hash`);
        }
      }

      if (text.includes("_type") || text.includes("Changed value")) {
        problems.push(`${index}: shows the JSON: ${text}`);
      }

      cleanup();
    }

    expect(problems).toEqual([]);
  });
});
