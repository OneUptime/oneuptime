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
import React, { FunctionComponent } from "react";
import { MemoryRouter } from "react-router-dom";
import LogDropFilterView from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/DropFilterView";
import TraceDropFilterView from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/DropFilterView";
import { DROP_FILTER_EDIT_ACTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/DropFilterForm";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

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

/*
 * A drop filter's own page, its Action card.
 *
 * Its Edit dialog asked again with a dropdown of its own - "Drop — Discard
 * all matching logs", "Sample — Keep a percentage of matching logs" - beside
 * a Sample Percentage box shown for Drop too, under "Required when Action is
 * Sample". It asks with the create form's fields now (DropFilterForm's
 * getDropFilterActionFields): Drop or Sample, each with its line, and the
 * share to keep only under Sample.
 */

const WAIT_TIMEOUT: number = 20000;

// The details card's own edit button.
const DETAILS_EDIT_BUTTON: RegExp = /^Edit (Log|Trace) Drop Filter$/;
const FILTER_ID: string = "77777777-7777-4777-8777-777777777777";

interface ViewPage {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  modelType: { new (): BaseModel };
  path: string;
  noun: string;
}

const VIEW_PAGES: Array<ViewPage> = [
  {
    name: "a log drop filter's page",
    Page: LogDropFilterView,
    modelType: LogDropFilter,
    path: `/dashboard/${PROJECT_ID}/logs/settings/drop-filters/${FILTER_ID}`,
    noun: "log",
  },
  {
    name: "a trace drop filter's page",
    Page: TraceDropFilterView,
    modelType: TraceDropFilter,
    path: `/dashboard/${PROJECT_ID}/traces/settings/drop-filters/${FILTER_ID}`,
    noun: "span",
  },
];

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

function storedFilter(
  modelType: { new (): BaseModel },
  data: JSONObject,
): BaseModel {
  return Object.assign(new modelType(), {
    _id: FILTER_ID,
    id: new ObjectID(FILTER_ID),
    name: "Noisy records",
    isEnabled: true,
    filterQuery: "severityText = 'Debug'",
    ...data,
  });
}

function renderPage(page: ViewPage): void {
  goTo(page.path);

  render(
    <MemoryRouter initialEntries={[page.path]}>
      <page.Page
        pageRoute={new Route(page.path)}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function openActionEdit(): Promise<HTMLElement> {
  const title: HTMLElement = await screen.findByText(
    "Action",
    { selector: "h2" },
    { timeout: WAIT_TIMEOUT },
  );
  const card: HTMLElement = title.closest(
    '[data-testid="card"]',
  ) as HTMLElement;

  expect(card).not.toBeNull();

  const edit: HTMLElement = await within(card).findByRole(
    "button",
    { name: /^Edit/ },
    { timeout: WAIT_TIMEOUT },
  );

  fireEvent.click(edit);

  return await screen.findByTestId("modal", {}, { timeout: WAIT_TIMEOUT });
}

beforeEach(() => {
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(OWNER_PERMISSIONS);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);

  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}) as unknown as Awaited<
        ReturnType<typeof ModelAPI.createOrUpdate>
      >,
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(VIEW_PAGES)("$name", (page: ViewPage) => {
  test("the Action card's button and dialog say Edit Action, apart from the details card's", async () => {
    /*
     * Both cards on the page said "Edit Log Drop Filter" (or Trace), one
     * opening the name and description, the other the action.
     */
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<BaseModel> => {
        return storedFilter(page.modelType, { action: "drop" });
      });

    renderPage(page);

    const modal: HTMLElement = await openActionEdit();

    expect(DROP_FILTER_EDIT_ACTION_TITLE).toBe("Edit Action");
    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      /^Edit Action$/,
    );

    const editButtons: Array<string> = screen
      .getAllByRole("button", { name: /^Edit/ })
      .map((button: HTMLElement): string => {
        return (button.textContent || "").trim();
      });

    // One Edit Action, on the Action card; the details card keeps its own.
    expect(
      editButtons.filter((text: string): boolean => {
        return text === "Edit Action";
      }),
    ).toHaveLength(1);
    expect(
      editButtons.some((text: string): boolean => {
        return DETAILS_EDIT_BUTTON.test(text);
      }),
    ).toBe(true);
  });

  test("edits the action with the create form's two answers, each with its line", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<BaseModel> => {
        return storedFilter(page.modelType, { action: "drop" });
      });

    renderPage(page);
    const modal: HTMLElement = await openActionEdit();

    const action: HTMLElement = await within(modal).findByRole(
      "radiogroup",
      { name: /^Action/ },
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(action).getByRole("radio", { name: "Drop" })).toBeChecked();
    expect(
      within(action).getByRole("radio", { name: "Sample" }),
    ).not.toBeChecked();
    expect(
      within(modal).getByText(`Discards every matching ${page.noun} for good.`),
    ).toBeInTheDocument();

    // Not the old dropdown, and no share to keep for a filter that drops.
    expect(within(modal).queryByRole("combobox")).toBeNull();
    expect(within(modal).queryByText(/Discard all matching/)).toBeNull();
    expect(
      within(modal).queryByRole("spinbutton", { name: /^Sample Percentage/ }),
    ).toBeNull();
  });

  test("turns a dropping filter into a sampling one, asking for the share only then", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<BaseModel> => {
        return storedFilter(page.modelType, { action: "drop" });
      });

    renderPage(page);
    const modal: HTMLElement = await openActionEdit();
    const action: HTMLElement = await within(modal).findByRole(
      "radiogroup",
      { name: /^Action/ },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(within(action).getByRole("radio", { name: "Sample" }));

    const share: HTMLElement = await within(modal).findByRole(
      "spinbutton",
      { name: /^Sample Percentage/ },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.change(share, { target: { value: "25" } });

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(
      () => {
        expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const model: Record<string, unknown> = (
      createOrUpdateSpy.mock.calls[0]![0] as {
        model: Record<string, unknown>;
      }
    ).model;

    expect(model["action"]).toBe("sample");
    expect(Number(model["samplePercentage"])).toBe(25);
  });

  test("opens a sampling filter on Sample, with its share", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<BaseModel> => {
        return storedFilter(page.modelType, {
          action: "sample",
          samplePercentage: 10,
        });
      });

    renderPage(page);
    const modal: HTMLElement = await openActionEdit();
    const action: HTMLElement = await within(modal).findByRole(
      "radiogroup",
      { name: /^Action/ },
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(action).getByRole("radio", { name: "Sample" })).toBeChecked();
    expect(
      await within(modal).findByRole(
        "spinbutton",
        { name: /^Sample Percentage/ },
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveValue(10);
  });
});
