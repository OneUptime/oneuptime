import { describe, expect, test } from "@jest/globals";
import {
  RECORD_NAME_ELEMENTS,
  scanTableNameColumns,
  TableNameColumn,
} from "../../../Helpers/TableNameColumnScan";

/*
 * The scan TableNameColumnsLineTextGuard holds every name and title column
 * to, run on small made-up modules: what it counts as NAME-ONLY (the
 * default reads the field, ColumnLineText), and what it sends back to say
 * which way its line reads (getLineText). A scan that passed everything
 * would make the guard pass with every column unsaid.
 */

function scan(columnSource: string): Array<TableNameColumn> {
  return scanTableNameColumns(
    `const columns = [\n${columnSource}\n];\n`,
    "Made/Up/List.tsx",
  );
}

function only(columnSource: string): TableNameColumn {
  const found: Array<TableNameColumn> = scan(columnSource);

  expect(found).toHaveLength(1);

  return found[0]!;
}

// A ModelTable column on the record's name that draws `element`.
function nameColumn(element: string, extra: string = ""): string {
  return `{
    field: { name: true },
    title: "Name",
    type: FieldType.Element,${extra}
    getElement: (item: Thing): ReactElement => {
      return ${element};
    },
  }`;
}

describe("a column it finds", () => {
  test("a ModelTable column on the name (field), with its file and line", () => {
    const column: TableNameColumn = only(
      nameColumn("<AppLink to={route}>{item.name}</AppLink>"),
    );

    expect(column).toEqual({
      file: "Made/Up/List.tsx",
      line: 2,
      field: "name",
      declaredBy: "field",
      hasLineText: false,
      isNameOnly: true,
      reason: "",
    });
  });

  test("a Table column on the title (key)", () => {
    const column: TableNameColumn = only(`{
      key: "title",
      title: "Title",
      type: FieldType.Element,
      getElement: (row: Row): ReactElement => {
        return <span>{row.title}</span>;
      },
    }`);

    expect(column.field).toBe("title");
    expect(column.declaredBy).toBe("key");
    expect(column.isNameOnly).toBe(true);
  });

  test("a field written another way (as never) is still the name", () => {
    const column: TableNameColumn = only(`{
      field: { name: true } as never,
      title: "Name",
      type: FieldType.Element,
      getElement: (item: Thing): ReactElement => {
        return <span>{item.name}</span>;
      },
    }`);

    expect(column.field).toBe("name");
  });

  test("getLineText, of either kind, is seen", () => {
    expect(
      only(
        nameColumn(
          `<div className="flex gap-2"><Logo /><span>{item.name}</span></div>`,
          "\n    getLineText: drawsItsOwnLines,",
        ),
      ).hasLineText,
    ).toBe(true);
    expect(
      only(
        nameColumn(
          "<span>{shownName(item)}</span>",
          "\n    getLineText: (item: Thing): string => { return shownName(item); },",
        ),
      ).hasLineText,
    ).toBe(true);
  });

  test("a method-style getElement is read too", () => {
    const column: TableNameColumn = only(`{
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement(item: Thing): ReactElement {
        return <span>Name: {item.name}</span>;
      },
    }`);

    expect(column.isNameOnly).toBe(false);
  });
});

describe("a column it leaves alone", () => {
  test("another record's name (a relation), or more than one field", () => {
    expect(
      scan(`{
        field: { monitor: { name: true } },
        title: "Monitor",
        type: FieldType.Element,
        getElement: (item: Thing): ReactElement => {
          return <div className="flex"><Logo />{item.monitor?.name}</div>;
        },
      }, {
        field: { name: true, description: true },
        title: "Name",
        type: FieldType.Element,
        getElement: (item: Thing): ReactElement => {
          return <div className="flex"><Logo />{item.name}</div>;
        },
      }`),
    ).toEqual([]);
  });

  test("a details card's field (fieldType), a filter, a plain column", () => {
    expect(
      scan(`{
        field: { name: true },
        title: "Name",
        fieldType: FieldType.Element,
        type: FieldType.Element,
        getElement: (item: Thing): ReactElement => {
          return <div className="flex"><Logo />{item.name}</div>;
        },
      }, {
        field: { name: true },
        title: "Name",
        type: FieldType.Text,
      }, {
        key: "name",
        title: "Name",
        type: FieldType.Text,
      }`),
    ).toEqual([]);
  });

  test("a column on any other field", () => {
    expect(
      scan(`{
        key: "description",
        title: "Description",
        type: FieldType.Element,
        getElement: (row: Row): ReactElement => {
          return <div className="flex"><Logo />{row.description}</div>;
        },
      }`),
    ).toEqual([]);
  });
});

describe("a name-only element (the default reads its field)", () => {
  test.each([
    ["a link", "<AppLink to={route}>{item.name}</AppLink>"],
    ["a plain anchor", '<a href="#">{item.name}</a>'],
    ["a span with classes", '<span className="font-medium">{item.name}</span>'],
    ["a fragment", "<>{item.name}</>"],
    [
      "a link around a span",
      "<Link to={route}><span>{item.name}</span></Link>",
    ],
    [
      "a record link's own <span className=flex>",
      '<span className="flex">{item.name}</span>',
    ],
    ["an isolate of the field", '<IsolatedText text={item.name || ""} />'],
    ["an element access", '<span>{item["name"]}</span>'],
    ["toString", "<span>{item.name?.toString()}</span>"],
    ["a cast and a dash", '<span>{(item.name as string) || "—"}</span>'],
    ["a nullish fallback with no letters", '<span>{item.name ?? "-"}</span>'],
    ["a space between parts", '<span>{item.name}{" "}</span>'],
  ])("%s", (_kind: string, element: string) => {
    const column: TableNameColumn = only(nameColumn(element));

    expect(column.reason).toBe("");
    expect(column.isNameOnly).toBe(true);
  });

  test("a const that holds just the field", () => {
    const column: TableNameColumn = only(`{
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement: (item: Thing): ReactElement => {
        const name: string = item.name?.toString() || "";
        return <AppLink to={route}>{name}</AppLink>;
      },
    }`);

    expect(column.isNameOnly).toBe(true);
  });

  test("a link when there is a page to open, a span when not", () => {
    const column: TableNameColumn = only(`{
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement: (item: Thing): ReactElement => {
        if (!item.id) {
          return <span>{item.name}</span>;
        }
        return item.isArchived ? (
          <span>{item.name}</span>
        ) : (
          <AppLink to={route}>{item.name}</AppLink>
        );
      },
    }`);

    expect(column.isNameOnly).toBe(true);
  });

  test.each(
    RECORD_NAME_ELEMENTS.map((name: string): [string] => {
      return [name];
    }),
  )("<%s> handed the row alone", (element: string) => {
    expect(only(nameColumn(`<${element} thing={item} />`)).isNameOnly).toBe(
      true,
    );
  });
});

describe("an element that is not name-only (it must say what its line reads)", () => {
  test.each([
    [
      "a logo beside the name, in a flex box",
      `<div className="flex items-center gap-2"><img src={logo} /><span>{item.name}</span></div>`,
      'draws a flex box, <div className="flex items-center gap-2">',
    ],
    [
      "a grid box",
      `<div className="grid grid-cols-1"><span>{item.name}</span></div>`,
      "draws a grid box",
    ],
    [
      "a span that is more than the record link's flex",
      `<span className="flex gap-1">{item.name}</span>`,
      "draws a flex box",
    ],
    [
      "classes worked out as it is drawn",
      "<span className={nameClassName}>{item.name}</span>",
      "whose classes are worked out as it is drawn",
    ],
    ["a badge", "<Pill text={item.name} color={item.color} />", "draws <Pill>"],
    [
      "an icon",
      `<span><Icon icon={IconProp.Lock} />{item.name}</span>`,
      "draws <Icon>",
    ],
    [
      "the page's own words",
      "<span>Name: {item.name}</span>",
      'draws words of its own, "Name:"',
    ],
    [
      "a translated title",
      "<span>{translator.translateText(item.name)}</span>",
      "draws {translator.translateText(item.name)}, not the row's name",
    ],
    [
      "another field under the name",
      "<div><div>{item.name}</div><div>{item.slug}</div></div>",
      "draws {item.slug}, not the row's name",
    ],
    [
      "a fallback with words",
      '<span>{item.name || "Unnamed"}</span>',
      "not the row's name",
    ],
    [
      "an isolate of other words",
      '<IsolatedText text={item.description || ""} />',
      "draws <IsolatedText> with other words than the row's name",
    ],
    [
      "a record link handed another value",
      "<IncidentElement incident={item.parentIncident} />",
      "draws <IncidentElement> with more than its row",
    ],
    [
      "a record link handed an option too",
      "<MonitorElement monitor={item} showIcon={true} />",
      "draws <MonitorElement> with more than its row",
    ],
    [
      "a component of the list's own",
      "<ThingName thing={item} />",
      "draws <ThingName>",
    ],
  ])("%s", (_kind: string, element: string, reason: string) => {
    const column: TableNameColumn = only(nameColumn(element));

    expect(column.isNameOnly).toBe(false);
    expect(column.reason).toContain(reason);
    // The line the reason points at is the column's own element.
    expect(column.reason).toMatch(/\(line \d+\)$/);
  });

  test("a value drawn through another function", () => {
    const column: TableNameColumn = only(nameColumn("renderName(item)"));

    expect(column.isNameOnly).toBe(false);
    expect(column.reason).toContain("returns renderName(item)");
  });

  test("an element drawn only on a condition", () => {
    const column: TableNameColumn = only(
      nameColumn("item.name ? <span>{item.name}</span> : null"),
    );

    expect(column.isNameOnly).toBe(false);
  });

  test("a function that returns nothing the scan can read", () => {
    const column: TableNameColumn = only(`{
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement: (item: Thing): ReactElement => {
        throw new Error(item.name);
      },
    }`);

    expect(column.isNameOnly).toBe(false);
    expect(column.reason).toBe("returns no element the guard can read");
  });

  test("an element function the scan cannot read", () => {
    const column: TableNameColumn = only(`{
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement: drawThingName,
    }`);

    expect(column.isNameOnly).toBe(false);
    expect(column.reason).toBe(
      "draws through a function the guard cannot read",
    );
  });

  test("a list drawn inside is not read as the name", () => {
    const column: TableNameColumn = only(`{
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement: (item: Thing): ReactElement => {
        return (
          <span>
            {item.name}
            {item.aliases.map((alias: string) => {
              return <span key={alias}>{alias}</span>;
            })}
          </span>
        );
      },
    }`);

    expect(column.isNameOnly).toBe(false);
    expect(column.reason).toContain("item.aliases.map");
  });
});
