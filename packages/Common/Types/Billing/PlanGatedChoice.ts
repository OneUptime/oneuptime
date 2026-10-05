import { PlanType } from "./SubscriptionPlan";

/*
 * A setting that is one choice of a few - who can see a status page, who
 * can view a dashboard - where a plan sells some of the choices.
 *
 * Leaving a paid choice never needs a plan: the move takes the plan-gated
 * column back to its default, which every plan may write
 * (PlanGatedColumnDefault). Coming back does. So a page that offers such a
 * move - a status page a trial left private made public, a dashboard a
 * trial left public made private - says, before it is saved, which plan
 * coming back needs.
 *
 * The plan coming back needs, or null when the move is not one of those: it
 * needs a plan itself, it goes nowhere, or coming back needs none either.
 */
export const getPlanNeededToComeBack: <TChoice, TState>(data: {
  // What the setting holds now.
  from: TState;
  // The choice it moves to.
  to: TChoice;
  // The choice a state is.
  getChoice: (state: TState) => TChoice;
  // What the setting holds once a move is written.
  getStateAfter: (move: { from: TState; to: TChoice }) => TState;
  // The plan a move needs, or null when it needs none.
  getPlanNeededForMove: (move: {
    from: TState;
    to: TChoice;
  }) => PlanType | null;
}) => PlanType | null = <TChoice, TState>(data: {
  from: TState;
  to: TChoice;
  getChoice: (state: TState) => TChoice;
  getStateAfter: (move: { from: TState; to: TChoice }) => TState;
  getPlanNeededForMove: (move: {
    from: TState;
    to: TChoice;
  }) => PlanType | null;
}): PlanType | null => {
  const current: TChoice = data.getChoice(data.from);

  if (
    current === data.to ||
    data.getPlanNeededForMove({ from: data.from, to: data.to })
  ) {
    return null;
  }

  return data.getPlanNeededForMove({
    from: data.getStateAfter({ from: data.from, to: data.to }),
    to: current,
  });
};
