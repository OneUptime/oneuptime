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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The two audit log export pages: a project's (Settings > Audit Logs >
 * Export, through the Dashboard plugin) and the whole instance's (Admin
 * Dashboard > Settings > Audit Log Export).
 *
 *   - which exports each lists (the project's, or those of no project), with
 *     which model API (the project's headers, or none) and which test route;
 *   - who may add, change and test one: the project's permission, and the
 *     Enterprise license - a lapsed one, or one without audit logs, leaves
 *     reading and deleting only, and says so above the table;
 *   - that audit logging being off in the project is said above it, with
 *     the way to turn it on;
 *   - what each row says, its last error, and Turn on / Turn off;
 *   - the empty table's way to the guide;
 *   - the form, for real: the settings are tested as typed before anything
 *     is saved, a project's export is saved in the project, the instance's
 *     in none, and an edit never re-sends a credential it did not type.
 *
 * The table is a stand-in that records its props; the form, the test and
 * the pages are real. Transport is replaced.
 */

let capturedTable: Record<string, unknown> | null = null;

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      capturedTable = props;
      return <div data-testid="audit-log-exports-model-table" />;
    },
  };
});

let mockLicenseMode: string = "editable";

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return mockLicenseMode;
      },
    };
  },
);

jest.mock("react-i18next", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-i18next",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import AuditLogExportSettings from "../../../Dashboard/AuditLogExport/AuditLogExportSettings";
import { AUDIT_LOG_EXPORT_SCOPE_COPY } from "../../../Dashboard/AuditLogExport/AuditLogExportCopy";
import {
  exportConfigFieldName,
  exportSecretFieldName,
} from "../../../Dashboard/AuditLogExport/AuditLogExportForm";
import AuditLogExportSettingsPage from "../../../AdminDashboard/AuditLogExport/AuditLogExportSettingsPage";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EXPORT_ID: string = "66666666-6666-4666-8666-666666666666";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/x/settings/audit-logs/export"),
  currentProject: null,
  hasPaymentMethod: true,
};

const LICENSE_REASON: string =
  "Needs a valid Enterprise license that includes audit logs.";

let auditLoggingOn: boolean = true;

type ActionButton = {
  title: string;
  disabled?: boolean;
  tooltip?: string;
  isVisible?: (item: AuditLogExport) => boolean;
  onClick: (
    item: AuditLogExport,
    done: () => void,
    onError?: (err: Error) => void,
  ) => void;
};

type Column = {
  title: string;
  getElement?: (item: AuditLogExport) => ReactElement;
};

function table(): Record<string, unknown> {
  return capturedTable!;
}

function addButton(): CardButtonSchema {
  return (table()["cardProps"] as { buttons: Array<CardButtonSchema> })
    .buttons[0]!;
}

function actions(): Array<ActionButton> {
  return table()["actionButtons"] as Array<ActionButton>;
}

function action(title: string): ActionButton {
  return actions().find((button: ActionButton): boolean => {
    return button.title === title;
  })!;
}

function column(title: string): Column {
  return (table()["columns"] as Array<Column>).find(
    (candidate: Column): boolean => {
      return candidate.title === title;
    },
  )!;
}

function savedExport(
  fields: Partial<Record<string, unknown>> = {},
): AuditLogExport {
  const item: AuditLogExport = new AuditLogExport();
  item._id = EXPORT_ID;
  item.projectId = PROJECT_ID;
  item.name = "Compliance archive";
  item.destinationType = AuditLogExportDestinationType.AmazonS3;
  item.config = {
    bucket: "acme-audit-logs",
    region: "eu-west-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  };
  item.isEnabled = true;

  for (const key of Object.keys(fields)) {
    (item as unknown as Record<string, unknown>)[key] = fields[key];
  }

  return item;
}

function posts(): Array<JSONObject> {
  return jest.mocked(API.post).mock.calls.map((call: Array<unknown>) => {
    return call[0] as JSONObject;
  });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function next(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
  });
}

async function renderProjectPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AuditLogExportSettings {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
}

async function renderInstancePage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AuditLogExportSettingsPage />
      </MemoryRouter>,
    );
  });
}

// The card's Add export, pressed: the real form opens beside the table.
async function openCreateForm(): Promise<void> {
  await act(async () => {
    (addButton().onClick as () => void)();
  });
  await waitFor(() => {
    expect(
      within(dialog()).getByRole("navigation", { name: "Progress" }),
    ).toBeInTheDocument();
  });
}

async function pickDestination(title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(dialog()).getByRole("radio", { name: new RegExp(`^${title}`) }),
    );
  });
  await next();
}

async function fillS3(): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/^Bucket/), {
      target: { value: "acme-audit-logs" },
    });
    fireEvent.change(screen.getByLabelText(/^Access key ID/), {
      target: { value: "AKIAIOSFODNN7EXAMPLE" },
    });
    fireEvent.change(screen.getByLabelText(/^Secret access key/), {
      target: { value: SECRET },
    });
  });
}

beforeEach(() => {
  capturedTable = null;
  mockLicenseMode = "editable";
  auditLoggingOn = true;

  /*
   * Before ModelAPI's: spied after it, the inherited create is already a
   * mock, and jest would hand back that same one for both.
   */
  jest
    .spyOn(AdminModelAPI, "create")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: PROJECT_ID.toString() });
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.enableAuditLogs = auditLoggingOn;
    return project;
  }) as never);
  jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);
  jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);
  jest.spyOn(API, "post").mockResolvedValue(
    new HTTPResponse(
      200,
      {
        isSuccessful: true,
        message:
          "A test file was written to s3://acme-audit-logs/oneuptime/audit-logs/oneuptime-audit-log-export-test.ndjson.gz.",
      },
      {},
    ) as never,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a project's exports: Settings > Audit Logs > Export", () => {
  test("lists the project's exports, with the project's model API, and every move on them", async () => {
    await renderProjectPage();

    expect(table()["query"]).toEqual({ projectId: PROJECT_ID });
    expect(table()["modelAPI"]).toBe(ModelAPI);
    expect(table()["isDeleteable"]).toBe(true);
    expect(table()["isCreateable"]).toBe(false);
    expect(table()["isEditable"]).toBe(false);
    expect(
      (table()["cardProps"] as { title: string; description: string }).title,
    ).toBe("Export Audit Logs");
    expect(
      (table()["cardProps"] as { title: string; description: string })
        .description,
    ).toBe(AUDIT_LOG_EXPORT_SCOPE_COPY.project.cardDescription);
    expect(addButton().title).toBe("Add export");
    expect(addButton().disabled).toBe(false);
    expect(
      (table()["columns"] as Array<Column>).map((candidate: Column) => {
        return candidate.title;
      }),
    ).toEqual(["Name", "Status"]);
    // Turn on before Send a test: an export that is off shows it as its button.
    expect(
      actions().map((button: ActionButton) => {
        return button.title;
      }),
    ).toEqual(["View Error", "Turn on", "Send a test", "Turn off", "Edit"]);
    // Credentials are never asked for.
    expect(
      Object.keys(table()["selectMoreFields"] as Record<string, unknown>),
    ).not.toContain("secrets");
  });

  test("whoever may not change exports finds Add, Edit and Send a test locked, with the reason", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Exporting the audit log takes Project Owner or Admin.",
    });

    await renderProjectPage();

    expect(addButton().disabled).toBe(true);
    expect(addButton().tooltip).toBe(
      "Exporting the audit log takes Project Owner or Admin.",
    );

    for (const title of ["Turn on", "Send a test", "Turn off", "Edit"]) {
      expect(action(title).disabled).toBe(true);
      expect(action(title).tooltip).toBe(
        "Exporting the audit log takes Project Owner or Admin.",
      );
    }

    // Reading the last error is reading, which they may do.
    expect(action("View Error").disabled).toBeUndefined();

    // The empty state's button is locked too, with the reason under it.
    await act(async () => {
      render(
        <MemoryRouter>
          {table()["noItemsMessage"] as ReactElement}
        </MemoryRouter>,
      );
    });

    expect(screen.getByRole("button", { name: "Add export" })).toBeDisabled();
    expect(screen.getByTestId("audit-log-exports-empty")).toHaveTextContent(
      "Exporting the audit log takes Project Owner or Admin.",
    );
  });

  test.each([
    [
      "read-only",
      "audit-log-export-license-lapsed",
      "Enterprise license required: audit logs are not exported.",
    ],
    [
      "not-included",
      "audit-log-export-license-not-included",
      "Your Enterprise license does not include audit logs: audit logs are not exported.",
    ],
  ])(
    "a %s license says exporting stopped, and leaves reading and deleting only",
    async (mode: string, testId: string, title: string) => {
      mockLicenseMode = mode;

      await renderProjectPage();

      expect(screen.getByTestId(testId)).toHaveTextContent(title);
      expect(addButton().disabled).toBe(true);
      expect(addButton().tooltip).toBe(LICENSE_REASON);
      expect(action("Edit").disabled).toBe(true);
      expect(action("Send a test").disabled).toBe(true);
      expect(action("Send a test").tooltip).toBe(LICENSE_REASON);
      // Pausing and resuming change the export, which the license stopped.
      for (const title of ["Turn on", "Turn off"]) {
        expect(action(title).disabled).toBe(true);
        expect(action(title).tooltip).toBe(LICENSE_REASON);
      }
      expect(table()["isDeleteable"]).toBe(true);
    },
  );

  test("a license in its grace period warns, and changes nothing", async () => {
    mockLicenseMode = "grace";

    await renderProjectPage();

    expect(
      screen.getByTestId("audit-log-export-license-grace"),
    ).toBeInTheDocument();
    expect(addButton().disabled).toBe(false);
  });

  test("a valid license, or one not read yet, says nothing", async () => {
    for (const mode of ["editable", "unknown"]) {
      mockLicenseMode = mode;
      const { unmount } = render(
        <MemoryRouter>
          <AuditLogExportSettings {...PAGE_PROPS} />
        </MemoryRouter>,
      );

      expect(
        screen.queryByTestId("audit-log-export-license-lapsed"),
      ).toBeNull();
      expect(
        screen.queryByTestId("audit-log-export-license-not-included"),
      ).toBeNull();
      expect(screen.queryByTestId("audit-log-export-license-grace")).toBeNull();
      unmount();
    }
  });

  test("audit logging off in the project is said above the table, and only then", async () => {
    auditLoggingOn = false;
    await renderProjectPage();

    const banner: HTMLElement = await screen.findByTestId(
      "audit-log-export-audit-logging-off",
    );

    expect(banner).toHaveTextContent("Audit logging is off for this project.");
    expect(banner).toHaveTextContent(
      "Nothing new is recorded, so nothing new is exported.",
    );
    expect(banner).toHaveTextContent("Turn on audit logging");

    cleanup();
    auditLoggingOn = true;
    await renderProjectPage();

    await waitFor(() => {
      expect(ModelAPI.getItem).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("audit-log-export-audit-logging-off"),
    ).toBeNull();
  });

  test("the audit-logging-off banner opens Settings > Audit Logs > Settings, where its switch is", async () => {
    auditLoggingOn = false;
    jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);

    await renderProjectPage();

    const banner: HTMLElement = await screen.findByTestId(
      "audit-log-export-audit-logging-off",
    );

    await act(async () => {
      fireEvent.click(
        within(banner).getByRole("button", {
          name: /Audit logging is off for this project/,
        }),
      );
    });

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(Navigation.navigate).mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID.toString()}/settings/audit-logs/settings`,
    );
  });

  test("Turn on shows on an export that is off, Turn off on one that is on, and each writes the switch alone", async () => {
    await renderProjectPage();

    const on: AuditLogExport = savedExport();
    const off: AuditLogExport = savedExport({ isEnabled: false });

    expect(action("Turn on").isVisible!(on)).toBe(false);
    expect(action("Turn on").isVisible!(off)).toBe(true);
    expect(action("Turn off").isVisible!(on)).toBe(true);
    expect(action("Turn off").isVisible!(off)).toBe(false);
    expect(action("Turn on").tooltip).toBe(
      "Send what was recorded while it was off, then carry on.",
    );
    expect(action("Turn off").tooltip).toBe(
      "Stop sending. It keeps its place and catches up when turned back on.",
    );

    const refreshBefore: unknown = table()["refreshToggle"];

    for (const [title, item, isEnabled] of [
      ["Turn off", on, false],
      ["Turn on", off, true],
    ] as Array<[string, AuditLogExport, boolean]>) {
      const outcome: Array<string> = [];

      await act(async () => {
        action(title).onClick(
          item,
          () => {
            outcome.push("done");
          },
          (err: Error) => {
            outcome.push(`error: ${err.message}`);
          },
        );
      });

      await waitFor(() => {
        expect(outcome).toEqual(["done"]);
      });

      const calls: Array<Array<unknown>> = jest.mocked(ModelAPI.updateById).mock
        .calls as unknown as Array<Array<unknown>>;
      const update: { id: ObjectID; data: JSONObject } = calls[
        calls.length - 1
      ]![0] as { id: ObjectID; data: JSONObject };

      expect(update.id.toString()).toBe(EXPORT_ID);
      expect(update.data).toEqual({ isEnabled });
    }

    // The list is read again, so the row's status says what it now is.
    expect(table()["refreshToggle"]).not.toBe(refreshBefore);
  });

  test("a refused Turn off is the row's own error, in words", async () => {
    /*
     * Refused when it is called, as the server refuses: a promise rejected
     * up front is reported by the test environment's zone before anyone
     * could handle it.
     */
    jest.spyOn(ModelAPI, "updateById").mockImplementation((async () => {
      throw new Error("Audit logs need a valid license.");
    }) as never);

    await renderProjectPage();

    const outcome: Array<string> = [];

    await act(async () => {
      action("Turn off").onClick(
        savedExport(),
        () => {
          outcome.push("done");
        },
        (err: Error) => {
          outcome.push(`error: ${err.message}`);
        },
      );
    });

    await waitFor(() => {
      expect(outcome).toEqual(["error: Audit logs need a valid license."]);
    });
  });

  test("on the instance's page, Turn on and Turn off go through the Admin Dashboard's model API", async () => {
    jest
      .spyOn(AdminModelAPI, "updateById")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    await renderInstancePage();

    await act(async () => {
      action("Turn off").onClick(
        savedExport({ projectId: undefined }),
        () => {},
        () => {},
      );
    });

    await waitFor(() => {
      expect(AdminModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    expect(
      (
        jest.mocked(AdminModelAPI.updateById).mock.calls[0]![0] as unknown as {
          data: JSONObject;
        }
      ).data,
    ).toEqual({ isEnabled: false });
  });

  test("each row says where it sends under its name, never a credential", async () => {
    await renderProjectPage();

    render(
      <MemoryRouter>
        {column("Name").getElement!(
          savedExport({ secrets: JSON.stringify({ secretAccessKey: SECRET }) }),
        )}
      </MemoryRouter>,
    );

    expect(screen.getByText("Compliance archive")).toBeInTheDocument();
    expect(screen.getByTestId("audit-log-export-detail")).toHaveTextContent(
      "Amazon S3 · acme-audit-logs/oneuptime/audit-logs/",
    );
    expect(document.body).not.toHaveTextContent(SECRET);
  });

  test("a long name is cut short on its own line, with an ellipsis, and the address wraps under it whole", async () => {
    await renderProjectPage();

    render(
      <MemoryRouter>
        {column("Name").getElement!(
          savedExport({
            name: "Compliance archive for the SOC 2 and ISO 27001 auditors (production, EU)",
            destinationType: AuditLogExportDestinationType.S3Compatible,
            config: {
              endpoint: "https://minio.acme.internal:9000",
              bucket: "acme-sec-lake",
              region: "us-east-1",
              accessKeyId: "minio-audit",
            },
          }),
        )}
      </MemoryRouter>,
    );

    // A block of its own: an ellipsis does not reach into a box inside a line.
    expect(screen.getByTestId("audit-log-export-name").tagName).toBe("DIV");
    expect(screen.getByTestId("audit-log-export-name")).toHaveClass("truncate");
    // S3-compatible storage names its endpoint, as a path-style address does.
    expect(screen.getByTestId("audit-log-export-detail")).toHaveTextContent(
      "S3-compatible storage · minio.acme.internal:9000/acme-sec-lake/oneuptime/audit-logs/",
    );
    // The address is one box on the line: it never breaks at a hyphen of its bucket.
    expect(
      screen.getByText(
        "minio.acme.internal:9000/acme-sec-lake/oneuptime/audit-logs/",
      ),
    ).toHaveClass("inline-block", "max-w-full");
  });

  test("each row's status says how exporting goes", async () => {
    await renderProjectPage();

    for (const [fields, health, line] of [
      [
        {
          lastAttemptAt: new Date(Date.now() - 60 * 1000),
          lastExportedAt: new Date(Date.now() - 3 * 60 * 1000),
        },
        "Exporting",
        "Last exported 3 minutes ago",
      ],
      [
        {
          lastError: "403",
          failingSince: new Date(Date.now() - 2 * 60 * 60 * 1000),
          lastExportedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
        "Failing",
        // A span: "Failing since 2 hours ago" read oddly, in every language.
        "Failing for 2 hours",
      ],
      [{ isEnabled: false }, "Paused", null],
      [{}, "Starting", null],
    ] as Array<[Record<string, unknown>, string, string | null]>) {
      const { unmount } = render(
        <MemoryRouter>
          {column("Status").getElement!(savedExport(fields))}
        </MemoryRouter>,
      );

      expect(screen.getByText(health)).toBeInTheDocument();

      if (line) {
        expect(
          screen.getByTestId("audit-log-export-status-line"),
        ).toHaveTextContent(line);
      } else {
        expect(screen.queryByTestId("audit-log-export-status-line")).toBeNull();
      }

      unmount();
    }
  });

  test("View Error shows only on a failing export, with the error and the next try", async () => {
    await renderProjectPage();

    const failing: AuditLogExport = savedExport({
      lastError:
        "Amazon S3 refused the request (403 AccessDenied). Allow s3:PutObject on the folder.",
      nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    expect(action("View Error").isVisible!(savedExport())).toBe(false);
    expect(action("View Error").isVisible!(failing)).toBe(true);

    await act(async () => {
      action("View Error").onClick(failing, () => {});
    });

    expect(screen.getByTestId("audit-log-export-error")).toHaveTextContent(
      "Allow s3:PutObject on the folder.",
    );
    expect(screen.getByTestId("audit-log-export-next-try")).toHaveTextContent(
      "Next try:",
    );
  });

  test("Send a test sends one entry with the saved settings, to the project's route, as soon as it opens", async () => {
    await renderProjectPage();

    await act(async () => {
      action("Send a test").onClick(savedExport(), () => {});
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("audit-log-export-test-result"),
      ).toBeInTheDocument();
    });

    expect(posts()).toHaveLength(1);
    expect(String(posts()[0]!["url"])).toContain("/audit-log-export/test");
    expect(posts()[0]!["data"]).toEqual({ exportId: EXPORT_ID });
    expect(posts()[0]!["headers"]).toEqual({
      tenantid: PROJECT_ID.toString(),
    });
  });

  test("adding one: the destination, its settings tested as typed, then it is saved in the project", async () => {
    await renderProjectPage();
    await openCreateForm();

    // Six destinations to pick from.
    for (const title of [
      "Amazon S3",
      "S3-compatible storage",
      "Google Cloud Storage",
      "Azure Blob Storage",
      "Webhook",
      "Syslog",
    ]) {
      expect(
        within(dialog()).getByRole("radio", { name: new RegExp(`^${title}`) }),
      ).toBeInTheDocument();
    }

    await pickDestination("Amazon S3");

    const sendTest: HTMLElement = screen.getByTestId(
      "audit-log-export-send-test",
    );

    expect(sendTest).toBeDisabled();
    expect(
      screen.getByText("Fill in the settings above to send a test."),
    ).toBeInTheDocument();

    await fillS3();

    await act(async () => {
      fireEvent.click(screen.getByTestId("audit-log-export-send-test"));
    });

    expect(String(posts()[0]!["url"])).toContain("/audit-log-export/test");
    expect(posts()[0]!["data"]).toEqual({
      destinationType: "s3",
      config: {
        bucket: "acme-audit-logs",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: { secretAccessKey: SECRET },
    });
    expect(posts()[0]!["headers"]).toEqual({
      tenantid: PROJECT_ID.toString(),
    });
    expect(
      await screen.findByTestId("audit-log-export-test-result"),
    ).toHaveAttribute("data-successful", "true");
    // Testing saved nothing.
    expect(ModelAPI.create).not.toHaveBeenCalled();

    await next();

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Start exporting" }),
      );
    });

    await waitFor(() => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });

    const saved: AuditLogExport = jest.mocked(ModelAPI.create).mock.calls[0]![0]
      .model as AuditLogExport;

    expect(saved.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(saved.name).toBe("Amazon S3");
    expect(saved.destinationType).toBe("s3");
    expect(saved.config).toEqual({
      bucket: "acme-audit-logs",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    });
    expect(JSON.parse(saved.secrets!)).toEqual({ secretAccessKey: SECRET });
    expect(saved.isEnabled).toBe(true);
    // From now on: no Export From picked.
    expect(saved.startsAt).toBeUndefined();
  });

  test("a destination that refuses the test says what to fix", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      new HTTPResponse(
        200,
        {
          isSuccessful: false,
          message:
            "Amazon S3 refused the request (403 AccessDenied): allow s3:PutObject on arn:aws:s3:::acme-audit-logs/oneuptime/audit-logs/* for this key.",
        },
        {},
      ) as never,
    );

    await renderProjectPage();
    await openCreateForm();
    await pickDestination("Amazon S3");
    await fillS3();

    await act(async () => {
      fireEvent.click(screen.getByTestId("audit-log-export-send-test"));
    });

    const result: HTMLElement = await screen.findByTestId(
      "audit-log-export-test-result",
    );

    expect(result).toHaveAttribute("data-successful", "false");
    expect(result).toHaveTextContent("allow s3:PutObject");

    // A changed key hides the answer it never checked.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Secret access key/), {
        target: { value: `${SECRET}-new` },
      });
    });

    expect(screen.queryByTestId("audit-log-export-test-result")).toBeNull();
  });

  test("editing one keeps its destination and its stored key: only what was typed is sent", async () => {
    await renderProjectPage();

    await act(async () => {
      action("Edit").onClick(savedExport(), () => {});
    });

    // No destination step: it cannot change.
    expect(
      within(
        within(dialog()).getByRole("navigation", { name: "Progress" }),
      ).queryByText("Destination"),
    ).toBeNull();
    expect(screen.getByLabelText(/^Bucket/)).toHaveValue("acme-audit-logs");
    expect(screen.getByLabelText(/^Secret access key/)).toHaveValue("");

    // The stored key is tested: nothing has to be pasted.
    await act(async () => {
      fireEvent.click(screen.getByTestId("audit-log-export-send-test"));
    });

    expect(posts()[0]!["data"]).toEqual({
      exportId: EXPORT_ID,
      config: {
        bucket: "acme-audit-logs",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: {},
    });

    await next();

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Save changes" }),
      );
    });

    await waitFor(() => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });

    const update: { id: ObjectID; data: JSONObject } = jest.mocked(
      ModelAPI.updateById,
    ).mock.calls[0]![0] as unknown as { id: ObjectID; data: JSONObject };

    expect(update.id.toString()).toBe(EXPORT_ID);
    // Never the switch: that is the row's Turn on and Turn off.
    expect(update.data).toEqual({
      name: "Compliance archive",
      config: {
        bucket: "acme-audit-logs",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
    });
  });

  test("the edit form has no on/off switch: its last step is the name and Export From", async () => {
    await renderProjectPage();

    await act(async () => {
      action("Edit").onClick(savedExport({ isEnabled: false }), () => {});
    });

    await next();

    expect(screen.getByLabelText(/^Name/)).toHaveValue("Compliance archive");
    expect(within(dialog()).queryByRole("switch")).toBeNull();
    expect(
      within(dialog()).getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  test("the empty table says what is supported, and opens the guide in a new tab", async () => {
    jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);

    await renderProjectPage();

    await act(async () => {
      render(
        <MemoryRouter>
          {table()["noItemsMessage"] as ReactElement}
        </MemoryRouter>,
      );
    });

    expect(screen.getByTestId("audit-log-exports-empty")).toHaveTextContent(
      "Amazon S3, S3-compatible storage, Google Cloud Storage, Azure Blob Storage, webhooks and syslog are supported.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("audit-log-exports-empty-docs"));
    });

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(Navigation.navigate).mock.calls[0]![0])).toBe(
      "/docs/configuration/audit-log-export",
    );
    expect(jest.mocked(Navigation.navigate).mock.calls[0]![1]).toEqual({
      openInNewTab: true,
    });
  });
});

describe("the instance's exports: Admin Dashboard > Settings > Audit Log Export", () => {
  test("lists the exports of no project, with the Admin Dashboard's model API", async () => {
    await renderInstancePage();

    expect(table()["query"]).toEqual({ projectId: new IsNull() });
    expect(table()["modelAPI"]).toBe(AdminModelAPI);
    expect((table()["cardProps"] as { description: string }).description).toBe(
      AUDIT_LOG_EXPORT_SCOPE_COPY.instance.cardDescription,
    );
    // The page's own place in Settings.
    expect(screen.getAllByText("Audit Log Export").length).toBeGreaterThan(0);
  });

  test("adding one tests it on the instance's route, without a project, and saves it in none", async () => {
    await renderInstancePage();
    await openCreateForm();
    await pickDestination("Syslog");

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Host/), {
        target: { value: "10.20.0.15" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("audit-log-export-send-test"));
    });

    expect(String(posts()[0]!["url"])).toContain(
      "/audit-log-export/instance/test",
    );
    // The Admin Dashboard's requests name no project.
    expect(posts()[0]!["headers"]).toEqual({});
    expect((posts()[0]!["data"] as JSONObject)["destinationType"]).toBe(
      "syslog",
    );

    await next();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Name/), {
        target: { value: "Central SIEM" },
      });
    });

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Start exporting" }),
      );
    });

    await waitFor(() => {
      expect(AdminModelAPI.create).toHaveBeenCalledTimes(1);
    });

    const saved: AuditLogExport = jest.mocked(AdminModelAPI.create).mock
      .calls[0]![0].model as AuditLogExport;

    expect(saved.projectId).toBeUndefined();
    expect(saved.name).toBe("Central SIEM");
    expect(saved.config).toEqual({
      host: "10.20.0.15",
      port: 6514,
      protocol: "tls",
      framing: "octet-counting",
    });
    expect(JSON.parse(saved.secrets!)).toEqual({});
    expect(ModelAPI.create).not.toHaveBeenCalled();
  });

  test("the license stops it here too", async () => {
    mockLicenseMode = "read-only";

    await renderInstancePage();

    expect(
      screen.getByTestId("audit-log-export-license-lapsed"),
    ).toBeInTheDocument();
    expect(addButton().disabled).toBe(true);
  });

  test("the field names the form saves under are the catalog's", () => {
    expect(exportConfigFieldName("syslog", "host")).toBe(
      "syslog__config__host",
    );
    expect(exportSecretFieldName("s3", "secretAccessKey")).toBe(
      "s3__secret__secretAccessKey",
    );
  });
});
