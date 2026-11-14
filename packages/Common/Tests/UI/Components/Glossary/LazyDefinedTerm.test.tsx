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
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A word with its definition, as a form field's, a card's and a table
 * column's titles draw it (LazyDefinedTerm). DefinedTerm is a file of its
 * own, loaded by the first word drawn: imported statically, it - with the
 * Glossary it reads, the terms and docs languages it links and "Was this
 * clear?" under a definition - was about 7 KiB gzipped of the first load of
 * the sign-in pages, a status page and a public dashboard, which never mark
 * a word (packages/Common/Scripts/first-load-budgets.js).
 *
 * These hold its file back until the test lets it arrive, so the word is
 * seen before and after, and pin the imports that keep it out of the first
 * load of every page with a form, a card or a table.
 */

const definedTermRenderMock: MockFunction = getJestMockFunction();

// What DefinedTerm draws is DefinedTerm.test.tsx's; here, whether, and with what, it is drawn.
jest.mock("../../../../UI/Components/Glossary/DefinedTerm", () => {
  return {
    __esModule: true,
    default: (props: {
      term: string;
      children: React.ReactNode;
      dataTestId?: string | undefined;
    }): React.ReactElement => {
      definedTermRenderMock(props);
      return <span data-testid="defined-term-arrived">{props.children}</span>;
    },
  };
});

import LazyDefinedTerm from "../../../../UI/Components/Glossary/LazyDefinedTerm";
import {
  DEFINED_TERM_CLASS_NAME,
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTermWord";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";

const UI_COMPONENTS: string = path.join(__dirname, "../../../../UI/Components");

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(UI_COMPONENTS, relative), "utf8");
};

interface HeldLoad {
  library: LazyLibrary<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

// What the real load would have done: LazyLibrary.load, not held back.
const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;

let held: Array<HeldLoad> = [];

const tick: () => Promise<void> = async (): Promise<void> => {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
};

// Lets the file asked for arrive.
const arrive: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      const load: HeldLoad = held.shift() as HeldLoad;

      realLoad.call(load.library).then(load.resolve, load.reject);

      await tick();
    }

    await tick();
  });
};

const word: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(DEFINED_TERM_TEST_ID);
};

beforeEach(() => {
  held = [];
  definedTermRenderMock.mockReset();

  // Nothing has loaded, whatever an earlier test let arrive.
  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockReturnValue(null);

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ library: this, resolve, reject });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a word with its definition, as a title draws it", () => {
  test("is drawn at once as DefinedTerm draws it - the same button, line and words - and its file is asked for once", () => {
    render(
      <LazyDefinedTerm term={GlossaryTerm.Criteria}>Criteria</LazyDefinedTerm>,
    );

    expect(word().tagName).toBe("BUTTON");
    expect(word()).toHaveAttribute("type", "button");
    expect(word()).toHaveAttribute("data-glossary-term", "criteria");
    expect(word().className).toBe(DEFINED_TERM_CLASS_NAME);
    expect(word()).toHaveTextContent("Criteria");
    expect(screen.getByRole("button", { name: "Criteria" })).toBe(word());
    expect(screen.queryByTestId("defined-term-arrived")).toBeNull();
    expect(held).toHaveLength(1);
  });

  test.each<[string, string, GlossaryTerm, boolean, string]>([
    ["required", "Probes", GlossaryTerm.Probe, true, "Probes"],
    [
      "optional",
      "Initial State",
      GlossaryTerm.State,
      false,
      "Initial State (Optional)",
    ],
  ])(
    "before the file arrives, a dropdown whose title is a defined term keeps its name, and so does the word (%s)",
    (
      _kind: string,
      title: string,
      term: GlossaryTerm,
      required: boolean,
      fieldName: string,
    ) => {
      // As a form draws a dropdown's title: a <label> with no `for`.
      render(
        <div>
          <FieldLabelElement
            title={title}
            id="field-label"
            glossaryTerm={term}
            required={required}
          />
          <input role="combobox" aria-labelledby="field-label" />
        </div>,
      );

      expect(screen.queryByTestId("defined-term-arrived")).toBeNull();
      expect(screen.getByRole("button", { name: title })).toBe(word());
      expect(screen.getByRole("combobox", { name: fieldName })).toBeVisible();
    },
  );

  test("is DefinedTerm once the file arrives, with what the title gave it", async () => {
    // A field's title gives its word a place for the definition (FieldLabel).
    const place: React.RefObject<HTMLSpanElement> =
      React.createRef<HTMLSpanElement>();

    render(
      <LazyDefinedTerm
        term={GlossaryTerm.Probe}
        dataTestId="probes-word"
        popoverPlace={place}
      >
        Probes
      </LazyDefinedTerm>,
    );

    // Its own test id, before the file arrives as after.
    expect(screen.getByTestId("probes-word")).toHaveTextContent("Probes");

    await arrive();

    expect(screen.getByTestId("defined-term-arrived")).toHaveTextContent(
      "Probes",
    );
    expect(screen.queryByTestId("probes-word")).toBeNull();

    const props: Record<string, unknown> = definedTermRenderMock.mock.calls[
      definedTermRenderMock.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;

    expect(props["term"]).toBe(GlossaryTerm.Probe);
    expect(props["dataTestId"]).toBe("probes-word");
    expect(props["popoverPlace"]).toBe(place);
  });

  test("once the file is there, a word drawn after is DefinedTerm from its first frame, asking for nothing", () => {
    const loaded: { default: unknown } = jest.requireMock(
      "../../../../UI/Components/Glossary/DefinedTerm",
    ) as { default: unknown };

    jest
      .spyOn(LazyLibrary.prototype, "getLoaded")
      .mockReturnValue(loaded.default);

    render(
      <LazyDefinedTerm term={GlossaryTerm.Criteria}>Criteria</LazyDefinedTerm>,
    );

    expect(screen.getByTestId("defined-term-arrived")).toHaveTextContent(
      "Criteria",
    );
    expect(screen.queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
    expect(held).toHaveLength(0);
  });

  test("a file that does not arrive leaves the word as it is drawn", async () => {
    render(
      <LazyDefinedTerm term={GlossaryTerm.Criteria}>Criteria</LazyDefinedTerm>,
    );

    await act(async () => {
      (held.shift() as HeldLoad).reject(
        new Error("Loading chunk DefinedTerm failed."),
      );

      await tick();
    });

    expect(word()).toHaveTextContent("Criteria");
    expect(word()).toHaveAttribute("data-glossary-term", "criteria");
    expect(screen.queryByTestId("defined-term-arrived")).toBeNull();
  });

  test("before the file arrives, a press is still the word's own: no box ticked, no card opened, no Enter or Space for a card", () => {
    const onChange: MockFunction = getJestMockFunction();
    const onCardClick: MockFunction = getJestMockFunction();
    const onCardKeyDown: MockFunction = getJestMockFunction();

    render(
      <div
        role="button"
        tabIndex={0}
        onClick={onCardClick}
        onKeyDown={onCardKeyDown}
      >
        <label>
          <input type="checkbox" data-testid="box" onChange={onChange} />
          <LazyDefinedTerm term={GlossaryTerm.Probe}>Probes</LazyDefinedTerm>
        </label>
      </div>,
    );

    const click: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    word().dispatchEvent(click);

    // Held back, as DefinedTerm holds it: a card that is a link is not followed.
    expect(click.defaultPrevented).toBe(true);
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("box")).not.toBeChecked();

    fireEvent.keyDown(word(), { key: "Enter" });
    fireEvent.keyDown(word(), { key: " " });

    expect(onCardKeyDown).not.toHaveBeenCalled();

    // Any other key is the page's, as it is for DefinedTerm's word.
    fireEvent.keyDown(word(), { key: "Tab" });

    expect(onCardKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("the imports that keep DefinedTerm out of the first load", () => {
  test.each<[string, string]>([
    [
      "Forms/Fields/FieldLabel.tsx",
      'import DefinedTerm from "../../Glossary/LazyDefinedTerm";',
    ],
    ["Card/Card.tsx", 'import DefinedTerm from "../Glossary/LazyDefinedTerm";'],
    [
      "ModelTable/BaseModelTable.tsx",
      'import DefinedTerm from "../Glossary/LazyDefinedTerm";',
    ],
  ])(
    "%s draws its title's word through LazyDefinedTerm",
    (file: string, lazyImport: string) => {
      const source: string = read(file);

      expect(source).toContain(lazyImport);
      expect(source).not.toMatch(/from "[./]+\/Glossary\/DefinedTerm"/);
    },
  );

  test("LazyDefinedTerm reads DefinedTerm's types, and loads it only with import()", () => {
    const source: string = read("Glossary/LazyDefinedTerm.tsx");

    const staticImports: Array<string> = Array.from(
      source.matchAll(/^import[^;]*from "\.\/DefinedTerm";$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(staticImports).toEqual([
      'import type DefinedTerm from "./DefinedTerm";',
      'import type { ComponentProps } from "./DefinedTerm";',
    ]);
    expect(source).toContain('await import("./DefinedTerm")');
  });
});
