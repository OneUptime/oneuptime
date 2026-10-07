import { describe, expect, test } from "@jest/globals";
import { getPlanNeededToComeBack } from "../../../Types/Billing/PlanGatedChoice";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

/*
 * getPlanNeededToComeBack: for a setting that is one choice of a few, where
 * a plan sells some of the choices, the plan coming back to the current
 * choice needs after a move that itself needs none.
 *
 * The setting here is a toy one shaped like a dashboard's access: Private
 * (the default, free) or Public (sold on Scale), plus whether a password is
 * kept, which a move to Private clears - so coming back starts from the
 * state the move leaves, not the one it came from.
 */

type Choice = "Private" | "Public";

interface State {
  choice: Choice;
  hasPassword: boolean;
}

interface Move {
  from: State;
  to: Choice;
}

// Moving to Public needs Scale on a plan below it; moving to Private never does.
const belowScale: (move: Move) => PlanType | null = (
  move: Move,
): PlanType | null => {
  return move.to === "Public" && move.from.choice !== "Public"
    ? PlanType.Scale
    : null;
};

const onScale: (move: Move) => PlanType | null = (): PlanType | null => {
  return null;
};

const getChoice: (state: State) => Choice = (state: State): Choice => {
  return state.choice;
};

const getStateAfter: (move: Move) => State = (move: Move): State => {
  return {
    choice: move.to,
    hasPassword: move.to === "Private" ? false : move.from.hasPassword,
  };
};

const PUBLIC: State = { choice: "Public", hasPassword: true };
const PRIVATE: State = { choice: "Private", hasPassword: false };

describe("getPlanNeededToComeBack", () => {
  test("leaving a paid choice needs no plan, coming back to it does: that plan is named", () => {
    expect(
      getPlanNeededToComeBack<Choice, State>({
        from: PUBLIC,
        to: "Private",
        getChoice: getChoice,
        getStateAfter: getStateAfter,
        getPlanNeededForMove: belowScale,
      }),
    ).toBe(PlanType.Scale);
  });

  test("a move that needs a plan itself says nothing about coming back: it is refused first", () => {
    expect(
      getPlanNeededToComeBack<Choice, State>({
        from: PRIVATE,
        to: "Public",
        getChoice: getChoice,
        getStateAfter: getStateAfter,
        getPlanNeededForMove: belowScale,
      }),
    ).toBe(null);
  });

  test("a move that goes nowhere needs nothing to come back", () => {
    for (const from of [PUBLIC, PRIVATE]) {
      expect(
        getPlanNeededToComeBack<Choice, State>({
          from: from,
          to: from.choice,
          getChoice: getChoice,
          getStateAfter: getStateAfter,
          getPlanNeededForMove: belowScale,
        }),
      ).toBe(null);
    }
  });

  test("on a plan that has every choice, no move needs a plan to come back", () => {
    for (const [from, to] of [
      [PUBLIC, "Private"],
      [PRIVATE, "Public"],
    ] as Array<[State, Choice]>) {
      expect(
        getPlanNeededToComeBack<Choice, State>({
          from: from,
          to: to,
          getChoice: getChoice,
          getStateAfter: getStateAfter,
          getPlanNeededForMove: onScale,
        }),
      ).toBe(null);
    }
  });

  test("coming back is asked from the state the move leaves, to the choice it leaves", () => {
    const asked: Array<Move> = [];

    getPlanNeededToComeBack<Choice, State>({
      from: PUBLIC,
      to: "Private",
      getChoice: getChoice,
      getStateAfter: getStateAfter,
      getPlanNeededForMove: (move: Move): PlanType | null => {
        asked.push(move);
        return belowScale(move);
      },
    });

    expect(asked).toEqual([
      // The move itself, from what the setting holds now.
      { from: PUBLIC, to: "Private" },
      // Then coming back, from what the move leaves (the password cleared).
      { from: { choice: "Private", hasPassword: false }, to: "Public" },
    ]);
  });
});
