import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import MatchedText, {
  MATCHED_TEXT_MARK_CLASS_NAME,
} from "../../../../UI/Components/CommandPalette/MatchedText";
import PaletteRow from "../../../../UI/Components/CommandPalette/PaletteRow";
import ProjectPickerMenuItem from "../../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuItem";
import IconProp from "../../../../Types/Icon/IconProp";
import Project from "../../../../Models/DatabaseModels/Project";

/*
 * WHAT A SEARCH MATCHED, MARKED.
 *
 * Search (Cmd/Ctrl+K) marked the part of a page's name that matched what
 * was typed, with a mark of its own; the project list marked nothing. Both
 * now draw MatchedText, so a match looks the same wherever it is found and
 * the two cannot drift apart.
 */

function marksOf(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("mark")).map(
    (mark: HTMLElement): string => {
      return mark.textContent || "";
    },
  );
}

function drawn(text: string, search: string): HTMLElement {
  return render(
    <p data-testid="matched">
      <MatchedText text={text} search={search} />
    </p>,
  ).getByTestId("matched");
}

afterEach(() => {
  cleanup();
});

describe("MatchedText", () => {
  test("marks each word typed where it starts a word of the text", () => {
    expect(marksOf(drawn("OneUptime Kubernetes", "kube"))).toEqual(["Kube"]);
    cleanup();
    expect(marksOf(drawn("Sample: Acme Shop", "sample shop"))).toEqual([
      "Sample",
      "Shop",
    ]);
  });

  test("marks two words side by side as one run, the space between them with them", () => {
    expect(marksOf(drawn("Sample: Acme Shop", "shop acme"))).toEqual([
      "Acme Shop",
    ]);
  });

  test("marks the whole search inside a word when it starts none", () => {
    expect(marksOf(drawn("OneUptime Kubernetes", "ernet"))).toEqual(["ernet"]);
  });

  test("reads the text as the search does: case and accents aside", () => {
    expect(marksOf(drawn("Café Production", "CAFE"))).toEqual(["Café"]);
  });

  test("keeps the whole text, in its order, around the marks", () => {
    const element: HTMLElement = drawn("Sample: Acme Shop", "acme");

    expect(element).toHaveTextContent("Sample: Acme Shop");
    expect(element.textContent).toBe("Sample: Acme Shop");
  });

  test("marks nothing for a typo, initials or letters in order", () => {
    expect(marksOf(drawn("OneUptime Kubernetes", "kubernetse"))).toEqual([]);
    cleanup();
    expect(marksOf(drawn("OneUptime Kubernetes", "ouk"))).toEqual([]);
    cleanup();
    expect(marksOf(drawn("OneUptime Kubernetes", "knts"))).toEqual([]);
  });

  test("with nothing typed, draws the text as it is", () => {
    const element: HTMLElement = drawn("پروژه آکمه", "");

    expect(marksOf(element)).toEqual([]);
    // One text node: found whole, as a name drawn without a search is.
    expect(screen.getByText("پروژه آکمه")).toBe(element);
  });

  test("an empty text draws nothing", () => {
    expect(drawn("", "acme").textContent).toBe("");
  });

  test("each mark is drawn with the one class", () => {
    const element: HTMLElement = drawn("Sample: Acme Shop", "sample shop");

    element.querySelectorAll("mark").forEach((mark: HTMLElement) => {
      expect(mark.className).toBe(MATCHED_TEXT_MARK_CLASS_NAME);
    });
  });
});

describe("a match looks the same in Search and in the project list", () => {
  test("Search's row marks its title, its breadcrumb and its description with MatchedText's mark", () => {
    render(
      <PaletteRow
        item={{
          id: "api-keys",
          title: "API Keys",
          breadcrumb: ["Project Settings", "API Keys"],
        }}
        query="api"
        isActive={false}
        onActivate={() => {}}
        onSelect={() => {}}
        setRowElement={() => {}}
      />,
    );

    const row: HTMLElement = screen.getByTestId(
      "command-palette-option-api-keys",
    );
    const marks: Array<HTMLElement> = Array.from(row.querySelectorAll("mark"));

    expect(marksOf(row)).toEqual(["API", "API"]);
    for (const mark of marks) {
      expect(mark.className).toBe(MATCHED_TEXT_MARK_CLASS_NAME);
    }

    cleanup();

    render(
      <PaletteRow
        item={{
          id: "on-call",
          title: "On-Call Policies",
          description: "Page the right person when something breaks",
        }}
        query="page"
        isActive={false}
        onActivate={() => {}}
        onSelect={() => {}}
        setRowElement={() => {}}
      />,
    );

    expect(
      marksOf(screen.getByTestId("command-palette-option-on-call")),
    ).toEqual(["Page"]);
  });

  test("the project list's row marks a name with the same mark", () => {
    const project: Project = new Project();
    project._id = "b7000000-0000-4000-8000-0000000000aa";
    project.name = "Sample: Acme Shop";

    render(
      <ul role="listbox">
        <ProjectPickerMenuItem
          id="project-picker-matched-row"
          icon={IconProp.Folder}
          project={project}
          searchText="acme"
          onProjectSelected={() => {}}
        />
      </ul>,
    );

    const row: HTMLElement = screen.getByRole("option");
    const mark: HTMLElement | null = row.querySelector("mark");

    expect(row).toHaveTextContent("Sample: Acme Shop");
    expect(mark).toHaveTextContent("Acme");
    expect(mark!.className).toBe(MATCHED_TEXT_MARK_CLASS_NAME);
  });

  test("a project's row with no search, or no name, draws no mark", () => {
    const named: Project = new Project();
    named._id = "b7000000-0000-4000-8000-0000000000ab";
    named.name = "Sample: Acme Shop";

    const nameless: Project = new Project();
    nameless._id = "b7000000-0000-4000-8000-0000000000ac";

    render(
      <ul role="listbox">
        <ProjectPickerMenuItem
          id="project-picker-unsearched-row"
          icon={IconProp.Folder}
          project={named}
          onProjectSelected={() => {}}
        />
        <ProjectPickerMenuItem
          id="project-picker-nameless-row"
          icon={IconProp.Folder}
          project={nameless}
          searchText="acme"
          onProjectSelected={() => {}}
        />
      </ul>,
    );

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(document.querySelectorAll("mark")).toHaveLength(0);
    expect(screen.getByText("Sample: Acme Shop")).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  test("the mark is a soft yellow ground under the text's own colour, which the dark theme gives its own shade", () => {
    const classes: Array<string> = MATCHED_TEXT_MARK_CLASS_NAME.split(" ");

    expect(classes).toContain("bg-yellow-100");
    expect(classes).toContain("text-inherit");

    const theme: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../UI/Styles/Theme.css"),
      "utf8",
    );

    expect(theme).toMatch(/html\.dark :is\([^)]*\.bg-yellow-100[^)]*\)/);
  });
});
