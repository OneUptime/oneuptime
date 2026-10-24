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
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

// The notes as text: what the card hands the viewer is what is under test.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import ProjectAiContextCard from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiContextCard";
import AiContextView, {
  AI_CONTEXT_FADED_FRAME_CLASS_NAME,
  AI_CONTEXT_FOLDED_FRAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextView";
import {
  AI_CONTEXT_CARD_ANCHOR,
  AI_CONTEXT_CARD_COPY,
  AI_CONTEXT_TEST_IDS,
  getAiContextOutline,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextCopy";
import Project from "../../../Models/DatabaseModels/Project";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Icon from "../../../UI/Components/Icon/Icon";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Project Settings → AI → AI Features → AI context (issue #5198): what
 * OneUptime AI should know about the project's systems, read first by every
 * investigation, fix, postmortem draft and Ask AI chat. The card is
 * rendered for real here, with the model API and the permission snapshot
 * stubbed: what it reads, what it shows with notes and without, how a long
 * text folds, what its dialog asks and sends, and who may change it.
 */

const WAIT_TIMEOUT: number = 20000;

const AI_FEATURES_PATH: string = `/dashboard/${PROJECT_ID}/settings/ai-features`;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const NOTES: string =
  "## How our systems fit together\n\n- checkout-api serves the checkout page and depends on payments-db.";

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function openCard(): void {
  goTo(AI_FEATURES_PATH);
  render(
    <MemoryRouter initialEntries={[AI_FEATURES_PATH]}>
      <ProjectAiContextCard />
    </MemoryRouter>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function card(): Promise<HTMLElement> {
  const title: HTMLElement = await screen.findByText(
    AI_CONTEXT_CARD_COPY.cardTitle,
    { selector: "h2, h3, h4, h5, h6, span, div" },
    { timeout: WAIT_TIMEOUT },
  );

  return title.closest('[data-testid="card"]') as HTMLElement;
}

async function cardButton(name: string): Promise<HTMLElement> {
  return await screen.findByRole("button", { name }, { timeout: WAIT_TIMEOUT });
}

// The dialog's Markdown source, where a test types.
async function dialogSource(dialog: HTMLElement): Promise<HTMLTextAreaElement> {
  const editor: HTMLElement = await within(dialog).findByTestId(
    "project-ai-context-field",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  const toggle: HTMLElement | null = within(editor).queryByRole("button", {
    name: "Markdown",
  });

  if (toggle) {
    fireEvent.click(toggle);
  }

  return editor.querySelector("textarea") as HTMLTextAreaElement;
}

// The picture a button draws, by its path: a plus, a pencil.
function iconOf(element: HTMLElement): string | null {
  return element.querySelector("svg path")?.getAttribute("d") || null;
}

function iconPath(icon: IconProp): string | null {
  const drawn: { container: HTMLElement; unmount: () => void } = render(
    <Icon icon={icon} />,
  );
  const path: string | null = iconOf(drawn.container);
  drawn.unmount();
  return path;
}

function savedModels(): Array<Project> {
  return createOrUpdateSpy.mock.calls.map((call: Array<unknown>): Project => {
    return (call[0] as { model: Project }).model;
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  project = Object.assign(new Project(), { _id: PROJECT_ID });

  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return project;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the AI context card", () => {
  test("has its title, its line, and its place on the page", async () => {
    openCard();

    const found: HTMLElement = await card();

    expect(found).toHaveTextContent(AI_CONTEXT_CARD_COPY.cardDescription);
    expect(found).toHaveAttribute("id", AI_CONTEXT_CARD_ANCHOR);
  });

  test("reads the project it is on, and only its AI context", async () => {
    openCard();
    await card();

    await waitFor(
      () => {
        expect(getItemSpy).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    for (const call of getItemSpy.mock.calls) {
      const request: { id?: unknown; select?: Record<string, unknown> } =
        call[0] as { id?: unknown; select?: Record<string, unknown> };

      expect(String(request.id)).toBe(PROJECT_ID);
      for (const column of Object.keys(request.select || {})) {
        expect(["_id", "aiContext"]).toContain(column);
      }
    }
  });

  test("with none written: one quiet line, and a button that says what it does", async () => {
    openCard();

    expect(
      await screen.findByTestId(
        AI_CONTEXT_TEST_IDS.empty,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent("No AI context yet.");
    expect(await cardButton("Add AI context")).toBeEnabled();
    expect(screen.queryByTestId(AI_CONTEXT_TEST_IDS.view)).toBeNull();
  });

  /*
   * Most projects have no notes yet: a button drawn as "Edit" while the card
   * reads the project would turn into "Add AI context" a moment later. It is
   * drawn once the card knows which it is.
   */
  test("draws its button once it has read the project, never one word and then the other", async () => {
    let finishReading: (item: Project) => void = (): void => {};
    getItemSpy.mockImplementation((): Promise<Project> => {
      return new Promise<Project>((resolve: (item: Project) => void) => {
        finishReading = resolve;
      });
    });

    openCard();
    await card();
    await flush();

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add AI context" })).toBeNull();

    await act(async () => {
      finishReading(project);
    });

    expect(await cardButton("Add AI context")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  test("with notes: the notes as they read, how long they are, and Edit", async () => {
    project.aiContext = NOTES;
    openCard();

    const view: HTMLElement = await screen.findByTestId(
      AI_CONTEXT_TEST_IDS.view,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(within(view).getByTestId("markdown")).toHaveTextContent(
      "checkout-api serves the checkout page",
    );
    expect(
      within(view).getByTestId(AI_CONTEXT_TEST_IDS.length),
    ).toHaveTextContent(
      `${NOTES.length} of 20,000 characters · about ${Math.ceil(NOTES.length / 4)} tokens`,
    );
    // Short notes are drawn whole.
    expect(within(view).queryByTestId(AI_CONTEXT_TEST_IDS.toggle)).toBeNull();
    expect(await cardButton("Edit")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Add AI context" })).toBeNull();
  });

  test("the owner adds notes: the dialog asks one field, offers an outline, counts it, and saves that column alone", async () => {
    openCard();

    fireEvent.click(await cardButton("Add AI context"));
    await flush();

    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(dialog).toHaveTextContent(AI_CONTEXT_CARD_COPY.editModalTitle);
    expect(dialog).toHaveTextContent(AI_CONTEXT_CARD_COPY.editModalDescription);
    expect(dialog).toHaveTextContent(AI_CONTEXT_CARD_COPY.fieldTitle);
    expect(dialog).toHaveTextContent(AI_CONTEXT_CARD_COPY.fieldDescription);
    // Empty is an answer of its own: no "(Optional)".
    expect(dialog).not.toHaveTextContent("Optional");

    const length: HTMLElement = await within(dialog).findByTestId(
      AI_CONTEXT_TEST_IDS.length,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(length).toHaveTextContent("0 of 20,000 characters");

    // The outline fills the empty field, and goes once there is text.
    fireEvent.click(
      within(dialog).getByTestId(AI_CONTEXT_TEST_IDS.outlineButton),
    );
    await flush();

    const outline: string = getAiContextOutline(
      createTranslator(undefined, "en"),
    );
    const source: HTMLTextAreaElement = await dialogSource(dialog);
    expect(source.value).toBe(outline);
    expect(
      within(dialog).getByTestId(AI_CONTEXT_TEST_IDS.length),
    ).toHaveTextContent(`${outline.trim().length} of 20,000 characters`);
    expect(
      within(dialog).queryByTestId(AI_CONTEXT_TEST_IDS.outlineButton),
    ).toBeNull();

    fireEvent.change(source, { target: { value: NOTES } });
    await flush();
    expect(
      within(dialog).getByTestId(AI_CONTEXT_TEST_IDS.length),
    ).toHaveTextContent(
      `${NOTES.length} of 20,000 characters · about ${Math.ceil(NOTES.length / 4)} tokens`,
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(
      () => {
        expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const saved: Project = savedModels()[0]!;
    expect(saved.aiContext).toBe(NOTES);
    expect(String(saved.id)).toBe(PROJECT_ID);
    expect(saved.enableAi).toBeUndefined();
  });

  test("past 20,000 characters the count turns red and the dialog refuses it, saying what to do", async () => {
    openCard();

    fireEvent.click(await cardButton("Add AI context"));
    await flush();

    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const source: HTMLTextAreaElement = await dialogSource(dialog);

    fireEvent.change(source, { target: { value: "a".repeat(20001) } });
    await flush();

    expect(within(dialog).getByTestId(AI_CONTEXT_TEST_IDS.length)).toHaveClass(
      "text-red-600",
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );
    await flush();

    expect(
      await within(dialog).findByText(
        "Use 20,000 characters or fewer.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    // How far past the limit is the count's to say, red under the field.
    expect(
      within(dialog).getByTestId(AI_CONTEXT_TEST_IDS.length),
    ).toHaveTextContent("20,001 of 20,000 characters");
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  /*
   * A button that adds what is not there yet draws a plus, as every Add in
   * the product does; once there are notes, Edit draws the pencil.
   */
  test("its button draws what it does: a plus to add the first notes, a pencil to edit them", async () => {
    openCard();

    const add: HTMLElement = await cardButton("Add AI context");
    expect(iconOf(add)).toBe(iconPath(IconProp.Add));
    expect(iconOf(add)).not.toBe(iconPath(IconProp.Edit));

    cleanup();
    project.aiContext = NOTES;
    openCard();

    expect(iconOf(await cardButton("Edit"))).toBe(iconPath(IconProp.Edit));
  });

  test("locked, the button keeps its words and its picture", async () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectMember]);
    openCard();

    await screen.findByTestId(
      AI_CONTEXT_TEST_IDS.empty,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    const add: HTMLElement = await cardButton("Add AI context");
    expect(add).toBeDisabled();
    expect(iconOf(add)).toBe(iconPath(IconProp.Add));
  });

  /*
   * The outline's button goes once the field holds the outline. Focus does
   * not go with it, back to the page: it goes into the editor, the caret in
   * the outline's first item - where the first note is written.
   */
  test("after the outline, the keyboard is in the editor, in its first item", async () => {
    openCard();

    fireEvent.click(await cardButton("Add AI context"));
    await flush();

    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const outlineButton: HTMLElement = await within(dialog).findByTestId(
      AI_CONTEXT_TEST_IDS.outlineButton,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    outlineButton.focus();
    fireEvent.click(outlineButton);
    await flush();

    const editable: HTMLElement = within(dialog)
      .getByTestId(AI_CONTEXT_TEST_IDS.projectField)
      .querySelector("[role='textbox'][contenteditable]") as HTMLElement;

    await waitFor(
      () => {
        expect(document.activeElement).toBe(editable);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const firstItem: Element = editable.querySelector("li") as Element;
    const caret: Selection = window.getSelection() as Selection;
    expect(firstItem).not.toBeNull();
    expect(caret.rangeCount).toBe(1);
    expect(firstItem.contains(caret.anchorNode)).toBe(true);
    // The item under the outline's first heading.
    expect(firstItem.closest("ul")?.previousElementSibling).toHaveTextContent(
      "How our systems fit together",
    );
  });

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s may change it",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      project.aiContext = NOTES;
      openCard();

      expect(await cardButton("Edit")).toBeEnabled();
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
  ])(
    "%s reads it, and finds the button locked, naming who may change it",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      project.aiContext = NOTES;
      openCard();

      await screen.findByTestId(
        AI_CONTEXT_TEST_IDS.view,
        {},
        { timeout: WAIT_TIMEOUT },
      );

      const button: HTMLElement = await cardButton("Edit");
      expect(button).toBeDisabled();

      fireEvent.click(button);
      await flush();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(createOrUpdateSpy).not.toHaveBeenCalled();

      fireEvent.mouseEnter(screen.getByTestId("card-button-disabled-wrapper"));
      expect(
        await screen.findByRole("tooltip", {}, { timeout: WAIT_TIMEOUT }),
      ).toHaveTextContent(
        "Changing these needs one of these permissions: Project Owner, Project Admin.",
      );
    },
  );

  /*
   * Edit Project alone changes the project's name and the like, not what
   * OneUptime AI is told: the AI context is a Project Owner's or Project
   * Admin's, as the project's other AI settings are.
   */
  test("Edit Project alone neither reads nor changes it", async () => {
    grant([...BASE_PERMISSIONS, Permission.EditProject]);
    // The server leaves out a column its reader may not read.
    openCard();

    await card();
    await flush();

    expect(
      await screen.findByTestId("card-button", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeDisabled();
    expect(screen.queryByTestId(AI_CONTEXT_TEST_IDS.view)).toBeNull();
    for (const call of getItemSpy.mock.calls) {
      const request: { select?: Record<string, unknown> } = call[0] as {
        select?: Record<string, unknown>;
      };
      expect(request.select?.["aiContext"]).toBeUndefined();
    }
  });
});

describe("long notes are folded on the card", () => {
  /*
   * jsdom lays nothing out, so heights are given: the notes' own height,
   * and the folded frame's (max-h-72, 288px).
   */
  let contentHeight: number = 0;

  beforeEach(() => {
    contentHeight = 0;
    jest
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement): number {
        return this.parentElement?.getAttribute("data-testid") ===
          AI_CONTEXT_TEST_IDS.frame
          ? contentHeight
          : 0;
      });
    jest
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement): number {
        return this.getAttribute("data-testid") === AI_CONTEXT_TEST_IDS.frame
          ? 288
          : 0;
      });
  });

  test("notes that fit show whole, with no Show more and no fade - however many characters", () => {
    contentHeight = 200;
    render(<AiContextView text={"a".repeat(3000)} />);

    const frame: HTMLElement = screen.getByTestId(AI_CONTEXT_TEST_IDS.frame);

    expect(screen.queryByTestId(AI_CONTEXT_TEST_IDS.toggle)).toBeNull();
    expect(frame.className).not.toContain("mask-image");
    expect(screen.getByTestId(AI_CONTEXT_TEST_IDS.length)).toHaveTextContent(
      "3,000 of 20,000 characters · about 750 tokens",
    );
  });

  test("taller notes show their first lines, fading out; Show more opens them, Show less folds them again", () => {
    contentHeight = 900;
    render(<AiContextView text={NOTES} />);

    const frame: HTMLElement = screen.getByTestId(AI_CONTEXT_TEST_IDS.frame);
    const toggle: HTMLElement = screen.getByTestId(AI_CONTEXT_TEST_IDS.toggle);

    expect(toggle).toHaveTextContent("Show more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", frame.id);
    for (const className of [
      ...AI_CONTEXT_FOLDED_FRAME_CLASS_NAME.split(" "),
      ...AI_CONTEXT_FADED_FRAME_CLASS_NAME.split(" "),
    ]) {
      expect(frame).toHaveClass(className);
    }

    fireEvent.click(toggle);

    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(frame).not.toHaveClass("max-h-72");
    expect(frame.className).not.toContain("mask-image");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(frame).toHaveClass("max-h-72");
  });

  test("changed notes start folded again", () => {
    contentHeight = 900;
    const view: ReturnType<typeof render> = render(
      <AiContextView text={NOTES} />,
    );

    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.toggle));
    expect(screen.getByTestId(AI_CONTEXT_TEST_IDS.toggle)).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    view.rerender(<AiContextView text={`${NOTES}\n\n- One more line.`} />);

    expect(screen.getByTestId(AI_CONTEXT_TEST_IDS.toggle)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("the notes start and end flush with the card's body", () => {
    render(<AiContextView text={NOTES} />);

    expect(screen.getByTestId(AI_CONTEXT_TEST_IDS.frame)).toHaveClass(
      "[&>div>div>*:first-child]:mt-0",
      "[&>div>div>*:last-child]:mb-0",
    );
  });

  test("the notes are laid out by their own first letter, whatever the reader's language", () => {
    render(<AiContextView text={NOTES} />);

    expect(
      within(screen.getByTestId(AI_CONTEXT_TEST_IDS.frame)).getByTestId(
        "markdown",
      ).parentElement,
    ).toHaveAttribute("dir", "auto");
  });

  test("blank notes read as none", () => {
    render(<AiContextView text={"   \n  "} />);

    expect(screen.getByTestId(AI_CONTEXT_TEST_IDS.empty)).toHaveTextContent(
      "No AI context yet.",
    );
  });
});
