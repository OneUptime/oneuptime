import { summarizeOffHoursFallback } from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";

/*
 * The exact phrase the UI used to print for EVERY restricted layer. On the
 * lowest-priority layer it is a lie (there is no layer underneath to take
 * over), so its reappearance in that branch is the regression these tests
 * exist to catch. Kept as a constant so the check reads the same everywhere.
 */
const TAKE_OVER_PHRASE: string = "take over";

/*
 * Every non-null sentence is rendered straight into the layer header, so it has
 * to be a real sentence: not blank, and terminated.
 */
function expectRenderableSentence(sentence: string | null): void {
  expect(sentence).not.toBeNull();
  expect(typeof sentence).toBe("string");
  expect((sentence as string).trim().length).toBeGreaterThan(0);
  expect((sentence as string).endsWith(".")).toBe(true);
}

describe("LayerSummary.summarizeOffHoursFallback: no restriction", () => {
  /*
   * An unrestricted layer covers all 24 hours, so there are no "off hours" to
   * describe at all. Returning a sentence here would tell a 24/7 layer's owner
   * that some other layer covers them at night, which is both wrong and
   * alarming. Both lower-priority-layer values must stay null: the presence of
   * a layer underneath must never be able to resurrect the sentence.
   */
  test("returns null when the layer has no restriction, for either lower-priority value", () => {
    const withLowerLayer: string | null = summarizeOffHoursFallback({
      hasRestriction: false,
      hasLowerPriorityLayer: true,
    });
    const withoutLowerLayer: string | null = summarizeOffHoursFallback({
      hasRestriction: false,
      hasLowerPriorityLayer: false,
    });

    expect(withLowerLayer).toBeNull();
    expect(withoutLowerLayer).toBeNull();
  });

  /*
   * capitalize is a formatting knob; it must not become an accidental gate that
   * makes an unrestricted layer produce a sentence.
   */
  test("capitalize does not resurrect the sentence for an unrestricted layer", () => {
    expect(
      summarizeOffHoursFallback({
        hasRestriction: false,
        hasLowerPriorityLayer: true,
        capitalize: true,
      }),
    ).toBeNull();
    expect(
      summarizeOffHoursFallback({
        hasRestriction: false,
        hasLowerPriorityLayer: false,
        capitalize: true,
      }),
    ).toBeNull();
  });
});

describe("LayerSummary.summarizeOffHoursFallback: restricted layer with a layer underneath", () => {
  /*
   * This is the one configuration in which the historic sentence was actually
   * true — a restricted layer with a lower-priority layer beneath it really
   * does hand off outside its hours. The fix must not have thrown the true
   * case out along with the false one.
   */
  test("says lower-priority layers take over", () => {
    const sentence: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: true,
    });

    expectRenderableSentence(sentence);
    expect(sentence).toContain("lower-priority layers take over");
  });
});

describe("LayerSummary.summarizeOffHoursFallback: restricted lowest-priority layer", () => {
  /*
   * The bug this whole function exists for: a single Mon-Fri 9-5 layer is the
   * lowest-priority layer, so nights and weekends are a genuine coverage gap.
   * The user must be told that in plain words instead of being reassured.
   * Asserted on meaning rather than exact wording so copy edits stay free.
   */
  test("states plainly that nobody is on call outside the restricted hours", () => {
    const sentence: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
    });

    expectRenderableSentence(sentence);
    expect(sentence as string).toMatch(/nobody/i);
    expect(sentence as string).toMatch(/nobody[\s\S]*on call/i);
  });

  /*
   * The precise regression: any edit that reintroduces the hand-off promise on
   * the bottom layer — by re-merging the branches, by flipping the
   * hasLowerPriorityLayer condition, or by pasting the old copy back — puts
   * "take over" into this string again.
   */
  test("never promises a hand-off when there is no layer to hand off to", () => {
    const plain: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
    });
    const capitalized: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
      capitalize: true,
    });

    expect(plain).not.toContain(TAKE_OVER_PHRASE);
    expect(capitalized).not.toContain(TAKE_OVER_PHRASE);
  });

  /*
   * The two branches must not have collapsed into one shared string; if they
   * ever read identically, one of the two configurations is being described
   * wrongly no matter which wording survived.
   */
  test("differs from the sentence used when a lower-priority layer exists", () => {
    const lowest: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
    });
    const withFallback: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: true,
    });

    expect(lowest).not.toBe(withFallback);
  });
});

describe("LayerSummary.summarizeOffHoursFallback: capitalize option", () => {
  /*
   * Callers splice this after a semicolon ("Daily 9-5; outside those hours...")
   * or print it as its own sentence. Getting the default wrong produces a
   * mid-sentence capital or a lowercase sentence start in the layer header, so
   * the default (omitted) must stay lowercase for both branches.
   */
  test("omitted capitalize starts lowercase in both branches", () => {
    const lowest: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
    });
    const withFallback: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: true,
    });

    expect(lowest as string).toMatch(/^[a-z]/);
    expect(withFallback as string).toMatch(/^[a-z]/);
  });

  /*
   * An explicit false is the documented way to ask for the mid-sentence form,
   * so it must behave exactly like omitting the option rather than falling into
   * some third state.
   */
  test("capitalize false is identical to omitting it", () => {
    const omittedLowest: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
    });
    const explicitFalseLowest: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: false,
      capitalize: false,
    });
    const omittedWithFallback: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: true,
    });
    const explicitFalseWithFallback: string | null = summarizeOffHoursFallback({
      hasRestriction: true,
      hasLowerPriorityLayer: true,
      capitalize: false,
    });

    expect(explicitFalseLowest).toBe(omittedLowest);
    expect(explicitFalseWithFallback).toBe(omittedWithFallback);
  });

  /*
   * Capitalizing must only touch the first letter. A naive implementation
   * (toUpperCase on the whole string, or a sentence-case pass) would shout the
   * warning or mangle the em-dash clause, and a slice bug would silently drop
   * the first word of the coverage-gap warning.
   */
  test("capitalize true only uppercases the first character, for both branches", () => {
    const branches: Array<boolean> = [true, false];

    for (const hasLowerPriorityLayer of branches) {
      const lower: string | null = summarizeOffHoursFallback({
        hasRestriction: true,
        hasLowerPriorityLayer: hasLowerPriorityLayer,
        capitalize: false,
      });
      const upper: string | null = summarizeOffHoursFallback({
        hasRestriction: true,
        hasLowerPriorityLayer: hasLowerPriorityLayer,
        capitalize: true,
      });

      expectRenderableSentence(lower);
      expectRenderableSentence(upper);

      const lowerText: string = lower as string;
      const upperText: string = upper as string;

      expect(upperText.charAt(0)).toBe(lowerText.charAt(0).toUpperCase());
      expect(upperText.charAt(0)).toMatch(/^[A-Z]$/);
      expect(upperText.slice(1)).toBe(lowerText.slice(1));
      expect(upperText.length).toBe(lowerText.length);
    }
  });
});
