import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ProductAnalyticsEventRef,
  ProductAnalyticsRetentionPeriod,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  ProductAnalyticsFunnelDefinition,
  ProductAnalyticsSavedViewType,
} from "../../../Types/Rum/ProductAnalyticsSavedViews";
import { createTranslator, Translator } from "../../../Types/Translator";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import { SavedViewOption } from "../../../UI/Components/TelemetryViewer/types";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Saved funnels and saved retention tables on the Funnels and User
 * Retention pages' toolbar (issue #6630): the application's saved ones by
 * name, each opening what it keeps; "+ Save funnel", which keeps what is
 * on screen under a name; Edit (its name), Delete, and - on the open one,
 * once what is on screen is no longer what it keeps - Update. A link that
 * names a saved one is settled once the list is read: opened, kept as
 * named under the link's own definition, or let go with a sentence.
 *
 * The reads and writes are stood in for (ModelAPI), and so is the save
 * and rename dialog (ModelFormModal, whose own form is tested elsewhere):
 * what is asserted is what the menu hands each.
 */

const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<unknown>): unknown => {
        return deleteItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : String(error);
      },
    },
  };
});

interface FormModalStubProps {
  name: string;
  title: string;
  description?: string;
  submitButtonText?: string;
  modelIdToEdit?: ObjectID;
  onClose: () => void;
  onBeforeCreate?: (
    item: RumProductAnalyticsSavedView,
  ) => Promise<RumProductAnalyticsSavedView>;
  onSuccess?: (item: RumProductAnalyticsSavedView) => void;
  formProps: { formType: FormType; fields: Array<JSONObject> };
}

// The last save or rename dialog drawn, as the menu set it up.
let mockLastFormModal: FormModalStubProps | null = null;
let mockCreatedItem: RumProductAnalyticsSavedView | null = null;

function mockModelFormModal(props: FormModalStubProps): React.ReactElement {
  mockLastFormModal = props;

  return (
    <div data-testid={`form-modal-${props.name}`}>
      <p>{props.title}</p>
      <button
        type="button"
        onClick={() => {
          const item: RumProductAnalyticsSavedView =
            new RumProductAnalyticsSavedView();

          item.name = "Checkout funnel";

          void (async (): Promise<void> => {
            const created: RumProductAnalyticsSavedView = props.onBeforeCreate
              ? await props.onBeforeCreate(item)
              : item;

            created._id = NEW_VIEW_ID;
            mockCreatedItem = created;
            props.onSuccess?.(created);
          })();
        }}
      >
        Submit the form
      </button>
      <button type="button" onClick={props.onClose}>
        Close the form
      </button>
    </div>
  );
}

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: FormModalStubProps): React.ReactElement => {
      return mockModelFormModal(props);
    },
  };
});

import ProductAnalyticsSavedViewsMenu, {
  ComponentProps,
  settleProductAnalyticsAddressView,
  toProductAnalyticsSavedViewOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsSavedViewsMenu";
import {
  PRODUCT_ANALYTICS_SAVED_VIEW_WORDS,
  ProductAnalyticsSavedView,
  ProductAnalyticsSavedViewWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsSavedViews";

const PROJECT_ID: string = "6a302222-0000-4000-8000-000000000001";
const APP_ID: string = "6a302222-0000-4000-8000-000000000002";
const SIGN_UP_VIEW_ID: string = "6a302222-0000-4000-8000-000000000003";
const CHECKOUT_VIEW_ID: string = "6a302222-0000-4000-8000-000000000004";
const BROKEN_VIEW_ID: string = "6a302222-0000-4000-8000-000000000005";
const NEW_VIEW_ID: string = "6a302222-0000-4000-8000-000000000006";
const TEST_ID: string = "product-analytics-funnels-saved";

const DAY_MS: number = 24 * 60 * 60 * 1000;

const english: Translator = createTranslator(undefined, "en");

const SIGN_UP: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Signed up",
};
const PURCHASED: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Purchased",
};
const SESSION: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Session,
  name: "",
};

const SIGN_UP_FUNNEL: ProductAnalyticsFunnelDefinition = {
  steps: [SESSION, SIGN_UP],
  windowMs: DAY_MS,
  filters: [],
};
const CHECKOUT_FUNNEL: ProductAnalyticsFunnelDefinition = {
  steps: [SIGN_UP, PURCHASED],
  windowMs: 7 * DAY_MS,
  filters: [],
};

type FunnelView =
  ProductAnalyticsSavedView<ProductAnalyticsSavedViewType.Funnel>;

function savedRow(data: {
  id: string;
  name: string;
  definition: unknown;
}): RumProductAnalyticsSavedView {
  const row: RumProductAnalyticsSavedView = new RumProductAnalyticsSavedView(
    new ObjectID(data.id),
  );

  row.name = data.name;
  row.viewType = ProductAnalyticsSavedViewType.Funnel;
  row.definition = data.definition as JSONObject;
  row.rumApplicationId = new ObjectID(APP_ID);

  return row;
}

const SIGN_UP_ROW: RumProductAnalyticsSavedView = savedRow({
  id: SIGN_UP_VIEW_ID,
  name: "Sign-up",
  definition: SIGN_UP_FUNNEL,
});
const CHECKOUT_ROW: RumProductAnalyticsSavedView = savedRow({
  id: CHECKOUT_VIEW_ID,
  name: "Checkout",
  definition: CHECKOUT_FUNNEL,
});
// Written by a script, in a shape this version does not read.
const BROKEN_ROW: RumProductAnalyticsSavedView = savedRow({
  id: BROKEN_VIEW_ID,
  name: "From the API",
  definition: { steps: "signup" },
});

function listAnswer(rows: Array<RumProductAnalyticsSavedView>): unknown {
  return { data: rows, count: rows.length, skip: 0, limit: 100 };
}

function view(
  row: RumProductAnalyticsSavedView,
  definition: ProductAnalyticsFunnelDefinition | null,
): FunnelView {
  return {
    id: row._id!.toString(),
    name: row.name!,
    rumApplicationId: APP_ID,
    viewType: ProductAnalyticsSavedViewType.Funnel,
    definition: definition,
    problem: definition ? null : "unreadable",
  };
}

interface Callbacks {
  onOpen: MockFunction;
  onSelect: MockFunction;
  onNotice: MockFunction;
  onSettled: MockFunction;
}

let callbacks: Callbacks;

type GateAnswers = Record<ModelAction, PermissionGateResult>;

function allow(): GateAnswers {
  return {
    [ModelAction.Read]: { isAllowed: true },
    [ModelAction.Create]: { isAllowed: true },
    [ModelAction.Update]: { isAllowed: true },
    [ModelAction.Delete]: { isAllowed: true },
  };
}

function setGates(answers: GateAnswers): void {
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (...args: Array<unknown>): PermissionGateResult => {
      return answers[args[1] as ModelAction];
    },
  );
}

function menuProps(
  overrides?: Partial<ComponentProps<ProductAnalyticsSavedViewType.Funnel>>,
): ComponentProps<ProductAnalyticsSavedViewType.Funnel> {
  return {
    rumApplicationId: new ObjectID(APP_ID),
    viewType: ProductAnalyticsSavedViewType.Funnel,
    definition: SIGN_UP_FUNNEL,
    savedViewId: null,
    isDefinitionInAddress: false,
    isSettled: false,
    onOpen: callbacks.onOpen as unknown as (view: FunnelView) => void,
    onSelect: callbacks.onSelect as unknown as (id: string | null) => void,
    onNotice: callbacks.onNotice as unknown as (notice: string | null) => void,
    onSettled: callbacks.onSettled as unknown as () => void,
    dataTestId: TEST_ID,
    ...overrides,
  };
}

function renderMenu(
  overrides?: Partial<ComponentProps<ProductAnalyticsSavedViewType.Funnel>>,
): ReturnType<typeof render> {
  return render(<ProductAnalyticsSavedViewsMenu {...menuProps(overrides)} />);
}

function trigger(): HTMLElement {
  return within(screen.getByTestId(TEST_ID)).getAllByRole("button")[0]!;
}

async function openPanel(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(trigger());
  });

  return screen.getByRole("dialog", { name: "Saved funnels" });
}

async function waitForListRead(times: number = 1): Promise<void> {
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalledTimes(times);
  });
}

beforeEach(() => {
  getListMock.mockReset();
  updateByIdMock.mockReset();
  deleteItemMock.mockReset();
  getListMock.mockResolvedValue(
    listAnswer([CHECKOUT_ROW, BROKEN_ROW, SIGN_UP_ROW]),
  );
  updateByIdMock.mockResolvedValue(undefined);
  deleteItemMock.mockResolvedValue(undefined);
  mockLastFormModal = null;
  mockCreatedItem = null;
  callbacks = {
    onOpen: getJestMockFunction(),
    onSelect: getJestMockFunction(),
    onNotice: getJestMockFunction(),
    onSettled: getJestMockFunction(),
  };
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  setGates(allow());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the dropdown's rows", () => {
  const views: Array<FunnelView> = [
    view(SIGN_UP_ROW, SIGN_UP_FUNNEL),
    view(CHECKOUT_ROW, CHECKOUT_FUNNEL),
    view(BROKEN_ROW, null),
  ];

  test("each saved view by its name; the open one changed once the screen differs", () => {
    const options: Array<SavedViewOption> = toProductAnalyticsSavedViewOptions({
      views: views,
      savedViewId: SIGN_UP_VIEW_ID,
      definition: CHECKOUT_FUNNEL,
      translator: english,
    });

    expect(
      options.map((option: SavedViewOption): string => {
        return option.name;
      }),
    ).toEqual(["Sign-up (changed)", "Checkout", "From the API"]);
    expect(
      options.map((option: SavedViewOption): string => {
        return option.id;
      }),
    ).toEqual([SIGN_UP_VIEW_ID, CHECKOUT_VIEW_ID, BROKEN_VIEW_ID]);
  });

  test("the open one is not changed while the screen shows what it keeps, or nothing yet", () => {
    for (const definition of [SIGN_UP_FUNNEL, null]) {
      expect(
        toProductAnalyticsSavedViewOptions({
          views: views,
          savedViewId: SIGN_UP_VIEW_ID,
          definition: definition,
          translator: english,
        })[0]?.name,
      ).toBe("Sign-up");
    }

    // Another one differing from the screen is not the open one: no mark.
    expect(
      toProductAnalyticsSavedViewOptions({
        views: views,
        savedViewId: null,
        definition: CHECKOUT_FUNNEL,
        translator: english,
      })[0]?.name,
    ).toBe("Sign-up");
  });

  test("one this version cannot read says so under its name", () => {
    const options: Array<SavedViewOption> = toProductAnalyticsSavedViewOptions({
      views: views,
      savedViewId: null,
      definition: SIGN_UP_FUNNEL,
      translator: english,
    });

    expect(options[2]?.detail).toBe("Cannot be opened");
    expect(options[0]?.detail).toBeUndefined();
    expect(options[1]?.detail).toBeUndefined();
  });
});

describe("the saved view a link names, once the list is read", () => {
  const words: ProductAnalyticsSavedViewWords =
    PRODUCT_ANALYTICS_SAVED_VIEW_WORDS[ProductAnalyticsSavedViewType.Funnel];
  const views: Array<FunnelView> = [
    view(SIGN_UP_ROW, SIGN_UP_FUNNEL),
    view(BROKEN_ROW, null),
  ];

  test("none named: nothing to settle", () => {
    expect(
      settleProductAnalyticsAddressView({
        savedViewId: null,
        isDefinitionInAddress: false,
        views: views,
        words: words,
      }),
    ).toEqual({ kind: "none" });
  });

  test("named alone (a widget's link): opened", () => {
    expect(
      settleProductAnalyticsAddressView({
        savedViewId: SIGN_UP_VIEW_ID,
        isDefinitionInAddress: false,
        views: views,
        words: words,
      }),
    ).toEqual({ kind: "open", view: views[0] });
  });

  test("named beside a definition (a shared link): kept as named, the link's definition shown", () => {
    expect(
      settleProductAnalyticsAddressView({
        savedViewId: SIGN_UP_VIEW_ID,
        isDefinitionInAddress: true,
        views: views,
        words: words,
      }),
    ).toEqual({ kind: "keep" });
  });

  test("deleted, not this reader's, or unreadable: let go, saying so", () => {
    for (const savedViewId of [CHECKOUT_VIEW_ID, BROKEN_VIEW_ID]) {
      for (const isDefinitionInAddress of [false, true]) {
        expect(
          settleProductAnalyticsAddressView({
            savedViewId: savedViewId,
            isDefinitionInAddress: isDefinitionInAddress,
            views: views,
            words: words,
          }),
        ).toEqual({
          kind: "drop",
          notice:
            "The saved funnel this link opens was deleted, or you cannot see it.",
        });
      }
    }
  });

  test("a list that could not be read: let go, saying that", () => {
    expect(
      settleProductAnalyticsAddressView({
        savedViewId: SIGN_UP_VIEW_ID,
        isDefinitionInAddress: false,
        views: null,
        words: words,
      }),
    ).toEqual({ kind: "drop", notice: "Could not load the saved funnels." });
  });
});

describe("the menu on the toolbar", () => {
  test("reads the application's saved funnels, by name, as the page opens", async () => {
    renderMenu();
    await waitForListRead();

    const request: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;
    const query: JSONObject = request["query"] as JSONObject;

    expect((query["rumApplicationId"] as ObjectID).toString()).toBe(APP_ID);
    expect(query["viewType"]).toBe(ProductAnalyticsSavedViewType.Funnel);
    expect((query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);

    await waitFor(() => {
      expect(trigger()).toHaveTextContent("Saved funnels3");
    });
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(callbacks.onNotice).not.toHaveBeenCalled();
  });

  /*
   * It stands in the card's header beside the time range, at the time
   * range's header size - 38px, 42px on a phone - where a chip stood 30px.
   */
  test("its trigger is as tall as the header's time range beside it", async () => {
    renderMenu();
    await waitForListRead();
    await waitFor(() => {
      expect(trigger()).toHaveTextContent("Saved funnels3");
    });

    expect(trigger()).toHaveClass("px-3", "py-2.5", "md:py-2", "text-sm");
    expect(trigger()).not.toHaveClass("py-1.5", "text-xs");
  });

  test("reads the list again as it opens, so one saved in another tab is in it", async () => {
    renderMenu();
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    await waitForListRead(2);

    for (const name of ["Checkout", "From the API", "Sign-up"]) {
      expect(within(panel).getByRole("button", { name: name })).toBeVisible();
    }

    // The settle runs once, on the first read.
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
  });

  test("picking one opens what it keeps", async () => {
    renderMenu();
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Checkout" }));
    });

    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpen.mock.calls[0]![0]).toEqual(
      view(CHECKOUT_ROW, CHECKOUT_FUNNEL),
    );
    expect(callbacks.onNotice).toHaveBeenCalledWith(null);
  });

  test("picking one this version cannot read says so over the page, and opens nothing", async () => {
    renderMenu();
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    expect(within(panel).getByText("Cannot be opened")).toBeVisible();

    await act(async () => {
      fireEvent.click(
        within(panel).getByRole("button", { name: "From the API" }),
      );
    });

    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(callbacks.onNotice).toHaveBeenCalledWith(
      "From the API cannot be opened: reload the page, or delete it and save it again.",
    );
  });

  test("names the open one in the trigger, changed once the screen differs, and offers Update", async () => {
    const rendered: ReturnType<typeof render> = renderMenu({
      savedViewId: SIGN_UP_VIEW_ID,
      isSettled: true,
    });

    await waitForListRead();
    await waitFor(() => {
      expect(trigger()).toHaveTextContent("Sign-up");
    });

    // The same funnel on screen: nothing to update.
    let panel: HTMLElement = await openPanel();

    expect(within(panel).queryByRole("button", { name: "Update" })).toBeNull();

    rendered.rerender(
      <ProductAnalyticsSavedViewsMenu
        {...menuProps({
          savedViewId: SIGN_UP_VIEW_ID,
          isSettled: true,
          definition: CHECKOUT_FUNNEL,
        })}
      />,
    );

    expect(trigger()).toHaveTextContent("Sign-up (changed)");

    panel = screen.getByRole("dialog", { name: "Saved funnels" });

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Update" }));
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: JSONObject = updateByIdMock.mock.calls[0]![0] as JSONObject;

    expect((request["id"] as ObjectID).toString()).toBe(SIGN_UP_VIEW_ID);
    expect(request["data"]).toEqual({ definition: CHECKOUT_FUNNEL });

    // Read again, so the list shows what it now keeps.
    await waitForListRead(3);
    expect(callbacks.onNotice).toHaveBeenCalledWith(null);
  });

  test("an Update the server refuses says why over the page", async () => {
    updateByIdMock.mockRejectedValue(new Error("Plan upgrade needed."));

    renderMenu({
      savedViewId: SIGN_UP_VIEW_ID,
      isSettled: true,
      definition: CHECKOUT_FUNNEL,
    });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Update" }));
    });

    await waitFor(() => {
      expect(callbacks.onNotice).toHaveBeenCalledWith("Plan upgrade needed.");
    });
  });

  test("Clear view lets the open one go and leaves the screen as it is", async () => {
    renderMenu({ savedViewId: SIGN_UP_VIEW_ID, isSettled: true });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    await act(async () => {
      fireEvent.click(
        within(panel).getByRole("button", { name: /Clear view/ }),
      );
    });

    expect(callbacks.onSelect).toHaveBeenCalledWith(null);
    expect(callbacks.onOpen).not.toHaveBeenCalled();
  });
});

describe("saving what is on screen", () => {
  test("is not offered until the funnel is shown, and says so", async () => {
    renderMenu({ definition: null });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();
    const create: HTMLElement = within(panel).getByRole("button", {
      name: "+ Save funnel",
    });

    expect(create).toBeDisabled();
    expect(
      within(panel).getByText("Nothing to save until the funnel is shown."),
    ).toBeVisible();
  });

  test("keeps the funnel on screen under a name, for this application, and makes it the open one", async () => {
    renderMenu({ definition: CHECKOUT_FUNNEL });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    await act(async () => {
      fireEvent.click(
        within(panel).getByRole("button", { name: "+ Save funnel" }),
      );
    });

    expect(mockLastFormModal?.title).toBe("Save funnel");
    expect(mockLastFormModal?.submitButtonText).toBe("Save funnel");
    expect(mockLastFormModal?.description).toContain(
      "The time range is not saved.",
    );
    expect(mockLastFormModal?.formProps.formType).toBe(FormType.Create);

    const nameField: JSONObject = mockLastFormModal!.formProps.fields[0]!;

    expect(nameField["field"]).toEqual({ name: true });
    expect(nameField["placeholder"]).toBe("Sign-up to first purchase");
    expect(nameField["required"]).toBe(true);
    expect(nameField["validation"]).toEqual({ maxLength: 100 });

    getListMock.mockResolvedValue(
      listAnswer([CHECKOUT_ROW, BROKEN_ROW, SIGN_UP_ROW]),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit the form" }));
    });

    expect(mockCreatedItem?.name).toBe("Checkout funnel");
    expect(mockCreatedItem?.projectId?.toString()).toBe(PROJECT_ID);
    expect(mockCreatedItem?.rumApplicationId?.toString()).toBe(APP_ID);
    expect(mockCreatedItem?.viewType).toBe(
      ProductAnalyticsSavedViewType.Funnel,
    );
    expect(mockCreatedItem?.definition).toEqual(CHECKOUT_FUNNEL);

    await waitFor(() => {
      expect(callbacks.onSelect).toHaveBeenCalledWith(NEW_VIEW_ID);
    });
    expect(
      screen.queryByTestId(`form-modal-${TEST_ID}-save`),
    ).not.toBeInTheDocument();
    expect(callbacks.onNotice).toHaveBeenCalledWith(null);
  });

  test("a role that may not save sees why; a role whose permissions are still read sees nothing yet", async () => {
    setGates({
      ...allow(),
      [ModelAction.Create]: {
        isAllowed: false,
        disabledReason: "You need a role that can save funnels.",
      },
    });

    const first: ReturnType<typeof render> = renderMenu();

    await waitForListRead();

    let panel: HTMLElement = await openPanel();

    expect(
      within(panel).getByRole("button", { name: "+ Save funnel" }),
    ).toBeDisabled();
    expect(
      within(panel).getByText("You need a role that can save funnels."),
    ).toBeVisible();

    first.unmount();
    setGates({
      ...allow(),
      [ModelAction.Create]: { isAllowed: false },
    });
    renderMenu();
    await waitForListRead(3);

    panel = await openPanel();

    expect(
      within(panel).queryByRole("button", { name: "+ Save funnel" }),
    ).toBeNull();
  });
});

describe("renaming and deleting", () => {
  test("Edit renames that one, and the list is read again", async () => {
    renderMenu();
    await waitForListRead();

    const panel: HTMLElement = await openPanel();
    const checkoutRow: HTMLElement = within(panel)
      .getByRole("button", { name: "Checkout" })
      .closest("div") as HTMLElement;

    await act(async () => {
      fireEvent.click(
        within(checkoutRow).getByRole("button", { name: "Edit" }),
      );
    });

    expect(mockLastFormModal?.title).toBe("Rename saved funnel");
    expect(mockLastFormModal?.modelIdToEdit?.toString()).toBe(CHECKOUT_VIEW_ID);
    expect(mockLastFormModal?.formProps.formType).toBe(FormType.Update);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit the form" }));
    });

    await waitForListRead(3);
    expect(
      screen.queryByTestId(`form-modal-${TEST_ID}-rename`),
    ).not.toBeInTheDocument();
  });

  test("Delete asks first, names the widgets that show it, and lets the open one go", async () => {
    renderMenu({
      savedViewId: CHECKOUT_VIEW_ID,
      isSettled: true,
      definition: CHECKOUT_FUNNEL,
    });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();
    const checkoutRow: HTMLElement = within(panel)
      .getByRole("button", { name: "Checkout" })
      .closest("div") as HTMLElement;

    await act(async () => {
      fireEvent.click(
        within(checkoutRow).getByRole("button", { name: "Delete" }),
      );
    });

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Delete saved funnel",
    );
    expect(modal).toHaveTextContent("Checkout");
    expect(modal).toHaveTextContent(
      "Dashboard widgets that show it will say it was deleted.",
    );
    expect(deleteItemMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (
        (deleteItemMock.mock.calls[0]![0] as JSONObject)["id"] as ObjectID
      ).toString(),
    ).toBe(CHECKOUT_VIEW_ID);
    await waitFor(() => {
      expect(callbacks.onSelect).toHaveBeenCalledWith(null);
    });
    await waitForListRead(3);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("deleting another one leaves the open one open", async () => {
    renderMenu({ savedViewId: SIGN_UP_VIEW_ID, isSettled: true });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();
    const checkoutRow: HTMLElement = within(panel)
      .getByRole("button", { name: "Checkout" })
      .closest("div") as HTMLElement;

    await act(async () => {
      fireEvent.click(
        within(checkoutRow).getByRole("button", { name: "Delete" }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });
    await waitForListRead(3);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });

  test("a delete the server refuses says why in the dialog", async () => {
    deleteItemMock.mockRejectedValue(new Error("Not allowed."));

    renderMenu();
    await waitForListRead();

    const panel: HTMLElement = await openPanel();
    const checkoutRow: HTMLElement = within(panel)
      .getByRole("button", { name: "Checkout" })
      .closest("div") as HTMLElement;

    await act(async () => {
      fireEvent.click(
        within(checkoutRow).getByRole("button", { name: "Delete" }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent("Not allowed.");
    });
  });

  test("a role without update or delete sees neither", async () => {
    setGates({
      ...allow(),
      [ModelAction.Update]: { isAllowed: false, disabledReason: "No." },
      [ModelAction.Delete]: { isAllowed: false, disabledReason: "No." },
    });

    renderMenu({
      savedViewId: SIGN_UP_VIEW_ID,
      isSettled: true,
      definition: CHECKOUT_FUNNEL,
    });
    await waitForListRead();

    const panel: HTMLElement = await openPanel();

    for (const action of ["Edit", "Delete", "Update"]) {
      expect(within(panel).queryByRole("button", { name: action })).toBeNull();
    }
  });
});

describe("a list that could not be read", () => {
  test("says so in the panel, with Try again", async () => {
    getListMock.mockRejectedValue(new Error("offline"));

    renderMenu();
    await waitForListRead();
    await waitFor(() => {
      expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    });

    // No count: "0" would say there are none.
    expect(trigger()).toHaveTextContent(/^Saved funnels$/);

    const panel: HTMLElement = await openPanel();

    await waitForListRead(2);
    await waitFor(() => {
      expect(
        within(panel).getByTestId(`${TEST_ID}-not-loaded`),
      ).toHaveTextContent("Could not load the saved funnels.");
    });

    getListMock.mockResolvedValue(listAnswer([SIGN_UP_ROW]));

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    });

    await waitFor(() => {
      expect(
        within(panel).getByRole("button", { name: "Sign-up" }),
      ).toBeVisible();
    });
  });
});

describe("settling the link the page opened on", () => {
  test("a widget's link opens what the saved one keeps, then the page reads", async () => {
    renderMenu({ savedViewId: CHECKOUT_VIEW_ID, definition: null });

    await waitFor(() => {
      expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    });
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpen.mock.calls[0]![0]).toEqual(
      view(CHECKOUT_ROW, CHECKOUT_FUNNEL),
    );
    // Opened before the page is told it may read.
    expect(callbacks.onOpen.mock.invocationCallOrder[0]!).toBeLessThan(
      callbacks.onSettled.mock.invocationCallOrder[0]!,
    );
    expect(callbacks.onNotice).not.toHaveBeenCalled();
  });

  test("a shared link's own definition stays, under the saved one it names", async () => {
    renderMenu({
      savedViewId: CHECKOUT_VIEW_ID,
      isDefinitionInAddress: true,
      definition: SIGN_UP_FUNNEL,
    });

    await waitFor(() => {
      expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    });
    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("Checkout (changed)");
  });

  test("a link to one deleted, or not this reader's, says so and shows the default", async () => {
    renderMenu({
      savedViewId: "6a302222-0000-4000-8000-0000000000ff",
      definition: null,
    });

    await waitFor(() => {
      expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    });
    expect(callbacks.onOpen).not.toHaveBeenCalled();
    expect(callbacks.onSelect).toHaveBeenCalledWith(null);
    expect(callbacks.onNotice).toHaveBeenCalledWith(
      "The saved funnel this link opens was deleted, or you cannot see it.",
    );
  });

  test("a link whose list cannot be read says that, and the page reads its default", async () => {
    getListMock.mockRejectedValue(new Error("offline"));

    renderMenu({ savedViewId: CHECKOUT_VIEW_ID, definition: null });

    await waitFor(() => {
      expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    });
    expect(callbacks.onSelect).toHaveBeenCalledWith(null);
    expect(callbacks.onNotice).toHaveBeenCalledWith(
      "Could not load the saved funnels.",
    );
  });

  test("a menu drawn again once the page has settled lists, and leaves the page as it is", async () => {
    renderMenu({ savedViewId: CHECKOUT_VIEW_ID, isSettled: true });

    await waitForListRead();
    await waitFor(() => {
      expect(trigger()).toHaveTextContent("Checkout (changed)");
    });
    expect(callbacks.onSettled).not.toHaveBeenCalled();
    expect(callbacks.onOpen).not.toHaveBeenCalled();
  });

  test("a role that may not read saved views has no dropdown, and the link is still settled", async () => {
    setGates({
      ...allow(),
      [ModelAction.Read]: { isAllowed: false, disabledReason: "No." },
    });

    renderMenu({ savedViewId: CHECKOUT_VIEW_ID, definition: null });

    await waitFor(() => {
      expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId(TEST_ID)).not.toBeInTheDocument();
  });

  test("a retention table's menu reads saved retention tables", async () => {
    getListMock.mockResolvedValue(listAnswer([]));

    render(
      <ProductAnalyticsSavedViewsMenu
        rumApplicationId={new ObjectID(APP_ID)}
        viewType={ProductAnalyticsSavedViewType.Retention}
        definition={{
          startEvent: SIGN_UP,
          returnEvent: SESSION,
          period: ProductAnalyticsRetentionPeriod.Week,
          filters: [],
        }}
        savedViewId={null}
        isDefinitionInAddress={false}
        isSettled={false}
        onOpen={callbacks.onOpen as unknown as () => void}
        onSelect={callbacks.onSelect as unknown as () => void}
        onNotice={callbacks.onNotice as unknown as () => void}
        onSettled={callbacks.onSettled as unknown as () => void}
        dataTestId="product-analytics-retention-saved"
      />,
    );

    await waitForListRead();

    expect(
      ((getListMock.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
        "viewType"
      ],
    ).toBe(ProductAnalyticsSavedViewType.Retention);

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId("product-analytics-retention-saved"),
        ).getAllByRole("button")[0]!,
      );
    });

    const panel: HTMLElement = screen.getByRole("dialog", {
      name: "Saved retention tables",
    });

    expect(
      within(panel).getByText("No saved retention tables yet."),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "+ Save retention table" }),
    ).toBeEnabled();
  });
});
