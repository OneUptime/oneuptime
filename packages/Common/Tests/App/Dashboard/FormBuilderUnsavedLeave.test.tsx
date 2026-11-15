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
import React, { act, FunctionComponent, ReactElement } from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Leaving a form's builder with unsaved questions (issue #7401). The
 * questions are a draft until Save Changes, and only closing or reloading
 * the tab asked first (the builder's own beforeunload listener): a click in
 * the side menu, a crumb or the browser's Back button dropped the draft
 * without a word. Now, while the questions differ from the saved ones:
 *
 *   - the side menu (any link into the app) and Back ask first, in the
 *     dashboard's words: "Leave without saving?", Keep Editing stays,
 *     Discard Changes leaves;
 *   - closing or reloading the tab asks through the browser, once - the
 *     leave guard's question, the builder's own listener gone;
 *   - a new version of OneUptime does not reload the page under them.
 *
 * Nothing asks for a builder left as it was, a change undone, or after
 * Save Changes or the builder's own Discard Changes; a refused save keeps
 * asking.
 *
 * The real form page (Pages/Forms/View/Build), its builder and a side menu
 * entry run inside a real BrowserRouter on jsdom's history. The network,
 * the permission gate, the preview and the name-and-description dialog are
 * stubbed, as FormBuilderUi.test.tsx stubs them.
 */

jest.setTimeout(120000);

const PROJECT_ID: string = "66666666-6666-4666-8666-666666666661";
const FORM_ID: string = "66666666-6666-4666-8666-666666666662";
const FORMS_PATH: string = `/dashboard/${PROJECT_ID}/forms`;
const FORM_PATH: string = `${FORMS_PATH}/${FORM_ID}`;
const MONITORS_PATH: string = `/dashboard/${PROJECT_ID}/monitors`;

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData",
  () => {
    return {
      __esModule: true,
      loadFormCustomFields: async (): Promise<Array<unknown>> => {
        return [];
      },
      loadFormRecordOptions: async (): Promise<Array<unknown>> => {
        return [];
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormPreviewModal",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", { "data-testid": "stub-preview" });
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "stub-details" });
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import FormBuild from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Build";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Form from "../../../Models/DatabaseModels/Form";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { afterHistorySteps } from "../../Helpers/HistorySteps";

const LEAVE_TITLE: string = "Leave without saving?";
const LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this form's questions. If you leave now, they will be lost.";
// The dashboard's question, which the builder's must not borrow.
const DASHBOARD_LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you leave now, they will be lost.";

const OWN_QUESTION: FormField = {
  id: "office",
  source: FormFieldSource.Question,
  type: CustomFieldType.Dropdown,
  label: "Which office?",
  dropdownOptions: "Berlin\nLondon",
  isRequired: false,
};

/*
 * An incident form's starting questions, with ids that stay put from one
 * call to the next, and a question of its own.
 */
function storedFields(): Array<FormField> {
  return [
    ...getDefaultFormFields(FormTargetType.Incident).map(
      (field: FormField): FormField => {
        return {
          ...field,
          id: (
            field.targetField ||
            field.submitterField ||
            field.id
          ).toLowerCase(),
        };
      },
    ),
    OWN_QUESTION,
  ];
}

let refuseSaves: boolean = false;

/*
 * The app around the builder, as the Dashboard app draws it: the router's
 * navigate handed to Navigation (App.tsx), a side menu entry for another
 * page, and the pages themselves.
 */
const AppShell: FunctionComponent = (): ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());

  return (
    <div>
      <nav aria-label="Side menu">
        <SideMenuItem
          link={{ title: "Monitors", to: new Route(MONITORS_PATH) }}
        />
      </nav>
      <Routes>
        <RouterRoute
          path="/dashboard/:projectId/forms"
          element={<p>All forms</p>}
        />
        <RouterRoute
          path="/dashboard/:projectId/forms/:id"
          element={
            <FormBuild
              pageRoute={RouteMap[PageMap.FORM_VIEW] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
        <RouterRoute
          path="/dashboard/:projectId/monitors"
          element={<p>All monitors</p>}
        />
      </Routes>
    </div>
  );
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 8; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

/*
 * The forms list, then the form opened from it: Back from the builder has
 * a page of the app to go to.
 */
async function openBuilderFromList(): Promise<void> {
  render(
    <BrowserRouter useTransitions={false}>
      <AppShell />
    </BrowserRouter>,
  );

  expect(screen.getByText("All forms")).toBeInTheDocument();

  await act(async () => {
    Navigation.navigate(new Route(FORM_PATH));
  });
  await waitFor(() => {
    expect(screen.getByTestId("form-canvas")).toBeInTheDocument();
  });
  await settle();
}

// The questions on the canvas, in order, by id.
function questionIds(): Array<string> {
  return Array.from(
    screen
      .getByTestId("form-questions")
      .querySelectorAll('[data-testid^="form-question-"][data-selected]'),
  ).map((element: Element): string => {
    return (element.getAttribute("data-testid") || "").replace(
      "form-question-",
      "",
    );
  });
}

function saveChangesButton(): HTMLElement {
  const button: HTMLElement | undefined = screen
    .queryAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(FormsCopy.saveChanges);
    });

  expect(button).toBeDefined();
  return button!;
}

function queryLeaveDialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: LEAVE_TITLE });
}

function browserAsksBeforeUnload(): boolean {
  const event: Event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

async function addTextQuestion(): Promise<void> {
  const before: number = questionIds().length;

  await click(screen.getByTestId("form-palette-question-Text"));

  expect(questionIds()).toHaveLength(before + 1);
}

async function clickSideMenuMonitors(): Promise<void> {
  await act(async () => {
    // The side menu's entry: an incident form asks about monitors too.
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Side menu" })).getByText(
        "Monitors",
      ),
    );
  });
  await settle();
}

async function pressBrowserBack(): Promise<void> {
  await act(async () => {
    window.history.back();
  });
  // The step, the guard's step back in the next frame, and what followed.
  await act(async () => {
    await afterHistorySteps();
  });
  await settle();
}

async function answer(
  button: "Keep Editing" | "Discard Changes",
): Promise<void> {
  await act(async () => {
    fireEvent.click(within(queryLeaveDialog()!).getByText(button));
  });
  await settle();
}

beforeEach(() => {
  LeaveGuard.reset();
  UnsavedChanges.reset();
  window.history.replaceState(null, "", FORMS_PATH);

  refuseSaves = false;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const form: Form = new Form();
    form._id = FORM_ID;
    form.name = "Report a Problem";
    form.description = "Tell us what is wrong.";
    form.targetType = FormTargetType.Incident;
    form.fields = JSON.parse(JSON.stringify(storedFields()));
    form.targetSettings = {} as never;
    return form;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    if (refuseSaves) {
      throw new Error("Questions: two questions ask for the same field.");
    }

    return {};
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(async () => {
  cleanup();
  LeaveGuard.reset();
  UnsavedChanges.reset();
  jest.restoreAllMocks();
  // A history step still in flight lands before the next test.
  await settle();
});

describe("a form's questions left as they were", () => {
  test("the side menu leaves at once, and nothing asks", async () => {
    await openBuilderFromList();

    expect(questionIds()).toHaveLength(storedFields().length);
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITORS_PATH);
  });

  test("Back leaves at once, and nothing asks", async () => {
    await openBuilderFromList();

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All forms")).toBeInTheDocument();
    expect(window.location.pathname).toBe(FORMS_PATH);
  });

  test("a question moved down and back up leaves nothing unsaved", async () => {
    await openBuilderFromList();
    const first: string = questionIds()[0]!;

    await click(screen.getByTestId(`form-question-move-down-${first}`));
    expect(questionIds()[1]).toBe(first);
    expect(browserAsksBeforeUnload()).toBe(true);

    await click(screen.getByTestId(`form-question-move-up-${first}`));
    expect(questionIds()[0]).toBe(first);
    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });
});

describe("a form with an unsaved question", () => {
  test("the side menu asks first, in its own words, and the page stays", async () => {
    await openBuilderFromList();
    await addTextQuestion();

    await clickSideMenuMonitors();

    const dialog: HTMLElement | null = queryLeaveDialog();
    expect(dialog).not.toBeNull();
    expect(within(dialog!).getByText(LEAVE_DESCRIPTION)).toBeInTheDocument();
    expect(within(dialog!).queryByText(DASHBOARD_LEAVE_DESCRIPTION)).toBeNull();
    expect(within(dialog!).getByText("Keep Editing")).toBeInTheDocument();
    expect(within(dialog!).getByText("Discard Changes")).toBeInTheDocument();

    // Nothing has moved yet.
    expect(screen.queryByText("All monitors")).toBeNull();
    expect(window.location.pathname).toBe(FORM_PATH);
    expect(questionIds()).toHaveLength(storedFields().length + 1);
  });

  test("Keep Editing stays with the draft; the next try asks again", async () => {
    await openBuilderFromList();
    await addTextQuestion();
    await clickSideMenuMonitors();

    await answer("Keep Editing");

    expect(queryLeaveDialog()).toBeNull();
    expect(window.location.pathname).toBe(FORM_PATH);
    expect(questionIds()).toHaveLength(storedFields().length + 1);
    expect(screen.getByTestId("form-builder-status")).toHaveTextContent(
      FormsCopy.unsavedChanges,
    );

    await clickSideMenuMonitors();
    expect(queryLeaveDialog()).not.toBeNull();
  });

  test("Discard Changes goes where the side menu was going, and saves nothing", async () => {
    await openBuilderFromList();
    await addTextQuestion();
    await clickSideMenuMonitors();

    await answer("Discard Changes");

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITORS_PATH);
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("Back asks first, and the draft and its address stay", async () => {
    await openBuilderFromList();
    await addTextQuestion();

    await pressBrowserBack();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(FORM_PATH);
    expect(screen.queryByText("All forms")).toBeNull();
    expect(questionIds()).toHaveLength(storedFields().length + 1);
  });

  test("Keep Editing after Back stays; Back again asks again", async () => {
    await openBuilderFromList();
    await addTextQuestion();
    await pressBrowserBack();

    await answer("Keep Editing");

    expect(window.location.pathname).toBe(FORM_PATH);
    expect(questionIds()).toHaveLength(storedFields().length + 1);

    await pressBrowserBack();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(FORM_PATH);
  });

  test("Discard Changes after Back goes back", async () => {
    await openBuilderFromList();
    await addTextQuestion();
    await pressBrowserBack();

    await answer("Discard Changes");

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All forms")).toBeInTheDocument();
    expect(window.location.pathname).toBe(FORMS_PATH);
  });

  test("a question deleted asks", async () => {
    await openBuilderFromList();

    await click(screen.getByTestId("form-question-select-office"));
    await click(screen.getByTestId("form-question-delete-office"));
    expect(questionIds()).not.toContain("office");

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).not.toBeNull();
  });

  test("closing or reloading the tab asks through the browser, and a new version waits", async () => {
    await openBuilderFromList();

    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await addTextQuestion();

    expect(browserAsksBeforeUnload()).toBe(true);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("the tab's question is the leave guard's alone: the builder adds no listener of its own", async () => {
    const added: Array<string> = [];
    const addEventListener: typeof window.addEventListener =
      window.addEventListener.bind(window);
    getJestSpyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      added.push(type);
      addEventListener(type, listener, options);
    }) as never);

    await openBuilderFromList();
    added.length = 0;

    await addTextQuestion();

    // The guard's, held while the draft is unsaved - and no other.
    expect(
      added.filter((type: string): boolean => {
        return type === "beforeunload";
      }),
    ).toEqual(["beforeunload"]);
  });
});

describe("after Save Changes or the builder's Discard Changes", () => {
  test("saved questions leave at once: the side menu asks nothing", async () => {
    await openBuilderFromList();
    await addTextQuestion();

    await click(saveChangesButton());

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("form-builder-status")).toHaveTextContent(
      FormsCopy.savedChanges,
    );
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("saved questions: Back asks nothing", async () => {
    await openBuilderFromList();
    await addTextQuestion();
    await click(saveChangesButton());

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All forms")).toBeInTheDocument();
  });

  test("the builder's own Discard Changes puts the questions back, and then nothing asks", async () => {
    await openBuilderFromList();
    await addTextQuestion();

    await click(screen.getByTestId("form-builder-discard"));

    expect(questionIds()).toHaveLength(storedFields().length);
    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a save that is refused keeps asking: the questions are still unsaved", async () => {
    refuseSaves = true;

    await openBuilderFromList();
    await addTextQuestion();

    await click(saveChangesButton());

    expect(screen.getByTestId("form-builder-save-error")).toHaveTextContent(
      "Questions: two questions ask for the same field.",
    );
    expect(browserAsksBeforeUnload()).toBe(true);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(FORM_PATH);
  });
});
