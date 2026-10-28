import Icon, {
  ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
  ICONS_POINTING_ALONG_THE_LINE,
  isIconMirroredRightToLeft,
} from "../../../UI/Components/Icon/Icon";
import Toggle, {
  getToggleClassNames,
  TOGGLE_KNOB_OFF_CLASS,
  TOGGLE_KNOB_ON_CLASS,
  TOGGLE_KNOB_ON_RIGHT_TO_LEFT_CLASS,
} from "../../../UI/Components/Toggle/Toggle";
import Statusbubble, {
  STATUS_BUBBLE_DOT_CLASS_NAME,
  STATUS_BUBBLE_ROW_CLASS_NAME,
} from "../../../UI/Components/StatusBubble/StatusBubble";
import KeyboardShortcut from "../../../UI/Components/KeyboardShortcut/KeyboardShortcut";
import KeyboardKey from "../../../UI/Components/KeyboardShortcut/KeyboardKey";
import Modal from "../../../UI/Components/Modal/Modal";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Footer from "../../../UI/Components/Footer/Footer";
import ProjectPicker from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import ProjectPickerMenuItem from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuItem";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import MarkdownBlockquote from "../../../UI/Components/Markdown.tsx/MarkdownQuote";
import { MARKDOWN_CALLOUT_ATTRIBUTE } from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";
import {
  getMarkdownBlockText,
  getMarkdownReadingDirection,
  getMarkdownWords,
  getShownMarkdownReadingDirection,
  MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS,
  MarkdownTreeNode,
  rehypeBlocksReadTheirOwnWay,
} from "../../../UI/Components/Markdown.tsx/MarkdownReadingDirection";
import { TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME } from "../../../UI/Utils/TypedTextDirection";
import Input, { InputType } from "../../../UI/Components/Input/Input";
import TextArea from "../../../UI/Components/TextArea/TextArea";
import IsolatedText from "../../../UI/Components/IsolatedText/IsolatedText";
import TableBody from "../../../UI/Components/Table/TableBody";
import Detail from "../../../UI/Components/Detail/Detail";
import LongTextViewer from "../../../UI/Components/LongText/LongTextViewer";
import CodeEditor from "../../../UI/Components/CodeEditor/CodeEditor";
import CodeType from "../../../Types/Code/CodeType";
import LogsTable from "../../../UI/Components/LogsViewer/components/LogsTable";
import Log from "../../../Models/AnalyticsModels/Log";
import FieldType from "../../../UI/Components/Types/FieldType";
import { TEXT_DIRECTION_SCAN_LENGTH } from "../../../Types/ReadingDirection";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import Project from "../../../Models/DatabaseModels/Project";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";

/*
 * WHAT A PAGE THAT READS RIGHT TO LEFT CHANGES IN THE SHARED COMPONENTS.
 *
 * A Persian page is served <html dir="rtl"> (Common/UI/Utils/PageLanguage),
 * and every left and right utility then means the start and the end of the
 * line (Common/UI/Styles/TailwindReadingDirection.js). What the components
 * add on top is pinned here: what turns round (arrows), what slides the
 * other way (a switch's knob, a drawer), what keeps reading left to right
 * whatever the page (keyboard shortcuts), and what reads the way its own
 * words are written (notes, project names, the copyright line).
 *
 * jsdom does not lay a page out, so this pins the classes and attributes;
 * packages/E2E/ReadingDirection measures them in a real browser.
 */

afterEach(() => {
  cleanup();
});

const ALL_ICONS: Array<IconProp> = Object.values(IconProp) as Array<IconProp>;

const svgOf: (icon: IconProp, props?: { className?: string }) => Element = (
  icon: IconProp,
  props?: { className?: string },
): Element => {
  const { container } = render(
    <Icon icon={icon} className={props?.className} />,
  );
  const svg: Element | null = container.querySelector("svg");

  if (!svg) {
    throw new Error(`Icon ${icon} drew no <svg>.`);
  }

  return svg;
};

const classListOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

describe("icons that point along the line", () => {
  test("turn round on a page that reads right to left", () => {
    for (const icon of ICONS_POINTING_ALONG_THE_LINE) {
      expect(classListOf(svgOf(icon))).toContain(
        ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
      );
      cleanup();
    }
  });

  test("are only the ones pointing left or right, or indenting", () => {
    for (const icon of ICONS_POINTING_ALONG_THE_LINE) {
      expect(icon).toMatch(/Left|Right|Indent|Outdent/);
    }
  });

  test("up, down and every other icon keep their shape", () => {
    const keptIcons: Array<IconProp> = ALL_ICONS.filter((icon: IconProp) => {
      return !ICONS_POINTING_ALONG_THE_LINE.includes(icon);
    });

    expect(keptIcons).toEqual(
      expect.arrayContaining([
        IconProp.ChevronDown,
        IconProp.ChevronUp,
        IconProp.Check,
        IconProp.Close,
      ]),
    );

    for (const icon of keptIcons) {
      expect(
        isIconMirroredRightToLeft({
          icon: icon,
          isMirroredRightToLeft: undefined,
        }),
      ).toBe(false);
    }

    expect(classListOf(svgOf(IconProp.ChevronDown))).not.toContain(
      ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
    );
  });

  test("an icon kept as drawn (a time axis's chevrons) says so", () => {
    expect(
      isIconMirroredRightToLeft({
        icon: IconProp.ChevronRight,
        isMirroredRightToLeft: false,
      }),
    ).toBe(false);

    const { container } = render(
      <Icon icon={IconProp.ChevronRight} isMirroredRightToLeft={false} />,
    );

    expect(
      classListOf(container.querySelector("svg")!).join(" "),
    ).not.toContain("dir(rtl)");
  });

  test("any icon can be asked to turn round", () => {
    expect(
      isIconMirroredRightToLeft({
        icon: IconProp.Help,
        isMirroredRightToLeft: true,
      }),
    ).toBe(true);
  });

  test("turn with the scale property, so a component's own turn still applies", () => {
    /*
     * scale is applied after transform: a folded section's chevron turned
     * down (rotate-90) still points down when mirrored, not up.
     */
    expect(ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME).toBe(
      "[&:dir(rtl)]:[scale:-1_1]",
    );
    expect(ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME).not.toMatch(
      /rotate|translate|transform/,
    );

    expect(
      classListOf(svgOf(IconProp.ChevronRight, { className: "rotate-90" })),
    ).toEqual(
      expect.arrayContaining([
        "rotate-90",
        ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
      ]),
    );
  });
});

describe("a switch on a page that reads right to left", () => {
  test("slides its knob towards the start of the line when on", () => {
    const on: string = getToggleClassNames({
      isChecked: true,
      isDisabled: false,
    }).knob;

    expect(on.split(" ")).toEqual(
      expect.arrayContaining([
        TOGGLE_KNOB_ON_CLASS,
        TOGGLE_KNOB_ON_RIGHT_TO_LEFT_CLASS,
      ]),
    );

    // As far the other way as it goes left to right.
    expect(TOGGLE_KNOB_ON_RIGHT_TO_LEFT_CLASS).toBe(
      `[&:dir(rtl)]:-${TOGGLE_KNOB_ON_CLASS}`,
    );
  });

  test("leaves the knob where it rests when off", () => {
    const off: string = getToggleClassNames({
      isChecked: false,
      isDisabled: true,
    }).knob;

    expect(off.split(" ")).toContain(TOGGLE_KNOB_OFF_CLASS);
    expect(off).not.toContain("dir(rtl)");
  });

  test("draws the knob it says", () => {
    render(<Toggle value={true} onChange={() => {}} ariaLabel="Notify me" />);

    const track: HTMLElement = screen.getByRole("switch", {
      name: "Notify me",
    });
    const knob: Element | null = track.querySelector(
      '[class*="translate-x-5"]',
    );

    expect(knob).not.toBeNull();
    expect(classListOf(knob!)).toContain(TOGGLE_KNOB_ON_RIGHT_TO_LEFT_CLASS);
  });
});

describe("a status bubble", () => {
  test("spaces its dot from its words with a gap, on either side", () => {
    render(
      <Statusbubble
        text="Operational"
        color={new Color("#10b981")}
        shouldAnimate={true}
      />,
    );

    const row: HTMLElement = screen.getByRole("status");
    const dot: HTMLElement = screen.getByTestId("status-bubble-dot");

    expect(row.className).toBe(STATUS_BUBBLE_ROW_CLASS_NAME);
    expect(row).toHaveClass("gap-2.5");
    expect(row.firstElementChild).toBe(dot);

    /*
     * The dot sits 2px in from the start of the line, and nothing of it
     * leans left: a negative left margin or a sideways shift drew it on top
     * of its words on a page that reads right to left.
     */
    expect(dot.className).toBe(STATUS_BUBBLE_DOT_CLASS_NAME);
    expect(dot).toHaveClass("ms-0.5", "flex-none");
    expect(dot.className).not.toMatch(/(^|\s)-?(ml|mr|translate-x)-/);
  });
});

describe("a keyboard shortcut", () => {
  test("reads left to right on every page, the keys in the order pressed", () => {
    const { container } = render(
      <KeyboardShortcut keys={[KeyboardKey.Mod, "k"]} />,
    );

    expect(container.firstElementChild).toHaveAttribute("dir", "ltr");
  });
});

describe("a dialog", () => {
  test("starts its words at the start of the line", () => {
    render(
      <Modal title="Delete monitor" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );

    const panel: HTMLElement = screen.getByTestId("modal");

    expect(panel).toHaveClass("text-start");
    expect(panel).not.toHaveClass("text-left");
  });
});

describe("a side menu section", () => {
  test("points a folded section's chevron along the line, either way", () => {
    render(
      <SideMenuSection title="Settings" defaultCollapsed={true}>
        <a href="/settings">Settings</a>
      </SideMenuSection>,
    );

    const chevron: Element | null = screen
      .getByRole("button", { expanded: false })
      .querySelector("svg");

    expect(chevron).not.toBeNull();

    // Pointing at the end of the line: right, or left read right to left.
    expect(classListOf(chevron!)).toEqual(
      expect.arrayContaining(["-rotate-90", "[&:dir(rtl)]:rotate-90"]),
    );
  });

  test("points an open section's chevron down on every page", () => {
    render(
      <SideMenuSection title="Settings" defaultCollapsed={false}>
        <a href="/settings">Settings</a>
      </SideMenuSection>,
    );

    const chevron: Element | null = screen
      .getByRole("button", { expanded: true })
      .querySelector("svg");

    expect(classListOf(chevron!)).toContain("rotate-0");
    expect(classListOf(chevron!).join(" ")).not.toContain("dir(rtl)");
  });
});

describe("words that read their own way", () => {
  test("a footer's copyright", () => {
    render(<Footer copyright="شرکت آکمه" links={[]} />);

    expect(screen.getByText(/شرکت آکمه/)).toHaveAttribute("dir", "auto");
  });

  test("a project's name, in the picker and in its list", () => {
    render(
      <ProjectPicker
        projects={[]}
        selectedProjectIcon={IconProp.Folder}
        selectedProjectName="Acme Production"
        onCreateProjectButtonClicked={() => {}}
        onProjectSelected={() => {}}
      />,
    );

    expect(screen.getByText("Acme Production")).toHaveAttribute("dir", "auto");
    cleanup();

    const project: Project = new Project();
    project._id = "b7000000-0000-4000-8000-0000000000a1";
    project.name = "پروژه آکمه";

    render(
      <ProjectPickerMenuItem
        icon={IconProp.Folder}
        project={project}
        onProjectSelected={() => {}}
      />,
    );

    expect(screen.getByText("پروژه آکمه")).toHaveAttribute("dir", "auto");
  });
});

describe("notes read the way they are written", () => {
  test("as it is typed, a note reads the way its first letter does", () => {
    expect(getMarkdownReadingDirection("The deploy finished.")).toBe("ltr");
    expect(getMarkdownReadingDirection("استقرار تمام شد.")).toBe("rtl");

    // Markup and figures before the first letter do not decide it.
    expect(getMarkdownReadingDirection("## 1. **استقرار**")).toBe("rtl");
    expect(getMarkdownReadingDirection("- [ ] `npm` 42 Fix it")).toBe("ltr");
  });

  test("shown, a note reads the way most of its words do, its links' addresses and its code left out", () => {
    expect(getShownMarkdownReadingDirection("The deploy finished.")).toBe(
      "ltr",
    );
    // A Persian sentence that starts with an English word is Persian.
    expect(getShownMarkdownReadingDirection("API پرداخت از کار افتاده.")).toBe(
      "rtl",
    );
    expect(
      getShownMarkdownReadingDirection(
        "`kubectl rollout restart deployment/checkout` را اجرا کنید",
      ),
    ).toBe("rtl");
    expect(
      getShownMarkdownReadingDirection(
        "[حادثه](https://oneuptime.example/dashboard/incidents/view) باز شد",
      ),
    ).toBe("rtl");
    expect(
      getShownMarkdownReadingDirection("Rolled back [v2.4.1](/releases)."),
    ).toBe("ltr");
  });

  test("a note with no letter yet follows the page", () => {
    for (const read of [
      getMarkdownReadingDirection,
      getShownMarkdownReadingDirection,
    ]) {
      expect(read("")).toBeUndefined();
      expect(read(null)).toBeUndefined();
      expect(read(undefined)).toBeUndefined();
      expect(read("123 - 456")).toBeUndefined();
    }
  });

  test("the words of a note leave out where its links go and its code", () => {
    expect(getMarkdownWords("See [the runbook](https://x.example/a) now")).toBe(
      "See [the runbook now",
    );
    expect(getMarkdownWords("![graph](/img.png) and `code here` done")).toBe(
      "![graph and  done",
    );
    // An unclosed mark is a character like any other.
    expect(getMarkdownWords("a ` b ](c")).toBe("a ` b ](c");
    expect(getMarkdownWords(null)).toBe("");
  });

  test("the words of a note are read in one pass, however its marks are left open", () => {
    // Marks that are never closed: each would otherwise be searched for to the end.
    for (const adversarial of [
      "](".repeat(200000),
      "`".repeat(400000),
      `${"](x".repeat(130000)}`,
    ]) {
      const read: FastestRun<string> = fastestRun({
        run: (): string => {
          return getMarkdownWords(adversarial);
        },
        limitInMs: 2000,
      });

      expect(read.inMs).toBeLessThan(2000);
      expect(read.result.length).toBeLessThanOrEqual(
        TEXT_DIRECTION_SCAN_LENGTH,
      );
    }
  });
});

describe("each block of a shown note reads its own way", () => {
  const text: (value: string) => MarkdownTreeNode = (
    value: string,
  ): MarkdownTreeNode => {
    return { type: "text", value };
  };

  const element: (
    tagName: string,
    children: Array<MarkdownTreeNode>,
    properties?: Record<string, unknown>,
  ) => MarkdownTreeNode = (
    tagName: string,
    children: Array<MarkdownTreeNode>,
    properties?: Record<string, unknown>,
  ): MarkdownTreeNode => {
    return { type: "element", tagName, properties: properties || {}, children };
  };

  const laidOut: (tree: MarkdownTreeNode) => MarkdownTreeNode = (
    tree: MarkdownTreeNode,
  ): MarkdownTreeNode => {
    rehypeBlocksReadTheirOwnWay()(tree);

    return tree;
  };

  test("every paragraph, heading, list, quote and table takes the way most of its words read", () => {
    const tree: MarkdownTreeNode = laidOut({
      type: "root",
      children: [
        element("h2", [text("کندی در جستجو")]),
        text("\n"),
        element("p", [text("The search cluster lost one node.")]),
        element("ul", [
          element("li", [element("a", [text("Checkout API")])]),
          element("li", [element("a", [text("Payments gateway")])]),
        ]),
        element("blockquote", [element("p", [text("نقل قول.")])]),
        element("table", [element("tr", [element("td", [text("Region")])])]),
      ],
    });

    const [heading, , paragraph, list, quote, table] = tree.children!;

    expect(heading!.properties!["dir"]).toBe("rtl");
    expect(paragraph!.properties!["dir"]).toBe("ltr");
    // A list of English names on a Persian page: its bullets beside them.
    expect(list!.properties!["dir"]).toBe("ltr");
    expect(quote!.properties!["dir"]).toBe("rtl");
    expect(table!.properties!["dir"]).toBe("ltr");
  });

  test("code says nothing about a block's way, and keeps the page's own rules", () => {
    const tree: MarkdownTreeNode = laidOut({
      type: "root",
      children: [
        element("p", [
          element("code", [text("kubectl rollout restart deployment")]),
          text(" را اجرا کنید"),
        ]),
        element("pre", [element("code", [text("echo done")])]),
        element("p", [text("12:30 - 99.9%")]),
      ],
    });

    const [runIt, block, figures] = tree.children!;

    expect(runIt!.properties!["dir"]).toBe("rtl");
    // A code block is left to right everywhere (Theme.css), never given a way here.
    expect(block!.properties!["dir"]).toBeUndefined();
    // No letters: it follows the note.
    expect(figures!.properties!["dir"]).toBeUndefined();
  });

  test("an item written the other way reads its own way where it stands, beside its bullet", () => {
    const tree: MarkdownTreeNode = laidOut({
      type: "root",
      children: [
        element("ul", [
          element("li", [text("مورد اول فارسی")]),
          element("li", [text("مورد دوم فارسی")]),
          element("li", [text("Checkout API returns 503.")]),
        ]),
      ],
    });

    const list: MarkdownTreeNode = tree.children![0]!;
    const english: MarkdownTreeNode = list.children![2]!;

    expect(list.properties!["dir"]).toBe("rtl");
    // The Persian items read the list's way and are left as they are.
    expect(list.children![0]!.children).toEqual([text("مورد اول فارسی")]);
    // The English one: its words in an isolate that reads left to right.
    expect(english.properties!["dir"]).toBeUndefined();
    expect(english.children).toEqual([
      {
        type: "element",
        tagName: "bdi",
        properties: { dir: "ltr" },
        children: [text("Checkout API returns 503.")],
      },
    ]);
  });

  test("a task list's check box stays where the bullet would be", () => {
    const checkBox: MarkdownTreeNode = element("input", [], {
      type: "checkbox",
    });
    const tree: MarkdownTreeNode = laidOut({
      type: "root",
      children: [
        element("ul", [
          element("li", [text("اول این مورد را با دقت ببینید")]),
          element("li", [checkBox, text(" "), text("Roll back the deploy")]),
        ]),
      ],
    });

    const item: MarkdownTreeNode = tree.children![0]!.children![1]!;

    expect(item.children![0]).toBe(checkBox);
    expect(item.children![1]).toEqual(text(" "));
    expect(item.children![2]!.tagName).toBe("bdi");
    expect(item.children![2]!.children).toEqual([text("Roll back the deploy")]);
  });

  test("an item that holds paragraphs or a list has them read in turn", () => {
    const tree: MarkdownTreeNode = laidOut({
      type: "root",
      children: [
        element("ol", [
          element("li", [
            element("p", [text("گام اول را با دقت انجام دهید")]),
            element("p", [text("Restart it.")]),
            element("ul", [element("li", [text("Checkout")])]),
          ]),
        ]),
      ],
    });

    const item: MarkdownTreeNode = tree.children![0]!.children![0]!;
    const [persian, english, nested] = item.children!;

    expect(tree.children![0]!.properties!["dir"]).toBe("rtl");
    // The item itself keeps its list's way: its bullet stays on the list's side.
    expect(item.properties!["dir"]).toBeUndefined();
    expect(persian!.children).toEqual([text("گام اول را با دقت انجام دهید")]);
    expect(english!.children![0]!.tagName).toBe("bdi");
    expect(english!.children![0]!.properties).toEqual({ dir: "ltr" });
    expect(nested!.properties!["dir"]).toBeUndefined();
    expect(nested!.children![0]!.children![0]!.tagName).toBe("bdi");
  });

  test("the words of a block are read up to the length a direction is read from", () => {
    const block: MarkdownTreeNode = element("p", [
      text("a".repeat(TEXT_DIRECTION_SCAN_LENGTH + 10)),
      text("فارسی"),
    ]);

    expect(getMarkdownBlockText(block)).toHaveLength(
      TEXT_DIRECTION_SCAN_LENGTH,
    );
  });
});

/*
 * react-markdown is a stand-in under jest (Tests/__mocks__): the blocks a
 * note is drawn as, and their directions, are measured in a real browser by
 * packages/E2E/ReadingDirection. MarkdownViewerHugeText pins that the
 * viewer always hands the parser rehypeBlocksReadTheirOwnWay, last.
 */
describe("the viewer lays a note out the way its words read", () => {
  test("an English note left to right, a Persian one right to left - even one that starts with an English word", () => {
    const { container, rerender } = render(
      <MarkdownViewer text="The deploy finished." />,
    );

    const frame: () => Element = (): Element => {
      return container.firstElementChild!;
    };

    expect(frame()).toHaveAttribute("dir", "ltr");

    rerender(<MarkdownViewer text="استقرار تمام شد." />);
    expect(frame()).toHaveAttribute("dir", "rtl");

    rerender(<MarkdownViewer text="`kubectl` را روی کلاستر اجرا کنید." />);
    expect(frame()).toHaveAttribute("dir", "rtl");

    // Nothing to read: the page's way, with no dir of its own.
    rerender(<MarkdownViewer text="" />);
    expect(container.querySelector("[dir]")).toBeNull();
  });

  test("a quote and a callout stand on the side their words start", () => {
    const { container, rerender } = render(
      <MarkdownBlockquote dir="rtl">
        <p>این را بخوانید.</p>
      </MarkdownBlockquote>,
    );

    expect(container.querySelector("blockquote")).toHaveAttribute("dir", "rtl");

    rerender(
      <MarkdownBlockquote
        dir="ltr"
        {...{ [MARKDOWN_CALLOUT_ATTRIBUTE]: "warning" }}
      >
        <p>Do not restart the primary.</p>
      </MarkdownBlockquote>,
    );

    const callout: Element = container.querySelector("blockquote")!;

    expect(callout).toHaveAttribute("data-callout", "warning");
    expect(callout).toHaveAttribute("dir", "ltr");

    // With no way of its own, a quote follows the note.
    rerender(
      <MarkdownBlockquote>
        <p>12:30</p>
      </MarkdownBlockquote>,
    );
    expect(container.querySelector("blockquote")).not.toHaveAttribute("dir");
  });
});

describe("the editor writes the way its text is typed", () => {
  test("its paragraphs and headings read their own way; a list's items, a quote's and a table's stay beside their bullets", () => {
    expect(MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS).toMatch(
      /unicode-bidi:\s?plaintext/,
    );
    expect(MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS).toMatch(
      /text-align: start/,
    );

    for (const block of ["p", "h1", "h6", "dd", "figcaption"]) {
      expect(MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS).toMatch(
        new RegExp(`[(,]\\s?${block}[,)]`),
      );
    }

    // A list item turned round by its own first letter put its bullet on the other side in Safari.
    expect(MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS).not.toMatch(
      /[(,]\s?li[,)]/,
    );
    expect(MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS).toContain(
      ":not(li *, blockquote *, td *, th *)",
    );
  });

  test("the editor writes the way its text reads, and follows it as it changes", () => {
    render(<MarkdownEditor initialValue="" placeholder="Write a note" />);

    // Show the Markdown source: a plain textarea to type into.
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    const textarea: HTMLElement = screen.getByRole("textbox");
    const area: () => Element | null = (): Element | null => {
      return textarea.closest("[dir]");
    };

    // Empty, it follows the page.
    expect(area()).toBeNull();
    for (const className of TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME.split(
      " ",
    )) {
      expect(textarea.className).toContain(className);
    }

    act(() => {
      fireEvent.change(textarea, { target: { value: "استقرار تمام شد." } });
    });
    expect(area()).toHaveAttribute("dir", "rtl");

    act(() => {
      fireEvent.change(textarea, { target: { value: "The deploy finished." } });
    });
    expect(area()).toHaveAttribute("dir", "ltr");
  });
});

describe("fields read what is typed into them the way it is written", () => {
  test("each line reads its own way, and a placeholder the page's (Firefox hid a right-to-left one)", () => {
    expect(TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME).toBe(
      "[unicode-bidi:plaintext] placeholder-shown:[unicode-bidi:normal]",
    );
  });

  test("a text field, a password, an address and a text area carry it", () => {
    const { container } = render(
      <>
        <Input placeholder="Name" />
        <Input placeholder="Secret" type={InputType.PASSWORD} />
        <Input placeholder="Address" type={InputType.URL} />
        <TextArea placeholder="Description" />
      </>,
    );

    for (const field of Array.from(
      container.querySelectorAll("input, textarea"),
    )) {
      expect(field.className).toContain("[unicode-bidi:plaintext]");
      expect(field.className).toContain(
        "placeholder-shown:[unicode-bidi:normal]",
      );
    }
  });

  test("a field with its own classes carries it too", () => {
    const { container } = render(<Input className="w-24 border" />);

    expect(container.querySelector("input")!.className).toBe(
      `w-24 border ${TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME}`,
    );
  });

  test("a number, a date and a time are laid out by the browser and left alone", () => {
    const { container } = render(
      <>
        <Input type={InputType.NUMBER} />
        <Input type={InputType.DATE} />
        <Input type={InputType.DATETIME_LOCAL} />
        <Input type={InputType.TIME} />
      </>,
    );

    for (const field of Array.from(container.querySelectorAll("input"))) {
      expect(field.className).not.toContain("unicode-bidi");
    }
  });
});

describe("code reads left to right on every page", () => {
  test("a code editor's code and line numbers are left to right; its toolbar follows the page", () => {
    render(
      <CodeEditor type={CodeType.JSON} value={'{"region": "eu-west-1"}'} />,
    );

    expect(screen.getByTestId("code-editor-scroller")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(
      screen.getByTestId("code-editor-language").closest("[dir]"),
    ).toBeNull();
  });
});

describe("a value someone wrote, in a line of the page", () => {
  test("reads the way most of its letters do, in an isolate", () => {
    const { container, rerender } = render(
      <IsolatedText text="Watches the checkout endpoint every minute." />,
    );

    const isolate: () => Element = (): Element => {
      return container.firstElementChild!;
    };

    expect(isolate().tagName).toBe("BDI");
    expect(isolate()).toHaveAttribute("dir", "ltr");
    expect(isolate()).toHaveTextContent(
      "Watches the checkout endpoint every minute.",
    );

    rerender(<IsolatedText text="API پرداخت از کار افتاده." />);
    expect(isolate()).toHaveAttribute("dir", "rtl");

    // No letters: the bdi reads it as browsers read one.
    rerender(<IsolatedText text="8080" />);
    expect(isolate().tagName).toBe("BDI");
    expect(isolate()).not.toHaveAttribute("dir");
  });

  test("a long name breaks after its own dots and slashes when asked, and reads as written", () => {
    const { container, rerender } = render(
      <IsolatedText
        text="*.lab.acme-commerce.example"
        className="font-mono"
        breaksLikeAName={true}
      />,
    );

    const isolate: () => Element = (): Element => {
      return container.firstElementChild!;
    };

    // "*." / "lab." / "acme-commerce." / "example": a break after each dot.
    expect(isolate().tagName).toBe("BDI");
    expect(isolate()).toHaveAttribute("dir", "ltr");
    expect(isolate().className).toBe("font-mono");
    expect(isolate().querySelectorAll("wbr")).toHaveLength(3);
    // A <wbr> adds no character: copied or read aloud, it is the value.
    expect(isolate().textContent).toBe("*.lab.acme-commerce.example");

    // A short name fits a line of its own and gets no break inside.
    rerender(
      <IsolatedText text="backup.exe" className="font-mono" breaksLikeAName />,
    );
    expect(isolate().querySelectorAll("wbr")).toHaveLength(0);
    expect(isolate().textContent).toBe("backup.exe");

    // Not asked: the text as it is, as every other value someone wrote.
    rerender(<IsolatedText text="*.lab.acme-commerce.example" />);
    expect(isolate().querySelectorAll("wbr")).toHaveLength(0);
    expect(isolate().textContent).toBe("*.lab.acme-commerce.example");
  });

  test("a table's cell draws its text in one", () => {
    render(
      <table>
        <TableBody<{ _id: string; description: string; port: string }>
          id="isolated-text-body"
          data={[
            {
              _id: "44000000-0000-4000-8000-000000000001",
              description: "Watches the checkout endpoint every minute.",
              port: "8080",
            },
          ]}
          columns={[
            {
              title: "Description",
              type: FieldType.Text,
              key: "description",
            },
            { title: "Port", type: FieldType.Text, key: "port" },
          ]}
          selectedItems={[]}
          matchBulkSelectedItemByField={undefined}
          isMobile={false}
        />
      </table>,
    );

    const description: HTMLElement = screen.getByText(
      "Watches the checkout endpoint every minute.",
    );

    expect(description.tagName).toBe("BDI");
    expect(description).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("8080").tagName).toBe("BDI");
  });

  test("a detail's value written as text draws it in one; an element is drawn as it is", () => {
    render(
      <Detail<{ description: string; owner: string }>
        item={{
          description: "پایش نقطه پرداخت.",
          owner: "Payments team",
        }}
        fields={[
          {
            key: "description",
            title: "Description",
            fieldType: FieldType.Text,
          },
          {
            key: "owner",
            title: "Owner",
            getElement: () => {
              return <span data-testid="owner-element">Payments team</span>;
            },
          },
        ]}
        showRecordLine={false}
      />,
    );

    const description: HTMLElement = screen.getByText("پایش نقطه پرداخت.");

    expect(description.tagName).toBe("BDI");
    expect(description).toHaveAttribute("dir", "rtl");
    expect(screen.getByTestId("owner-element").closest("bdi")).toBeNull();
  });

  test("a log's message in the logs table reads its own way, under its column's name", () => {
    const english: Log = new Log();
    english.body = "Payment provider timed out after 30s.";
    english.time = new Date("2026-10-26T10:15:00.000Z");

    const persian: Log = new Log();
    persian.body = "پرداخت با موفقیت انجام شد.";
    persian.time = new Date("2026-10-26T10:16:00.000Z");

    render(
      <LogsTable
        logs={[english, persian]}
        serviceMap={{}}
        isLoading={false}
        onRowClick={() => {}}
        selectedColumns={["time", "message"]}
      />,
    );

    const englishMessage: HTMLElement = screen.getByText(
      "Payment provider timed out after 30s.",
    );

    expect(englishMessage.tagName).toBe("BDI");
    expect(englishMessage).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("پرداخت با موفقیت انجام شد.")).toHaveAttribute(
      "dir",
      "rtl",
    );
  });

  test("a long text in a table reads its own way too", () => {
    render(<LongTextViewer text="Rolled back the deploy." />);

    const value: HTMLElement = screen.getByText("Rolled back the deploy.");

    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute("dir", "ltr");
  });
});
