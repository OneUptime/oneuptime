/*
 * Which fields a database step's settings offer, end to end: the schema comes
 * back from the (mocked) /model-schema endpoint carrying the flags the server
 * now sets, and the editor decides what goes in its "Add a field" list.
 *
 * The schema is Incident's, as the write gate describes it - including the
 * columns the maintainer's screenshot showed in Create One Incident's list:
 * Created At and Created by User ID, "system fields that should never be in
 * the list".
 */

import React from "react";

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return String(error);
      }),
    },
  };
});

import HTTPResponse from "../../../../Types/API/HTTPResponse";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ModelColumnEditor, {
  ModelColumnEditorMode,
  RecordIntent,
} from "../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../UI/Components/Workflow/ModelSchema";
import API from "../../../../UI/Utils/API/API";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { RenderResult, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
): ModelSchemaColumn => {
  return {
    type: TableColumnType.ShortText,
    isRelation: false,
    required: false,
    hasDefault: false,
    isTenantColumn: false,
    isSystemColumn: false,
    canCreate: true,
    canUpdate: true,
    ...overrides,
  };
};

const INCIDENT_COLUMNS: Array<ModelSchemaColumn> = [
  makeColumn({
    id: "_id",
    title: "ID",
    type: TableColumnType.ObjectID,
    isSystemColumn: true,
    description: "ID of this object",
  }),
  makeColumn({
    id: "createdAt",
    title: "Created At",
    type: TableColumnType.Date,
    isSystemColumn: true,
    description: "Date and Time when the object was created.",
  }),
  makeColumn({
    id: "updatedAt",
    title: "Updated At",
    type: TableColumnType.Date,
    isSystemColumn: true,
    description: "Date and Time when the object was updated.",
  }),
  makeColumn({
    id: "deletedAt",
    title: "Deleted At",
    type: TableColumnType.Date,
    isSystemColumn: true,
    description: "Date and Time when the object was deleted.",
  }),
  makeColumn({
    id: "project",
    title: "Project",
    type: TableColumnType.Entity,
    isRelation: true,
    isTenantColumn: true,
    canUpdate: false,
  }),
  makeColumn({
    id: "projectId",
    title: "Project ID",
    type: TableColumnType.ObjectID,
    required: true,
    isTenantColumn: true,
    canUpdate: false,
  }),
  makeColumn({
    id: "title",
    title: "Title",
    type: TableColumnType.LongText,
    required: true,
    description: "Title of this incident.",
  }),
  makeColumn({
    id: "description",
    title: "Description",
    type: TableColumnType.Markdown,
    description: "Short description of this incident.",
  }),
  makeColumn({
    id: "declaredAt",
    title: "Declared At",
    type: TableColumnType.Date,
    required: true,
    hasDefault: true,
    description: "When this incident was declared.",
  }),
  makeColumn({
    id: "createdByUser",
    title: "Created by User",
    type: TableColumnType.Entity,
    isRelation: true,
    isSystemColumn: true,
    canUpdate: false,
  }),
  makeColumn({
    id: "createdByUserId",
    title: "Created by User ID",
    type: TableColumnType.ObjectID,
    isSystemColumn: true,
    canUpdate: false,
    description:
      "User ID who created this object (if this object was created by a User)",
  }),
  makeColumn({
    id: "monitors",
    title: "Monitors",
    type: TableColumnType.EntityArray,
    isRelation: true,
  }),
  makeColumn({
    id: "currentIncidentState",
    title: "Current Incident State",
    type: TableColumnType.Entity,
    isRelation: true,
    isSystemColumn: true,
  }),
  makeColumn({
    id: "currentIncidentStateId",
    title: "Current Incident State ID",
    type: TableColumnType.ObjectID,
    required: true,
    hasDefault: true,
    description: "Current state of this incident.",
  }),
  makeColumn({
    id: "incidentSeverity",
    title: "Incident Severity",
    type: TableColumnType.Entity,
    isRelation: true,
  }),
  makeColumn({
    id: "incidentSeverityId",
    title: "Incident Severity ID",
    type: TableColumnType.ObjectID,
    required: true,
    // What Incident really says about it.
    description: "Incident Severity ID",
  }),
  makeColumn({
    id: "changeMonitorStatusToId",
    title: "Change Monitor Status To ID",
    type: TableColumnType.ObjectID,
    description:
      "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.",
  }),
  makeColumn({
    id: "subscriberNotificationStatusOnIncidentCreated",
    title: "Subscriber Notification Status",
    type: TableColumnType.ShortText,
    isSystemColumn: true,
    hasDefault: true,
  }),
  makeColumn({
    id: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    title: "Should subscribers be notified?",
    type: TableColumnType.Boolean,
    hasDefault: true,
    canUpdate: false,
  }),
  makeColumn({
    id: "customFields",
    title: "Custom Fields",
    type: TableColumnType.JSON,
  }),
  makeColumn({
    id: "statusPagesNotifiedOnCreation",
    title: "Status Pages Notified On Creation",
    type: TableColumnType.JSON,
    isSystemColumn: true,
    canCreate: false,
  }),
];

/*
 * Every column OneUptime fills in, by id. None of these may ever be offered
 * for a create or an update.
 */
const SYSTEM_IDS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "createdByUserId",
  "subscriberNotificationStatusOnIncidentCreated",
  "statusPagesNotifiedOnCreation",
];

const TEST_ID: string = "model-column-add";

type MockApiGetFunction = () => MockFunction;

const apiGet: MockApiGetFunction = (): MockFunction => {
  return API.get as unknown as MockFunction;
};

type ResolveSchemaFunction = (columns: Array<ModelSchemaColumn>) => void;

const resolveSchemaWith: ResolveSchemaFunction = (
  columns: Array<ModelSchemaColumn>,
): void => {
  apiGet().mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      { columns: columns } as unknown as JSONObject,
      {},
    ),
  );
};

interface EditorHarness {
  user: UserEvent;
  onChange: MockFunction;
  result: RenderResult;
}

interface RenderEditorOptions {
  mode?: ModelColumnEditorMode | undefined;
  recordIntent?: RecordIntent | undefined;
  initialValue?: string | undefined;
  tableName?: string | undefined;
}

type RenderEditorFunction = (options?: RenderEditorOptions) => EditorHarness;

const renderEditor: RenderEditorFunction = (
  options?: RenderEditorOptions,
): EditorHarness => {
  const onChange: MockFunction = getJestMockFunction();

  const result: RenderResult = render(
    <ModelColumnEditor
      tableName={options?.tableName || "Incident"}
      mode={options?.mode || ModelColumnEditorMode.Record}
      recordIntent={options?.recordIntent}
      initialValue={options?.initialValue}
      onChange={onChange as unknown as (value: string) => void}
    />,
  );

  return { user: userEvent.setup(), onChange: onChange, result: result };
};

type OpenPickerFunction = (user: UserEvent) => Promise<Array<string>>;

// Opens the "Add a field" / "Add a condition" list and reads off what it offers.
const openPickerAndListIds: OpenPickerFunction = async (
  user: UserEvent,
): Promise<Array<string>> => {
  await user.click(await screen.findByTestId(TEST_ID));

  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option: HTMLElement) => {
      return (option.getAttribute("data-testid") || "").replace(
        `${TEST_ID}-option-`,
        "",
      );
    });
};

beforeEach(() => {
  resolveSchemaWith(INCIDENT_COLUMNS);
});

afterEach(() => {
  apiGet().mockReset();
});

describe("Create One Incident", () => {
  test("never offers a field OneUptime fills in itself", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    for (const systemId of SYSTEM_IDS) {
      expect({ systemId, offered: offered.includes(systemId) }).toEqual({
        systemId,
        offered: false,
      });
    }

    // Nor the screenshot's labels, by name.
    const list: HTMLElement = screen.getByRole("listbox");

    expect(within(list).queryByText("Created At")).toBeNull();
    expect(within(list).queryByText("Created by User ID")).toBeNull();
    expect(within(list).queryByText("Updated At")).toBeNull();
  });

  test("offers the incident's own fields, the main ones first", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    /*
     * Title and severity are already rows - a create opens with every field it
     * needs - so the list starts with the ones that fill themselves in.
     */
    expect(offered).toEqual([
      "currentIncidentStateId",
      "declaredAt",
      "changeMonitorStatusToId",
      "description",
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    ]);
    expect(screen.getByText("Main fields")).toBeVisible();
  });

  test("opens with a row for each field it needs, and only those", async () => {
    renderEditor({ recordIntent: RecordIntent.Create });

    expect(
      await screen.findByTestId("model-column-value-title"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("model-column-value-incidentSeverityId"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("model-column-row")).toHaveLength(2);
    expect(
      screen.getByText(/2 required fields still empty/),
    ).toBeInTheDocument();
  });

  test("a field row does not print a description that is only its name again", async () => {
    renderEditor({ recordIntent: RecordIntent.Create });

    const row: HTMLElement = (
      await screen.findByTestId("model-column-value-incidentSeverityId")
    ).closest('[data-testid="model-column-row"]') as HTMLElement;

    expect(within(row).getAllByText("Incident Severity ID")).toHaveLength(1);
    // A real description still prints.
    expect(screen.getByText("Title of this incident.")).toBeInTheDocument();
  });

  test("a field picked from the list becomes a row, ready to type into", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    await user.click(await screen.findByTestId(TEST_ID));
    await user.click(screen.getByTestId(`${TEST_ID}-option-description`));

    const input: HTMLElement = screen.getByTestId(
      "model-column-value-description",
    );

    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a field already on the form is not offered again", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    await user.click(await screen.findByTestId(TEST_ID));
    await user.click(screen.getByTestId(`${TEST_ID}-option-description`));

    const offered: Array<string> = await openPickerAndListIds(user);

    expect(offered).not.toContain("description");
    expect(offered).toContain("declaredAt");
  });

  test("names only the fields that really need JSON under the form", async () => {
    renderEditor({ recordIntent: RecordIntent.Create });

    const note: HTMLElement = await screen.findByText(
      /can only be set with Edit as JSON/,
    );

    expect(note).toHaveTextContent(
      "Monitors, Custom Fields can only be set with Edit as JSON.",
    );
    // Set through their own "ID" field, or by OneUptime - not missing at all.
    expect(note).not.toHaveTextContent("Created by User");
    expect(note).not.toHaveTextContent("Current Incident State");
    expect(note).not.toHaveTextContent("Incident Severity");
    expect(note).not.toHaveTextContent("Project");
  });

  /*
   * A workflow saved before the list stopped offering Created At can still
   * hold it. The row stays - dropping a stored value loses work - and says why
   * it is not in the list any more, rather than calling it an unknown column.
   */
  test("a system field already stored keeps its row and says OneUptime fills it in", async () => {
    renderEditor({
      recordIntent: RecordIntent.Create,
      initialValue:
        '{"title":"Checkout is down","createdAt":"2026-08-15T09:30:00.000Z"}',
    });

    expect(
      await screen.findByTestId("model-column-system-note-createdAt"),
    ).toHaveTextContent(
      "OneUptime fills this in itself, so you can remove it.",
    );
    expect(screen.queryByText(/isn't a known column/)).toBeNull();
    expect(screen.queryByTestId("model-column-system-note-title")).toBeNull();
  });
});

describe("Update One Incident", () => {
  test("offers what may change on an incident that exists", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Update,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    expect(offered).toEqual([
      "currentIncidentStateId",
      "declaredAt",
      "incidentSeverityId",
      "title",
      "changeMonitorStatusToId",
      "description",
    ]);
  });

  test("never offers a system field, or one only a create may set", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Update,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    for (const systemId of SYSTEM_IDS) {
      expect(offered).not.toContain(systemId);
    }

    expect(offered).not.toContain(
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    );
  });

  test("has no Required group - an update writes only what it names", async () => {
    const { user }: EditorHarness = renderEditor({
      recordIntent: RecordIntent.Update,
    });

    await openPickerAndListIds(user);

    expect(screen.queryByText("Required")).toBeNull();
  });
});

describe("a query on incidents", () => {
  test("still filters on the fields OneUptime fills in", async () => {
    const { user }: EditorHarness = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    expect(offered).toContain("_id");
    expect(offered).toContain("createdAt");
    expect(offered).toContain("updatedAt");
    expect(offered).toContain("createdByUserId");
  });

  test("leads with the record ID", async () => {
    const { user }: EditorHarness = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    expect(offered[0]).toBe("_id");
  });

  test("lists what OneUptime fills in last, under its own heading", async () => {
    const { user }: EditorHarness = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    await openPickerAndListIds(user);

    const systemGroup: HTMLElement = screen.getByTestId(
      `${TEST_ID}-group-system`,
    );

    expect(
      within(systemGroup).getByText("Filled in by OneUptime"),
    ).toBeVisible();
    expect(
      within(systemGroup).getByTestId(`${TEST_ID}-option-createdAt`),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`${TEST_ID}-group-other`)).queryByTestId(
        `${TEST_ID}-option-createdAt`,
      ),
    ).toBeNull();
  });

  test("leaves out Deleted At, which is empty on every incident there is", async () => {
    const { user }: EditorHarness = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    const offered: Array<string> = await openPickerAndListIds(user);

    expect(offered).not.toContain("deletedAt");
    expect(offered).not.toContain("projectId");
  });

  test("a condition picked from the list becomes a row", async () => {
    const { user }: EditorHarness = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    await user.click(await screen.findByTestId(TEST_ID));
    await user.type(
      screen.getByTestId(`${TEST_ID}-search`),
      "created at{Enter}",
    );

    expect(
      screen.getByTestId("model-column-value-createdAt"),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 conditions set/)).toBeInTheDocument();
  });
});

/*
 * ScheduledMaintenance.slug is required, has no default and carries a create
 * list - DatabaseService.generateSlug writes it from the title on every create.
 * Create One Scheduled Maintenance opened on a required "Slug" row for it.
 */
describe("Create One Scheduled Maintenance", () => {
  const SCHEDULED_MAINTENANCE_COLUMNS: Array<ModelSchemaColumn> = [
    makeColumn({
      id: "title",
      title: "Title",
      required: true,
      description: "Title of this scheduled event.",
    }),
    makeColumn({
      id: "slug",
      title: "Slug",
      type: TableColumnType.Slug,
      required: true,
      isSystemColumn: true,
      canUpdate: false,
      description: "Friendly globally unique name for your object",
    }),
    makeColumn({
      id: "startsAt",
      title: "Starts At",
      type: TableColumnType.Date,
      required: true,
    }),
    makeColumn({
      id: "endsAt",
      title: "Ends At",
      type: TableColumnType.Date,
      required: true,
    }),
  ];

  test("does not ask for the slug the server writes", async () => {
    resolveSchemaWith(SCHEDULED_MAINTENANCE_COLUMNS);

    renderEditor({
      tableName: "ScheduledMaintenance",
      recordIntent: RecordIntent.Create,
    });

    expect(
      await screen.findByTestId("model-column-value-title"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-column-value-slug")).toBeNull();
    expect(
      screen.getByText(/3 required fields still empty/),
    ).toBeInTheDocument();
  });
});

/*
 * A response from a server that predates the flags - the editor's own list of
 * system columns still keeps the obvious ones out of a create.
 */
describe("a schema without the new flags", () => {
  test("still keeps the timestamps and created-by out of a create", async () => {
    resolveSchemaWith([
      {
        id: "createdAt",
        title: "Created At",
        type: TableColumnType.Date,
        isRelation: false,
      },
      {
        id: "createdByUserId",
        title: "Created by User ID",
        type: TableColumnType.ObjectID,
        isRelation: false,
      },
      {
        id: "name",
        title: "Name",
        type: TableColumnType.Name,
        isRelation: false,
      },
    ]);

    const { user }: EditorHarness = renderEditor({
      tableName: "Label",
      recordIntent: RecordIntent.Create,
    });

    expect(await openPickerAndListIds(user)).toEqual(["name"]);
  });
});
