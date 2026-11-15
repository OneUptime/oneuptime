import "@testing-library/jest-dom";
import type { Mock } from "jest-mock";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";
import NewVersion from "../../../../UI/Utils/NewVersion/NewVersion";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";
import { CHUNK_LOAD_RELOAD_STORAGE_KEY } from "../../../../UI/Utils/NewVersion/ChunkLoadError";
import {
  CODE_EDITOR_LINE_HEIGHT_PX,
  CODE_EDITOR_PADDING_Y_PX,
} from "../../../../UI/Components/CodeEditor/CodeEditorSize";
import FileModel from "../../../../Models/DatabaseModels/File";
import { CUSTOM_FIELD_FILES_HINT } from "../../../../UI/Components/CustomFields/CustomFieldFormFields";
import { JSONObject } from "../../../../Types/JSON";
import MimeType from "../../../../Types/File/MimeType";
import ObjectID from "../../../../Types/ObjectID";
import { TemplateVariableGroups } from "../../../../Types/Template/TemplateVariable";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * Every page with a form reaches FormField, and few forms have a code,
 * Markdown, file or people picker field: the sign-in page's and a status
 * page's have none. So their controls - with js-yaml, DOMPurify,
 * react-dropzone, the kinds of record the people picker searches and the rest
 * of what they run on - are files of their own, loaded by the first form that
 * has such a field (issue #5619).
 *
 * These hold every one of those files back until the test lets it arrive, so
 * each field type is seen before and after its control is there:
 *
 *   - before, the field draws a place for the control, the same size, and says
 *     it is loading;
 *   - after, the control is there with what the field holds, and works, and
 *     everything around it is the same elements as before;
 *   - if the file does not arrive, the field keeps its size and says so.
 *
 * jsdom lays nothing out, so "the same size" is checked here as the classes
 * and the numbers that decide it. packages/E2E/CodeEditor/FormFieldLoading.spec.ts
 * measures the same fields in real browsers.
 */

interface TestEntity extends JSONObject {
  config?: string;
  name?: string;
}

interface HeldLoad {
  library: LazyLibrary<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

// What the real load would have done: LazyLibrary.load, not held back.
const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;

let held: Array<HeldLoad> = [];
let asked: Set<LazyLibrary<unknown>> = new Set<LazyLibrary<unknown>>();

type TickFunction = () => Promise<void>;

const tick: TickFunction = async (): Promise<void> => {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
};

// Lets every file asked for arrive, and the ones they ask for in turn.
const arrive: TickFunction = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      const load: HeldLoad = held.shift() as HeldLoad;

      realLoad.call(load.library).then(load.resolve, load.reject);

      await tick();
    }

    await tick();
  });
};

type FailLoadsFunction = (error?: Error | undefined) => Promise<void>;

const failLoads: FailLoadsFunction = async (
  error?: Error | undefined,
): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      (held.shift() as HeldLoad).reject(
        error || new Error("The file could not be read"),
      );
    }

    await tick();
  });
};

beforeEach(() => {
  held = [];
  asked = new Set<LazyLibrary<unknown>>();

  // Nothing has loaded, whatever an earlier test let arrive.
  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockReturnValue(null);

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    asked.add(this);

    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ library: this, resolve, reject });
      },
    );
  });

  TabMemory.remove(CHUNK_LOAD_RELOAD_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type SetFieldValueMock = Mock<(name: string, value: unknown) => void>;

interface RenderOptions {
  value?: unknown;
  error?: string | undefined;
  overrides?: Partial<Field<TestEntity>> | undefined;
  setFieldValue?: SetFieldValueMock | undefined;
}

// An owners field, as forms declare one: people and teams in one picker.
const OWNERS_PICKER: PeoplePickerFieldConfig = {
  kinds: [
    { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
    { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
  ],
  addButtonText: "Add owner",
};

const fieldOf: (
  fieldType: FormFieldSchemaType,
  options?: RenderOptions,
) => React.ReactElement = (
  fieldType: FormFieldSchemaType,
  options?: RenderOptions,
): React.ReactElement => {
  const field: Field<TestEntity> = {
    title: "Config",
    description: "The configuration.",
    name: "config",
    field: { config: true },
    fieldType: fieldType,
    required: false,
    dataTestId: "the-control",
    // A people picker field draws only with the kinds it picks.
    ...(fieldType === FormFieldSchemaType.PeoplePicker
      ? { peoplePicker: OWNERS_PICKER }
      : {}),
    ...(options?.overrides || {}),
  } as Field<TestEntity>;

  return (
    <FormField<TestEntity>
      field={field}
      fieldName="config"
      index={0}
      isDisabled={false}
      error={options?.error || ""}
      touched={Boolean(options?.error)}
      currentValues={
        (options?.value === undefined
          ? {}
          : { config: options.value }) as FormValues<TestEntity>
      }
      setFieldTouched={(): void => {}}
      setFieldValue={
        (options?.setFieldValue as (name: string, value: unknown) => void) ||
        ((): void => {})
      }
      disableAutofocus={true}
    />
  );
};

const renderField: (
  fieldType: FormFieldSchemaType,
  options?: RenderOptions,
) => void = (fieldType: FormFieldSchemaType, options?: RenderOptions): void => {
  render(fieldOf(fieldType, options));
};

const placeholderOf: (fieldType: FormFieldSchemaType) => string = (
  fieldType: FormFieldSchemaType,
): string => {
  switch (fieldType) {
    case FormFieldSchemaType.YAML:
      return "yaml-editor-placeholder";
    case FormFieldSchemaType.Markdown:
      return "markdown-editor-placeholder";
    case FormFieldSchemaType.File:
    case FormFieldSchemaType.ImageFile:
    case FormFieldSchemaType.MultipleFiles:
      return "file-picker-placeholder";
    case FormFieldSchemaType.PeoplePicker:
      return "people-picker-placeholder";
    default:
      return "code-editor-placeholder";
  }
};

// The control itself, once it is there; null until then.
const controlOf: (fieldType: FormFieldSchemaType) => HTMLElement | null = (
  fieldType: FormFieldSchemaType,
): HTMLElement | null => {
  switch (fieldType) {
    case FormFieldSchemaType.Markdown:
      return screen.queryByRole("textbox");
    case FormFieldSchemaType.File:
    case FormFieldSchemaType.ImageFile:
    case FormFieldSchemaType.MultipleFiles:
      return document.querySelector<HTMLElement>("input[type='file']");
    case FormFieldSchemaType.PeoplePicker:
      return screen.queryByTestId("people-picker-add-button");
    default:
      return screen.queryByTestId("code-editor-input");
  }
};

const FIELD_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.JSON,
  FormFieldSchemaType.HTML,
  FormFieldSchemaType.CSS,
  FormFieldSchemaType.JavaScript,
  FormFieldSchemaType.YAML,
  FormFieldSchemaType.Markdown,
  FormFieldSchemaType.File,
  FormFieldSchemaType.ImageFile,
  FormFieldSchemaType.MultipleFiles,
  FormFieldSchemaType.PeoplePicker,
];

const CODE_FIELD_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.JSON,
  FormFieldSchemaType.HTML,
  FormFieldSchemaType.CSS,
  FormFieldSchemaType.JavaScript,
  FormFieldSchemaType.YAML,
];

/*
 * The classes that decide how much room something takes. Colours, shadows,
 * hover and focus states and what only the live control needs do not.
 */
const ROOM_CLASS: RegExp =
  /^(?:p[xytblrse]?-[\d.]+|m[xytblrse]?-[\d.]+|min-h-\S+|h-\S+|gap(?:-[xy])?-[\d.]+|space-[xy]-[\d.]+|border(?:-[xytblrse])?(?:-[\d]+)?|flex|flex-col|flex-wrap|block|grid|text-(?:xs|sm|base)|rounded(?:-\S+)?|items-\S+|justify-\S+|overflow-\S+|w-full|sr-only)$/;

const roomOf: (element: Element | null | undefined) => Array<string> = (
  element: Element | null | undefined,
): Array<string> => {
  return Array.from(element?.classList || [])
    .filter((name: string): boolean => {
      return ROOM_CLASS.test(name);
    })
    .sort();
};

describe.each(FIELD_TYPES)("a %s field", (fieldType: FormFieldSchemaType) => {
  test("before its control arrives: its place, said to be loading, under its own label and help", () => {
    renderField(fieldType);

    const placeholder: HTMLElement = screen.getByTestId(
      placeholderOf(fieldType),
    );

    expect(placeholder).toHaveAttribute("data-load-state", "loading");
    expect(placeholder).toHaveAttribute("role", "status");
    expect(placeholder).toHaveAttribute("aria-live", "polite");
    expect(within(placeholder).getByText("Loading content")).toHaveClass(
      "sr-only",
    );

    // Named by the field's label, so a screen reader knows which field.
    const labelId: string | null = placeholder.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toHaveTextContent(
      "Config",
    );

    expect(screen.getByText("The configuration.")).toBeInTheDocument();

    // The control is not there, and neither is its test id.
    expect(controlOf(fieldType)).toBeNull();
    expect(screen.queryByTestId("the-control")).toBeNull();

    // Asked for as the field is drawn.
    expect(asked.size).toBeGreaterThan(0);
  });

  test("after its control arrives: the control, with nothing above it drawn anew", async () => {
    renderField(fieldType);

    const label: HTMLElement = screen.getByText("Config");
    const help: HTMLElement = screen.getByText("The configuration.");

    await arrive();

    expect(controlOf(fieldType)).toBeInTheDocument();
    expect(screen.queryByTestId(placeholderOf(fieldType))).toBeNull();
    expect(screen.queryByText("Loading content")).toBeNull();

    // The same elements, not new ones: nothing around the control moved.
    expect(screen.getByText("Config")).toBe(label);
    expect(screen.getByText("The configuration.")).toBe(help);
  });

  test("if its control cannot be loaded: it says so, the same size, under its label", async () => {
    renderField(fieldType);

    await failLoads();

    expect(
      await screen.findByText("This couldn't be loaded."),
    ).toBeInTheDocument();

    const placeholder: HTMLElement = screen.getByTestId(
      placeholderOf(fieldType),
    );

    expect(placeholder).toHaveAttribute("data-load-state", "failed");
    expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
      "data-variant",
      "part",
    );

    // The way out: a reload, which fetches the control again.
    expect(screen.getByTestId("chunk-load-recovery-reload")).toBeEnabled();

    // Its place stays underneath, out of sight, and keeps the field's size.
    const shape: Element | null = placeholder.querySelector(".invisible");
    expect(shape).toHaveAttribute("aria-hidden", "true");
    expect(shape?.firstElementChild).not.toBeNull();

    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(controlOf(fieldType)).toBeNull();
  });

  test("its own error is shown while its control loads, and if it cannot", async () => {
    renderField(fieldType, { error: "Config is required." });

    const message: HTMLElement = screen.getByTestId("error-message");

    expect(message).toHaveTextContent("Config is required.");

    await failLoads();

    expect(
      await screen.findByText("This couldn't be loaded."),
    ).toBeInTheDocument();

    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "Config is required.",
    );
    // Once only: the place out of sight does not say it too.
    expect(screen.getAllByText("Config is required.")).toHaveLength(1);
  });

  test("a field drawn after a failed load asks again, and draws its control", async () => {
    const first: { unmount: () => void } = render(fieldOf(fieldType));

    await failLoads();

    first.unmount();

    render(fieldOf(fieldType));

    expect(screen.getByTestId(placeholderOf(fieldType))).toHaveAttribute(
      "data-load-state",
      "loading",
    );
    expect(held.length).toBeGreaterThan(0);

    await arrive();

    expect(controlOf(fieldType)).toBeInTheDocument();
  });
});

describe("a code field, before and after its editor arrives", () => {
  // The editor's own rows and frame, as it draws them.
  const editorFrame: () => HTMLElement = (): HTMLElement => {
    return screen.getByTestId("the-control");
  };

  test.each(CODE_FIELD_TYPES)(
    "%s: the frame, toolbar and status bar take the same room",
    async (fieldType: FormFieldSchemaType) => {
      renderField(fieldType);

      const frame: Array<string> = roomOf(
        screen.getByTestId("code-editor-placeholder-frame"),
      );
      const toolbar: Array<string> = roomOf(
        screen.getByTestId("code-editor-placeholder-toolbar"),
      );
      const status: Array<string> = roomOf(
        screen.getByTestId("code-editor-placeholder-status"),
      );

      await arrive();

      const root: Element =
        screen.getByTestId("code-editor-input").closest(".ou-code-editor") ||
        editorFrame();

      expect(frame).toEqual(roomOf(root));
      expect(toolbar).toEqual(
        roomOf(
          screen.getByTestId("code-editor-language").parentElement
            ?.parentElement,
        ),
      );
      expect(status).toEqual(
        roomOf(screen.getByTestId("code-editor-status").parentElement),
      );
    },
  );

  test.each(CODE_FIELD_TYPES)(
    "%s: the room for its text is the editor's minimum, and scrolls where the editor does",
    async (fieldType: FormFieldSchemaType) => {
      renderField(fieldType);

      const code: HTMLElement = screen.getByTestId(
        "code-editor-placeholder-code",
      );
      const minHeight: string = code.style.minHeight;
      const maxHeight: string = screen.getByTestId(
        "code-editor-placeholder-scroller",
      ).style.maxHeight;

      await arrive();

      expect(minHeight).toBe(
        (screen.getByTestId("code-editor-input").parentElement as HTMLElement)
          .style.minHeight,
      );
      expect(maxHeight).toBe(
        screen.getByTestId("code-editor-scroller").style.maxHeight,
      );
    },
  );

  test("the room is 5 lines of a code field, from the editor's own numbers", () => {
    renderField(FormFieldSchemaType.JSON);

    expect(
      screen.getByTestId("code-editor-placeholder-code").style.minHeight,
    ).toBe(
      `${5 * CODE_EDITOR_LINE_HEIGHT_PX + 2 * CODE_EDITOR_PADDING_Y_PX}px`,
    );
  });

  test("the room is 12 lines of a YAML field, which its form is all about", () => {
    renderField(FormFieldSchemaType.YAML);

    expect(
      screen.getByTestId("code-editor-placeholder-code").style.minHeight,
    ).toBe(
      `${12 * CODE_EDITOR_LINE_HEIGHT_PX + 2 * CODE_EDITOR_PADDING_Y_PX}px`,
    );
  });

  test.each(CODE_FIELD_TYPES)(
    "%s: a field that holds more lines than its minimum has room for them all",
    async (fieldType: FormFieldSchemaType) => {
      const text: string = Array.from(
        { length: 30 },
        (_: unknown, index: number) => {
          return `line ${index}`;
        },
      ).join("\r\n");

      renderField(fieldType, { value: text });

      const minHeight: string = screen.getByTestId(
        "code-editor-placeholder-code",
      ).style.minHeight;

      await arrive();

      const gutterLines: number = (
        screen.getByTestId("code-editor-gutter").textContent || ""
      ).split("\n").length;

      expect(gutterLines).toBe(30);
      expect(minHeight).toBe(
        `${gutterLines * CODE_EDITOR_LINE_HEIGHT_PX + 2 * CODE_EDITOR_PADDING_Y_PX}px`,
      );

      expect(
        (screen.getByTestId("code-editor-input") as HTMLTextAreaElement).value,
      ).toBe(text.replace(/\r\n/g, "\n"));
    },
  );

  test("a field holding something that is not text has room for it as the editor writes it out", () => {
    renderField(FormFieldSchemaType.JSON, {
      value: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 },
    });

    // { and } and eight members, a line each.
    expect(
      screen.getByTestId("code-editor-placeholder-code").style.minHeight,
    ).toBe(
      `${10 * CODE_EDITOR_LINE_HEIGHT_PX + 2 * CODE_EDITOR_PADDING_Y_PX}px`,
    );
  });

  test.each(CODE_FIELD_TYPES)(
    "%s: its error is in the status bar, as the editor has it, and so takes no more room",
    async (fieldType: FormFieldSchemaType) => {
      renderField(fieldType, { error: "Config is required." });

      expect(
        within(screen.getByTestId("code-editor-placeholder-status")).getByText(
          "Config is required.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("code-editor-placeholder-frame")).toHaveClass(
        "border-red-300",
      );

      await arrive();

      expect(
        within(screen.getByTestId("code-editor-status")).getByText(
          "Config is required.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("the-control")).toHaveClass("border-red-300");
    },
  );

  test("once it arrives it holds what the field holds, and what is typed reaches the form", async () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField(FormFieldSchemaType.JSON, {
      value: '{"retries": 3}',
      setFieldValue: setFieldValue,
    });

    await arrive();

    const input: HTMLTextAreaElement = screen.getByTestId(
      "code-editor-input",
    ) as HTMLTextAreaElement;

    expect(input.value).toBe('{"retries": 3}');

    fireEvent.change(input, { target: { value: '{"retries": 4}' } });

    expect(setFieldValue).toHaveBeenCalledWith("config", '{"retries": 4}');
  });

  test("a YAML field keeps its own wrapper and hint once it arrives", async () => {
    renderField(FormFieldSchemaType.YAML);

    expect(screen.queryByTestId("yaml-editor")).toBeNull();

    await arrive();

    expect(screen.getByTestId("yaml-editor")).toBeInTheDocument();
    expect(screen.getByTestId("code-editor-hint")).toBeInTheDocument();
  });

  test("a field its form locks is read only once it arrives", async () => {
    renderField(FormFieldSchemaType.JSON, {
      overrides: { disabled: true },
    });

    await arrive();

    expect(screen.getByTestId("code-editor-input")).toHaveAttribute("readonly");
  });
});

describe("a code field with template variables, before and after its editor arrives", () => {
  const GROUPS: TemplateVariableGroups = [
    {
      title: "Incident",
      variables: [{ name: "incident.title", description: "Title" }],
    },
  ];

  test("its variables are there at once; picking one before the editor is there does nothing", async () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField(FormFieldSchemaType.JSON, {
      overrides: { templateVariables: GROUPS },
      setFieldValue: setFieldValue,
    });

    fireEvent.click(screen.getByTestId("template-variable-insert"));

    expect(setFieldValue).not.toHaveBeenCalled();
    expect(screen.getByTestId("code-editor-placeholder")).toBeInTheDocument();
  });

  test("the list stays where it is, and a variable picked once the editor is there goes in", async () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField(FormFieldSchemaType.JSON, {
      overrides: { templateVariables: GROUPS },
      setFieldValue: setFieldValue,
    });

    const list: HTMLElement = screen.getByTestId("template-variables");

    await arrive();

    expect(screen.getByTestId("template-variables")).toBe(list);

    fireEvent.click(screen.getByTestId("template-variable-insert"));

    expect(setFieldValue).toHaveBeenLastCalledWith(
      "config",
      "{{incident.title}}",
    );
  });

  test('typing "{{" opens the list under the cursor once the editor is there', async () => {
    renderField(FormFieldSchemaType.JSON, {
      overrides: { templateVariables: GROUPS },
    });

    await arrive();

    const input: HTMLTextAreaElement = screen.getByTestId(
      "code-editor-input",
    ) as HTMLTextAreaElement;

    act(() => {
      input.focus();
    });

    fireEvent.change(input, { target: { value: "{{" } });

    act(() => {
      input.setSelectionRange(2, 2);
    });

    fireEvent.input(input, { target: { value: "{{" } });

    expect(
      await screen.findByTestId("template-variable-suggestions"),
    ).toBeInTheDocument();
  });
});

describe("a Markdown field, before and after its editor arrives", () => {
  test("the toolbar, box and help line take the same room", async () => {
    renderField(FormFieldSchemaType.Markdown);

    const toolbar: Array<string> = roomOf(
      screen.getByTestId("markdown-editor-placeholder-toolbar"),
    );
    const box: Array<string> = roomOf(
      screen.getByTestId("markdown-editor-placeholder-box"),
    );
    const help: Array<string> = roomOf(
      screen.getByTestId("markdown-editor-placeholder-help"),
    );

    await arrive();

    expect(toolbar).toEqual(
      roomOf(screen.getByTestId("markdown-editor-toolbar")),
    );
    expect(box).toEqual(roomOf(screen.getByRole("textbox")));
    expect(help).toEqual(
      roomOf(
        screen.getByText("Formatting help").closest("details")?.parentElement,
      ),
    );
  });

  test("its toolbar's buttons are the editor's 32px", async () => {
    renderField(FormFieldSchemaType.Markdown);

    const button: Element | null = screen
      .getByTestId("markdown-editor-placeholder-toolbar")
      .querySelector(".animate-pulse");

    expect(button).toHaveClass("h-8", "w-8");

    await arrive();

    expect(
      within(screen.getByTestId("markdown-editor-toolbar")).getAllByRole(
        "button",
      )[0],
    ).toHaveClass("h-8", "w-8");
  });

  test("the words of its help line, which set how many lines it takes, are the editor's", async () => {
    renderField(FormFieldSchemaType.Markdown);

    expect(
      screen.getByTestId("markdown-editor-placeholder-help"),
    ).toHaveTextContent("Formatting help");

    await arrive();

    expect(screen.getByText("Formatting help")).toBeInTheDocument();
  });

  test("what the field holds is in the box out of sight, for the room it takes", async () => {
    const note: string = "Rolled back the deploy.\n\nEverything recovered.";

    renderField(FormFieldSchemaType.Markdown, { value: note });

    const held: Element | null = screen
      .getByTestId("markdown-editor-placeholder-box")
      .querySelector(".invisible");

    expect(held).toHaveClass("whitespace-pre-wrap");
    expect(held?.textContent).toBe(note);

    await arrive();

    expect(screen.getByRole("textbox")).toHaveTextContent(
      "Rolled back the deploy.",
    );
  });

  test("a value that is not text takes no room, as the editor would draw none", () => {
    renderField(FormFieldSchemaType.Markdown, { value: { not: "text" } });

    expect(
      screen
        .getByTestId("markdown-editor-placeholder-box")
        .querySelector(".invisible")?.textContent,
    ).toBe("");
  });

  test("with template variables it keeps room for their fold, which the editor draws under it", async () => {
    renderField(FormFieldSchemaType.Markdown, {
      overrides: {
        templateVariables: [
          {
            title: "Incident",
            variables: [{ name: "incident.title", description: "Title" }],
          },
        ],
      },
    });

    const fold: HTMLElement = screen.getByTestId(
      "markdown-editor-placeholder-variables",
    );

    expect(fold).toHaveClass("mt-3", "rounded-lg", "border", "px-3", "py-2");

    await arrive();

    const list: HTMLElement = screen.getByTestId(
      "markdown-editor-template-variables",
    );

    expect(list).toHaveClass("mt-3", "rounded-lg", "border");
    expect(list.querySelector("summary")).toHaveClass("px-3", "py-2");
    // What gives the fold's one line its height: the { } badge, 24px.
    expect(list.querySelector("summary > span")).toHaveClass("h-6");
    expect(fold.firstElementChild).toHaveClass("h-6");
  });

  test("without template variables it keeps no room for them", () => {
    renderField(FormFieldSchemaType.Markdown);

    expect(
      screen.queryByTestId("markdown-editor-placeholder-variables"),
    ).toBeNull();
  });

  test("its error is under the box, as the editor has it", async () => {
    renderField(FormFieldSchemaType.Markdown, {
      error: "Config is required.",
    });

    expect(screen.getByTestId("markdown-editor-placeholder-box")).toHaveClass(
      "border-red-300",
    );

    const message: HTMLElement = screen.getByTestId("error-message");

    expect(roomOf(message)).toEqual(["mt-1", "text-sm"]);

    await arrive();

    expect(roomOf(screen.getByTestId("error-message"))).toEqual([
      "mt-1",
      "text-sm",
    ]);
  });

  test("what is typed once it arrives reaches the form", async () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField(FormFieldSchemaType.Markdown, {
      setFieldValue: setFieldValue,
    });

    await arrive();

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "**Deployed**" },
    });

    expect(setFieldValue).toHaveBeenCalledWith("config", "**Deployed**");
  });
});

describe("a file field, before and after its picker arrives", () => {
  const fileNamed: (name: string) => FileModel = (name: string): FileModel => {
    const file: FileModel = new FileModel();
    file._id = ObjectID.generate().toString();
    file.name = name;
    file.fileType = MimeType.png;
    return file;
  };

  const filesIn: (element: HTMLElement) => Array<Element> = (
    element: HTMLElement,
  ): Array<Element> => {
    return Array.from(
      element.querySelectorAll("[data-testid='file-picker-placeholder-file']"),
    );
  };

  test.each([
    [FormFieldSchemaType.File],
    [FormFieldSchemaType.ImageFile],
    [FormFieldSchemaType.MultipleFiles],
  ])(
    "%s, empty: the prompt's zone takes the same room",
    async (fieldType: FormFieldSchemaType) => {
      renderField(fieldType);

      const zone: Array<string> = roomOf(
        screen.getByTestId("file-picker-placeholder-zone"),
      );

      expect(zone).toContain("px-6");
      expect(zone).toContain("py-8");

      await arrive();

      expect(zone).toEqual(roomOf(screen.getByTestId("the-control")));
    },
  );

  test.each([
    ["a picker of one", FormFieldSchemaType.File, {}],
    ["an image picker", FormFieldSchemaType.ImageFile, {}],
    ["a picker of several", FormFieldSchemaType.MultipleFiles, {}],
    [
      "a picker with its own words",
      FormFieldSchemaType.File,
      { placeholder: "Add your logo", fileHint: "Up to 512 KB." },
    ],
    [
      "a picker with its own limit",
      FormFieldSchemaType.File,
      { fileTypes: [MimeType.png], maxFileSizeInBytes: 512 * 1024 },
    ],
  ] as Array<[string, FormFieldSchemaType, Partial<Field<TestEntity>>]>)(
    "%s says what it will say, so its words wrap as they will",
    async (
      _name: string,
      fieldType: FormFieldSchemaType,
      overrides: Partial<Field<TestEntity>>,
    ) => {
      renderField(fieldType, { overrides });

      const words: string | null = screen.getByTestId(
        "file-picker-placeholder-zone",
      ).textContent;

      expect(words).toContain("drag & drop.");

      await arrive();

      expect(screen.getByTestId("the-control").textContent).toBe(words);
    },
  );

  test("a picker of several holding files says what it will say about more", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      value: [fileNamed("first.png")],
    });

    const words: string | null = screen.getByTestId(
      "file-picker-placeholder-zone",
    ).textContent;

    expect(words).toContain("Add more files");

    await arrive();

    expect(screen.getByTestId("the-control").textContent).toBe(words);
  });

  test("a picker of several that is full says what it will say", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      value: [fileNamed("first.png"), fileNamed("second.png")],
      overrides: { maxFiles: 2 },
    });

    const words: string | null = screen.getByTestId(
      "file-picker-placeholder-zone",
    ).textContent;

    expect(words).toContain("up to 2 files");

    await arrive();

    expect(screen.getByTestId("file-picker-full").textContent).toBe(words);
  });

  // Full at one file: the words for one, on the stand-in as on the picker (issue #7421).
  test("a picker of several full at one file says it holds one, before and after", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      value: [fileNamed("first.png")],
      overrides: { maxFiles: 1 },
    });

    const words: string | null = screen.getByTestId(
      "file-picker-placeholder-zone",
    ).textContent;

    expect(words).toBe("This field holds one file. Remove it to add another.");

    await arrive();

    expect(screen.getByTestId("file-picker-full").textContent).toBe(words);
  });

  // A hint that names the count says the field's own, before and after.
  test("a picker of several says its own most files in its hint, before and after", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      overrides: { maxFiles: 3, fileHint: CUSTOM_FIELD_FILES_HINT },
    });

    const words: string | null = screen.getByTestId(
      "file-picker-placeholder-zone",
    ).textContent;

    expect(words).toContain(
      "Up to 3 files of 10 MB each: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.",
    );

    await arrive();

    expect(screen.getByTestId("the-control").textContent).toBe(words);
  });

  test("a picker of one holding its file has the file alone, and no zone", async () => {
    renderField(FormFieldSchemaType.File, { value: fileNamed("logo.png") });

    const placeholder: HTMLElement = screen.getByTestId(
      "file-picker-placeholder",
    );

    expect(screen.queryByTestId("file-picker-placeholder-zone")).toBeNull();

    const files: Array<Element> = filesIn(placeholder);

    expect(files).toHaveLength(1);
    expect(files[0]).toHaveTextContent("logo.png");

    const row: Array<string> = roomOf(files[0]);

    await arrive();

    // Its zone is there out of sight, as the place's first child is.
    expect(screen.getByTestId("the-control")).toHaveClass("sr-only");
    expect(row).toEqual(roomOf(screen.getByTestId("file-picker-file")));
  });

  test("a picker of one with a file the picker would not read as one shows the prompt", async () => {
    renderField(FormFieldSchemaType.File, { value: { name: "not a model" } });

    expect(
      screen.getByTestId("file-picker-placeholder-zone"),
    ).toBeInTheDocument();

    await arrive();

    expect(screen.queryByTestId("file-picker-file")).toBeNull();
  });

  test("a picker of several holding files asks for more in the smaller zone, over the files", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      value: [fileNamed("first.png"), fileNamed("second.png")],
    });

    const zone: Array<string> = roomOf(
      screen.getByTestId("file-picker-placeholder-zone"),
    );

    expect(zone).toContain("px-4");
    expect(zone).toContain("py-4");
    expect(filesIn(screen.getByTestId("file-picker-placeholder"))).toHaveLength(
      2,
    );

    await arrive();

    expect(zone).toEqual(roomOf(screen.getByTestId("the-control")));
    expect(screen.getAllByTestId("file-picker-file")).toHaveLength(2);
  });

  test("a picker of several that is full says so in the note's room", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      value: [fileNamed("first.png"), fileNamed("second.png")],
      overrides: { maxFiles: 2 },
    });

    const zone: Array<string> = roomOf(
      screen.getByTestId("file-picker-placeholder-zone"),
    );

    expect(zone).toContain("py-3");

    await arrive();

    expect(screen.getByTestId("file-picker-full")).toBeInTheDocument();
    expect(zone).toEqual(roomOf(screen.getByTestId("the-control")));
  });

  test("its file's row keeps room for the buttons that go under the name on a phone", async () => {
    renderField(FormFieldSchemaType.File, { value: fileNamed("logo.png") });

    const row: Element = filesIn(
      screen.getByTestId("file-picker-placeholder"),
    )[0] as Element;

    const buttons: Element | null = row.querySelector(".invisible");

    expect(buttons).toHaveAttribute("aria-hidden", "true");
    expect(buttons?.textContent).toBe("ReplaceRemove");

    await arrive();

    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  test("a picker of several has no Replace, in its place or once it arrives", async () => {
    renderField(FormFieldSchemaType.MultipleFiles, {
      value: [fileNamed("first.png")],
    });

    expect(
      filesIn(screen.getByTestId("file-picker-placeholder"))[0]?.querySelector(
        ".invisible",
      )?.textContent,
    ).toBe("Remove");

    await arrive();

    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });

  test("its error is under the place, as the picker has it", async () => {
    renderField(FormFieldSchemaType.File, { error: "Config is required." });

    const message: HTMLElement = screen.getByTestId("error-message");

    expect(message).toHaveTextContent("Config is required.");

    const room: Array<string> = roomOf(message);

    await arrive();

    expect(roomOf(screen.getByTestId("error-message"))).toEqual(room);
  });

  test("once it arrives, what the form holds is in it, and Remove reaches the form", async () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField(FormFieldSchemaType.File, {
      value: fileNamed("logo.png"),
      setFieldValue: setFieldValue,
    });

    await arrive();

    expect(screen.getByText("logo.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(setFieldValue).toHaveBeenCalledWith("config", null);
  });
});

describe("a people picker field, before and after its picker arrives", () => {
  const ADA: string = "0000000e-0000-4000-8000-000000000001";
  const GRACE: string = "0000000e-0000-4000-8000-000000000002";
  const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

  const renderPicker: (
    values: JSONObject,
    peoplePicker?: Partial<PeoplePickerFieldConfig>,
  ) => void = (
    values: JSONObject,
    peoplePicker?: Partial<PeoplePickerFieldConfig>,
  ): void => {
    render(
      <FormField<TestEntity>
        field={
          {
            title: "Owners",
            field: { config: true },
            fieldType: FormFieldSchemaType.PeoplePicker,
            peoplePicker: { ...OWNERS_PICKER, ...(peoplePicker || {}) },
            dataTestId: "the-control",
          } as Field<TestEntity>
        }
        fieldName="config"
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={values as FormValues<TestEntity>}
        setFieldTouched={(): void => {}}
        setFieldValue={(): void => {}}
        disableAutofocus={true}
      />,
    );
  };

  // What the place holds, in order: its button, and a chip for each pick.
  const partsOf: () => Array<string> = (): Array<string> => {
    return Array.from(
      screen
        .getByTestId("people-picker-placeholder")
        .querySelectorAll("[data-testid^='people-picker-placeholder-']"),
    ).map((part: Element): string => {
      return `${part.getAttribute("data-testid")}: ${part.textContent}`;
    });
  };

  test("its button comes first, with the field's words, and a chip for each pick says Loading..., as the picker's chips do until their names arrive", () => {
    renderPicker({ ownerUsers: [ADA, GRACE], ownerTeams: [PLATFORM] });

    expect(partsOf()).toEqual([
      "people-picker-placeholder-button: Add owner",
      "people-picker-placeholder-chip: Loading...",
      "people-picker-placeholder-chip: Loading...",
      "people-picker-placeholder-chip: Loading...",
    ]);

    // Nothing of the picker yet.
    expect(screen.queryByTestId("people-picker-add-button")).toBeNull();
    expect(screen.queryByTestId("people-chip")).toBeNull();
  });

  test("a picker of one with its pick has the chip first, and then Change", () => {
    renderPicker({ ownerUsers: ADA, ownerTeams: null }, { isSinglePick: true });

    expect(partsOf()).toEqual([
      "people-picker-placeholder-chip: Loading...",
      "people-picker-placeholder-button: Change",
    ]);
  });

  test("a picker of one with nothing picked has its button, as the picker does", () => {
    renderPicker(
      { ownerUsers: null, ownerTeams: null },
      { isSinglePick: true },
    );

    expect(partsOf()).toEqual(["people-picker-placeholder-button: Add owner"]);
  });

  test("its button takes the room the picker's does, with the same words", async () => {
    renderPicker({});

    const button: HTMLElement = screen.getByTestId(
      "people-picker-placeholder-button",
    );
    const room: Array<string> = roomOf(button);
    const words: string | null = button.textContent;

    expect(room).toContain("px-3");
    expect(room).toContain("py-1");

    await arrive();

    const pickerButton: HTMLElement = screen.getByTestId(
      "people-picker-add-button",
    );

    expect(roomOf(pickerButton)).toEqual(room);
    expect(pickerButton.textContent).toBe(words);
    expect(screen.queryByTestId("people-picker-placeholder")).toBeNull();
  });

  test("with nothing picked it says what that means, as the picker does", async () => {
    renderPicker(
      {},
      {
        whenNobodyPicked: {
          text: "Next person in the rotation",
          icon: IconProp.Refresh,
        },
      },
    );

    const nobodyPicked: HTMLElement = screen.getByTestId(
      "people-picker-placeholder-nobody-picked",
    );

    expect(nobodyPicked).toHaveTextContent("Next person in the rotation");

    const room: Array<string> = roomOf(nobodyPicked);

    await arrive();

    const said: HTMLElement = screen.getByTestId("people-picker-nobody-picked");

    expect(said).toHaveTextContent("Next person in the rotation");
    expect(roomOf(said)).toEqual(room);
  });
});

describe("a part of the page that will not download", () => {
  test("a control whose file is gone moves the page onto the new version, as every part does", async () => {
    const reloadKeepingPlace: Mock<() => void> = jest
      .spyOn(NewVersion, "reloadKeepingPlace")
      .mockImplementation((): void => {}) as unknown as Mock<() => void>;

    renderField(FormFieldSchemaType.Markdown);

    await failLoads(
      new TypeError("Failed to fetch dynamically imported module: /dist/x.js"),
    );

    await act(async () => {
      await tick();
    });

    expect(reloadKeepingPlace).toHaveBeenCalledTimes(1);

    // Not a blank space while it does: the part says it is on its way.
    expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
      "data-step",
      "reloading",
    );
  });

  test("if it still will not download after reloading, the field says it could not be loaded", async () => {
    TabMemory.set(CHUNK_LOAD_RELOAD_STORAGE_KEY, Date.now().toString());

    const reloadKeepingPlace: Mock<() => void> = jest
      .spyOn(NewVersion, "reloadKeepingPlace")
      .mockImplementation((): void => {}) as unknown as Mock<() => void>;

    renderField(FormFieldSchemaType.Markdown);

    await failLoads(
      new TypeError("Failed to fetch dynamically imported module: /dist/x.js"),
    );

    expect(
      await screen.findByText("This couldn't be loaded."),
    ).toBeInTheDocument();

    expect(reloadKeepingPlace).not.toHaveBeenCalled();
  });
});

describe("a form", () => {
  const renderForm: (fields: Fields<TestEntity>) => void = (
    fields: Fields<TestEntity>,
  ): void => {
    render(
      <BasicForm
        id="the-form"
        fields={fields}
        initialValues={{ name: "Database" } as FormValues<TestEntity>}
        onSubmit={(): void => {}}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );
  };

  const TEXT_FIELD: Field<TestEntity> = {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    stepId: "basic",
  } as Field<TestEntity>;

  const flush: TickFunction = async (): Promise<void> => {
    await act(async () => {
      await tick();
    });
  };

  test("with no such field asks for none of them: the sign-in page's forms", async () => {
    renderForm([
      { ...TEXT_FIELD, stepId: undefined } as Field<TestEntity>,
      {
        field: { config: true },
        title: "Password",
        fieldType: FormFieldSchemaType.Password,
      } as Field<TestEntity>,
    ]);

    await flush();

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(asked.size).toBe(0);
  });

  test("with such a field on its only step draws its place, and then the control", async () => {
    renderForm([
      {
        field: { config: true },
        title: "Config",
        fieldType: FormFieldSchemaType.JSON,
      } as Field<TestEntity>,
    ]);

    expect(
      await screen.findByTestId("code-editor-placeholder"),
    ).toBeInTheDocument();

    await arrive();

    expect(screen.getByTestId("code-editor-input")).toBeInTheDocument();
    expect(screen.queryByTestId("code-editor-placeholder")).toBeNull();
  });

  test("asks for a control as it is drawn, for a field on a step not reached yet", async () => {
    render(
      <BasicForm
        id="the-form"
        fields={[
          TEXT_FIELD,
          {
            field: { config: true },
            title: "Config",
            fieldType: FormFieldSchemaType.Markdown,
            stepId: "details",
          } as Field<TestEntity>,
        ]}
        steps={[
          { id: "basic", title: "Basic" },
          { id: "details", title: "Details" },
        ]}
        initialValues={{ name: "Database" } as FormValues<TestEntity>}
        onSubmit={(): void => {}}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await flush();

    // Not drawn yet, and asked for all the same.
    expect(screen.queryByTestId("markdown-editor-placeholder")).toBeNull();
    expect(asked.size).toBe(1);

    await arrive();

    // There by the time the step is reached: drawn from its first frame.
    (LazyLibrary.prototype.getLoaded as unknown as Mock).mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(
      await screen.findByTestId("markdown-editor-toolbar"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-editor-placeholder")).toBeNull();
  });

  test("asks for a control as it is drawn, for a field hidden until another answer shows it", async () => {
    renderForm([
      { ...TEXT_FIELD, stepId: undefined } as Field<TestEntity>,
      {
        field: { config: true },
        title: "Attachment",
        fieldType: FormFieldSchemaType.File,
        showIf: (): boolean => {
          return false;
        },
      } as Field<TestEntity>,
    ]);

    await flush();

    expect(screen.queryByTestId("file-picker-placeholder")).toBeNull();
    expect(asked.size).toBe(1);
  });

  test("asks once for a control several of its fields draw with", async () => {
    renderForm(
      [
        FormFieldSchemaType.JSON,
        FormFieldSchemaType.HTML,
        FormFieldSchemaType.CSS,
      ].map((fieldType: FormFieldSchemaType, index: number) => {
        return {
          field: { [`code${index}`]: true },
          title: fieldType,
          fieldType: fieldType,
        } as unknown as Field<TestEntity>;
      }),
    );

    await flush();

    expect(asked.size).toBe(1);
  });

  test("whose control cannot be loaded keeps its other fields and can still be saved", async () => {
    const onSubmit: Mock<(values: FormValues<TestEntity>) => void> =
      jest.fn<(values: FormValues<TestEntity>) => void>();

    render(
      <BasicForm
        id="the-form"
        fields={[
          { ...TEXT_FIELD, stepId: undefined } as Field<TestEntity>,
          {
            field: { config: true },
            title: "Config",
            fieldType: FormFieldSchemaType.Markdown,
          } as Field<TestEntity>,
        ]}
        initialValues={
          { name: "Database", config: "Held" } as FormValues<TestEntity>
        }
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await flush();
    await failLoads();
    await flush();
    await failLoads();

    expect(
      await screen.findByText("This couldn't be loaded."),
    ).toBeInTheDocument();

    expect(screen.getByLabelText(/Name/)).toHaveValue("Database");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await flush();

    // What it held goes back as it came: nothing lost for a control not there.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Database",
      config: "Held",
    });
  });
});
