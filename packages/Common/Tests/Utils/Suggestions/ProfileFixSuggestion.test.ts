import { describe, expect, test } from "@jest/globals";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import { ProfileCategory } from "../../../Utils/Profiles/ProfileTypes";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_PROFILE_FIX_SUGGESTION,
  PROFILE_FIX_MIN_FUNCTION_SAMPLES,
  PROFILE_FIX_MIN_GROWTH_POINTS,
  PROFILE_FIX_MIN_OWN_SHARE_PERCENT,
  PROFILE_FIX_MIN_WINDOW_SAMPLES,
  PROFILE_NOT_WORTH_FIXING_MESSAGE,
  ProfileFixOffer,
  ProfileFixReason,
  ProfileFixSuggestion,
  ProfileHotspotEvidence,
  getProfileFixOffer,
  getProfileFixReason,
  isProfileHotspotWorthFixing,
  parseProfileFixSuggestion,
  profileFixSuggestionToJSON,
} from "../../../Utils/Suggestions/ProfileFixSuggestion";

/*
 * "Fix with AI" in the Profiler is offered only where it applies: the
 * application's own code, taking a real share of the time (or memory) or a
 * share that grew, in a window with enough samples to say so - and then
 * only as far as the shared code-fix decision allows (AI on, nothing on its
 * way, a repository to open the pull request in, nothing in Code's way).
 * The server's two routes and the panel all read this one helper.
 */

const HOT: ProfileHotspotEvidence = {
  category: ProfileCategory.Cpu,
  isOwnCode: true,
  ownShare: 42,
  functionSampleCount: 12400,
  windowSampleCount: 29500,
};

const REPOSITORY: { id: string; name: string } = {
  id: "90000000-0000-4000-8000-0000000000c1",
  name: "acme/checkout",
};

describe("which functions are worth a fix", () => {
  test("the application's own code with a real share is hot", () => {
    expect(getProfileFixReason(HOT)).toBe(ProfileFixReason.Hot);
    expect(isProfileHotspotWorthFixing(HOT)).toBe(true);
  });

  test("exactly at the threshold counts; just under it does not", () => {
    expect(
      getProfileFixReason({
        ...HOT,
        ownShare: PROFILE_FIX_MIN_OWN_SHARE_PERCENT,
      }),
    ).toBe(ProfileFixReason.Hot);
    expect(
      getProfileFixReason({
        ...HOT,
        ownShare: PROFILE_FIX_MIN_OWN_SHARE_PERCENT - 0.1,
      }),
    ).toBeNull();
  });

  test("a share that grew is worth it while still small - and growth is named first", () => {
    expect(
      getProfileFixReason({
        ...HOT,
        ownShare: 4,
        ownShareBefore: 4 - PROFILE_FIX_MIN_GROWTH_POINTS,
      }),
    ).toBe(ProfileFixReason.Grew);
    expect(
      getProfileFixReason({ ...HOT, ownShare: 42, ownShareBefore: 10 }),
    ).toBe(ProfileFixReason.Grew);
    // Grown by less: hot still, if hot.
    expect(
      getProfileFixReason({ ...HOT, ownShare: 42, ownShareBefore: 41 }),
    ).toBe(ProfileFixReason.Hot);
    expect(
      getProfileFixReason({ ...HOT, ownShare: 3, ownShareBefore: 1 }),
    ).toBeNull();
  });

  test.each([
    ["a library's or the runtime's code", { isOwnCode: false }],
    [
      "too few samples of the function",
      { functionSampleCount: PROFILE_FIX_MIN_FUNCTION_SAMPLES - 1 },
    ],
    [
      "too few samples in the window",
      { windowSampleCount: PROFILE_FIX_MIN_WINDOW_SAMPLES - 1 },
    ],
    ["a goroutine snapshot", { category: ProfileCategory.Goroutines }],
    ["a profile type of no kind", { category: ProfileCategory.Other }],
    ["a share that is not a number", { ownShare: Number.NaN }],
  ])("%s is not", (_name: string, change: Partial<ProfileHotspotEvidence>) => {
    expect(getProfileFixReason({ ...HOT, ...change })).toBeNull();
  });

  test.each([
    ProfileCategory.Cpu,
    ProfileCategory.Wall,
    ProfileCategory.Memory,
    ProfileCategory.Allocations,
    ProfileCategory.Locks,
  ])("%s is work to make lighter", (category: ProfileCategory) => {
    expect(getProfileFixReason({ ...HOT, category })).toBe(
      ProfileFixReason.Hot,
    );
  });

  test("the refusal says the same thresholds in words", () => {
    expect(PROFILE_NOT_WORTH_FIXING_MESSAGE).toContain(
      `${PROFILE_FIX_MIN_OWN_SHARE_PERCENT}%`,
    );
    expect(PROFILE_NOT_WORTH_FIXING_MESSAGE).toContain(
      `${PROFILE_FIX_MIN_GROWTH_POINTS} points`,
    );
    expect(PROFILE_NOT_WORTH_FIXING_MESSAGE).toContain(
      `${PROFILE_FIX_MIN_WINDOW_SAMPLES} samples`,
    );
  });
});

describe("what the panel is offered", () => {
  const base: Parameters<typeof getProfileFixOffer>[0] = {
    evidence: HOT,
    isAiEnabled: true,
    hasActiveFix: false,
    hasConnectedRepository: true,
  };

  test("a hot function with everything in place: the fix", () => {
    const offer: ProfileFixOffer = getProfileFixOffer(base);

    expect(offer).toEqual({
      offer: SuggestionOffer.Act,
      reason: ProfileFixReason.Hot,
      blocker: null,
    });
  });

  test("AI off, or a function not worth it: nothing at all", () => {
    expect(getProfileFixOffer({ ...base, isAiEnabled: false }).offer).toBe(
      SuggestionOffer.None,
    );
    expect(
      getProfileFixOffer({ ...base, evidence: { ...HOT, isOwnCode: false } })
        .offer,
    ).toBe(SuggestionOffer.None);
  });

  test("a fix on its way: a link to it", () => {
    expect(getProfileFixOffer({ ...base, hasActiveFix: true }).offer).toBe(
      SuggestionOffer.InProgress,
    );
  });

  test("no repository connected: the set-up step to connect one", () => {
    const offer: ProfileFixOffer = getProfileFixOffer({
      ...base,
      hasConnectedRepository: false,
    });

    expect(offer.offer).toBe(SuggestionOffer.SetUp);
    expect(offer.blocker!.type).toBe(
      CodeTaskBlockerType.RepositoryNotConnected,
    );
  });

  test("Code's gate says no: that step, in Code's words - unless the person may not ask at all", () => {
    const credits: ProfileFixOffer = getProfileFixOffer({
      ...base,
      blocker: {
        type: CodeTaskBlockerType.NoAiCredits,
        message: "The project has no AI credits left.",
      },
    });

    expect(credits.offer).toBe(SuggestionOffer.SetUp);
    expect(credits.blocker!.type).toBe(CodeTaskBlockerType.NoAiCredits);

    expect(
      getProfileFixOffer({
        ...base,
        blocker: {
          type: CodeTaskBlockerType.NoPermission,
          message: "You cannot ask AI in this repository.",
        },
      }).offer,
    ).toBe(SuggestionOffer.None);
  });
});

describe("the suggestion route's answer", () => {
  const act: ProfileFixSuggestion = {
    offer: SuggestionOffer.Act,
    reason: ProfileFixReason.Hot,
    blocker: null,
    evidence: HOT,
    repository: REPOSITORY,
    repositories: [],
    taskId: null,
  };

  test("reads back as it was written", () => {
    expect(
      parseProfileFixSuggestion(
        JSON.parse(JSON.stringify(profileFixSuggestionToJSON(act))),
      ),
    ).toEqual(act);
  });

  test("a fix with repositories to pick from keeps them", () => {
    const pick: ProfileFixSuggestion = {
      ...act,
      repository: null,
      repositories: [REPOSITORY, { id: "r2", name: "acme/platform" }],
    };

    expect(
      parseProfileFixSuggestion(profileFixSuggestionToJSON(pick)).repositories,
    ).toHaveLength(2);
  });

  test("work in progress keeps its task", () => {
    const working: ProfileFixSuggestion = {
      ...NO_PROFILE_FIX_SUGGESTION,
      offer: SuggestionOffer.InProgress,
      reason: ProfileFixReason.Hot,
      evidence: HOT,
      taskId: "70000000-0000-4000-8000-0000000000f2",
    };

    expect(
      parseProfileFixSuggestion(profileFixSuggestionToJSON(working)).taskId,
    ).toBe("70000000-0000-4000-8000-0000000000f2");
  });

  test.each([
    ["nothing", null],
    ["a list", []],
    ["no offer", {}],
    [
      "a fix for a function the rule would not offer",
      {
        ...profileFixSuggestionToJSON(act),
        evidence: { ...HOT, isOwnCode: false },
      },
    ],
    [
      "a fix with nowhere to ask it",
      {
        ...profileFixSuggestionToJSON(act),
        repository: null,
        repositories: [],
      },
    ],
    [
      "a set-up step that does not say what it is",
      {
        ...profileFixSuggestionToJSON(act),
        offer: SuggestionOffer.SetUp,
        blocker: { type: "Unknown", message: "" },
      },
    ],
    [
      "work in progress with no task",
      { ...profileFixSuggestionToJSON(act), offer: SuggestionOffer.InProgress },
    ],
    [
      "a finished fix, which this suggestion never says, even with somewhere to ask it",
      {
        ...profileFixSuggestionToJSON(act),
        offer: SuggestionOffer.Done,
        taskId: "70000000-0000-4000-8000-0000000000f2",
      },
    ],
    [
      "evidence that does not hold together",
      { ...profileFixSuggestionToJSON(act), evidence: { category: "cpu" } },
    ],
  ])("%s reads as no suggestion", (_name: string, answer: unknown) => {
    expect(parseProfileFixSuggestion(answer as JSONObject)).toEqual(
      NO_PROFILE_FIX_SUGGESTION,
    );
  });
});
