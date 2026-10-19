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
  test("says who it is for, offers Add destination, and lists name, what is sent, status and last sent", async () => {
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
    ).toEqual(["Name", "Sends", "Status", "Last Sent"]);
    expect(
      (props.actionButtons || []).map((button: { title: string }) => {
        return button.title;
      }),
    ).toEqual(["View Error", "Send a test event", "Edit"]);
    expect(props.isDeleteable).toBe(true);
    expect(props.query).toEqual({ projectId: PROJECT_ID });
  });

  test("its empty state explains the SIEM case and opens the form", async () => {
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

    expect(empty).toHaveTextContent("Already use a SIEM?");

    await act(async () => {
      fireEvent.click(
        within(empty).getByRole("button", { name: "Send to Google SecOps" }),
      );
    });

    expect(
      await screen.findByRole("dialog", { name: "Send to Google SecOps" }),
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
  });
});

describe("adding a Google SecOps destination", () => {
  test("walks the SIEM's settings, then what to send; nothing is sent to test until the key is pasted", async () => {
    await renderForm();

    /*
     * One SIEM today, so no step to pick it: its connection, then what to
     * send. The dialog's title names the SIEM.
     */
    expect(within(progress()).getByText("Connection")).toBeInTheDocument();
    expect(within(progress()).getByText("What to send")).toBeInTheDocument();
    expect(within(progress()).queryByText("SIEM")).toBeNull();
    expect(activeStep()).toBe("Connection");
    expect(sendTestButton()).toBeDisabled();
    expect(
      screen.getByText("Fill in the settings above to send a test event."),
    ).toBeInTheDocument();
  });

  test("tests the settings as typed, never saved, then saves them and starts sending detections only", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });
    const { onSaved } = await renderForm();

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
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Google SecOps");

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
