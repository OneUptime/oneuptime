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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * A RECORD RENAMED ON ITS OWN PAGE: THE PAGE'S HEADING FOLLOWS.
 *
 * A record's page is headed by its name - "Team - Platform", "Project -
 * Acme", a user's email in the Admin Dashboard - by the layout's ModelPage,
 * which reads it once and stays mounted while the tabs below it change. A
 * detail card on the page edits the record, and its save showed in the card
 * and nowhere else: the heading, the crumb that names the record and the
 * browser tab kept the old name until a reload (issue #6766, "When I click on
 * edit and save, the new changes do not reflect"). Only two cards told the
 * heading, each by hand.
 *
 * CardModelDetail now tells it after every save (ModelHeaderEvents), for the
 * record it saved and no other. These render the real ModelPage around the
 * real CardModelDetail, its Edit dialog and form; the API is a stand-in that
 * holds the records as a server would.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import ModelPage from "../../../UI/Components/Page/ModelPage";
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import { subscribeToModelHeaderChanged } from "../../../UI/Components/Page/ModelHeaderEvents";
import Probe from "../../../Models/DatabaseModels/Probe";

// Generous: these drive the real page, card and form, on a busy CI box.
const WAIT: { timeout: number } = { timeout: 20000 };

const PROBE_A: string = "11111111-1111-4111-8111-111111111111";
const PROBE_B: string = "22222222-2222-4222-8222-222222222222";

// The probes as the server holds them: id to name.
let storedNames: Map<string, string> = new Map<string, string>();

interface GetItemRequest {
  id: ObjectID;
  select: Record<string, unknown>;
  requestOptions?: Record<string, unknown> | undefined;
}

/*
 * The page header's read: ModelPage asks with request options of its own and
 * no _id (the card asks for _id; the Edit form names an override URL).
 */
function isHeaderRead(request: GetItemRequest): boolean {
  return Boolean(
    request.requestOptions &&
      !("overrideRequestUrl" in request.requestOptions) &&
      !request.select["_id"],
  );
}

function headerReadsOf(id: string): number {
  return getItemMock.mock.calls.filter((call: Array<unknown>) => {
    const request: GetItemRequest = call[0] as GetItemRequest;
    return request.id.toString() === id && isHeaderRead(request);
  }).length;
}

function probeCard(probeId: string): ReactElement {
  return (
    <CardModelDetail<Probe>
      name={`Probe Details ${probeId}`}
      cardProps={{
        title: "Probe Details",
        description: "Here are more details for this probe.",
      }}
      isEditable={true}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Probe name",
        },
      ]}
      modelDetailProps={{
        modelType: Probe,
        id: `probe-detail-${probeId}`,
        modelId: new ObjectID(probeId),
        fields: [
          {
            field: { name: true },
            title: "Name",
            fieldType: FieldType.Text,
          },
        ],
      }}
    />
  );
}

/*
 * Probe A's page, headed by its name, with A's card on it - and, when
 * asked, a card for probe B too, as a page that shows a related record does.
 */
function probePage(options?: { withCardOf?: string }): ReactElement {
  return (
    <ModelPage
      title="Probe"
      modelType={Probe}
      modelId={new ObjectID(PROBE_A)}
      modelNameField="name"
    >
      <div>{probeCard(options?.withCardOf || PROBE_A)}</div>
    </ModelPage>
  );
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

async function openEditDialog(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByText("Edit Probe", {}, WAIT));

  const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

  await waitFor(() => {
    expect(within(dialog).getByPlaceholderText("Probe name")).not.toHaveValue(
      "",
    );
  }, WAIT);

  return dialog;
}

async function rename(to: string): Promise<void> {
  const dialog: HTMLElement = await openEditDialog();

  fireEvent.change(within(dialog).getByPlaceholderText("Probe name"), {
    target: { value: to },
  });
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  }, WAIT);
}

describe("A record renamed on its own page: the page's heading follows (issue #6766)", () => {
  beforeEach(() => {
    storedNames = new Map<string, string>([
      [PROBE_A, "WBHQ"],
      [PROBE_B, "Frankfurt"],
    ]);

    getItemMock.mockReset();
    getItemMock.mockImplementation(async (request: unknown) => {
      const id: string = (request as GetItemRequest).id.toString();
      const probe: Probe = new Probe();
      probe.id = new ObjectID(id);
      probe.name = storedNames.get(id) || "";
      return probe;
    });

    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockImplementation(async (request: unknown) => {
      const model: Probe = (request as { model: Probe }).model;
      storedNames.set(model.id!.toString(), model.name || "");
      return { data: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("renaming the record in its card renames the page's heading at once", async () => {
    render(probePage());

    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ");
    }, WAIT);
    expect(headerReadsOf(PROBE_A)).toBe(1);

    await rename("WBHQ Primary");

    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ Primary");
    }, WAIT);
    // The card shows it too.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("card-model-detail-body")).getByText(
          "WBHQ Primary",
        ),
      ).toBeInTheDocument();
    }, WAIT);
    expect(headerReadsOf(PROBE_A)).toBe(2);
  });

  test("a second rename follows too", async () => {
    render(probePage());

    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ");
    }, WAIT);

    await rename("WBHQ Primary");
    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ Primary");
    }, WAIT);

    await rename("WBHQ Main");
    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ Main");
    }, WAIT);
    expect(headerReadsOf(PROBE_A)).toBe(3);
  });

  test("each save tells the heading once, for the record it saved", async () => {
    const told: Array<string> = [];
    const stopListening: () => void = subscribeToModelHeaderChanged({
      modelType: Probe,
      modelId: new ObjectID(PROBE_A),
      onChanged: (): void => {
        told.push(PROBE_A);
      },
    });

    try {
      render(probePage());

      await waitFor(() => {
        expect(heading()).toHaveTextContent("Probe - WBHQ");
      }, WAIT);

      await rename("WBHQ Primary");

      await waitFor(() => {
        expect(told).toEqual([PROBE_A]);
      }, WAIT);
    } finally {
      stopListening();
    }
  });

  test("a save of another record on the page leaves the heading alone", async () => {
    render(probePage({ withCardOf: PROBE_B }));

    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ");
    }, WAIT);

    await rename("Frankfurt 2");

    // B's card shows B's new name; A's heading is not read again.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("card-model-detail-body")).getByText(
          "Frankfurt 2",
        ),
      ).toBeInTheDocument();
    }, WAIT);
    expect(heading()).toHaveTextContent("Probe - WBHQ");
    expect(headerReadsOf(PROBE_A)).toBe(1);
  });

  test("a refused save reads nothing again, and the heading keeps its name", async () => {
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockRejectedValue(
      new Error("You do not have permission to edit this probe."),
    );

    render(probePage());

    await waitFor(() => {
      expect(heading()).toHaveTextContent("Probe - WBHQ");
    }, WAIT);

    const dialog: HTMLElement = await openEditDialog();
    const readsBeforeSave: number = getItemMock.mock.calls.length;

    fireEvent.change(within(dialog).getByPlaceholderText("Probe name"), {
      target: { value: "WBHQ Primary" },
    });
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await screen.findByText(
      "You do not have permission to edit this probe.",
      {},
      WAIT,
    );

    expect(getItemMock.mock.calls.length).toBe(readsBeforeSave);
    expect(heading()).toHaveTextContent("Probe - WBHQ");
    expect(headerReadsOf(PROBE_A)).toBe(1);
  });
});
