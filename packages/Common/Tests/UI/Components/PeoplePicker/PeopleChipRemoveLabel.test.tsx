import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * WHAT A CHIP'S REMOVE BUTTON IS CALLED.
 *
 * A chip in a picker has a button that takes the pick away, named after it:
 * "Remove Platform". An escalation rule's Notify picker can hold one on-call
 * schedule twice - as itself (whoever is on call) and as its Next in
 * rotation (the person after them) - and both chips carry the schedule's
 * name. So the Next in rotation chip's button names its tag as well,
 * "Remove Primary (Next in rotation)", and a screen reader never hears two
 * buttons that read the same but remove different things.
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

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import { PeopleChip } from "../../../../UI/Components/PeoplePicker/PeopleList";
import {
  PEOPLE_PICKER_KIND_DEFINITIONS,
  PeoplePickerKindDefinition,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PRIMARY: string = "0000000c-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

function option(
  kind: PeoplePickerKind,
  id: string,
  name: string,
): PeoplePickerOption {
  return { kind: kind, id: id, name: name };
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
});

describe("a chip's remove button", () => {
  test("is named after the pick", () => {
    render(
      <PeopleChip
        kind={PeoplePickerKind.Team}
        id={PLATFORM}
        option={option(PeoplePickerKind.Team, PLATFORM, "Platform")}
        onRemove={() => {}}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Remove Platform",
    });

    expect(button.getAttribute("title")).toBe("Remove Platform");
  });

  test("one schedule picked both ways: two remove buttons, each saying which pick it takes away", () => {
    const removed: Array<string> = [];

    render(
      <div>
        <PeopleChip
          kind={PeoplePickerKind.OnCallSchedule}
          id={PRIMARY}
          option={option(PeoplePickerKind.OnCallSchedule, PRIMARY, "Primary")}
          onRemove={() => {
            removed.push("on call");
          }}
        />
        <PeopleChip
          kind={PeoplePickerKind.OnCallScheduleNextInRotation}
          id={PRIMARY}
          option={option(
            PeoplePickerKind.OnCallScheduleNextInRotation,
            PRIMARY,
            "Primary",
          )}
          onRemove={() => {
            removed.push("next in rotation");
          }}
        />
      </div>,
    );

    const next: HTMLElement = screen.getByRole("button", {
      name: "Remove Primary (Next in rotation)",
    });

    expect(next.getAttribute("title")).toBe(
      "Remove Primary (Next in rotation)",
    );
    // The schedule's own chip is named as before.
    expect(
      screen.getAllByRole("button", { name: "Remove Primary" }),
    ).toHaveLength(1);

    fireEvent.click(next);

    expect(removed).toEqual(["next in rotation"]);
    // The chip itself shows the name and the tag, as before.
    expect(screen.getAllByTestId("people-chip")[1]).toHaveTextContent(
      "PrimaryNext in rotation",
    );
  });

  test("a read-only chip has no button to name", () => {
    render(
      <PeopleChip
        kind={PeoplePickerKind.OnCallScheduleNextInRotation}
        id={PRIMARY}
        option={option(
          PeoplePickerKind.OnCallScheduleNextInRotation,
          PRIMARY,
          "Primary",
        )}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  test("only Next in rotation names its tag: every other kind is one pick per record", () => {
    const tagged: Array<PeoplePickerKind> = Object.values(
      PEOPLE_PICKER_KIND_DEFINITIONS,
    )
      .filter((definition: PeoplePickerKindDefinition): boolean => {
        return Boolean(definition.isTagInRemoveLabel);
      })
      .map((definition: PeoplePickerKindDefinition): PeoplePickerKind => {
        return definition.kind;
      });

    expect(tagged).toEqual([PeoplePickerKind.OnCallScheduleNextInRotation]);
  });
});
