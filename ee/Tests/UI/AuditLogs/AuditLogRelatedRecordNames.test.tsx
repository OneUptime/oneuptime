import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

const mockApiGet: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return mockApiGet(...args);
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10470000-0000-4000-8000-000000000301" };
      },
    },
  };
});

import AuditLogChangesModal from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import {
  AUDIT_LOG_RELATED_WORDS,
  AuditLogRelatedRecordsLoader,
  getAuditLogReferenceItems,
  loadAuditLogRelatedRecords,
  namesAnyRecord,
} from "../../../Dashboard/AuditLogs/AuditLogRelatedRecordValue";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { hideAuditLogChange } from "Common/Types/AuditLog/AuditLogHiddenValues";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  AuditLogRelatedRecord,
  AuditLogRelatedRecordState,
  AuditLogRelatedRecords,
} from "Common/Utils/AuditLog/AuditLogRelatedRecords";

/*
 * A CHANGED REFERENCE READS BY THE RECORD'S NAME (#10470).
 *
 * The changes dialog read a monitor's status as two UUIDs and a monitor's
 * labels as a JSON array. It now asks once, as it opens, for the names of
 * the records its changes name, and draws each by its name with its id
 * under it: "Degraded", then "Operational". A record the reader may not
 * read reads "Name hidden", one deleted since "Deleted"; a field whose value
 * is hidden from them names nothing, and nothing is asked for it. The names
 * come from the server, read with the reader's own permissions
 * (GET /audit-log/:id/related-record-names); here the read is handed in,
 * and the route it goes through is checked on its own.
 */

const ENTRY_ID: string = "10470000-0000-4000-8000-000000000302";
const OTHER_ENTRY_ID: string = "10470000-0000-4000-8000-000000000303";
const DEGRADED: string = "10470000-0000-4000-8000-0000000003b1";
const OPERATIONAL: string = "10470000-0000-4000-8000-0000000003b2";
const PRODUCTION: string = "10470000-0000-4000-8000-0000000003c1";
const EU: string = "10470000-0000-4000-8000-0000000003c2";
const LEGACY: string = "10470000-0000-4000-8000-0000000003c3";
const SECRET: string = "10470000-0000-4000-8000-0000000003c4";

const MONITOR_UPDATE: JSONArray = [
  {
    field: "currentMonitorStatusId",
    oldValue: DEGRADED,
    newValue: OPERATIONAL,
  },
  {
    field: "labels",
    oldValue: [
      { _id: PRODUCTION, name: "Prod" },
      { _id: LEGACY, name: "Legacy" },
    ],
    newValue: [{ _id: PRODUCTION }, { _id: EU }, { _id: SECRET }],
  },
  { field: "name", oldValue: "Checkout API", newValue: "Checkout API v2" },
];

const ANSWER: AuditLogRelatedRecords = new Map<
  string,
  Map<string, AuditLogRelatedRecord>
>([
  [
    "currentMonitorStatusId",
    new Map<string, AuditLogRelatedRecord>([
      [DEGRADED, { state: AuditLogRelatedRecordState.Named, name: "Degraded" }],
      [
        OPERATIONAL,
        { state: AuditLogRelatedRecordState.Named, name: "Operational" },
      ],
    ]),
  ],
  [
    "labels",
    new Map<string, AuditLogRelatedRecord>([
      [
        PRODUCTION,
        { state: AuditLogRelatedRecordState.Named, name: "Production" },
      ],
      [EU, { state: AuditLogRelatedRecordState.Named, name: "EU" }],
      [LEGACY, { state: AuditLogRelatedRecordState.Deleted, name: "Legacy" }],
      [SECRET, { state: AuditLogRelatedRecordState.Hidden }],
    ]),
  ],
]);

function loaderAnswering(
  answer: AuditLogRelatedRecords | null,
): MockFunction & AuditLogRelatedRecordsLoader {
  const load: MockFunction = getJestMockFunction();

  load.mockImplementation(() => {
    return Promise.resolve(answer);
  });

  return load as MockFunction & AuditLogRelatedRecordsLoader;
}

function openDialog(data: {
  load: AuditLogRelatedRecordsLoader;
  changes?: JSONArray;
  auditLogId?: string;
  action?: string;
}): ReturnType<typeof render> {
  return render(
    <AuditLogChangesModal
      isOpen={true}
      onClose={jest.fn()}
      action={data.action || "Update"}
      resourceType="Monitor"
      storedResourceType="Monitor"
      resourceName="Checkout API"
      changes={data.changes || MONITOR_UPDATE}
      auditLogId={data.auditLogId ?? ENTRY_ID}
      loadRelatedRecords={data.load}
    />,
  );
}

// The rendered record of an id: its state, what it says, and the id it keeps.
function recordOf(id: string): HTMLElement {
  const records: Array<HTMLElement> = screen
    .getAllByTestId("audit-log-related-record")
    .filter((element: HTMLElement): boolean => {
      return element.getAttribute("data-record-id") === id;
    });

  expect(records.length).toBeGreaterThan(0);

  return records[0]!;
}

beforeEach(() => {
  mockApiGet.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a single reference", () => {
  test("reads Degraded, then Operational, each with its id under it", async () => {
    openDialog({ load: loaderAnswering(ANSWER) });

    await waitFor(() => {
      expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    expect(
      within(recordOf(DEGRADED)).getByTestId("audit-log-related-record-name"),
    ).toHaveTextContent("Degraded");
    expect(
      within(recordOf(DEGRADED)).getByTestId("audit-log-related-record-id"),
    ).toHaveTextContent(DEGRADED);
    expect(
      within(recordOf(OPERATIONAL)).getByTestId("audit-log-related-record-id"),
    ).toHaveTextContent(OPERATIONAL);
    // Before, then After: the status's change reads at a glance.
    const status: HTMLElement = recordOf(DEGRADED).closest(
      "div.grid",
    ) as HTMLElement;

    expect(within(status).getByText("Before")).toBeInTheDocument();
    expect(within(status).getByText("After")).toBeInTheDocument();
    expect(within(status).getByText("Degraded")).toBeInTheDocument();
    expect(within(status).getByText("Operational")).toBeInTheDocument();
  });

  test("a field that names no record reads as it always did", async () => {
    openDialog({ load: loaderAnswering(ANSWER) });

    await waitFor(() => {
      expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    expect(screen.getByText("Checkout API v2")).toBeInTheDocument();
  });
});

describe("a list of references", () => {
  test("each label by its name now, the one deleted since by the name the entry recorded, and one kept from the reader by none", async () => {
    openDialog({ load: loaderAnswering(ANSWER) });

    await waitFor(() => {
      expect(screen.getAllByText("Production").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("EU")).toBeInTheDocument();
    // Its name now, not the one the entry recorded then.
    expect(screen.queryByText("Prod")).not.toBeInTheDocument();

    const legacy: HTMLElement = recordOf(LEGACY);
    expect(legacy).toHaveAttribute("data-state", "Deleted");
    expect(within(legacy).getByText("Legacy")).toBeInTheDocument();
    expect(
      within(legacy).getByTestId("audit-log-related-record-deleted"),
    ).toHaveTextContent("Deleted");

    const secret: HTMLElement = recordOf(SECRET);
    expect(secret).toHaveAttribute("data-state", "Hidden");
    expect(
      within(secret).getByTestId("audit-log-related-record-hidden"),
    ).toHaveTextContent("Name hidden");
    expect(
      within(secret).getByTestId("audit-log-related-record-id"),
    ).toHaveTextContent(SECRET);

    // No list is drawn as JSON any longer.
    expect(screen.queryByText(/"_id"/)).not.toBeInTheDocument();
  });

  test("a record deleted since with no name recorded reads Deleted, by its id", async () => {
    const gone: string = "10470000-0000-4000-8000-0000000003b9";

    openDialog({
      changes: [
        {
          field: "currentMonitorStatusId",
          oldValue: gone,
          newValue: OPERATIONAL,
        },
      ],
      load: loaderAnswering(
        new Map<string, Map<string, AuditLogRelatedRecord>>([
          [
            "currentMonitorStatusId",
            new Map<string, AuditLogRelatedRecord>([
              [gone, { state: AuditLogRelatedRecordState.Deleted }],
              [
                OPERATIONAL,
                {
                  state: AuditLogRelatedRecordState.Named,
                  name: "Operational",
                },
              ],
            ]),
          ],
        ]),
      ),
    });

    await waitFor(() => {
      expect(recordOf(gone)).toHaveAttribute("data-state", "Deleted");
    });

    expect(
      within(recordOf(gone)).queryByTestId("audit-log-related-record-name"),
    ).not.toBeInTheDocument();
    expect(
      within(recordOf(gone)).getByTestId("audit-log-related-record-id"),
    ).toHaveTextContent(gone);
  });
});

describe("a reader who may and may not read the related record", () => {
  test("the same change reads the status's name for one reader, Name hidden for another", async () => {
    const changes: JSONArray = [
      {
        field: "currentMonitorStatusId",
        oldValue: DEGRADED,
        newValue: OPERATIONAL,
      },
    ];

    openDialog({ changes, load: loaderAnswering(ANSWER) });

    await waitFor(() => {
      expect(screen.getByText("Degraded")).toBeInTheDocument();
    });

    cleanup();

    openDialog({
      changes,
      load: loaderAnswering(
        new Map<string, Map<string, AuditLogRelatedRecord>>([
          [
            "currentMonitorStatusId",
            new Map<string, AuditLogRelatedRecord>([
              [DEGRADED, { state: AuditLogRelatedRecordState.Hidden }],
              [OPERATIONAL, { state: AuditLogRelatedRecordState.Hidden }],
            ]),
          ],
        ]),
      ),
    });

    await waitFor(() => {
      expect(screen.getAllByText("Name hidden")).toHaveLength(2);
    });

    expect(screen.queryByText("Degraded")).not.toBeInTheDocument();
    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
  });
});

describe("a field whose value is hidden from the reader (#10642)", () => {
  test("names nothing: it reads Value hidden, and no name is asked for it", async () => {
    const load: MockFunction & AuditLogRelatedRecordsLoader =
      loaderAnswering(ANSWER);

    openDialog({
      changes: [
        hideAuditLogChange({
          field: "currentMonitorStatusId",
          oldValue: DEGRADED,
          newValue: OPERATIONAL,
        }),
      ],
      load,
    });

    expect(screen.getByText("Value hidden")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-log-related-record")).toBeNull();
    expect(screen.queryByText(DEGRADED)).toBeNull();
    // Nothing of a hidden value is a record to name: nothing is asked.
    expect(load).not.toHaveBeenCalled();
  });

  test("beside a field the reader reads, only that one's records are drawn", async () => {
    openDialog({
      changes: [
        hideAuditLogChange({
          field: "currentMonitorStatusId",
          oldValue: DEGRADED,
          newValue: OPERATIONAL,
        }),
        MONITOR_UPDATE[1] as JSONObject,
      ],
      load: loaderAnswering(ANSWER),
    });

    await waitFor(() => {
      expect(screen.getByText("EU")).toBeInTheDocument();
    });

    expect(screen.getByText("Value hidden")).toBeInTheDocument();
    expect(screen.queryByText("Degraded")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });
});

describe("the names are read once a dialog", () => {
  test("one read for the whole entry, however many fields and rows name records", async () => {
    const load: MockFunction & AuditLogRelatedRecordsLoader =
      loaderAnswering(ANSWER);

    const { rerender } = openDialog({ load });

    await waitFor(() => {
      expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    // Drawn again, as a table's refresh draws it: nothing is read again.
    rerender(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Update"
        resourceType="Monitor"
        storedResourceType="Monitor"
        changes={MONITOR_UPDATE}
        auditLogId={ENTRY_ID}
        loadRelatedRecords={load}
      />,
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(ENTRY_ID);

    // Another entry is read for its own.
    rerender(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Update"
        resourceType="Monitor"
        storedResourceType="Monitor"
        changes={MONITOR_UPDATE}
        auditLogId={OTHER_ENTRY_ID}
        loadRelatedRecords={load}
      />,
    );

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(2);
    });
    expect(load).toHaveBeenLastCalledWith(OTHER_ENTRY_ID);
  });

  test("nothing is asked for an entry that names no record, a session's entry, or a closed dialog", () => {
    const load: MockFunction & AuditLogRelatedRecordsLoader =
      loaderAnswering(ANSWER);

    openDialog({
      changes: [{ field: "name", oldValue: "a", newValue: "b" }],
      load,
    });
    cleanup();

    openDialog({
      action: "SignIn",
      changes: [{ field: "userId", oldValue: null, newValue: DEGRADED }],
      load,
    });
    cleanup();

    render(
      <AuditLogChangesModal
        isOpen={false}
        onClose={jest.fn()}
        action="Update"
        changes={MONITOR_UPDATE}
        auditLogId={ENTRY_ID}
        loadRelatedRecords={load}
      />,
    );

    expect(load).not.toHaveBeenCalled();
    expect(namesAnyRecord([{ oldValue: "x", newValue: 3 }])).toBe(false);
    expect(namesAnyRecord([{ oldValue: null, newValue: [{ _id: EU }] }])).toBe(
      true,
    );
  });

  test("while the names load, each reference keeps its id and a bar where its name will be", async () => {
    let finish: (records: AuditLogRelatedRecords) => void = () => {};
    const load: MockFunction = getJestMockFunction();

    load.mockImplementation(() => {
      return new Promise<AuditLogRelatedRecords>(
        (resolve: (records: AuditLogRelatedRecords) => void) => {
          finish = resolve;
        },
      );
    });

    openDialog({ load: load as unknown as AuditLogRelatedRecordsLoader });

    expect(
      screen.getAllByTestId("inline-value-skeleton").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
    expect(screen.queryByText("Degraded")).not.toBeInTheDocument();

    await act(async () => {
      finish(ANSWER);
    });

    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryAllByTestId("inline-value-skeleton")).toHaveLength(0);
  });

  test("names that cannot be read leave the dialog as it was: ids, and the names the entry recorded", async () => {
    openDialog({ load: loaderAnswering(null) });

    await waitFor(() => {
      expect(screen.queryAllByTestId("inline-value-skeleton")).toHaveLength(0);
    });

    // An id is drawn as the text it is.
    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
    expect(screen.queryByTestId("audit-log-related-record-hidden")).toBeNull();
    // A relation the entry recorded with names still reads by them.
    expect(screen.getByText("Prod")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });
});

describe("the read it goes through", () => {
  test("asks the audit log for the entry's names with the page's own headers: the reader's", async () => {
    mockApiGet.mockImplementation(() => {
      return Promise.resolve(
        new HTTPResponse(
          200,
          {
            fields: {
              currentMonitorStatusId: {
                [OPERATIONAL]: { state: "Named", name: "Operational" },
              },
            },
          },
          {},
        ),
      );
    });

    const records: AuditLogRelatedRecords | null =
      await loadAuditLogRelatedRecords(ENTRY_ID);

    expect(mockApiGet).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string }; headers: unknown } =
      mockApiGet.mock.calls[0]![0] as never;

    expect(request.url.toString()).toContain(
      `/audit-log/${ENTRY_ID}/related-record-names`,
    );
    expect(request.headers).toEqual({
      tenantid: "10470000-0000-4000-8000-000000000301",
    });
    expect(records?.get("currentMonitorStatusId")?.get(OPERATIONAL)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Operational",
    });
  });

  test("a refused or failed read is no names, never an error in the dialog", async () => {
    mockApiGet.mockImplementation(() => {
      return Promise.resolve(new HTTPErrorResponse(404, {}, {}));
    });

    expect(await loadAuditLogRelatedRecords(ENTRY_ID)).toBeNull();

    mockApiGet.mockImplementation(() => {
      return Promise.reject(new Error("offline"));
    });

    expect(await loadAuditLogRelatedRecords(ENTRY_ID)).toBeNull();
  });
});

describe("what a value names", () => {
  test("each record in its order, by its answer, or by the name the entry recorded", () => {
    expect(
      getAuditLogReferenceItems({
        value: [{ _id: LEGACY, name: "Legacy" }, EU],
        records: new Map<string, AuditLogRelatedRecord>([
          [EU, { state: AuditLogRelatedRecordState.Named, name: "EU" }],
        ]),
      }),
    ).toEqual([
      { id: LEGACY, state: "Unread", name: "Legacy" },
      { id: EU, state: AuditLogRelatedRecordState.Named, name: "EU" },
    ]);
  });
});

describe("the words, in every language", () => {
  test.each([...DASHBOARD_LANGUAGES])(
    "%s words Deleted and Name hidden",
    (language: string) => {
      for (const word of Object.values(AUDIT_LOG_RELATED_WORDS)) {
        expect(readDashboardLocale("en")[word]).toBe(word);
        expect({
          word,
          language,
          worded: isWordedInDashboardLocale(word, language),
        }).toEqual({
          word,
          language,
          worded: true,
        });
      }
    },
  );

  test("a reference reads in the reader's language", async () => {
    const instance: i18n = createInstance();

    instance.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        de: { translation: readDashboardLocale("de") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });

    render(
      <I18nextProvider i18n={instance}>
        <AuditLogChangesModal
          isOpen={true}
          onClose={jest.fn()}
          action="Update"
          resourceType="Monitor"
          storedResourceType="Monitor"
          changes={MONITOR_UPDATE}
          auditLogId={ENTRY_ID}
          loadRelatedRecords={loaderAnswering(ANSWER)}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(readDashboardLocale("de")["Name hidden"]!),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(readDashboardLocale("de")["Deleted"]!),
    ).toBeInTheDocument();
  });
});
