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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import { Mock } from "jest-mock";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventDestinationFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDestinationFormModal";
import { SecurityEventDestinationTestModal } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDestinationTest";
import SecurityEventDestinationsTable from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDestinationsTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityEventDestination from "../../../Models/DatabaseModels/SecurityEventDestination";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventDestinationProvider from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import SecurityEventDestinationScope from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import escapeRegExp from "../../../Utils/RegExpEscape";

/*
 * "Send to your SIEM": the table's card and columns, the form that adds or
 * edits a Google SecOps destination (what it saves, what its test event
 * posts, a blank key on edit kept), and the test event a saved destination
 * sends from its row. The real BasicFormModal and BasicForm are exercised;
 * transport, the project id, the table's data loading and Monaco's
 * browser-only editor are replaced.
 */

jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      return (
        <>
          <textarea
            aria-labelledby={props.ariaLabelledby}
            placeholder={props.placeholder}
            value={props.value ?? props.initialValue ?? ""}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
              props.onChange?.(event.target.value);
            }}
            onBlur={props.onBlur}
          />
          {props.error && <span role="alert">{props.error}</span>}
        </>
      );
    },
  };
});

// The form's onClose and onSaved, recorded by jest.fn().
type CallbackMock = Mock<() => void>;

let capturedTable: ModelTableProps<BaseModel> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<BaseModel>): ReactElement => {
      capturedTable = props;
      return <div data-testid="destinations-table" />;
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DESTINATION_ID: string = "66666666-6666-4666-8666-666666666666";
const INSTANCE: string = "projects/acme/locations/europe/instances/chronicle";
const KEY: string = `${JSON.stringify(
  {
    type: "service_account",
    client_email: "secops-writer@acme.example",
    private_key:
      "-----BEGIN PRIVATE KEY-----\\nsynthetic\\n-----END PRIVATE KEY-----\\n",
  },
  null,
  2,
)}\n`;

function savedDestination(): SecurityEventDestination {
  const value: SecurityEventDestination = new SecurityEventDestination();
  value._id = DESTINATION_ID;
  value.projectId = PROJECT_ID;
  value.name = "Production SecOps";
  value.provider = SecurityEventDestinationProvider.GoogleSecOps;
  value.config = { region: "europe", instanceResourceName: INSTANCE };
  value.sendScope = SecurityEventDestinationScope.Detections;
  value.isEnabled = true;
  return value;
}

function postBodies(): Array<JSONObject> {
  return jest.mocked(API.post).mock.calls.map((call: Array<unknown>) => {
    return (call[0] as JSONObject)["data"] as JSONObject;
  });
}

function postRoutes(): Array<string> {
  return jest.mocked(API.post).mock.calls.map((call: Array<unknown>) => {
    return String((call[0] as JSONObject)["url"]);
  });
}

beforeEach(() => {
  capturedTable = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ "project-id": PROJECT_ID.toString() });
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
          "A test event was sent. It shows in your SIEM within a few minutes.",
      },
      {},
    ) as never,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

async function next(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
  });
}

async function renderForm(
  destination?: SecurityEventDestination,
): Promise<{ onSaved: CallbackMock; onClose: CallbackMock }> {
  const onSaved: CallbackMock = jest.fn<() => void>();
  const onClose: CallbackMock = jest.fn<() => void>();

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityEventDestinationFormModal
          destination={destination}
          onClose={onClose}
          onSaved={onSaved}
        />
      </MemoryRouter>,
    );
  });
  await waitFor(() => {
    expect(progress()).toBeInTheDocument();
  });

  return { onSaved, onClose };
}

async function pickRegion(user: UserEvent, region: string): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: /^Region/ }));
  await user.click(
    await screen.findByRole("option", { name: region, exact: true }),
  );
}

function sendTestButton(): HTMLElement {
  return screen.getByTestId("security-event-destination-send-test");
}

describe("the Send to your SIEM table", () => {
  test("says who it is for, offers Add destination, and lists name, what is sent and how sending goes", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationsTable />
        </MemoryRouter>,
      );
    });

    const props: ModelTableProps<BaseModel> = capturedTable!;

    expect(props.cardProps?.title).toBe("Send to your SIEM");
    expect(props.cardProps?.description).toBe(
      "Already use a SIEM? OneUptime sends what it finds there too, as it happens - only its detections, or every security event.",
    );
    expect(
      (props.cardProps?.buttons as Array<CardButtonSchema>).map(
        (button: CardButtonSchema) => {
          return button.title;
        },
      ),
    ).toEqual(["Add destination"]);
    expect(
      props.columns.map((column: { title: string }) => {
        return column.title;
      }),
      /*
       * When it last sent reads under its status, and what it is sent under
       * its name, not in columns of their own: with them, the table ran past
       * its card beside the side menu at 1280 - in English with a Last Sent
       * column, in ten languages with a Sends column.
       */
    ).toEqual(["Name", "Status"]);
    expect(
      (props.actionButtons || []).map((button: { title: string }) => {
        return button.title;
      }),
    ).toEqual(["View Error", "Send a test event", "Edit"]);
    expect(props.isDeleteable).toBe(true);
    expect(props.query).toEqual({ projectId: PROJECT_ID });
  });

  test("its empty state says nothing is sent yet, names the SIEMs it supports and opens the form", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationsTable />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      render(
        <MemoryRouter>
          {capturedTable!.noItemsMessage as ReactElement}
        </MemoryRouter>,
      );
    });

    const empty: HTMLElement = screen.getByTestId(
      "security-event-destinations-empty",
    );

    // The card already asks who it is for; the empty state says what is true now.
    expect(empty).toHaveTextContent("Nothing is sent to a SIEM yet");
    expect(empty).toHaveTextContent(
      "Google SecOps, Splunk, Microsoft Sentinel and Elastic Security are supported.",
    );
    expect(empty).not.toHaveTextContent("Already use a SIEM?");
    // Drawn like every other empty table.
    expect(empty).toHaveAttribute("data-empty-state-kind", "empty");

    await act(async () => {
      fireEvent.click(
        within(empty).getByRole("button", { name: "Send to your SIEM" }),
      );
    });

    expect(
      await screen.findByRole("dialog", { name: "Send to your SIEM" }),
    ).toBeInTheDocument();
  });

  test("whoever may not configure SIEMs finds Add destination locked with the reason", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Sending to a SIEM takes Security Admin.",
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationsTable />
        </MemoryRouter>,
      );
    });

    const add: CardButtonSchema = (
      capturedTable!.cardProps?.buttons as Array<CardButtonSchema>
    )[0]!;

    expect(add.disabled).toBe(true);
    expect(add.tooltip).toBe("Sending to a SIEM takes Security Admin.");

    // The empty state's button is locked too, and says why under it, not only on hover.
    await act(async () => {
      render(
        <MemoryRouter>
          {capturedTable!.noItemsMessage as ReactElement}
        </MemoryRouter>,
      );
    });

    expect(
      screen.getByRole("button", { name: "Send to your SIEM" }),
    ).toBeDisabled();
    expect(
      screen.getByTestId("security-event-destinations-empty-note"),
    ).toHaveTextContent("Sending to a SIEM takes Security Admin.");
  });

  test("each row says what the SIEM is and what it is sent, under its name", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationsTable />
        </MemoryRouter>,
      );
    });

    const nameColumn: ModelTableProps<BaseModel>["columns"][number] =
      capturedTable!.columns.find((column: { title: string }) => {
        return column.title === "Name";
      })!;

    const detections: SecurityEventDestination = savedDestination();
    const everything: SecurityEventDestination = savedDestination();
    everything.name = "SecOps EU";
    everything.sendScope = SecurityEventDestinationScope.AllEvents;

    for (const [item, name, detail] of [
      [detections, "Production SecOps", "Google SecOps · Detections only"],
      [everything, "SecOps EU", "Google SecOps · All security events"],
    ] as Array<[SecurityEventDestination, string, string]>) {
      const { unmount } = render(
        <MemoryRouter>
          {nameColumn.getElement!(item as unknown as BaseModel)}
        </MemoryRouter>,
      );

      expect(screen.getByText(name)).toBeInTheDocument();
      const line: HTMLElement = screen.getByTestId(
        "security-event-destination-detail",
      );
      expect(line).toHaveTextContent(detail);
      /*
       * Where room runs out the line breaks between its two parts, never
       * inside one: "Google SecOps ·" over "All security events".
       */
      expect(
        Array.from(line.querySelectorAll("span.whitespace-nowrap")).map(
          (part: Element): string => {
            return part.textContent || "";
          },
        ),
      ).toEqual(["Google SecOps ·", detail.split(" · ")[1]]);

      /*
       * Official logos audit: the SIEM's official logo starts the row, on
       * a 32 pixel tile, as the AI and cloud connections lists draw theirs;
       * decorative, since the detail line names the product.
       */
      const logo: Element | null = document.querySelector(
        "[data-provider-logo]",
      );
      expect(logo).toHaveAttribute(
        "data-provider-logo",
        "google-security-operations",
      );
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(logo).toHaveClass("bg-white", "h-8", "w-8");
      unmount();
    }
  });

  test("each row's status says how sending goes, and when it last sent", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationsTable />
        </MemoryRouter>,
      );
    });

    const statusColumn: ModelTableProps<BaseModel>["columns"][number] =
      capturedTable!.columns.find((column: { title: string }) => {
        return column.title === "Status";
      })!;

    const sending: SecurityEventDestination = savedDestination();
    sending.lastAttemptAt = new Date(Date.now() - 2 * 60 * 1000);
    sending.lastSentAt = new Date(Date.now() - 2 * 60 * 1000);

    const failing: SecurityEventDestination = savedDestination();
    failing.lastAttemptAt = new Date(Date.now() - 60 * 1000);
    failing.lastSentAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    failing.lastError = "Google SecOps did not accept the events (HTTP 500).";

    const starting: SecurityEventDestination = savedDestination();

    for (const [item, health, lastSent] of [
      [sending, "Sending", "Last sent 2 minutes ago"],
      [failing, "Failing", "Last sent 3 hours ago"],
      [starting, "Starting", null],
    ] as Array<[SecurityEventDestination, string, string | null]>) {
      const { unmount } = render(
        <MemoryRouter>
          {statusColumn.getElement!(item as unknown as BaseModel)}
        </MemoryRouter>,
      );

      expect(screen.getByText(health)).toBeInTheDocument();

      if (lastSent) {
        expect(
          screen.getByTestId("security-event-destination-last-sent"),
        ).toHaveTextContent(lastSent);
      } else {
        expect(
          screen.queryByTestId("security-event-destination-last-sent"),
        ).toBeNull();
      }

      unmount();
    }
  });
});

// The SIEM step: one card per SIEM OneUptime sends to, then on to its settings.
async function pickSiem(title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(dialog()).getByRole("radio", {
        name: new RegExp(`^${escapeRegExp(title)}`),
      }),
    );
  });
  await next();
}

describe("adding a Google SecOps destination", () => {
  test("picks the SIEM, walks its settings, then what to send; nothing is sent to test until the key is pasted", async () => {
    await renderForm();

    // Four SIEMs: a step to pick one, then its connection, then what to send.
    expect(within(progress()).getByText("SIEM")).toBeInTheDocument();
    expect(within(progress()).getByText("Connection")).toBeInTheDocument();
    expect(within(progress()).getByText("What to send")).toBeInTheDocument();
    expect(activeStep()).toBe("SIEM");

    for (const title of [
      "Google SecOps",
      "Splunk",
      "Microsoft Sentinel",
      "Elastic Security",
    ]) {
      expect(
        within(dialog()).getByRole("radio", {
          name: new RegExp(`^${escapeRegExp(title)}`),
        }),
      ).toBeInTheDocument();
    }

    await pickSiem("Google SecOps");

    expect(activeStep()).toBe("Connection");
    expect(sendTestButton()).toBeDisabled();
    expect(
      screen.getByText("Fill in the settings above to send a test event."),
    ).toBeInTheDocument();
  });

  test("tests the settings as typed, never saved, then saves them and starts sending detections only", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });
    const { onSaved } = await renderForm();

    await pickSiem("Google SecOps");

    await pickRegion(user, "europe");
    fireEvent.change(screen.getByLabelText(/^Instance resource name/), {
      target: { value: INSTANCE },
    });

    expect(
      screen.getByText("Paste the key above to send a test event."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(
        screen.getByRole("textbox", { name: /^Service account JSON/ }),
        { target: { value: KEY } },
      );
    });

    await act(async () => {
      fireEvent.click(sendTestButton());
    });

    expect(postRoutes()[0]).toContain("/security-event-destination/test");
    expect(postBodies()[0]).toEqual({
      provider: "google-secops",
      config: { region: "europe", instanceResourceName: INSTANCE },
      secrets: { serviceAccountJson: KEY },
    });
    expect(
      await screen.findByTestId("security-event-destination-test-result"),
    ).toHaveTextContent(
      "A test event was sent. It shows in your SIEM within a few minutes.",
    );
    expect(ModelAPI.create).not.toHaveBeenCalled();

    await next();
    expect(activeStep()).toBe("What to send");
    // Left empty, the destination is listed under the SIEM's name.
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
    // What to send first, then the name it is listed under.
    expect(
      screen
        .getByRole("radio", { name: /Detections only/ })
        .compareDocumentPosition(screen.getByLabelText(/^Name/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Start sending" }),
      );
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    const saved: SecurityEventDestination = jest.mocked(ModelAPI.create).mock
      .calls[0]![0].model as SecurityEventDestination;

    expect(saved.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(saved.provider).toBe("google-secops");
    expect(saved.name).toBe("Google SecOps");
    expect(saved.config).toEqual({
      region: "europe",
      instanceResourceName: INSTANCE,
    });
    expect(JSON.parse(saved.secrets!)).toEqual({ serviceAccountJson: KEY });
    expect(saved.sendScope).toBe(SecurityEventDestinationScope.Detections);
    expect(saved.isEnabled).toBe(true);
  });

  test("a SIEM that refuses the test says what to fix, and a changed key hides the old answer", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      new HTTPResponse(
        200,
        {
          isSuccessful: false,
          message:
            "Google SecOps refused the key (HTTP 403). Give the service account the Chronicle API Editor role.",
        },
        {},
      ) as never,
    );
    const user: UserEvent = userEvent.setup({ delay: null });
    await renderForm();

    await pickSiem("Google SecOps");
    await pickRegion(user, "europe");
    fireEvent.change(screen.getByLabelText(/^Instance resource name/), {
      target: { value: INSTANCE },
    });
    await act(async () => {
      fireEvent.change(
        screen.getByRole("textbox", { name: /^Service account JSON/ }),
        { target: { value: KEY } },
      );
    });
    await act(async () => {
      fireEvent.click(sendTestButton());
    });

    const result: HTMLElement = await screen.findByTestId(
      "security-event-destination-test-result",
    );

    expect(result).toHaveAttribute("data-successful", "false");
    expect(result).toHaveTextContent("Chronicle API Editor");

    await act(async () => {
      fireEvent.change(
        screen.getByRole("textbox", { name: /^Service account JSON/ }),
        { target: { value: `${KEY} ` + "{}" } },
      );
    });

    expect(
      screen.queryByTestId("security-event-destination-test-result"),
    ).toBeNull();
  });
});

describe("adding a Splunk destination", () => {
  test("asks only for Splunk's HEC settings, tests them as typed and saves them", async () => {
    const { onSaved } = await renderForm();

    await pickSiem("Splunk");

    // Splunk's fields, none of Google SecOps's.
    expect(screen.queryByLabelText(/^Instance resource name/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^HEC URL/), {
      target: { value: "https://splunk.example.com:8088" },
    });
    // The index waits under More fields: most tokens write to their default.
    await openMoreFields();
    fireEvent.change(screen.getByLabelText(/^Index/), {
      target: { value: "security" },
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^HEC token/), {
        target: { value: "00000000-1111-2222-3333-444444444444" },
      });
    });

    await act(async () => {
      fireEvent.click(sendTestButton());
    });

    expect(postBodies()[0]).toEqual({
      provider: "splunk",
      config: { hecUrl: "https://splunk.example.com:8088", index: "security" },
      secrets: { hecToken: "00000000-1111-2222-3333-444444444444" },
    });

    await next();
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Splunk Cloud" },
    });

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Start sending" }),
      );
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    const saved: SecurityEventDestination = jest.mocked(ModelAPI.create).mock
      .calls[0]![0].model as SecurityEventDestination;

    expect(saved.provider).toBe("splunk");
    expect(saved.name).toBe("Splunk Cloud");
    expect(saved.config).toEqual({
      hecUrl: "https://splunk.example.com:8088",
      index: "security",
    });
    expect(JSON.parse(saved.secrets!)).toEqual({
      hecToken: "00000000-1111-2222-3333-444444444444",
    });
  });
});

// The settings a SIEM's form folds away, as the More fields header names them.
function moreFields(): HTMLElement {
  return within(dialog()).getByRole("button", { name: /^More fields/ });
}

async function openMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(moreFields());
  });
}

describe("the settings most SIEMs leave at their defaults", () => {
  test.each([
    ["Splunk", ["HEC URL", "HEC token"], ["Index", "Source type"]],
    [
      "Microsoft Sentinel",
      [
        "Directory (tenant) ID",
        "Application (client) ID",
        "Logs ingestion endpoint",
        "Data collection rule immutable ID",
        "Client secret",
      ],
      ["Stream", "Cloud"],
    ],
    ["Elastic Security", ["Elasticsearch URL", "API key"], ["Data stream"]],
  ])(
    "%s asks first for what it cannot do without, the rest folded under More fields",
    async (siem: string, asked: Array<string>, folded: Array<string>) => {
      await renderForm();
      await pickSiem(siem);

      for (const title of asked) {
        expect(screen.getByText(title, { exact: true })).toBeVisible();
      }

      expect(moreFields()).toHaveAttribute("aria-expanded", "false");
      // The fold's header names what it holds, none of it set yet.
      const items: Array<HTMLElement> = within(dialog()).getAllByTestId(
        "folded-section-item",
      );
      expect(
        items.map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
      ).toEqual(folded);
      for (const item of items) {
        expect(item).toHaveAttribute("data-item-set", "false");
      }
      for (const title of folded) {
        // Mounted, so a value carries over, but neither shown nor focusable.
        expect(
          screen.getByLabelText(new RegExp(`^${escapeRegExp(title)}`)),
        ).not.toBeVisible();
      }

      await openMoreFields();

      expect(moreFields()).toHaveAttribute("aria-expanded", "true");
      for (const title of folded) {
        expect(
          screen.getByLabelText(new RegExp(`^${escapeRegExp(title)}`)),
        ).toBeVisible();
      }
    },
  );

  test("Google SecOps folds nothing: every setting it has, it needs", async () => {
    await renderForm();
    await pickSiem("Google SecOps");

    expect(
      screen.getByText("Instance resource name", { exact: true }),
    ).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: /^More fields/ }),
    ).toBeNull();
  });

  test("a new Sentinel destination is in the public cloud unless someone picks Azure Government", async () => {
    await renderForm();
    await pickSiem("Microsoft Sentinel");

    fireEvent.change(screen.getByLabelText(/^Directory \(tenant\) ID/), {
      target: { value: "11111111-2222-4333-8444-555555555555" },
    });
    fireEvent.change(screen.getByLabelText(/^Application \(client\) ID/), {
      target: { value: "66666666-7777-4888-9999-000000000000" },
    });
    fireEvent.change(screen.getByLabelText(/^Logs ingestion endpoint/), {
      target: { value: "https://acme-dce.eastus-1.ingest.monitor.azure.com" },
    });
    fireEvent.change(
      screen.getByLabelText(/^Data collection rule immutable ID/),
      { target: { value: "dcr-0123456789abcdef0123456789abcdef" } },
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Client secret/), {
        target: { value: "client-secret-value" },
      });
    });

    await act(async () => {
      fireEvent.click(sendTestButton());
    });

    // The cloud, never shown, is sent as the public cloud it starts at.
    expect(postBodies()[0]).toEqual({
      provider: "microsoft-sentinel",
      config: {
        tenantId: "11111111-2222-4333-8444-555555555555",
        clientId: "66666666-7777-4888-9999-000000000000",
        logsIngestionEndpoint:
          "https://acme-dce.eastus-1.ingest.monitor.azure.com",
        dcrImmutableId: "dcr-0123456789abcdef0123456789abcdef",
        cloud: "public",
      },
      secrets: { clientSecret: "client-secret-value" },
    });
  });
});

describe("editing a destination", () => {
  test("starts from what is saved; a blank key is tested and kept as the stored one", async () => {
    const { onSaved } = await renderForm(savedDestination());

    expect(screen.getByLabelText(/^Instance resource name/)).toHaveValue(
      INSTANCE,
    );
    expect(
      screen.getByRole("textbox", { name: /^Service account JSON/ }),
    ).toHaveAttribute("placeholder", "Unchanged");
    expect(sendTestButton()).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(sendTestButton());
    });

    expect(postBodies()[0]).toEqual({
      destinationId: DESTINATION_ID,
      config: { region: "europe", instanceResourceName: INSTANCE },
      secrets: {},
    });

    await next();
    expect(activeStep()).toBe("What to send");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("radio", { name: /All security events/ }),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Save changes" }),
      );
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(ModelAPI.updateById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: new ObjectID(DESTINATION_ID),
        data: {
          name: "Production SecOps",
          config: { region: "europe", instanceResourceName: INSTANCE },
          sendScope: SecurityEventDestinationScope.AllEvents,
          isEnabled: true,
        },
      }),
    );
  });
});

describe("the row's Send a test event", () => {
  test("sends with the saved settings as it opens, and again on demand", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationTestModal
            destinationId={DESTINATION_ID}
            destinationName="Production SecOps"
            onClose={() => {}}
          />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByRole("dialog", {
        name: "Send a test event: Production SecOps",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("security-event-destination-test-result"),
    ).toHaveAttribute("data-successful", "true");
    expect(postBodies()).toEqual([{ destinationId: DESTINATION_ID }]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    });

    await waitFor(() => {
      expect(postBodies()).toHaveLength(2);
    });
  });

  test("an API error is an answer in the dialog, not a crash", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          403,
          { message: "Testing a destination takes Security Admin." },
          {},
        ) as never,
      );
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventDestinationTestModal
            destinationId={DESTINATION_ID}
            destinationName="Production SecOps"
            onClose={() => {}}
          />
        </MemoryRouter>,
      );
    });

    const result: HTMLElement = await screen.findByTestId(
      "security-event-destination-test-result",
    );

    expect(result).toHaveAttribute("data-successful", "false");
  });
});
