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
import {
  getMarkdownReadingDirection,
  MARKDOWN_BLOCKS_READ_THEIR_OWN_WAY_CLASS_NAME,
  MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS,
} from "../../../UI/Components/Markdown.tsx/MarkdownReadingDirection";
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
  test("the direction of a note is its first letter's", () => {
    expect(getMarkdownReadingDirection("The deploy finished.")).toBe("ltr");
    expect(getMarkdownReadingDirection("استقرار تمام شد.")).toBe("rtl");

    // Markup and figures before the first letter do not decide it.
    expect(getMarkdownReadingDirection("## 1. **استقرار**")).toBe("rtl");
    expect(getMarkdownReadingDirection("- [ ] `npm` 42 Fix it")).toBe("ltr");
  });

  test("a note with no letter yet follows the page", () => {
    expect(getMarkdownReadingDirection("")).toBeUndefined();
    expect(getMarkdownReadingDirection(null)).toBeUndefined();
    expect(getMarkdownReadingDirection(undefined)).toBeUndefined();
    expect(getMarkdownReadingDirection("123 - 456")).toBeUndefined();
  });

  test("each block of a note reads its own way, and starts on that side", () => {
    for (const rule of [
      MARKDOWN_BLOCKS_READ_THEIR_OWN_WAY_CLASS_NAME,
      MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS,
    ]) {
      expect(rule).toMatch(/unicode-bidi:\s?plaintext/);
      expect(rule).toMatch(/text-start|text-align: start/);

      for (const block of ["p", "li", "h1", "h6", "dd", "figcaption"]) {
        expect(rule).toMatch(new RegExp(`[(,]\\s?${block}[,)]`));
      }
    }
  });

  test("the viewer lays an English note out left to right, a Persian one right to left", async () => {
    const { container, rerender } = render(
      <MarkdownViewer text="The deploy finished." />,
    );

    const frameOf: () => HTMLElement = (): HTMLElement => {
      return screen
        .getByText(/deploy finished|استقرار/)
        .closest("[dir]") as HTMLElement;
    };

    expect(frameOf()).toHaveAttribute("dir", "ltr");
    expect(frameOf().className).toContain(
      MARKDOWN_BLOCKS_READ_THEIR_OWN_WAY_CLASS_NAME,
    );

    rerender(<MarkdownViewer text="استقرار تمام شد." />);
    expect(frameOf()).toHaveAttribute("dir", "rtl");

    // Nothing to read: the page's way, with no dir of its own.
    rerender(<MarkdownViewer text="" />);
    expect(container.querySelector("[dir]")).toBeNull();
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
    expect(textarea.className).toContain("[unicode-bidi:plaintext]");

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
