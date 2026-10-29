import { getDataSecurityIssueFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueFeedKind";
import { getDataStoreFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreFeedKind";
import { resolveResourceFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceFeed/ResourceFeed";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import { Gray500, Green500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryColor,
} from "../../../UI/Components/Feed/FeedEntryKind";
import { getFeedEventTypeLabel } from "../../../UI/Components/Feed/FeedOptions";
import { describe, expect, test } from "@jest/globals";

/*
 * How the entries of the two Data Security timelines look: an issue's and a
 * data store's. ResourceFeed draws an event type its feed does not map, and
 * the shared suffix rules do not know, as a grey dot ("Other"), so every
 * event either timeline records must come out as something a reader can
 * tell apart - and a response action, which the server colours by what it
 * did, must take the row's colour.
 */

const ISSUE_EVENT_TYPES: Array<string> = Object.values(
  DataSecurityIssueFeedEventType,
);
const STORE_EVENT_TYPES: Array<string> = Object.values(DataStoreFeedEventType);

describe("a Data Security issue's timeline", () => {
  test.each(ISSUE_EVENT_TYPES)(
    "%s has a look of its own, not the grey dot",
    (eventType: string) => {
      const kind: FeedEntryKind = resolveResourceFeedKind({
        eventType: eventType,
        getKind: getDataSecurityIssueFeedKind,
      });

      expect(getDataSecurityIssueFeedKind(eventType)).toBeDefined();
      expect(kind).not.toBe(SHARED_FEED_ENTRY_KINDS.Other);
    },
  );

  test("a response action takes the colour the server gave it: green when the store changed, grey when it was already so", () => {
    const kind: FeedEntryKind = resolveResourceFeedKind({
      eventType: DataSecurityIssueFeedEventType.ResponseActionTaken,
      getKind: getDataSecurityIssueFeedKind,
    });

    expect(kind.icon).toBe(IconProp.ShieldCheck);
    expect(kind.tone).toBe(FeedTone.Record);

    const changed: Color = getFeedEntryColor({
      kind: kind,
      rowColor: Green500,
    });
    const unchanged: Color = getFeedEntryColor({
      kind: kind,
      rowColor: Gray500,
    });

    expect(changed.toString()).toBe(Green500.toString());
    expect(unchanged.toString()).toBe(Gray500.toString());
  });
});

describe("a data store's timeline", () => {
  test.each(STORE_EVENT_TYPES)(
    "%s has a look of its own, not the grey dot",
    (eventType: string) => {
      const kind: FeedEntryKind = resolveResourceFeedKind({
        eventType: eventType,
        getKind: getDataStoreFeedKind,
      });

      expect(kind).not.toBe(SHARED_FEED_ENTRY_KINDS.Other);
    },
  );

  test("a store's created, updated, archived, restored, owner and rule entries look the way every resource feed's do", () => {
    const shared: Array<[string, FeedEntryKind]> = [
      [
        DataStoreFeedEventType.DataStoreCreated,
        SHARED_FEED_ENTRY_KINDS.Created,
      ],
      [
        DataStoreFeedEventType.DataStoreUpdated,
        SHARED_FEED_ENTRY_KINDS.Updated,
      ],
      [
        DataStoreFeedEventType.DataStoreArchived,
        SHARED_FEED_ENTRY_KINDS.Archived,
      ],
      [
        DataStoreFeedEventType.DataStoreRestored,
        SHARED_FEED_ENTRY_KINDS.Restored,
      ],
      [
        DataStoreFeedEventType.OwnerUserAdded,
        SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
      ],
      [
        DataStoreFeedEventType.OwnerTeamRemoved,
        SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
      ],
      [
        DataStoreFeedEventType.OwnerRuleExecuted,
        SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
      ],
      [
        DataStoreFeedEventType.LabelRuleExecuted,
        SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
      ],
    ];

    for (const [eventType, expected] of shared) {
      expect(getDataStoreFeedKind(eventType)).toBeUndefined();
      expect(
        resolveResourceFeedKind({
          eventType: eventType,
          getKind: getDataStoreFeedKind,
        }),
      ).toBe(expected);
    }
  });

  test("a response action that closed the store's exposure takes the row's colour", () => {
    const kind: FeedEntryKind | undefined = getDataStoreFeedKind(
      DataStoreFeedEventType.ResponseActionTaken,
    );

    expect(kind).toEqual({ icon: IconProp.ShieldCheck, tone: FeedTone.Record });
    expect(
      getFeedEntryColor({ kind: kind!, rowColor: Green500 }).toString(),
    ).toBe(Green500.toString());
  });
});

describe("the event type filter's labels", () => {
  test("OneUptime AI's entries read AI, as the product writes it", () => {
    expect(
      getFeedEventTypeLabel(DataSecurityIssueFeedEventType.AiExplanation),
    ).toBe("AI Explanation");
    expect(
      getFeedEventTypeLabel(DataSecurityIssueFeedEventType.AiFixRequested),
    ).toBe("AI Fix Requested");
  });

  test("every other event type is its name in words", () => {
    expect(
      getFeedEventTypeLabel(DataSecurityIssueFeedEventType.AcceptanceExpired),
    ).toBe("Acceptance Expired");
    expect(
      getFeedEventTypeLabel(DataStoreFeedEventType.ResponseActionTaken),
    ).toBe("Response Action Taken");
    expect(
      getFeedEventTypeLabel(DataStoreFeedEventType.DataStoreArchived),
    ).toBe("Data Store Archived");
  });
});
