import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { loadCodeEditor } from "../../../../UI/Components/CodeEditor/LazyCodeEditor";
import { loadYamlEditor } from "../../../../UI/Components/CodeEditor/LazyYamlEditor";
import { loadFilePicker } from "../../../../UI/Components/FilePicker/LazyFilePicker";
import { loadMarkdownEditor } from "../../../../UI/Components/Markdown.tsx/LazyMarkdownEditor";
import {
  getLoadControl,
  loadAllFormFieldControls,
  loadFormFieldControls,
} from "../../../../UI/Components/Forms/Fields/FormFieldControls";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";

/*
 * Which field draws with which control that is a file of its own (issue
 * #5619), and what a form asks for as it is drawn.
 */

// A field type drawn with a control the first load already holds.
const FIRST_LOAD_TYPES: Array<FormFieldSchemaType> = Object.values(
  FormFieldSchemaType,
).filter((fieldType: FormFieldSchemaType): boolean => {
  return ![
    FormFieldSchemaType.JSON,
    FormFieldSchemaType.HTML,
    FormFieldSchemaType.CSS,
    FormFieldSchemaType.JavaScript,
    FormFieldSchemaType.YAML,
    FormFieldSchemaType.Markdown,
    FormFieldSchemaType.File,
    FormFieldSchemaType.ImageFile,
    FormFieldSchemaType.MultipleFiles,
  ].includes(fieldType);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getLoadControl", () => {
  test.each([
    [FormFieldSchemaType.JSON, loadCodeEditor],
    [FormFieldSchemaType.HTML, loadCodeEditor],
    [FormFieldSchemaType.CSS, loadCodeEditor],
    [FormFieldSchemaType.JavaScript, loadCodeEditor],
    [FormFieldSchemaType.YAML, loadYamlEditor],
    [FormFieldSchemaType.Markdown, loadMarkdownEditor],
    [FormFieldSchemaType.File, loadFilePicker],
    [FormFieldSchemaType.ImageFile, loadFilePicker],
    [FormFieldSchemaType.MultipleFiles, loadFilePicker],
  ] as Array<[FormFieldSchemaType, () => Promise<unknown>]>)(
    "a %s field draws with its own file",
    (fieldType: FormFieldSchemaType, loadControl: () => Promise<unknown>) => {
      expect(getLoadControl(fieldType)).toBe(loadControl);
    },
  );

  test.each(FIRST_LOAD_TYPES)(
    "a %s field loads nothing",
    (fieldType: FormFieldSchemaType) => {
      expect(getLoadControl(fieldType)).toBeNull();
    },
  );

  test("a field of no type loads nothing", () => {
    expect(getLoadControl(undefined)).toBeNull();
  });
});

describe("loadFormFieldControls", () => {
  test("asks for nothing for fields whose controls the first load holds", () => {
    const load: ReturnType<typeof jest.spyOn> = jest.spyOn(
      LazyLibrary.prototype,
      "load",
    );

    loadFormFieldControls(
      FIRST_LOAD_TYPES.map((fieldType: FormFieldSchemaType) => {
        return { fieldType };
      }),
    );
    loadFormFieldControls([{}]);
    loadFormFieldControls([]);

    expect(load).not.toHaveBeenCalled();
  });

  test("asks once for a control several fields draw with, and for each control a field does", () => {
    const load: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LazyLibrary.prototype, "load")
      .mockImplementation((): Promise<unknown> => {
        return Promise.resolve(null);
      });

    loadFormFieldControls([
      { fieldType: FormFieldSchemaType.JSON },
      { fieldType: FormFieldSchemaType.HTML },
      { fieldType: FormFieldSchemaType.Text },
    ]);

    expect(load).toHaveBeenCalledTimes(1);

    load.mockClear();

    loadFormFieldControls([
      { fieldType: FormFieldSchemaType.JSON },
      { fieldType: FormFieldSchemaType.Markdown },
      { fieldType: FormFieldSchemaType.File },
      { fieldType: FormFieldSchemaType.ImageFile },
      { fieldType: FormFieldSchemaType.YAML },
    ]);

    expect(load).toHaveBeenCalledTimes(4);
  });

  test("a load that fails is left for the field to say: nothing is thrown, and nothing goes unhandled", async () => {
    jest
      .spyOn(LazyLibrary.prototype, "load")
      .mockImplementation((): Promise<unknown> => {
        return Promise.reject(new Error("The file could not be fetched"));
      });

    const unhandled: Array<unknown> = [];
    const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    expect(() => {
      loadFormFieldControls([{ fieldType: FormFieldSchemaType.Markdown }]);
    }).not.toThrow();

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 10);
    });

    process.off("unhandledRejection", onUnhandled);

    expect(unhandled).toEqual([]);
  });
});

describe("loadAllFormFieldControls", () => {
  test("has every one of them loaded when it resolves, for what must have them before it draws", async () => {
    await loadAllFormFieldControls();

    // Each asks again and is answered at once, with the control itself.
    expect(typeof (await loadCodeEditor())).toBe("function");
    expect(typeof (await loadYamlEditor())).toBe("function");
    expect(typeof (await loadMarkdownEditor())).toBe("function");
    expect(typeof (await loadFilePicker())).toBe("function");
  });

  test("says so when one of them cannot be loaded", async () => {
    jest
      .spyOn(LazyLibrary.prototype, "load")
      .mockImplementation((): Promise<unknown> => {
        return Promise.reject(new Error("The file could not be fetched"));
      });

    await expect(loadAllFormFieldControls()).rejects.toThrow(
      "The file could not be fetched",
    );
  });
});
