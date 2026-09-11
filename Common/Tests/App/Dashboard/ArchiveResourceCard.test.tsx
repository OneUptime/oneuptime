import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import { Mock } from "jest-mock";
import ArchiveResourceCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

interface ArchiveState {
  isArchived: boolean;
}

interface ResourceCase {
  name: string;
  modelType: { new (): BaseModel };
  modelId: ObjectID;
  listRoute: Route;
  singularName: string;
  editPermission: Permission;
  readPermission: Permission;
  deletePermission: Permission;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const getItemMock: Mock<(args: unknown) => Promise<ArchiveState | null>> =
  jest.fn<(args: unknown) => Promise<ArchiveState | null>>();
const updateByIdMock: Mock<(args: unknown) => Promise<void>> =
  jest.fn<(args: unknown) => Promise<void>>();
const navigateMock: Mock<(route: Route) => void> = jest.fn<(route: Route) => void>();
const friendlyMessageMock: Mock<(error: unknown) => string> =
  jest.fn<(error: unknown) => string>();
let permissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (args: unknown): Promise<ArchiveState | null> => {
        return getItemMock(args);
      },
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (route: Route): void => {
        navigateMock(route);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return friendlyMessageMock(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissions;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const RESOURCE_CASES: Array<ResourceCase> = [
  {
    name: "RUM application",
    modelType: RumApplication,
    modelId: new ObjectID("11111111-0000-4000-8000-000000000001"),
    listRoute: new Route("/dashboard/project/rum/applications"),
    singularName: "application",
    editPermission: Permission.EditRumApplication,
    readPermission: Permission.ReadRumApplication,
    deletePermission: Permission.DeleteRumApplication,
  },
  {
    name: "cloud resource",
    modelType: CloudResource,
    modelId: new ObjectID("22222222-0000-4000-8000-000000000002"),
    listRoute: new Route("/dashboard/project/cloud/resources"),
    singularName: "cloud environment",
    editPermission: Permission.EditCloudResource,
    readPermission: Permission.ReadCloudResource,
    deletePermission: Permission.DeleteCloudResource,
  },
  {
    name: "serverless function",
    modelType: ServerlessFunction,
    modelId: new ObjectID("33333333-0000-4000-8000-000000000003"),
    listRoute: new Route("/dashboard/project/serverless/functions"),
    singularName: "function",
    editPermission: Permission.EditServerlessFunction,
    readPermission: Permission.ReadServerlessFunction,
    deletePermission: Permission.DeleteServerlessFunction,
  },
];

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return { promise: promise, resolve: resolvePromise };
}

async function renderCard(resource: ResourceCase): Promise<void> {
  render(<ArchiveResourceCard {...resource} />);
  await waitFor(() => {
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
}

function openConfirmation(action: "Archive" | "Unarchive"): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: action }));
  return screen.getByRole("dialog");
}

function submitConfirmation(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
}

beforeEach(() => {
  getItemMock.mockReset().mockResolvedValue({ isArchived: false });
  updateByIdMock.mockReset().mockResolvedValue(undefined);
  navigateMock.mockReset();
  friendlyMessageMock.mockReset().mockImplementation((error: unknown): string => {
    return error instanceof Error ? error.message : "Request failed";
  });
  permissions = [Permission.EditRumApplication];
});

afterEach(() => {
  cleanup();
});

// Exercise the real card, buttons, modal and model permission declarations.
// Only the server, navigation and signed-in permission snapshot are replaced.
describe.each(RESOURCE_CASES)("ArchiveResourceCard for a $name", (resource: ResourceCase) => {
  beforeEach(() => {
    permissions = [resource.editPermission];
  });

  test("loads its archive state and requires confirmation before archiving", async () => {
    await renderCard(resource);

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock).toHaveBeenCalledWith({
      modelType: resource.modelType,
      id: resource.modelId,
      select: { isArchived: true },
    });
    expect(screen.getByRole("heading", { name: `Archive ${resource.singularName}` })).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent("keeps collecting telemetry");
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();

    const dialog: HTMLElement = openConfirmation("Archive");
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(`Archive ${resource.singularName}`);
    expect(within(dialog).getByTestId("confirm-modal-description")).toHaveTextContent(
      `Are you sure you want to archive this ${resource.singularName}? It will be hidden from the list but will keep collecting telemetry.`,
    );
    expect(updateByIdMock).not.toHaveBeenCalled();

    submitConfirmation(dialog);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(resource.listRoute);
    });
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: resource.modelType,
      id: resource.modelId,
      data: { isArchived: true },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeEnabled();
  });

  test("restores an archived resource without leaving Settings", async () => {
    getItemMock.mockResolvedValue({ isArchived: true });
    await renderCard(resource);

    expect(screen.getByRole("heading", { name: `Unarchive ${resource.singularName}` })).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent("is archived and hidden from lists");
    expect(screen.getByTestId("card-description")).toHaveTextContent("still collecting telemetry");

    const dialog: HTMLElement = openConfirmation("Unarchive");
    expect(within(dialog).getByTestId("confirm-modal-description")).toHaveTextContent(
      `Are you sure you want to unarchive this ${resource.singularName}? It will reappear in the main list.`,
    );
    submitConfirmation(dialog);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: resource.modelType,
      id: resource.modelId,
      data: { isArchived: false },
    });
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test.each([false, true])("read permission alone cannot change archive state (archived: %s)", async (isArchived: boolean) => {
    permissions = [resource.readPermission];
    getItemMock.mockResolvedValue({ isArchived: isArchived });
    await renderCard(resource);

    const action: string = isArchived ? "Unarchive" : "Archive";
    const button: HTMLElement = screen.getByRole("button", { name: action });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByTestId("card-button-disabled-wrapper"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      `You do not have permission to update this ${resource.singularName}.`,
    );
  });

  test("delete permission does not substitute for update permission", async () => {
    permissions = [resource.deletePermission];
    await renderCard(resource);

    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("ArchiveResourceCard request and confirmation handling", () => {
  const resource: ResourceCase = RESOURCE_CASES[0]!;

  test("shows loading without an action until archive state arrives", async () => {
    const pending: Deferred<ArchiveState> = deferred<ArchiveState>();
    getItemMock.mockReturnValue(pending.promise);
    render(<ArchiveResourceCard {...resource} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ isArchived: true });
      await pending.promise;
    });

    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeEnabled();
  });

  test.each([false, true])("cancel closes confirmation without changing the resource (archived: %s)", async (isArchived: boolean) => {
    getItemMock.mockResolvedValue({ isArchived: isArchived });
    await renderCard(resource);

    const action: "Archive" | "Unarchive" = isArchived ? "Unarchive" : "Archive";
    const dialog: HTMLElement = openConfirmation(action);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: action })).toBeEnabled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("closing the confirmation never submits an archive request", async () => {
    await renderCard(resource);
    const dialog: HTMLElement = openConfirmation("Archive");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("waits for a successful save and prevents duplicate submissions", async () => {
    const pending: Deferred<void> = deferred<void>();
    updateByIdMock.mockReturnValue(pending.promise);
    await renderCard(resource);
    const dialog: HTMLElement = openConfirmation("Archive");
    submitConfirmation(dialog);

    expect(within(dialog).getByTestId("modal-footer-submit-button")).toBeDisabled();
    submitConfirmation(dialog);
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalledWith(resource.listRoute);
  });

  test("can archive and unarchive in place when no list route is supplied", async () => {
    render(<ArchiveResourceCard {...resource} listRoute={undefined} />);
    await screen.findByRole("button", { name: "Archive" });

    submitConfirmation(openConfirmation("Archive"));
    await screen.findByRole("button", { name: "Unarchive" });
    submitConfirmation(openConfirmation("Unarchive"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(updateByIdMock).toHaveBeenNthCalledWith(1, {
      modelType: resource.modelType,
      id: resource.modelId,
      data: { isArchived: true },
    });
    expect(updateByIdMock).toHaveBeenNthCalledWith(2, {
      modelType: resource.modelType,
      id: resource.modelId,
      data: { isArchived: false },
    });
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("uses the model name when no singular label is supplied", async () => {
    render(<ArchiveResourceCard {...resource} singularName={undefined} />);

    expect(await screen.findByRole("heading", {
      name: `Archive ${new RumApplication().singularName}`,
    })).toBeInTheDocument();
  });

  test("displays a failed state read without offering an archive action", async () => {
    const error: Error = new Error("Could not load archive status");
    getItemMock.mockRejectedValue(error);
    await renderCard(resource);

    expect(screen.getByText(error.message)).toBeInTheDocument();
    expect(friendlyMessageMock).toHaveBeenCalledWith(error);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test.each([false, true])("displays save failures and never navigates away (archived: %s)", async (isArchived: boolean) => {
    const error: Error = new Error("The archive update could not be saved");
    getItemMock.mockResolvedValue({ isArchived: isArchived });
    updateByIdMock.mockRejectedValue(error);
    await renderCard(resource);
    submitConfirmation(openConfirmation(isArchived ? "Unarchive" : "Archive"));

    expect(await screen.findByText(error.message)).toBeInTheDocument();
    expect(friendlyMessageMock).toHaveBeenCalledWith(error);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
