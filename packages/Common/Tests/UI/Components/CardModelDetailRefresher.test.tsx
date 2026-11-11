import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * CardModelDetail keeps its own refresher, handed to ModelDetail, and flips it
 * whenever the page's refresher prop changes. That effect used to run on
 * mount too, so ModelDetail saw a second refresher value right after its
 * first render and every card sent two getItem requests on page load.
 * ModelDetail drops the first response, so nothing looked wrong - it only
 * wasted a request per card.
 *
 * getItem hands back a fresh Probe per call, as the real API does.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<any>) => {
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

import ModelDetail from "../../../UI/Components/ModelDetail/ModelDetail";
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import Probe from "../../../Models/DatabaseModels/Probe";

/*
 * These render real components that fetch, so give the waits enough room to
 * survive a loaded CI box - the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";

type CountDetailFetchesFunction = () => number;

/*
 * The edit modal's ModelForm also calls getItem to prefill. ModelDetail's
 * request is the one that asks for _id; ModelForm's is built from the form
 * fields only.
 */
const countDetailFetches: CountDetailFetchesFunction = (): number => {
  return getItemMock.mock.calls.filter((call: Array<any>) => {
    return Boolean(call[0]?.select?.["_id"]);
  }).length;
};

type FlushFunction = () => Promise<void>;

// Lets any effect-triggered follow-up fetch fire before asserting on counts.
const flush: FlushFunction = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });
};

interface ProbeCardProps {
  refresher?: boolean | undefined;
  modelDetailRefresher?: boolean | undefined;
  isEditable?: boolean | undefined;
}

const ProbeCard: React.FunctionComponent<ProbeCardProps> = (
  props: ProbeCardProps,
): React.ReactElement => {
  return (
    <CardModelDetail<Probe>
      name="Probe Details"
      cardProps={{
        title: "Probe Details",
        description: "Here are more details for this probe.",
      }}
      {...(props.refresher !== undefined ? { refresher: props.refresher } : {})}
      isEditable={props.isEditable || false}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
      modelDetailProps={{
        modelType: Probe,
        id: "probe-detail",
        // A fresh ObjectID per render, exactly like a real page.
        modelId: new ObjectID(PROBE_ID),
        ...(props.modelDetailRefresher !== undefined
          ? { refresher: props.modelDetailRefresher }
          : {}),
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
};

describe("CardModelDetail refresher", () => {
  let probeName: string;

  beforeEach(() => {
    probeName = "WBHQ";
    getItemMock.mockReset();
    getItemMock.mockImplementation((data: any) => {
      const probe: Probe = new Probe();
      probe.id = new ObjectID(data.id.toString());
      probe.name = probeName;
      return Promise.resolve(probe);
    });
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  it("fetches exactly once on mount", async () => {
    render(<ProbeCard />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  it("fetches exactly once on mount when the page passes a refresher", async () => {
    render(<ProbeCard refresher={false} />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  it("refetches each time the page toggles its refresher", async () => {
    const { rerender } = render(<ProbeCard refresher={false} />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    probeName = "WBHQ renamed";
    rerender(<ProbeCard refresher={true} />);

    await screen.findByText("WBHQ renamed", {}, { timeout: WAIT_TIMEOUT });
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(2);

    probeName = "WBHQ renamed again";
    rerender(<ProbeCard refresher={false} />);

    await screen.findByText(
      "WBHQ renamed again",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(3);
  });

  it("does not refetch when the page re-renders with the same refresher", async () => {
    const { rerender } = render(<ProbeCard refresher={true} />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    rerender(<ProbeCard refresher={true} />);
    rerender(<ProbeCard refresher={true} />);
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after saving the edit modal, and on a page toggle after that", async () => {
    const { rerender } = render(
      <ProbeCard isEditable={true} refresher={false} />,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();
    expect(countDetailFetches()).toBe(1);

    await userEvent.click(
      await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
    );

    await waitFor(
      () => {
        expect(screen.getByDisplayValue("WBHQ")).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    probeName = "WBHQ saved";
    await userEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("WBHQ saved", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(countDetailFetches()).toBe(2);

    /*
     * The save flipped the internal refresher on its own. A page toggle after
     * that still has to reach ModelDetail as a change.
     */
    probeName = "WBHQ toggled";
    rerender(<ProbeCard isEditable={true} refresher={true} />);

    await screen.findByText("WBHQ toggled", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    expect(countDetailFetches()).toBe(3);
  });

  it("follows a refresher passed through modelDetailProps", async () => {
    /*
     * A refresher the page puts in modelDetailProps is followed as the card's
     * own refresher prop is. Only that one toggles here, so the refetch can
     * only have come from it.
     */
    const { rerender } = render(
      <ProbeCard refresher={false} modelDetailRefresher={false} />,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    probeName = "WBHQ extended";
    rerender(<ProbeCard refresher={false} modelDetailRefresher={true} />);

    await screen.findByText("WBHQ extended", {}, { timeout: WAIT_TIMEOUT });
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  it("adds no fetch of its own on a StrictMode mount", async () => {
    /*
     * StrictMode runs mount effects twice, so ModelDetail on its own already
     * fetches more than once there. The card must not add to that - which a
     * guard that only skips the effect's first run would.
     */
    const { unmount } = render(
      <React.StrictMode>
        <ModelDetail<Probe>
          modelType={Probe}
          id="probe-detail"
          modelId={new ObjectID(PROBE_ID)}
          refresher={false}
          fields={[
            {
              field: { name: true },
              title: "Name",
              fieldType: FieldType.Text,
            },
          ]}
        />
      </React.StrictMode>,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    const bareDetailFetches: number = getItemMock.mock.calls.length;
    unmount();
    getItemMock.mockClear();

    render(
      <React.StrictMode>
        <ProbeCard refresher={false} />
      </React.StrictMode>,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(bareDetailFetches);
  });
});

/*
 * ISSUE #6766: "When I click on edit and save, the new changes do not
 * reflect" - the Admin Dashboard's Active Monitors card, whose page handed
 * its refresher to modelDetailProps as well as to the card. CardModelDetail
 * spread modelDetailProps over its own refresher, so the save flipped a
 * refresher ModelDetail never saw, and the card kept the old limit until a
 * reload.
 *
 * A page here owns its refresher, as a real one does, and hands it over the
 * way it is told - on the card, in modelDetailProps, or both - with a button
 * that refreshes the page, and, when told, a refresh of its own on a save
 * (onSaveSuccess). Whatever the page does, a save shows what was saved.
 */

type RefresherPlacement = "card" | "modelDetailProps" | "both";

const PLACEMENTS: Array<RefresherPlacement> = [
  "card",
  "modelDetailProps",
  "both",
];

interface ProbePageProps {
  placement: RefresherPlacement;
  refreshesOnSave?: boolean | undefined;
}

const ProbePage: React.FunctionComponent<ProbePageProps> = (
  props: ProbePageProps,
): React.ReactElement => {
  const [refresher, setRefresher] = React.useState<boolean>(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setRefresher(!refresher);
        }}
      >
        Refresh page
      </button>
      <CardModelDetail<Probe>
        name="Probe Details"
        cardProps={{
          title: "Probe Details",
          description: "Here are more details for this probe.",
        }}
        {...(props.placement === "modelDetailProps"
          ? {}
          : { refresher: refresher })}
        isEditable={true}
        onSaveSuccess={
          props.refreshesOnSave
            ? () => {
                setRefresher(!refresher);
              }
            : undefined
        }
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
        modelDetailProps={{
          modelType: Probe,
          id: "probe-detail",
          modelId: new ObjectID(PROBE_ID),
          ...(props.placement === "card" ? {} : { refresher: refresher }),
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
    </div>
  );
};

type SaveFromDialogFunction = (savedName: string) => Promise<void>;

/*
 * Opens the card's Edit dialog, waits for it to be filled with the record,
 * and saves - the server then holds savedName, as if the field had been
 * changed to it.
 */
const saveFromDialog: SaveFromDialogFunction = async (
  savedName: string,
): Promise<void> => {
  await userEvent.click(
    await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
  );

  await waitFor(
    () => {
      expect(screen.getByDisplayValue(probeNameOnServer)).toBeDefined();
    },
    { timeout: WAIT_TIMEOUT },
  );

  probeNameOnServer = savedName;
  await userEvent.click(screen.getByText("Save Changes"));
};

let probeNameOnServer: string = "WBHQ";

describe("CardModelDetail shows what its Edit dialog saved, wherever the page puts its refresher (issue #6766)", () => {
  beforeEach(() => {
    probeNameOnServer = "WBHQ";
    getItemMock.mockReset();
    getItemMock.mockImplementation((data: any) => {
      const probe: Probe = new Probe();
      probe.id = new ObjectID(data.id.toString());
      probe.name = probeNameOnServer;
      return Promise.resolve(probe);
    });
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  it.each(PLACEMENTS)(
    "refresher on %s: a save shows the saved value at once, with one read",
    async (placement: RefresherPlacement) => {
      render(<ProbePage placement={placement} />);

      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
      await flush();
      expect(countDetailFetches()).toBe(1);

      await saveFromDialog("WBHQ saved");

      await screen.findByText("WBHQ saved", {}, { timeout: WAIT_TIMEOUT });
      await flush();

      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      expect(countDetailFetches()).toBe(2);
      expect(screen.queryByText("WBHQ")).toBeNull();
    },
  );

  it.each(PLACEMENTS)(
    "refresher on %s: a page refresh reads once",
    async (placement: RefresherPlacement) => {
      render(<ProbePage placement={placement} />);

      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
      await flush();
      expect(countDetailFetches()).toBe(1);

      // Both, the same state passed to each, is one change: one read.
      probeNameOnServer = "WBHQ refreshed";
      await userEvent.click(screen.getByText("Refresh page"));

      await screen.findByText("WBHQ refreshed", {}, { timeout: WAIT_TIMEOUT });
      await flush();
      expect(countDetailFetches()).toBe(2);
    },
  );

  it.each(PLACEMENTS)(
    "refresher on %s: a page refresh after a save still reads again",
    async (placement: RefresherPlacement) => {
      render(<ProbePage placement={placement} />);

      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
      await flush();

      await saveFromDialog("WBHQ saved");
      await screen.findByText("WBHQ saved", {}, { timeout: WAIT_TIMEOUT });
      await flush();
      expect(countDetailFetches()).toBe(2);

      probeNameOnServer = "WBHQ refreshed";
      await userEvent.click(screen.getByText("Refresh page"));

      await screen.findByText("WBHQ refreshed", {}, { timeout: WAIT_TIMEOUT });
      await flush();
      expect(countDetailFetches()).toBe(3);
    },
  );

  it.each(PLACEMENTS)(
    "refresher on %s: a page that refreshes on a save as well still ends on the saved value",
    async (placement: RefresherPlacement) => {
      render(<ProbePage placement={placement} refreshesOnSave={true} />);

      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
      await flush();

      await saveFromDialog("WBHQ saved");

      await screen.findByText("WBHQ saved", {}, { timeout: WAIT_TIMEOUT });
      await flush();

      expect(screen.getByText("WBHQ saved")).toBeDefined();
      // The save's read and the page's: no more, and no loop.
      expect(countDetailFetches()).toBeLessThanOrEqual(3);
    },
  );

  it.each(PLACEMENTS)(
    "refresher on %s: a second save shows too",
    async (placement: RefresherPlacement) => {
      render(<ProbePage placement={placement} />);

      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
      await flush();

      await saveFromDialog("WBHQ saved");
      await screen.findByText("WBHQ saved", {}, { timeout: WAIT_TIMEOUT });
      await flush();

      await saveFromDialog("WBHQ saved again");
      await screen.findByText(
        "WBHQ saved again",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      await flush();

      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
      expect(countDetailFetches()).toBe(3);
    },
  );

  it("a refused save keeps the dialog open with the reason, and the card as it was", async () => {
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockRejectedValue(
      new Error("You do not have permission to edit this probe."),
    );

    render(<ProbePage placement="modelDetailProps" />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();

    await saveFromDialog("WBHQ never saved");
    probeNameOnServer = "WBHQ";

    await screen.findByText(
      "You do not have permission to edit this probe.",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await flush();

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.queryByText("WBHQ never saved")).toBeNull();
    // Nothing was saved, so nothing is read again.
    expect(countDetailFetches()).toBe(1);
  });
});

describe("ModelDetail's refresher", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    getItemMock.mockImplementation((data: any) => {
      const probe: Probe = new Probe();
      probe.id = new ObjectID(data.id.toString());
      probe.name = "WBHQ";
      return Promise.resolve(probe);
    });
  });

  type DetailWithRefresherProps = { refresher: number };

  const DetailWithRefresher: React.FunctionComponent<
    DetailWithRefresherProps
  > = (props: DetailWithRefresherProps): React.ReactElement => {
    return (
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail"
        modelId={new ObjectID(PROBE_ID)}
        refresher={props.refresher}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FieldType.Text,
          },
        ]}
      />
    );
  };

  it("reads again each time a count goes up, and not when it stays", async () => {
    const { rerender } = render(<DetailWithRefresher refresher={0} />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    rerender(<DetailWithRefresher refresher={1} />);
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(2);

    // Two reasons at once are still a change, where two flips are not.
    rerender(<DetailWithRefresher refresher={3} />);
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(3);

    rerender(<DetailWithRefresher refresher={3} />);
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(3);
  });
});
