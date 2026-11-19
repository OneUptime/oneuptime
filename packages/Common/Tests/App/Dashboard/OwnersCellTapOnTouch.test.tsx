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
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import { isTouchPointer } from "../../../UI/Components/Tooltip/TooltipTap";
import { isRowOpeningClick } from "../../../UI/Components/Table/RowClick";
import User from "../../../Models/DatabaseModels/User";
import Team from "../../../Models/DatabaseModels/Team";
import Name from "../../../Types/Name";
import Email from "../../../Types/Email";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ON A TOUCH SCREEN, A TAP ON AN OWNER'S AVATAR SAYS WHO OWNS THE ROW (#9866).
 *
 * From 768px to about 1100px wide, beside the side menu, a list draws its
 * rows as cards, and the cards keep their owners - a tablet's width, with
 * no pointer to hover. Each owner is drawn as initials, its name in the
 * avatar's hover tooltip only, and a tap on the avatar was a tap on the
 * card, which opened the record: the list never said who owned a row.
 *
 * Now the first tap on an avatar shows its tooltip - the same tooltip, the
 * same name a screen reader hears - and is the tooltip's alone: the card
 * does not open. A second tap on it, or a tap anywhere else on the card,
 * opens the record as before. A mouse's click opens the record at once, as
 * it always did.
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

/*
 * A list's card at a tablet's width, as the shared table draws one: it
 * opens its record on a click that is the card's own (Table/RowClick).
 */
function Card(props: {
  owners: Array<ResourceOwnerEntry>;
  onOpen: () => void;
}): ReactElement {
  return (
    <div
      data-testid="card"
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        if (isRowOpeningClick(event, { hasTextSelection: false })) {
          props.onOpen();
        }
      }}
    >
      <p data-testid="card-title">Payments Primary</p>
      <div data-testid="owners-field">
        <OwnersCell owners={props.owners} />
      </div>
    </div>
  );
}

// Lets Tippy's deferred work run: a rich tooltip waits 120ms to show.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 300);
    });
  });
}

// What a press tells: a finger's, a pen's or a mouse's.
function pointerDown(element: HTMLElement, pointerType: string): void {
  const event: MouseEvent = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });

  Object.defineProperty(event, "pointerType", { value: pointerType });
  element.dispatchEvent(event);
}

/*
 * A tap, as a touch screen sends it: the pointer's press and the touch, then
 * the mouse events a browser makes up for it, ending in the click.
 */
async function tap(
  element: HTMLElement,
  pointerType: string = "touch",
): Promise<void> {
  act(() => {
    pointerDown(element, pointerType);
  });
  fireEvent.touchStart(element);
  fireEvent.touchEnd(element);
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  await settle();
}

// A mouse's click: hovered first, then pressed.
async function click(element: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(element);
  act(() => {
    pointerDown(element, "mouse");
  });
  fireEvent.mouseDown(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  await settle();
}

// Whether a tooltip saying the given words shows.
function isTooltipShown(text: string): boolean {
  const element: HTMLElement | null = screen.queryByText(text, {
    exact: true,
  });
  const box: Element | null | undefined = element?.closest(".tippy-box");

  return Boolean(box && box.getAttribute("data-state") === "visible");
}

afterEach(() => {
  cleanup();
});

describe("an owner's avatar in a card, on a touch screen (#9866)", () => {
  test("the first tap shows who the owner is, and the card does not open", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={onOpen as () => void}
      />,
    );

    const avatar: HTMLElement = screen.getByRole("img", {
      name: "Ada Lovelace",
    });

    await tap(avatar);

    expect(onOpen).not.toHaveBeenCalled();
    expect(
      screen.getByText("person1@acme-commerce.example"),
    ).toBeInTheDocument();
    expect(isTooltipShown("person1@acme-commerce.example")).toBe(true);
    // The same name a screen reader hears, before and after.
    expect(avatar).toHaveAccessibleName("Ada Lovelace");
  });

  test("it stays once the finger lifts", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={onOpen as () => void}
      />,
    );

    const avatar: HTMLElement = screen.getByRole("img", {
      name: "Ada Lovelace",
    });

    await tap(avatar);
    // The finger lifts: the pointer leaves the avatar at once.
    fireEvent.mouseLeave(avatar);
    await settle();

    expect(isTooltipShown("person1@acme-commerce.example")).toBe(true);
  });

  test("a second tap on it opens the record, as before", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={onOpen as () => void}
      />,
    );

    const avatar: HTMLElement = screen.getByRole("img", {
      name: "Ada Lovelace",
    });

    await tap(avatar);
    await tap(avatar);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("a tap elsewhere on the card opens the record, as before", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={onOpen as () => void}
      />,
    );

    await tap(screen.getByRole("img", { name: "Ada Lovelace" }));
    expect(isTooltipShown("person1@acme-commerce.example")).toBe(true);

    await tap(screen.getByTestId("card-title"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    // And the tap put the tooltip away.
    expect(isTooltipShown("person1@acme-commerce.example")).toBe(false);
  });

  test("once it has gone, the next tap on the avatar shows it again rather than open the record", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={onOpen as () => void}
      />,
    );

    const avatar: HTMLElement = screen.getByRole("img", {
      name: "Ada Lovelace",
    });

    await tap(avatar);
    // Escape - a keyboard paired with the tablet - puts it away.
    fireEvent.keyDown(document.body, { key: "Escape" });
    await settle();
    expect(isTooltipShown("person1@acme-commerce.example")).toBe(false);

    await tap(avatar);

    expect(onOpen).not.toHaveBeenCalled();
    expect(isTooltipShown("person1@acme-commerce.example")).toBe(true);
  });

  test("a team says it is a team, and a pen taps as a finger does", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card owners={[makeTeam(2, "SRE")]} onOpen={onOpen as () => void} />,
    );

    await tap(screen.getByRole("img", { name: "SRE" }), "pen");

    expect(onOpen).not.toHaveBeenCalled();
    expect(isTooltipShown("Team")).toBe(true);
  });

  test("the +N says who the rest are on the first tap, too", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[
          makeUser(1, "Ada Lovelace"),
          makeTeam(2, "SRE"),
          makeUser(3, "Alan Turing"),
          makeUser(4, "Edsger Dijkstra"),
          makeUser(5, "Barbara Liskov"),
          makeTeam(6, "Payments"),
        ]}
        onOpen={onOpen as () => void}
      />,
    );

    const more: HTMLElement = screen.getByRole("img", {
      name: "Barbara Liskov, Payments",
    });

    await tap(more);

    expect(onOpen).not.toHaveBeenCalled();
    expect(isTooltipShown("Barbara Liskov")).toBe(true);
  });
});

describe("an owner's avatar in a card, with a mouse", () => {
  test("a click opens the record at once, as it always did", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={onOpen as () => void}
      />,
    );

    await click(screen.getByRole("img", { name: "Ada Lovelace" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("hovering still shows who it is", async () => {
    render(
      <Card
        owners={[makeUser(1, "Ada Lovelace")]}
        onOpen={getJestMockFunction() as () => void}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("img", { name: "Ada Lovelace" }));
    await settle();

    expect(isTooltipShown("person1@acme-commerce.example")).toBe(true);
  });
});

describe("the shared Tooltip's isShownOnFirstTap", () => {
  test("a finger and a pen are touch; a mouse is not", () => {
    expect(isTouchPointer("touch")).toBe(true);
    expect(isTouchPointer("pen")).toBe(true);
    expect(isTouchPointer("mouse")).toBe(false);
    expect(isTouchPointer("")).toBe(false);
  });

  test("without it, a tap goes on to what the trigger is in, as it always did", async () => {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <div onClick={onClick as () => void}>
        <Tooltip text="Copies the link">
          <span data-testid="trigger">Link</span>
        </Tooltip>
      </div>,
    );

    await tap(screen.getByTestId("trigger"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("with it, the first tap's click is prevented, so a row that reads it does not open", async () => {
    const clicks: Array<boolean> = [];

    render(
      <div
        onClick={(event: React.MouseEvent) => {
          clicks.push(event.defaultPrevented);
        }}
      >
        <Tooltip text="Ada Lovelace" isShownOnFirstTap={true}>
          <span data-testid="trigger">AL</span>
        </Tooltip>
      </div>,
    );

    await tap(screen.getByTestId("trigger"));
    await tap(screen.getByTestId("trigger"));

    // The first tap was the tooltip's; the second goes on.
    expect(clicks).toEqual([true, false]);
  });
});
