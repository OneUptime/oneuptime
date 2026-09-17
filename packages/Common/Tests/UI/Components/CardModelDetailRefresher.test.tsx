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
     * modelDetailProps is spread after CardModelDetail's own refresher, so a
     * refresher there wins. Only that one toggles here, so the refetch can
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
