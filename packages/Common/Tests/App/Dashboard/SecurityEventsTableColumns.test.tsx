import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

import securityEventColumns from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsTableColumns";
import Column from "../../../UI/Components/ModelTable/Column";
import { getColumnIds } from "../../../UI/Components/ModelTable/ColumnPreference";
import { getSelectFromColumns } from "../../../UI/Components/ModelTable/SelectFromColumns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import Select from "../../../Types/BaseDatabase/Select";
import { JSONObject } from "../../../Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * The security events table's column set
 * ---------------------------------------------------------------------------
 *
 * The table used to offer seven columns while the detail panel showed twelve
 * fields, so answering "which vendor produced all of these?" meant opening
 * every event one at a time (OneUptime/oneuptime#3399). Every field the detail
 * panel shows is now a column; the seven that were the whole table are still
 * the seven that show by default, and the rest are one click away in the
 * picker.
 *
 * Three classes of mistake are invisible on screen and each is pinned below:
 *
 *  - a field name that is not a column on the model. getSelectFromColumns
 *    throws a BadDataException for the primary field, which blanks the entire
 *    table rather than one cell.
 *  - a hidden column marked isNotCustomizable, which would put it in neither
 *    the table nor the picker: unreachable.
 *  - a column that silently changes the DEFAULT layout, which would reshuffle
 *    the table for every viewer who has never opened the picker.
 */

afterEach(() => {
  cleanup();
});

type TitlesOfFunction = (
  columns: Array<Column<SecurityEvent>>,
) => Array<string>;

const titlesOf: TitlesOfFunction = (
  columns: Array<Column<SecurityEvent>>,
): Array<string> => {
  return columns.map((column: Column<SecurityEvent>) => {
    return column.title;
  });
};

const visibleColumns: Array<Column<SecurityEvent>> =
  securityEventColumns.filter((column: Column<SecurityEvent>) => {
    return !column.isHiddenByDefault;
  });

type ColumnByTitleFunction = (title: string) => Column<SecurityEvent>;

const columnByTitle: ColumnByTitleFunction = (
  title: string,
): Column<SecurityEvent> => {
  const column: Column<SecurityEvent> | undefined = securityEventColumns.find(
    (candidate: Column<SecurityEvent>) => {
      return candidate.title === title;
    },
  );

  if (!column) {
    throw new Error(`No security event column titled "${title}"`);
  }

  return column;
};

type MakeEventFunction = (data: JSONObject) => SecurityEvent;

const makeEvent: MakeEventFunction = (data: JSONObject): SecurityEvent => {
  const event: SecurityEvent = new SecurityEvent();

  for (const key of Object.keys(data)) {
    (event as unknown as JSONObject)[key] = data[key];
  }

  return event;
};

describe("SecurityEventsTable columns - the default layout", () => {
  /*
   * These seven, in this order, are what the table showed before the rest were
   * added. Anything new has to ship hidden, or every existing viewer's table
   * silently rearranges itself.
   */
  test("shows exactly the seven columns it always did, in the same order", () => {
    expect(titlesOf(visibleColumns)).toEqual([
      "Time",
      "Severity",
      "Event Class",
      "Message",
      "Principal User",
      "Principal Host",
      "Vendor",
    ]);
  });

  test("everything else ships hidden", () => {
    const hidden: Array<Column<SecurityEvent>> = securityEventColumns.filter(
      (column: Column<SecurityEvent>) => {
        return Boolean(column.isHiddenByDefault);
      },
    );

    expect(hidden.length).toBe(securityEventColumns.length - 7);
    expect(hidden.length).toBeGreaterThan(0);
  });
});

describe("SecurityEventsTable columns - coverage of the detail panel", () => {
  /*
   * The issue's actual complaint: these are the fields the detail panel showed
   * but the picker did not offer. Named one by one rather than counted, so a
   * regression says which one went missing.
   */
  const requestedInIssue: Array<string> = [
    "Category",
    "Activity",
    "Vendor",
    "Product",
    "Rule Name",
    "Observables",
    "Event UID",
  ];

  test.each(requestedInIssue)("offers a %s column", (title: string) => {
    expect(titlesOf(securityEventColumns)).toContain(title);
  });

  /*
   * The rest of what the detail panel renders. Parity is the point: anything
   * worth reading on one event is worth scanning down the table.
   */
  const restOfTheDetailPanel: Array<string> = [
    "Time",
    "Severity",
    "Event Class",
    "Status",
    "Message",
    "Rule ID",
    "MITRE Tactics",
    "MITRE Techniques",
    "Principal User",
    "Principal Host",
    "Principal IP",
    "Principal Process",
    "Target User",
    "Target Host",
    "Target IP",
    "Target Port",
    "Target Resource",
  ];

  test.each(restOfTheDetailPanel)(
    "also offers a %s column",
    (title: string) => {
      expect(titlesOf(securityEventColumns)).toContain(title);
    },
  );

  test("the picker offers materially more than the seven it used to", () => {
    expect(securityEventColumns.length).toBe(
      requestedInIssue.length + restOfTheDetailPanel.length,
    );
  });
});

describe("SecurityEventsTable columns - shape", () => {
  test("every declared field is a real column on the model", () => {
    const model: SecurityEvent = new SecurityEvent();

    for (const column of securityEventColumns) {
      for (const field of Object.keys(column.field as JSONObject)) {
        expect({
          title: column.title,
          field,
          exists: model.hasColumn(field),
        }).toEqual({ title: column.title, field, exists: true });
      }
    }
  });

  /*
   * The real check that the above is enough: this is the call the table makes
   * on every fetch, and it throws rather than degrading.
   */
  test("building the API select does not throw", () => {
    const select: Select<SecurityEvent> = getSelectFromColumns<SecurityEvent>({
      columns: securityEventColumns,
      model: new SecurityEvent(),
    });

    expect((select as JSONObject)["categoryName"]).toBe(true);
    expect((select as JSONObject)["observables"]).toBe(true);
    expect((select as JSONObject)["eventUid"]).toBe(true);
  });

  test("column ids are unique, so a stored layout cannot confuse two of them", () => {
    const ids: Array<string> =
      getColumnIds<SecurityEvent>(securityEventColumns);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("titles are unique, so the picker's search is unambiguous", () => {
    const titles: Array<string> = titlesOf(securityEventColumns);

    expect(new Set(titles).size).toBe(titles.length);
  });

  /*
   * A hidden AND non-customizable column would be in neither the table nor the
   * picker.
   */
  test("no column is both hidden by default and kept out of the picker", () => {
    for (const column of securityEventColumns) {
      expect({
        title: column.title,
        unreachable: Boolean(
          column.isHiddenByDefault && column.isNotCustomizable,
        ),
      }).toEqual({ title: column.title, unreachable: false });
    }
  });

  /*
   * These columns are the table's own, not the viewer's - "remove" is only for
   * attribute columns, which are added from the picker in the first place.
   */
  test("no declared column is removable", () => {
    for (const column of securityEventColumns) {
      expect({
        title: column.title,
        removable: Boolean(column.isRemovable),
      }).toEqual({ title: column.title, removable: false });
    }
  });
});

describe("SecurityEventsTable columns - cells", () => {
  test("a text column with no value renders a dash rather than blank", () => {
    expect(columnByTitle("Category").noValueMessage).toBe("-");
    expect(columnByTitle("Rule Name").noValueMessage).toBe("-");
    expect(columnByTitle("Event UID").noValueMessage).toBe("-");
  });

  test("Observables joins the list into one scannable line", () => {
    const column: Column<SecurityEvent> = columnByTitle("Observables");

    const { container } = render(
      column.getElement!(
        makeEvent({ observables: ["web-1", "10.0.0.4", "bob@example.com"] }),
      ),
    );

    expect(container.textContent).toBe("web-1, 10.0.0.4, bob@example.com");
  });

  test("Observables keeps the full list available on hover", () => {
    const column: Column<SecurityEvent> = columnByTitle("Observables");

    const { container } = render(
      column.getElement!(makeEvent({ observables: ["web-1", "10.0.0.4"] })),
    );

    expect(container.querySelector("span")).toHaveAttribute(
      "title",
      "web-1, 10.0.0.4",
    );
  });

  test("an empty array column renders the placeholder, not an empty cell", () => {
    const column: Column<SecurityEvent> = columnByTitle("MITRE Tactics");

    const { container } = render(
      column.getElement!(makeEvent({ mitreTactics: [] })),
    );

    expect(container.textContent).toBe("-");
  });

  test("blank entries inside an array are dropped rather than joined as commas", () => {
    const column: Column<SecurityEvent> = columnByTitle("MITRE Techniques");

    const { container } = render(
      column.getElement!(
        makeEvent({ mitreTechniques: ["T1110", "", "T1078"] }),
      ),
    );

    expect(container.textContent).toBe("T1110, T1078");
  });

  test("array columns export the same joined text they render", () => {
    const column: Column<SecurityEvent> = columnByTitle("Observables");

    expect(
      column.getExportValue!(makeEvent({ observables: ["web-1", "10.0.0.4"] })),
    ).toBe("web-1, 10.0.0.4");

    expect(column.getExportValue!(makeEvent({ observables: [] }))).toBe("");
  });

  /*
   * ClickHouse cannot meaningfully order by an Array(String), and nothing
   * between the header and the query builder would reject the attempt.
   */
  test("array columns are not sortable", () => {
    expect(columnByTitle("Observables").disableSort).toBe(true);
    expect(columnByTitle("MITRE Tactics").disableSort).toBe(true);
    expect(columnByTitle("MITRE Techniques").disableSort).toBe(true);
  });

  /*
   * targetPort is non-nullable with a 0 default, so 0 means "the source did
   * not say" far more often than it means port zero.
   */
  test("Target Port renders a dash when the source did not say", () => {
    const column: Column<SecurityEvent> = columnByTitle("Target Port");

    const { container } = render(
      column.getElement!(makeEvent({ targetPort: 0 })),
    );

    expect(container.textContent).toBe("-");
    expect(column.getExportValue!(makeEvent({ targetPort: 0 }))).toBe("");
  });

  test("Target Port renders a real port", () => {
    const column: Column<SecurityEvent> = columnByTitle("Target Port");

    const { container } = render(
      column.getElement!(makeEvent({ targetPort: 443 })),
    );

    expect(container.textContent).toBe("443");
    expect(column.getExportValue!(makeEvent({ targetPort: 443 }))).toBe("443");
  });

  test("Severity still renders its pill", () => {
    const column: Column<SecurityEvent> = columnByTitle("Severity");

    const { container } = render(
      column.getElement!(makeEvent({ severityName: OcsfSeverity.Critical })),
    );

    expect(container.textContent).toContain("Critical");
  });

  test("Time renders a relative and an absolute reading", () => {
    const column: Column<SecurityEvent> = columnByTitle("Time");

    const { container } = render(
      column.getElement!(makeEvent({ time: new Date("2024-03-01T10:00:00Z") })),
    );

    expect(container.textContent).toContain("2024");
  });

  test("Time with nothing to show renders the placeholder", () => {
    const column: Column<SecurityEvent> = columnByTitle("Time");

    const { container } = render(column.getElement!(makeEvent({})));

    expect(container.textContent).toBe("-");
  });

  test("long free-text columns are typed as long text so they wrap", () => {
    expect(columnByTitle("Message").type).toBe(FieldType.LongText);
    expect(columnByTitle("Principal Process").type).toBe(FieldType.LongText);
    expect(columnByTitle("Target Resource").type).toBe(FieldType.LongText);
  });
});
