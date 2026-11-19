import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import OwnersCell from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import User from "../../../Models/DatabaseModels/User";
import Team from "../../../Models/DatabaseModels/Team";
import Name from "../../../Types/Name";
import Email from "../../../Types/Email";

/*
 * THE OWNERS COLUMN: ITS TOOLTIPS ARE WHOLE, AND A SCREEN READER HEARS WHO
 * OWNS THE ROW (#9769).
 *
 * "In the Monitors list view, hovering over an owner avatar in the first
 * row causes the hover tooltip to be visually cut off and clipped on the
 * left and top edges." The cell's tooltips - an owner's, and the "+N"'s
 * list of the rest - were drawn inside the table's cell, which clips its
 * value across. They are drawn on the page's body now (the shared
 * Tooltip's TooltipLayer), outside the cell and the list.
 *
 * And an owner drawn as initials was read as nothing at all: the initials
 * are for the eye only, and the tooltip that names the owner shows under
 * the pointer only. Each avatar is an image named by its owner now, and
 * the "+N" is read as the owners it stands for - names a screen reader
 * hears, never words drawn in the cell, whose text is what a cut-short
 * cell shows in full under the pointer.
 */

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

jest.setTimeout(30000);

const makeUser: (index: number, name: string) => ResourceOwnerEntry = (
  index: number,
  name: string,
): ResourceOwnerEntry => {
  const user: User = new User();
  user._id = `81000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  user.name = new Name(name);
  user.email = new Email(`person${index}@acme-commerce.example`);
  return { kind: "user", user: user } as ResourceOwnerEntry;
};

const makeTeam: (index: number, name: string) => ResourceOwnerEntry = (
  index: number,
  name: string,
): ResourceOwnerEntry => {
  const team: Team = new Team();
  team._id = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  team.name = name;
  return { kind: "team", team: team } as ResourceOwnerEntry;
};

const SIX_OWNERS: Array<ResourceOwnerEntry> = [
  makeUser(1, "Ada Lovelace"),
  makeTeam(2, "SRE"),
  makeUser(3, "Alan Turing"),
  makeUser(4, "Edsger Dijkstra"),
  makeUser(5, "Barbara Liskov"),
  makeTeam(6, "Payments"),
];

// The Owners cell of a list's first row, as the shared table draws it.
function FirstRow(props: { owners: Array<ResourceOwnerEntry> }): ReactElement {
  return (
    <div data-testid="table-scroll" style={{ overflowX: "auto" }}>
      <table>
        <tbody>
          <tr>
            <td>
              <div data-testid="cell" style={{ overflowX: "clip" }}>
                <OwnersCell owners={props.owners} />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Lets Tippy's deferred work run: a rich tooltip waits 120ms to show.
async function hover(element: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(element);
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 250);
    });
  });
}

afterEach(() => {
  cleanup();
});

describe("OwnersCell - its tooltips leave the table's cell (#9769)", () => {
  test("an owner's tooltip is drawn on the page's body, outside the cell and the list, whole", async () => {
    render(<FirstRow owners={[makeUser(1, "Ada Lovelace")]} />);

    await hover(screen.getByRole("img", { name: "Ada Lovelace" }));

    const email: HTMLElement = screen.getByText(
      "person1@acme-commerce.example",
    );
    const root: HTMLElement | null =
      email.closest<HTMLElement>("[data-tippy-root]");

    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);
    expect(screen.getByTestId("cell")).not.toContainElement(root);
    expect(screen.getByTestId("table-scroll")).not.toContainElement(root);
    expect(root).toHaveTextContent("Ada Lovelace");
  });

  test("a team's tooltip says it is a team, drawn outside the cell too", async () => {
    render(<FirstRow owners={[makeTeam(2, "SRE")]} />);

    await hover(screen.getByRole("img", { name: "SRE" }));

    const team: HTMLElement = screen.getByText("Team");
    const root: HTMLElement | null =
      team.closest<HTMLElement>("[data-tippy-root]");

    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);
    expect(screen.getByTestId("cell")).not.toContainElement(root);
  });

  test("the '+N' tooltip, listing the rest, is drawn outside the cell", async () => {
    render(<FirstRow owners={SIX_OWNERS} />);

    await hover(screen.getByText("+2"));

    const liskov: HTMLElement = screen.getByText("Barbara Liskov");
    const root: HTMLElement | null =
      liskov.closest<HTMLElement>("[data-tippy-root]");

    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);
    expect(screen.getByTestId("cell")).not.toContainElement(root);
    expect(root).toHaveTextContent("Payments");
  });
});

describe("OwnersCell - a screen reader hears who owns the row", () => {
  test("each owner is an image named by the owner - a person and a team alike", () => {
    render(
      <FirstRow owners={[makeUser(1, "Ada Lovelace"), makeTeam(2, "SRE")]} />,
    );

    expect(
      screen.getAllByRole("img").map((image: HTMLElement): string => {
        return image.getAttribute("aria-label") || "";
      }),
    ).toEqual(["Ada Lovelace", "SRE"]);
  });

  test("the '+N' is read as the owners it stands for", () => {
    render(<FirstRow owners={SIX_OWNERS} />);

    // Four drawn, then the two the '+2' stands for.
    expect(
      screen.getAllByRole("img").map((image: HTMLElement): string => {
        return image.getAttribute("aria-label") || "";
      }),
    ).toEqual([
      "Ada Lovelace",
      "SRE",
      "Alan Turing",
      "Edsger Dijkstra",
      "Barbara Liskov, Payments",
    ]);
    expect(
      screen.getByRole("img", { name: "Barbara Liskov, Payments" }),
    ).toHaveTextContent("+2");
  });

  test("the names are heard, never drawn: the cell's text is still its initials", () => {
    render(
      <FirstRow owners={[makeUser(1, "Ada Lovelace"), makeTeam(2, "SRE")]} />,
    );

    const text: string = screen.getByTestId("cell").textContent || "";

    expect(text).not.toContain("Ada Lovelace");
    expect(text).not.toContain("SRE");
    expect(text).toContain("AL");
  });
});
