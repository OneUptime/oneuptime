import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import ts from "typescript";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A FORM FIELD'S PLACEHOLDER IS LOOKED UP ONCE (#7663).
 *
 * FormField looked a field's placeholder up in the reader's language, and
 * then the control it handed the translation to - Input, TextArea, a
 * dropdown, the pickers, the code editors - looked that up again. Where a
 * translation is itself an English key, it was translated a second time:
 * Spanish says "Red" for "Network", and "Rojo" for "Red", so a field whose
 * placeholder is "Network" read "Rojo". An OpenStack domain's "Default"
 * read "Normal" in German the same way.
 *
 * Now FormField hands the placeholder over as written and the control that
 * draws it looks it up, once, as every control does with a placeholder it
 * is given outside a form. Here every kind of field FormField draws, in
 * Spanish with the Dashboard's own locale file, reads "Red" - never
 * "Rojo", never the English - and so does each control on its own. An
 * identifier (isPlaceholderIdentifier) still reads as written.
 *
 * The Markdown editor was the one control that drew a placeholder as it
 * was given, so it now looks it up as the others do, and no page hands it
 * one it has looked up already.
 */

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
    },
  };
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AutocompleteTextInput from "../../../../UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import Dropdown from "../../../../UI/Components/Dropdown/Dropdown";
import ColorPicker from "../../../../UI/Components/Forms/Fields/ColorPicker";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import { loadAllFormFieldControls } from "../../../../UI/Components/Forms/Fields/FormFieldControls";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Input from "../../../../UI/Components/Input/Input";
import MarkdownEditor from "../../../../UI/Components/Markdown.tsx/MarkdownEditor";
import TextArea from "../../../../UI/Components/TextArea/TextArea";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";

// A placeholder whose translation is itself an English key.
const PLACEHOLDER: string = "Network";
const ONCE: string = "Red";
const TWICE: string = "Rojo";

interface TestEntity extends JSONObject {
  value?: string;
}

// A word as a shared component looks it up (UI/Utils/Translation).
function word(text: string): string {
  return i18next.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

/*
 * Every text a reader can see as a placeholder: the attributes inputs and
 * editors draw one from, and every line of text with nothing else in it -
 * a dropdown's, a picker's, an editor's empty-state line.
 */
function drawnTexts(container: HTMLElement): Array<string> {
  const texts: Array<string> = [];

  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of [
      "placeholder",
      "data-placeholder",
      "aria-placeholder",
    ]) {
      const value: string | null = element.getAttribute(attribute);

      if (value) {
        texts.push(value);
      }
    }

    if (element.children.length === 0) {
      const text: string = (element.textContent || "").trim();

      if (text) {
        texts.push(text);
      }
    }
  }

  return texts;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderField(
  overrides: Partial<Field<TestEntity>>,
): Promise<HTMLElement> {
  const field: Field<TestEntity> = {
    title: "Name",
    name: "value",
    field: { value: true },
    required: false,
    placeholder: PLACEHOLDER,
    ...overrides,
  } as Field<TestEntity>;

  const view: ReturnType<typeof render> = render(
    <FormField<TestEntity>
      field={field}
      fieldName="value"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{} as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
      disableAutofocus={true}
    />,
  );

  await settle();

  return view.container;
}

// Each kind of field FormField draws, and the control that draws it.
const FIELD_KINDS: Array<[string, Partial<Field<TestEntity>>]> = [
  ["Text (Input)", { fieldType: FormFieldSchemaType.Text }],
  ["URL (Input)", { fieldType: FormFieldSchemaType.URL }],
  ["LongText (TextArea)", { fieldType: FormFieldSchemaType.LongText }],
  [
    "Dropdown (Dropdown)",
    {
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [{ label: "One", value: "one" }],
    },
  ],
  [
    "Dropdown of records (EntityDropdown)",
    {
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: { type: Monitor, labelField: "name", valueField: "_id" },
    },
  ],
  ["Time (TimePicker)", { fieldType: FormFieldSchemaType.Time }],
  /*
   * A Color field draws its swatches in a row, with no placeholder: the
   * picker says it only in its compact layout, which is among the controls
   * below.
   */
  ["Icon (IconPicker)", { fieldType: FormFieldSchemaType.Icon }],
  ["JSON (CodeEditor)", { fieldType: FormFieldSchemaType.JSON }],
  ["HTML (CodeEditor)", { fieldType: FormFieldSchemaType.HTML }],
  ["YAML (YamlEditor's hint)", { fieldType: FormFieldSchemaType.YAML }],
  ["Markdown (MarkdownEditor)", { fieldType: FormFieldSchemaType.Markdown }],
  ["File (FilePicker)", { fieldType: FormFieldSchemaType.File }],
  [
    "CustomComponent (an Input it is handed to)",
    {
      fieldType: FormFieldSchemaType.CustomComponent,
      getCustomElement: (
        _values: FormValues<TestEntity>,
        customProps: CustomElementProps,
      ): ReactElement => {
        return (
          <Input
            placeholder={customProps.placeholder}
            onChange={customProps.onChange}
          />
        );
      },
    },
  ],
];

// Each control a page uses on its own, outside a form.
const CONTROLS: Array<[string, () => ReactElement]> = [
  [
    "Input",
    (): ReactElement => {
      return <Input placeholder={PLACEHOLDER} />;
    },
  ],
  [
    "TextArea",
    (): ReactElement => {
      return <TextArea placeholder={PLACEHOLDER} />;
    },
  ],
  [
    "AutocompleteTextInput",
    (): ReactElement => {
      return (
        <AutocompleteTextInput
          placeholder={PLACEHOLDER}
          suggestions={[]}
          ariaLabel="Name"
        />
      );
    },
  ],
  [
    "Dropdown",
    (): ReactElement => {
      return (
        <Dropdown
          placeholder={PLACEHOLDER}
          options={[{ label: "One", value: "one" }]}
          ariaLabel="Name"
        />
      );
    },
  ],
  [
    "MarkdownEditor",
    (): ReactElement => {
      return <MarkdownEditor placeholder={PLACEHOLDER} />;
    },
  ],
  [
    "ColorPicker, compact",
    (): ReactElement => {
      return (
        <ColorPicker
          layout="compact"
          placeholder={PLACEHOLDER}
          onChange={(): void => {}}
          ariaLabel="Name"
        />
      );
    },
  ],
];

const PACKAGES: string = path.resolve(__dirname, "../../../../..");

// Where pages and shared components are written.
const SOURCE_FOLDERS: Array<string> = [
  path.join(PACKAGES, "App", "FeatureSet"),
  path.join(PACKAGES, "Common", "UI"),
];

// The calls that look a text up in the reader's language.
const LOOKUPS: ReadonlyArray<string> = [
  "t",
  "tx",
  "translateString",
  "translateText",
  "translateTerm",
  "translateValue",
];

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (!["node_modules", "build", "dist"].includes(entry.name)) {
        files.push(...sourceFiles(full));
      }
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

function looksUp(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const callee: ts.Expression = node.expression;
    const name: string = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";

    if (LOOKUPS.includes(name)) {
      return true;
    }
  }

  return Boolean(ts.forEachChild(node, looksUp));
}

interface HandedPlaceholder {
  where: string;
  placeholder: string;
  isLookedUp: boolean;
}

// Every placeholder a page or a component hands the Markdown editor.
function markdownEditorPlaceholders(): Array<HandedPlaceholder> {
  const handed: Array<HandedPlaceholder> = [];

  for (const file of SOURCE_FOLDERS.flatMap(sourceFiles)) {
    const text: string = fs.readFileSync(file, "utf8");

    if (!text.includes("<MarkdownEditor")) {
      continue;
    }

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(source) === "MarkdownEditor"
      ) {
        for (const attribute of node.attributes.properties) {
          if (
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === "placeholder" &&
            attribute.initializer
          ) {
            const line: number =
              source.getLineAndCharacterOfPosition(attribute.getStart(source))
                .line + 1;

            handed.push({
              where: `${path.relative(PACKAGES, file)}:${line}`,
              placeholder: attribute.initializer.getText(source),
              isLookedUp: looksUp(attribute.initializer),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return handed;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: readDashboardLocale("es") },
    },
    interpolation: { escapeValue: false },
  });

  await loadAllFormFieldControls();
});

afterEach(() => {
  cleanup();
});

describe("a placeholder whose translation is another English key", () => {
  test("is one in Spanish: Network is Red, and Red is Rojo", () => {
    expect(word(PLACEHOLDER)).toBe(ONCE);
    expect(word(ONCE)).toBe(TWICE);
  });
});

describe("a form field's placeholder, in Spanish", () => {
  test.each(FIELD_KINDS)(
    "%s draws it looked up once",
    async (_kind: string, overrides: Partial<Field<TestEntity>>) => {
      const drawn: Array<string> = drawnTexts(await renderField(overrides));

      expect(drawn).toContain(ONCE);
      expect(drawn).not.toContain(TWICE);
      expect(drawn).not.toContain(PLACEHOLDER);
    },
  );

  test("an identifier (isPlaceholderIdentifier) is drawn as written", async () => {
    const drawn: Array<string> = drawnTexts(
      await renderField({
        fieldType: FormFieldSchemaType.Text,
        isPlaceholderIdentifier: true,
      }),
    );

    expect(drawn).toContain(PLACEHOLDER);
    expect(drawn).not.toContain(ONCE);
    expect(drawn).not.toContain(TWICE);
  });
});

describe("a placeholder handed to the Markdown editor", () => {
  test("is English: the editor looks it up, and no page looks it up first", () => {
    const handed: Array<HandedPlaceholder> = markdownEditorPlaceholders();

    // FormField's, a note's and a monitor's, among others.
    const files: Array<string> = handed.map((item: HandedPlaceholder) => {
      return item.where.split(":")[0] || "";
    });

    expect(files).toContain(
      path.join(
        "Common",
        "UI",
        "Components",
        "Forms",
        "Fields",
        "FormField.tsx",
      ),
    );
    expect(files).toContain(
      path.join(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "EventNotes",
        "NoteComposer.tsx",
      ),
    );
    expect(handed.length).toBeGreaterThanOrEqual(5);

    expect(
      handed.filter((item: HandedPlaceholder): boolean => {
        return item.isLookedUp;
      }),
    ).toEqual([]);
  });
});

describe("a control on its own, outside a form, in Spanish", () => {
  test.each(CONTROLS)(
    "%s still looks its placeholder up, once",
    async (_name: string, control: () => ReactElement) => {
      const view: ReturnType<typeof render> = render(control());

      await settle();

      const drawn: Array<string> = drawnTexts(view.container);

      expect(drawn).toContain(ONCE);
      expect(drawn).not.toContain(TWICE);
      expect(drawn).not.toContain(PLACEHOLDER);
    },
  );
});
