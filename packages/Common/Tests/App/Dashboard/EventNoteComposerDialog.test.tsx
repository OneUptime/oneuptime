/** @timezone UTC */

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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The pieces the overview feeds' "Add Public Note" / "Add Private Note" are
 * built from, each on its own: the dialog (EventNoteComposerDialog), the
 * gate that decides whether a note may be written (getNoteCreateGate), the
 * feeds' hook (useFeedNoteActions), the composer's dialog variant
 * (NoteComposer variant="dialog"), and the template menu, which is portalled
 * so a dialog's scrolling body cannot cut it off.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

let currentPermissions: Array<string> = [];
let isMasterAdmin: boolean = true;
let currentProjectId: string | null = "10000000-0000-4000-8000-000000000001";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        if (!currentProjectId) {
          return null;
        }
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(currentProjectId);
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return currentPermissions;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
      getName: (): string => {
        return "Maya Chen";
      },
      getEmail: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return (
        <textarea
          aria-label="Note text"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.target.value);
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import EventNoteComposerDialog, {
  NOTE_COMPOSER_DIALOG_TITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNoteComposerDialog";
import {
  getNoteCreateGate,
  NoteCreateGate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNoteComposer";
import { EventNoteKind } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNoteKind";
import { getNotesCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import NoteComposer, {
  NoteComposerValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer";
import NoteTemplateMenu, {
  NoteTemplateOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu";
import useFeedNoteActions, {
  FeedNoteActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/useFeedNoteActions";
import FeedActionsMenu from "../../../UI/Components/Feed/FeedActionsMenu";
import Modal, { ModalWidth } from "../../../UI/Components/Modal/Modal";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";

function publicKind(): EventNoteKind<IncidentPublicNote> {
  return {
    modelType: IncidentPublicNote,
    visibility: "public",
    eventNoun: "incident",
    parentIdField: "incidentId",
    parentId: new ObjectID(INCIDENT_ID),
    subscriberNotifications: {
      isNotifyingByDefault: true,
      quietDescription: "Quiet because the incident was declared quietly.",
    },
    templates: { modelType: IncidentNoteTemplate },
  };
}

function privateKind(): EventNoteKind<IncidentInternalNote> {
  return {
    modelType: IncidentInternalNote,
    visibility: "private",
    eventNoun: "incident",
    parentIdField: "incidentId",
    parentId: new ObjectID(INCIDENT_ID),
    templates: { modelType: IncidentNoteTemplate },
  };
}

function payload(index: number = 0): Record<string, unknown> {
  const request: { model: BaseModel; modelType: { new (): BaseModel } } =
    createMock.mock.calls[index]![0] as {
      model: BaseModel;
      modelType: { new (): BaseModel };
    };
  return JSON.parse(
    JSON.stringify(BaseModel.toJSON(request.model, request.modelType)),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  currentPermissions = [Permission.ProjectOwner];
  isMasterAdmin = true;
  currentProjectId = "10000000-0000-4000-8000-000000000001";
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);
  createMock.mockImplementation(async (...args: Array<unknown>) => {
    return { data: (args[0] as { model: BaseModel }).model };
  });
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
});

describe("EventNoteComposerDialog", () => {
  test("is named after the action that opens it", () => {
    expect(NOTE_COMPOSER_DIALOG_TITLES).toEqual({
      public: "Add Public Note",
      private: "Add Private Note",
    });

    render(
      <EventNoteComposerDialog
        kind={publicKind()}
        onClose={() => {}}
        onPosted={() => {}}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Add Public Note" }),
    ).toBeInTheDocument();

    cleanup();

    render(
      <EventNoteComposerDialog
        kind={privateKind()}
        onClose={() => {}}
        onPosted={() => {}}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Add Private Note" }),
    ).toBeInTheDocument();
  });

  test("saves the note in the project the dashboard is on, then hands over", async () => {
    const onPosted: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    render(
      <EventNoteComposerDialog
        kind={publicKind()}
        onClose={() => {
          onClose();
        }}
        onPosted={() => {
          onPosted();
        }}
      />,
    );
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Add Public Note",
    });

    fireEvent.change(within(dialog).getByLabelText("Note text"), {
      target: { value: "Saved here." },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    expect(payload()["projectId"]).toMatchObject({
      value: "10000000-0000-4000-8000-000000000001",
    });
    expect(payload()["incidentId"]).toMatchObject({ value: INCIDENT_ID });
    expect(onPosted).toHaveBeenCalledTimes(1);
    // Closing is the owner's to do after a post; Cancel was never pressed.
    expect(onClose).not.toHaveBeenCalled();
  });

  test("posts nothing, and says why, with no project to post in", async () => {
    currentProjectId = null;

    render(
      <EventNoteComposerDialog
        kind={privateKind()}
        onClose={() => {}}
        onPosted={() => {}}
      />,
    );
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Add Private Note",
    });

    fireEvent.change(within(dialog).getByLabelText("Note text"), {
      target: { value: "Nowhere to go." },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("note-composer-error")).toHaveTextContent(
      "Select a project before posting a note.",
    );
  });

  test("someone who may not write notes is told why, and offered only Close", () => {
    isMasterAdmin = false;
    currentPermissions = [Permission.Viewer];
    const onClose: MockFunction = getJestMockFunction();

    render(
      <EventNoteComposerDialog
        kind={publicKind()}
        onClose={() => {
          onClose();
        }}
        onPosted={() => {}}
      />,
    );
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Add Public Note",
    });

    expect(
      within(dialog).getByTestId("note-composer-locked"),
    ).toHaveTextContent("You do not have permission to create");
    expect(within(dialog).queryByTestId("note-composer")).toBeNull();
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();

    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));
    expect(within(dialog).queryByText("Cancel")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("is not closed while a note is being posted", async () => {
    let finishPost: () => void = (): void => {};
    createMock.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        finishPost = (): void => {
          resolve({ data: {} });
        };
      });
    });
    const onClose: MockFunction = getJestMockFunction();

    render(
      <EventNoteComposerDialog
        kind={privateKind()}
        onClose={() => {
          onClose();
        }}
        onPosted={() => {}}
      />,
    );
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Add Private Note",
    });

    fireEvent.change(within(dialog).getByLabelText("Note text"), {
      target: { value: "Slow network." },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    fireEvent.click(within(dialog).getByTestId("close-button"));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Discard this draft?" }),
    ).toBeNull();

    await act(async () => {
      finishPost();
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe("getNoteCreateGate", () => {
  test("offers the note to whoever may create it", () => {
    const gate: NoteCreateGate = getNoteCreateGate(IncidentPublicNote);

    expect(gate).toEqual({ isShown: true, isDisabled: false });
  });

  test("locks it, saying which permission is missing, for someone who may only read", () => {
    isMasterAdmin = false;
    currentPermissions = [Permission.Viewer];

    const gate: NoteCreateGate = getNoteCreateGate(AlertInternalNote);

    expect(gate.isShown).toBe(true);
    expect(gate.isDisabled).toBe(true);
    expect(gate.tooltip).toMatch(/You do not have permission to create/);
  });

  test("offers nothing, and accuses nobody, while the permissions have not arrived", () => {
    isMasterAdmin = false;
    currentPermissions = [];

    expect(getNoteCreateGate(IncidentInternalNote)).toEqual({
      isShown: false,
      isDisabled: true,
    });
  });

  test("a project member may write every kind of note", () => {
    isMasterAdmin = false;
    currentPermissions = [Permission.ProjectMember];

    for (const modelType of [
      IncidentPublicNote,
      IncidentInternalNote,
      AlertInternalNote,
    ]) {
      expect(getNoteCreateGate(modelType).isDisabled).toBe(false);
    }
  });
});

interface HookHarnessProps {
  eventId: string;
  hasPublicNotes: boolean;
  onPosted: () => void;
}

const HookHarness: React.FunctionComponent<HookHarnessProps> = (
  props: HookHarnessProps,
): ReactElement => {
  const parentId: ObjectID = new ObjectID(props.eventId);
  const noteActions: FeedNoteActions = useFeedNoteActions({
    keyPrefix: "incident",
    publicNoteKind: props.hasPublicNotes
      ? { ...publicKind(), parentId }
      : undefined,
    privateNoteKind: { ...privateKind(), parentId },
    onPosted: props.onPosted,
  });

  return (
    <div>
      <FeedActionsMenu>{noteActions.menuItems}</FeedActionsMenu>
      <span data-testid="menu-item-keys">
        {noteActions.menuItems
          .map((item: ReactElement): string => {
            return String(item.key);
          })
          .join(",")}
      </span>
      {noteActions.dialog}
    </div>
  );
};

async function openMenu(): Promise<HTMLElement> {
  fireEvent.click(
    screen.getByText("Actions").closest('[aria-haspopup="menu"]')!,
  );
  return await screen.findByRole("menu");
}

describe("useFeedNoteActions", () => {
  test("offers the public note, then the private one, keyed after the feed", async () => {
    render(
      <HookHarness
        eventId={INCIDENT_ID}
        hasPublicNotes={true}
        onPosted={() => {}}
      />,
    );

    expect(screen.getByTestId("menu-item-keys")).toHaveTextContent(
      "incident-action-public-note,incident-action-private-note",
    );

    const menu: HTMLElement = await openMenu();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Add Public Note", "Add Private Note"]);
  });

  test("an event without public notes is offered only the private one", async () => {
    render(
      <HookHarness
        eventId={INCIDENT_ID}
        hasPublicNotes={false}
        onPosted={() => {}}
      />,
    );

    const menu: HTMLElement = await openMenu();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Add Private Note"]);
  });

  test("opens no dialog until asked, then the one asked for", async () => {
    render(
      <HookHarness
        eventId={INCIDENT_ID}
        hasPublicNotes={true}
        onPosted={() => {}}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    const menu: HTMLElement = await openMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Add Private Note" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Add Private Note" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Add Public Note" }),
    ).toBeNull();
  });

  test("after a post, closes the dialog and tells the feed", async () => {
    const onPosted: MockFunction = getJestMockFunction();

    render(
      <HookHarness
        eventId={INCIDENT_ID}
        hasPublicNotes={true}
        onPosted={() => {
          onPosted();
        }}
      />,
    );

    const menu: HTMLElement = await openMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Add Public Note" }),
    );
    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add Public Note",
    });

    fireEvent.change(within(dialog).getByLabelText("Note text"), {
      target: { value: "Done." },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(onPosted).toHaveBeenCalledTimes(1);
  });

  test("a dialog belongs to the event it was opened on", async () => {
    const view: RenderResult = render(
      <HookHarness
        eventId={INCIDENT_ID}
        hasPublicNotes={true}
        onPosted={() => {}}
      />,
    );

    const menu: HTMLElement = await openMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Add Public Note" }),
    );
    await screen.findByRole("dialog", { name: "Add Public Note" });

    view.rerender(
      <HookHarness
        eventId="20000000-0000-4000-8000-000000001029"
        hasPublicNotes={true}
        onPosted={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    view.rerender(
      <HookHarness
        eventId={INCIDENT_ID}
        hasPublicNotes={true}
        onPosted={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function composerValues(note: string = ""): NoteComposerValues {
  return { note, attachments: [], shouldNotify: true, postedAt: null };
}

describe("NoteComposer in a dialog", () => {
  function renderComposer(options: {
    variant: "card" | "dialog";
    note?: string;
    onSubmit?: () => void;
    onCancel?: () => void;
  }): void {
    render(
      <NoteComposer
        mode="create"
        variant={options.variant}
        visibility="public"
        copy={getNotesCopy("public", "incident")}
        values={composerValues(options.note)}
        onChange={() => {}}
        editorKey="test"
        isAttachmentsEnabled={true}
        isPostedAtEditable={true}
        isSubmitting={false}
        onSubmit={options.onSubmit || (() => {})}
        onCancel={options.onCancel || (() => {})}
        leadingActions={<button type="button">Templates</button>}
        dataTestId="note-composer"
      />,
    );
  }

  test("leaves Cancel and the submit button to the dialog's footer", () => {
    renderComposer({ variant: "dialog", note: "Written." });

    expect(screen.queryByTestId("note-submit")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("keeps everything else the card has: who reads it, the tools and the posting time", () => {
    renderComposer({ variant: "dialog" });

    expect(screen.getByTestId("note-audience")).toHaveTextContent(
      "Visible on your status page",
    );
    const tools: HTMLElement = screen.getByTestId("note-composer-tools");
    expect(within(tools).getByText("Templates")).toBeInTheDocument();
    expect(within(tools).getByTestId("note-attach-button")).toBeInTheDocument();
    expect(
      within(tools).getByTestId("note-posted-at-button"),
    ).toHaveTextContent("Posted now");
  });

  test("is not a card inside the dialog's card", () => {
    renderComposer({ variant: "dialog" });

    const form: HTMLElement = screen.getByTestId("note-composer");
    expect(form.className).not.toContain("border");
    expect(form.className).not.toContain("shadow");
  });

  test("Ctrl+Enter still posts, and Escape on an empty note still cancels", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const onCancel: MockFunction = getJestMockFunction();

    renderComposer({
      variant: "dialog",
      note: "Ready.",
      onSubmit: () => {
        onSubmit();
      },
    });
    fireEvent.keyDown(screen.getByLabelText("Note text"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    cleanup();

    renderComposer({
      variant: "dialog",
      onCancel: () => {
        onCancel();
      },
    });
    fireEvent.keyDown(screen.getByLabelText("Note text"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("the card on the Notes page keeps its own Cancel and submit", () => {
    renderComposer({ variant: "card", note: "Written." });

    expect(screen.getByTestId("note-submit")).toHaveTextContent("Post update");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByTestId("note-composer").className).toContain("border");
  });
});

const TEMPLATES: Array<NoteTemplateOption> = [
  { id: "1", name: "Identified", note: "**Identified.** We know why." },
  { id: "2", name: "Resolved", note: "**Resolved.** All good." },
];

function placeTriggerAt(top: number): void {
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation((): DOMRect => {
      return {
        top,
        bottom: top + 32,
        left: 40,
        right: 140,
        width: 100,
        height: 32,
        x: 40,
        y: top,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    });
}

describe("NoteTemplateMenu", () => {
  function renderMenu(options: {
    isOpeningUpwards?: boolean;
    onPick?: (template: NoteTemplateOption) => void;
    inDialog?: boolean;
  }): MockFunction {
    const loadTemplates: MockFunction = getJestMockFunction();
    loadTemplates.mockResolvedValue(TEMPLATES as never);

    const menu: ReactElement = (
      <div data-testid="menu-host">
        <NoteTemplateMenu
          loadTemplates={() => {
            return loadTemplates() as Promise<Array<NoteTemplateOption>>;
          }}
          isOpeningUpwards={options.isOpeningUpwards}
          onPick={options.onPick || (() => {})}
        />
      </div>
    );

    render(
      options.inDialog ? (
        <Modal
          title="Add Public Note"
          modalWidth={ModalWidth.Large}
          onClose={() => {}}
        >
          {menu}
        </Modal>
      ) : (
        menu
      ),
    );

    return loadTemplates;
  }

  test("is drawn over the page, outside the trigger's container", async () => {
    renderMenu({});

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");

    expect(screen.getByTestId("menu-host").contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position || "fixed").toBe("fixed");
  });

  test("inside a dialog it is not inside the dialog's scrolling body", async () => {
    renderMenu({ inDialog: true });

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");

    expect(screen.getByTestId("modal-content").contains(menu)).toBe(false);
    // Above the dialog, which sits at z-index 50.
    expect(Number(menu.style.zIndex)).toBeGreaterThan(50);
  });

  test("at the foot of a composer it opens above its trigger when there is room", async () => {
    placeTriggerAt(600);
    renderMenu({ isOpeningUpwards: true });

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");

    expect(menu.style.bottom).not.toBe("");
    expect(menu.style.top).toBe("");
  });

  test("it opens below when there is no room above", async () => {
    placeTriggerAt(40);
    renderMenu({ isOpeningUpwards: true });

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");

    expect(menu.style.top).not.toBe("");
    expect(menu.style.bottom).toBe("");
  });

  test("its height is held to the room it has", async () => {
    placeTriggerAt(300);
    renderMenu({ isOpeningUpwards: true });

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");

    expect(menu.style.maxHeight).toBe(`${300 - 4 - 8}px`);
  });

  test("loads its templates once, and a pick closes it", async () => {
    const onPick: MockFunction = getJestMockFunction();
    const loadTemplates: MockFunction = renderMenu({
      onPick: (template: NoteTemplateOption) => {
        onPick(template);
      },
    });

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    const menu: HTMLElement = await screen.findByTestId("note-template-menu");
    fireEvent.click(
      (await within(menu).findAllByText("Resolved"))[0]!.closest("button")!,
    );

    expect(onPick).toHaveBeenCalledWith(TEMPLATES[1]);
    expect(screen.queryByTestId("note-template-menu")).toBeNull();

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    await screen.findByTestId("note-template-menu");
    expect(loadTemplates).toHaveBeenCalledTimes(1);
  });

  test("opens from the keyboard into the menu, and Escape puts the focus back", async () => {
    renderMenu({});
    const trigger: HTMLElement = screen.getByTestId(
      "note-template-menu-button",
    );

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    const menu: HTMLElement = await screen.findByTestId("note-template-menu");
    const firstTemplate: HTMLElement = (
      await within(menu).findAllByText("Identified")
    )[0]!.closest("button")!;

    // Past the loading list, onto the first template.
    await waitFor(() => {
      expect(document.activeElement).toBe(firstTemplate);
    });

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByTestId("note-template-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("Escape in a dialog closes the menu, not the dialog", async () => {
    renderMenu({ inDialog: true });

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    await screen.findByTestId("note-template-menu");
    fireEvent.keyDown(document.activeElement || document.body, {
      key: "Escape",
    });

    expect(screen.queryByTestId("note-template-menu")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Add Public Note" }),
    ).toBeInTheDocument();
  });

  test("a press outside closes it", async () => {
    renderMenu({});

    fireEvent.click(screen.getByTestId("note-template-menu-button"));
    await screen.findByTestId("note-template-menu");
    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId("note-template-menu")).toBeNull();
  });
});
