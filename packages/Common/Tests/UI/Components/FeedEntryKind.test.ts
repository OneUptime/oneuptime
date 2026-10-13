import { describe, expect, test } from "@jest/globals";
import {
  Blue500,
  Gray500,
  Green500,
  Indigo500,
  Red500,
  Violet500,
  Amber500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import {
  FEED_BURST_COLLAPSE_LABEL,
  FEED_BURST_LABELS,
  FeedBurstKind,
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryColor,
  getFeedEntryKind,
  getFeedIcons,
} from "../../../UI/Components/Feed/FeedEntryKind";

/*
 * One icon and one colour per kind of entry, shared by every feed, and the
 * kinds that fold when they arrive in a burst.
 */

const kind: (tone: FeedTone) => FeedEntryKind = (
  tone: FeedTone,
): FeedEntryKind => {
  return { icon: IconProp.Circle, tone };
};

describe("colours", () => {
  test.each<[FeedTone, Color]>([
    [FeedTone.Neutral, Gray500],
    [FeedTone.Info, Blue500],
    [FeedTone.Success, Green500],
    [FeedTone.Warning, Amber500],
    [FeedTone.Danger, Red500],
    [FeedTone.People, Violet500],
    [FeedTone.AI, Indigo500],
  ])("%s is one fixed colour, whatever the row says", (tone: FeedTone, color: Color) => {
    expect(
      getFeedEntryColor({ kind: kind(tone), rowColor: Red500 }).toString(),
    ).toBe(color.toString());
  });

  test("a kind that takes the row's own colour takes it - a state change in its new state's colour", () => {
    const stateColor: Color = Color.fromString("#22c55e");

    expect(
      getFeedEntryColor({
        kind: SHARED_FEED_ENTRY_KINDS.StateChanged,
        rowColor: stateColor,
      }).toString(),
    ).toBe("#22c55e");
  });

  test("an old row without a colour is grey", () => {
    expect(
      getFeedEntryColor({
        kind: SHARED_FEED_ENTRY_KINDS.StateChanged,
      }).toString(),
    ).toBe(Gray500.toString());
  });
});

describe("looking a kind up", () => {
  const kinds: Record<"Known", FeedEntryKind> = {
    Known: SHARED_FEED_ENTRY_KINDS.PrivateNote,
  };

  test("a known event type gets its kind", () => {
    expect(getFeedEntryKind({ kinds, eventType: "Known" })).toBe(
      SHARED_FEED_ENTRY_KINDS.PrivateNote,
    );
  });

  test.each<[string | undefined]>([
    [undefined],
    [""],
    ["WrittenByANewerServer"],
    ["toString"],
    ["constructor"],
    ["__proto__"],
  ])(
    "%p - unknown, empty or an Object.prototype name - is the plain 'other' kind",
    (eventType: string | undefined) => {
      expect(getFeedEntryKind({ kinds, eventType })).toBe(
        SHARED_FEED_ENTRY_KINDS.Other,
      );
    },
  );

  test("a feed's icon table comes from its kinds", () => {
    expect(
      getFeedIcons({
        A: SHARED_FEED_ENTRY_KINDS.PrivateNote,
        B: SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
      }),
    ).toEqual({ A: IconProp.Lock, B: IconProp.UserPlus });
  });
});

describe("the shared kinds", () => {
  test("every kind that arrives in bursts folds as one of the four burst kinds", () => {
    const burstKinds: Array<[string, FeedBurstKind | undefined]> =
      Object.entries(SHARED_FEED_ENTRY_KINDS).map(
        (entry: [string, FeedEntryKind]): [string, FeedBurstKind | undefined] => {
          return [entry[0], entry[1].burst];
        },
      );

    expect(
      burstKinds.filter((entry: [string, FeedBurstKind | undefined]) => {
        return Boolean(entry[1]);
      }),
    ).toEqual([
      ["OwnerNotificationSent", FeedBurstKind.OwnerNotification],
      ["SubscriberNotificationSent", FeedBurstKind.SubscriberNotification],
      ["OnCallPolicy", FeedBurstKind.OnCall],
      ["OnCallNotification", FeedBurstKind.OnCall],
      ["LabelRuleExecuted", FeedBurstKind.Rule],
      ["OwnerRuleExecuted", FeedBurstKind.Rule],
      ["PrivacyRuleExecuted", FeedBurstKind.Rule],
      ["OnCallRuleExecuted", FeedBurstKind.Rule],
    ]);
  });

  test("people talking are blue, owners and roles violet, AI indigo, bookkeeping grey", () => {
    expect(SHARED_FEED_ENTRY_KINDS.PublicNote.tone).toBe(FeedTone.Info);
    expect(SHARED_FEED_ENTRY_KINDS.PrivateNote.tone).toBe(FeedTone.Info);
    expect(SHARED_FEED_ENTRY_KINDS.OwnerUserAdded.tone).toBe(FeedTone.People);
    expect(SHARED_FEED_ENTRY_KINDS.RoleAssigned.tone).toBe(FeedTone.People);
    expect(SHARED_FEED_ENTRY_KINDS.AIRootCause.tone).toBe(FeedTone.AI);
    expect(SHARED_FEED_ENTRY_KINDS.AIRootCause.icon).toBe(IconProp.Sparkles);
    expect(SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted.tone).toBe(
      FeedTone.Neutral,
    );
    expect(SHARED_FEED_ENTRY_KINDS.VideoCallFailed.tone).toBe(FeedTone.Danger);
  });

  test("a page and a state change take their row's colour: sent, acknowledged, skipped; the new state", () => {
    expect(SHARED_FEED_ENTRY_KINDS.OnCallPolicy.tone).toBe(FeedTone.Record);
    expect(SHARED_FEED_ENTRY_KINDS.OnCallNotification.tone).toBe(
      FeedTone.Record,
    );
    expect(SHARED_FEED_ENTRY_KINDS.StateChanged.tone).toBe(FeedTone.Record);
  });

  test("owners notified say who, behind their details", () => {
    expect(SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent.moreText).toBe(
      "Show who was notified",
    );
  });

  test("added and removed read apart: a plus and a minus", () => {
    expect(SHARED_FEED_ENTRY_KINDS.OwnerUserAdded.icon).toBe(IconProp.UserPlus);
    expect(SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved.icon).toBe(
      IconProp.UserMinus,
    );
    expect(SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved.icon).toBe(
      IconProp.UserMinus,
    );
    expect(SHARED_FEED_ENTRY_KINDS.Linked.icon).toBe(IconProp.Link);
    expect(SHARED_FEED_ENTRY_KINDS.Unlinked.icon).toBe(IconProp.LinkSlash);
  });
});

describe("the burst toggle's words", () => {
  test("each burst kind has a sentence for one and for many, with the count in it", () => {
    for (const burstKind of Object.values(FeedBurstKind)) {
      const label: { one: string; other: string } =
        FEED_BURST_LABELS[burstKind];

      expect(label.one).toContain("{{count}}");
      expect(label.other).toContain("{{count}}");
      expect(label.one).not.toBe(label.other);
      expect(label.other.startsWith("Show {{count}} more")).toBe(true);
    }
  });

  test("an unfolded burst folds back with Show fewer", () => {
    expect(FEED_BURST_COLLAPSE_LABEL).toBe("Show fewer");
  });
});
