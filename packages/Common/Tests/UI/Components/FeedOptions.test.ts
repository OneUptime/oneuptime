import {
  DEFAULT_FEED_OPTIONS,
  DEFAULT_FEED_SORT_ORDER,
  FEED_OPTIONS_TEXT,
  FEED_SORT_ORDER_OPTIONS,
  FILTERED_FEED_NO_ITEMS_MESSAGE,
  FeedEventTypeOption,
  FeedOptions,
  FeedSortOrderOption,
  getFeedEventTypeLabel,
  getFeedEventTypeOptions,
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
  getFeedOptionsKey,
  getFeedOptionsSummary,
  isDefaultFeedOptions,
  isFeedFiltered,
  isFeedSortOrder,
  sanitizeFeedEventTypes,
  translateFeedOptionsText,
} from "../../../UI/Components/Feed/FeedOptions";
import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { CephClusterFeedEventType } from "../../../Models/DatabaseModels/CephClusterFeed";
import { CloudResourceFeedEventType } from "../../../Models/DatabaseModels/CloudResourceFeed";
import { DockerHostFeedEventType } from "../../../Models/DatabaseModels/DockerHostFeed";
import { DockerSwarmClusterFeedEventType } from "../../../Models/DatabaseModels/DockerSwarmClusterFeed";
import { HostFeedEventType } from "../../../Models/DatabaseModels/HostFeed";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import { KubernetesClusterFeedEventType } from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import MonitorFeed, {
  MonitorFeedEventType,
} from "../../../Models/DatabaseModels/MonitorFeed";
import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { PodmanHostFeedEventType } from "../../../Models/DatabaseModels/PodmanHostFeed";
import { ProxmoxClusterFeedEventType } from "../../../Models/DatabaseModels/ProxmoxClusterFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { ServiceFeedEventType } from "../../../Models/DatabaseModels/ServiceFeed";
import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import { VMwareVCenterFeedEventType } from "../../../Models/DatabaseModels/VMwareVCenterFeed";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import { ObjectType } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

interface FeedEventTypeSpec {
  // The feed model's file under Models/DatabaseModels, without ".ts".
  name: string;
  // The *FeedEventType enum that file exports.
  enumName: string;
  eventTypes: Array<string>;
}

/*
 * Every dashboard activity feed that gets the "Filter & Sort" button. Each
 * one's event types become a checklist, so every label below has to read well
 * and be told apart from its neighbours. "the feed inventory" below checks
 * this table against the models on disk, so a new feed model cannot slip
 * past the label checks.
 */
const FEEDS: Array<FeedEventTypeSpec> = [
  {
    name: "AlertEpisodeFeed",
    enumName: "AlertEpisodeFeedEventType",
    eventTypes: Object.values(AlertEpisodeFeedEventType),
  },
  {
    name: "AlertFeed",
    enumName: "AlertFeedEventType",
    eventTypes: Object.values(AlertFeedEventType),
  },
  {
    name: "CephClusterFeed",
    enumName: "CephClusterFeedEventType",
    eventTypes: Object.values(CephClusterFeedEventType),
  },
  {
    name: "CloudResourceFeed",
    enumName: "CloudResourceFeedEventType",
    eventTypes: Object.values(CloudResourceFeedEventType),
  },
  {
    name: "DockerHostFeed",
    enumName: "DockerHostFeedEventType",
    eventTypes: Object.values(DockerHostFeedEventType),
  },
  {
    name: "DockerSwarmClusterFeed",
    enumName: "DockerSwarmClusterFeedEventType",
    eventTypes: Object.values(DockerSwarmClusterFeedEventType),
  },
  {
    name: "HostFeed",
    enumName: "HostFeedEventType",
    eventTypes: Object.values(HostFeedEventType),
  },
  {
    name: "IncidentEpisodeFeed",
    enumName: "IncidentEpisodeFeedEventType",
    eventTypes: Object.values(IncidentEpisodeFeedEventType),
  },
  {
    name: "IncidentFeed",
    enumName: "IncidentFeedEventType",
    eventTypes: Object.values(IncidentFeedEventType),
  },
  {
    name: "KubernetesClusterFeed",
    enumName: "KubernetesClusterFeedEventType",
    eventTypes: Object.values(KubernetesClusterFeedEventType),
  },
  {
    name: "MonitorFeed",
    enumName: "MonitorFeedEventType",
    eventTypes: Object.values(MonitorFeedEventType),
  },
  {
    name: "OnCallDutyPolicyFeed",
    enumName: "OnCallDutyPolicyFeedEventType",
    eventTypes: Object.values(OnCallDutyPolicyFeedEventType),
  },
  {
    name: "PodmanHostFeed",
    enumName: "PodmanHostFeedEventType",
    eventTypes: Object.values(PodmanHostFeedEventType),
  },
  {
    name: "ProxmoxClusterFeed",
    enumName: "ProxmoxClusterFeedEventType",
    eventTypes: Object.values(ProxmoxClusterFeedEventType),
  },
  {
    name: "ScheduledMaintenanceFeed",
    enumName: "ScheduledMaintenanceFeedEventType",
    eventTypes: Object.values(ScheduledMaintenanceFeedEventType),
  },
  {
    name: "ServiceFeed",
    enumName: "ServiceFeedEventType",
    eventTypes: Object.values(ServiceFeedEventType),
  },
  {
    name: "ServiceLevelObjectiveFeed",
    enumName: "ServiceLevelObjectiveFeedEventType",
    eventTypes: Object.values(ServiceLevelObjectiveFeedEventType),
  },
  {
    name: "VMwareVCenterFeed",
    enumName: "VMwareVCenterFeedEventType",
    eventTypes: Object.values(VMwareVCenterFeedEventType),
  },
];

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Models",
  "DatabaseModels",
);

/*
 * A feed model is recognised by the enum of event types its timeline holds;
 * that enum is exactly what the "Filter & Sort" checklist is built from.
 */
const FEED_EVENT_TYPE_ENUM_PATTERN: RegExp =
  /export enum (\w+FeedEventType)\b/g;

interface FeedModelOnDisk {
  name: string;
  enumName: string;
}

type FindFeedModelsOnDisk = () => Array<FeedModelOnDisk>;

const findFeedModelsOnDisk: FindFeedModelsOnDisk =
  (): Array<FeedModelOnDisk> => {
    const found: Array<FeedModelOnDisk> = [];

    for (const entry of fs.readdirSync(MODELS_DIRECTORY, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }

      const source: string = fs.readFileSync(
        path.join(MODELS_DIRECTORY, entry.name),
        "utf8",
      );

      for (const match of source.matchAll(FEED_EVENT_TYPE_ENUM_PATTERN)) {
        found.push({
          name: entry.name.replace(/\.ts$/, ""),
          enumName: match[1]!,
        });
      }
    }

    return found;
  };

type GetFeedIdentity = (feed: { name: string; enumName: string }) => string;

const getFeedIdentity: GetFeedIdentity = (feed: {
  name: string;
  enumName: string;
}): string => {
  return `${feed.name}.${feed.enumName}`;
};

// "IncidentStateChanged" is several words run together; "Created" is one.
const MULTI_WORD_CAMEL_CASE: RegExp = /[a-z0-9][A-Z]/;

type GetLabels = (eventTypes: Array<string>) => Array<string>;

const getLabels: GetLabels = (eventTypes: Array<string>): Array<string> => {
  return eventTypes.map((eventType: string): string => {
    return getFeedEventTypeLabel(eventType);
  });
};

type GetOptionValues = (options: Array<FeedEventTypeOption>) => Array<string>;

const getOptionValues: GetOptionValues = (
  options: Array<FeedEventTypeOption>,
): Array<string> => {
  return options.map((option: FeedEventTypeOption): string => {
    return option.value;
  });
};

type GetOptionLabels = (options: Array<FeedEventTypeOption>) => Array<string>;

const getOptionLabels: GetOptionLabels = (
  options: Array<FeedEventTypeOption>,
): Array<string> => {
  return options.map((option: FeedEventTypeOption): string => {
    return option.label;
  });
};

describe("getFeedEventTypeLabel across every dashboard feed", () => {
  test("the feed inventory is exactly the *FeedEventType enums in Models/DatabaseModels", () => {
    /*
     * Guards every test.each below against passing on a short list: a feed
     * model added later fails here until it joins FEEDS, and so gets its
     * labels checked too.
     */
    const onDisk: Array<string> = findFeedModelsOnDisk()
      .map(getFeedIdentity)
      .sort();

    // An empty scan would make the comparison below vacuous.
    expect(onDisk.length).toBeGreaterThan(0);
    expect(FEEDS.map(getFeedIdentity).sort()).toEqual(onDisk);
  });

  test.each(FEEDS)(
    "$name: the table lists $enumName's own values",
    (feed: FeedEventTypeSpec) => {
      /*
       * Loaded by name, so a row that pairs one model with another model's
       * enum (a copy-paste slip the static imports cannot catch) fails.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const model: Record<string, unknown> = require(
        path.join(MODELS_DIRECTORY, feed.name),
      );
      const eventTypeEnum: unknown = model[feed.enumName];

      expect(eventTypeEnum).toBeDefined();
      expect(feed.eventTypes).toEqual(
        Object.values(eventTypeEnum as Record<string, string>),
      );
      expect(feed.eventTypes.length).toBeGreaterThan(0);
    },
  );

  test.each(FEEDS)(
    "$name: every label is a tidy, capitalised phrase",
    (feed: FeedEventTypeSpec) => {
      for (const eventType of feed.eventTypes) {
        const label: string = getFeedEventTypeLabel(eventType);

        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
        expect(label).toBe(label.trim());
        expect(label).not.toContain("  ");
        expect(label).toMatch(/^[A-Z]/);
      }
    },
  );

  test.each(FEEDS)(
    "$name: no multi-word event type is shown as its raw enum value",
    (feed: FeedEventTypeSpec) => {
      const multiWordEventTypes: Array<string> = feed.eventTypes.filter(
        (eventType: string) => {
          return MULTI_WORD_CAMEL_CASE.test(eventType);
        },
      );

      // Every feed event type is a phrase, so this list is never empty.
      expect(multiWordEventTypes.length).toBeGreaterThan(0);

      for (const eventType of multiWordEventTypes) {
        const label: string = getFeedEventTypeLabel(eventType);

        expect(label).not.toBe(eventType);
        // Split into words, or joined as one ("Auto-Remediation").
        expect(label).toMatch(/[ -]/);
      }
    },
  );

  test.each(FEEDS)(
    "$name: labels are unique, so no two checkboxes read the same",
    (feed: FeedEventTypeSpec) => {
      const labels: Array<string> = getLabels(feed.eventTypes);

      expect(new Set<string>(labels).size).toBe(labels.length);
    },
  );

  test.each(FEEDS)(
    "$name: the checklist has one alphabetical entry per event type",
    (feed: FeedEventTypeSpec) => {
      const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
        eventTypes: feed.eventTypes,
      });
      const labels: Array<string> = getOptionLabels(options);

      expect([...getOptionValues(options)].sort()).toEqual(
        [...feed.eventTypes].sort(),
      );
      expect(new Set<string>(labels).size).toBe(options.length);

      for (let index: number = 1; index < labels.length; index++) {
        expect(
          labels[index - 1]!.localeCompare(labels[index]!),
        ).toBeLessThanOrEqual(0);
      }
    },
  );
});

describe("getFeedEventTypeLabel", () => {
  const cases: Array<[string, string]> = [
    // Plain camel case splits into title-case words.
    [IncidentFeedEventType.IncidentStateChanged, "Incident State Changed"],
    [IncidentFeedEventType.IncidentCreated, "Incident Created"],
    [IncidentFeedEventType.RootCause, "Root Cause"],
    [IncidentFeedEventType.PostmortemNote, "Postmortem Note"],
    [IncidentFeedEventType.IncidentMemberAdded, "Incident Member Added"],
    [
      IncidentFeedEventType.SubscriberNotificationSent,
      "Subscriber Notification Sent",
    ],
    [IncidentFeedEventType.LabelRuleExecuted, "Label Rule Executed"],
    [MonitorFeedEventType.MonitorStatusChanged, "Monitor Status Changed"],
    [
      DockerSwarmClusterFeedEventType.DockerSwarmClusterArchived,
      "Docker Swarm Cluster Archived",
    ],
    [OnCallDutyPolicyFeedEventType.RosterHandoff, "Roster Handoff"],
    [OnCallDutyPolicyFeedEventType.CoverageGapStarted, "Coverage Gap Started"],
    [OnCallDutyPolicyFeedEventType.UserAdded, "User Added"],
    [
      ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised,
      "Burn Rate Alert Raised",
    ],
    [ServiceLevelObjectiveFeedEventType.MonitorsAttached, "Monitors Attached"],
    // "OnCall" reads "On-Call", wherever it sits in the value.
    [IncidentFeedEventType.OnCallPolicy, "On-Call Policy"],
    [IncidentFeedEventType.OnCallNotification, "On-Call Notification"],
    [IncidentFeedEventType.OnCallRuleExecuted, "On-Call Rule Executed"],
    [
      OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated,
      "On-Call Duty Policy Created",
    ],
    [
      OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded,
      "On-Call Duty Schedule Added",
    ],
    // "VMware" and "vCenter" keep their product spelling.
    [VMwareVCenterFeedEventType.VMwareVCenterCreated, "VMware vCenter Created"],
    [
      VMwareVCenterFeedEventType.VMwareVCenterRestored,
      "VMware vCenter Restored",
    ],
    // The SLO feed's long prefix is "SLO" everywhere else in the dashboard.
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveCreated,
      "SLO Created",
    ],
    [
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled,
      "SLO Disabled",
    ],
    // Joining words stay lower case inside a title.
    [AlertFeedEventType.AddedToEpisode, "Added to Episode"],
    [AlertFeedEventType.RemovedFromEpisode, "Removed from Episode"],
    // Shared owner events read as a sentence, not "Owner User Added".
    [IncidentFeedEventType.OwnerUserAdded, "User Added as Owner"],
    [IncidentFeedEventType.OwnerUserRemoved, "User Removed as Owner"],
    [IncidentFeedEventType.OwnerTeamAdded, "Team Added as Owner"],
    [IncidentFeedEventType.OwnerTeamRemoved, "Team Removed as Owner"],
    [IncidentFeedEventType.AutoRemediation, "Auto-Remediation"],
    // Values no feed has yet still get a sensible label.
    ["Escalated", "Escalated"],
    ["escalated", "Escalated"],
    ["URLChanged", "URL Changed"],
    ["PutOnHold", "Put on Hold"],
    ["OnHold", "On Hold"],
    ["", ""],
  ];

  test.each(cases)("%p reads %p", (eventType: string, label: string) => {
    expect(getFeedEventTypeLabel(eventType)).toBe(label);
  });

  test("a joining word that opens the label stays capitalised", () => {
    expect(getFeedEventTypeLabel("ToBeReviewed")).toBe("To Be Reviewed");
  });

  test("an owner event keeps its sentence label in every feed that has it", () => {
    const feedsWithOwnerEvents: Array<FeedEventTypeSpec> = FEEDS.filter(
      (feed: FeedEventTypeSpec) => {
        return feed.eventTypes.includes(IncidentFeedEventType.OwnerUserAdded);
      },
    );

    expect(feedsWithOwnerEvents.length).toBeGreaterThan(1);

    for (const feed of feedsWithOwnerEvents) {
      const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
        eventTypes: feed.eventTypes,
      });

      expect(
        options.find((option: FeedEventTypeOption) => {
          return option.value === IncidentFeedEventType.OwnerUserAdded;
        })?.label,
      ).toBe("User Added as Owner");
    }
  });
});

describe("getFeedEventTypeOptions", () => {
  test("sorts by label, not by value", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: [
        IncidentFeedEventType.RootCause,
        AlertFeedEventType.AddedToEpisode,
        IncidentFeedEventType.OwnerUserAdded,
        IncidentFeedEventType.PublicNote,
      ],
    });

    /*
     * By value "OwnerUserAdded" would come before "PublicNote"; its label
     * "User Added as Owner" puts it last.
     */
    expect(options).toEqual([
      { value: "AddedToEpisode", label: "Added to Episode", icon: undefined },
      { value: "PublicNote", label: "Public Note", icon: undefined },
      { value: "RootCause", label: "Root Cause", icon: undefined },
      {
        value: "OwnerUserAdded",
        label: "User Added as Owner",
        icon: undefined,
      },
    ]);
  });

  test("lists each event type once and drops empty values", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: [
        IncidentFeedEventType.PrivateNote,
        "",
        IncidentFeedEventType.IncidentCreated,
        IncidentFeedEventType.PrivateNote,
        "",
        IncidentFeedEventType.IncidentCreated,
      ],
    });

    expect(getOptionValues(options)).toEqual([
      IncidentFeedEventType.IncidentCreated,
      IncidentFeedEventType.PrivateNote,
    ]);
  });

  test("an empty list gives an empty checklist", () => {
    expect(getFeedEventTypeOptions({ eventTypes: [] })).toEqual([]);
    expect(getFeedEventTypeOptions({ eventTypes: ["", ""] })).toEqual([]);
  });

  test("does not reorder the caller's list", () => {
    const eventTypes: Array<string> = [
      IncidentFeedEventType.RootCause,
      IncidentFeedEventType.IncidentCreated,
      IncidentFeedEventType.RootCause,
    ];

    getFeedEventTypeOptions({ eventTypes });

    expect(eventTypes).toEqual([
      IncidentFeedEventType.RootCause,
      IncidentFeedEventType.IncidentCreated,
      IncidentFeedEventType.RootCause,
    ]);
  });

  test("uses the feed's own label, and sorts by it", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: [
        IncidentFeedEventType.PublicNote,
        IncidentFeedEventType.RootCause,
      ],
      getEventTypeLabel: (eventType: string): string | undefined => {
        return eventType === IncidentFeedEventType.PublicNote
          ? "Status Page Note"
          : undefined;
      },
    });

    expect(options).toEqual([
      { value: "RootCause", label: "Root Cause", icon: undefined },
      { value: "PublicNote", label: "Status Page Note", icon: undefined },
    ]);
  });

  test("falls back to the split label when the feed has no name for an event", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: [
        IncidentFeedEventType.OnCallPolicy,
        IncidentFeedEventType.IncidentStateChanged,
      ],
      getEventTypeLabel: (): string | undefined => {
        return undefined;
      },
    });

    expect(getOptionLabels(options)).toEqual([
      "Incident State Changed",
      "On-Call Policy",
    ]);
  });

  test("an empty label from the feed also falls back, so no checkbox is blank", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: [IncidentFeedEventType.RootCause],
      getEventTypeLabel: (): string | undefined => {
        return "";
      },
    });

    expect(getOptionLabels(options)).toEqual(["Root Cause"]);
  });

  test("asks the feed for each event type's label once", () => {
    const askedFor: Array<string> = [];

    getFeedEventTypeOptions({
      eventTypes: [
        IncidentFeedEventType.RootCause,
        "",
        IncidentFeedEventType.RootCause,
        IncidentFeedEventType.PublicNote,
      ],
      getEventTypeLabel: (eventType: string): string | undefined => {
        askedFor.push(eventType);
        return undefined;
      },
    });

    expect(askedFor.sort()).toEqual([
      IncidentFeedEventType.PublicNote,
      IncidentFeedEventType.RootCause,
    ]);
  });

  test("attaches the feed's icon to each entry", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: [
        IncidentFeedEventType.OnCallNotification,
        IncidentFeedEventType.PrivateNote,
        IncidentFeedEventType.RootCause,
      ],
      getEventTypeIcon: (eventType: string): IconProp | undefined => {
        if (eventType === IncidentFeedEventType.OnCallNotification) {
          return IconProp.Bell;
        }

        if (eventType === IncidentFeedEventType.PrivateNote) {
          return IconProp.Info;
        }

        return undefined;
      },
    });

    expect(options).toEqual([
      {
        value: "OnCallNotification",
        label: "On-Call Notification",
        icon: IconProp.Bell,
      },
      { value: "PrivateNote", label: "Private Note", icon: IconProp.Info },
      { value: "RootCause", label: "Root Cause", icon: undefined },
    ]);
  });

  test("leaves the icon undefined when the feed has no icons", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: Object.values(MonitorFeedEventType),
    });

    expect(options.length).toBe(Object.values(MonitorFeedEventType).length);

    for (const option of options) {
      expect(option.icon).toBeUndefined();
    }
  });
});

describe("sanitizeFeedEventTypes", () => {
  const knownEventTypes: Array<string> = [
    IncidentFeedEventType.IncidentCreated,
    IncidentFeedEventType.IncidentStateChanged,
    IncidentFeedEventType.PublicNote,
    IncidentFeedEventType.RootCause,
  ];

  test("returns the selection in the feed's order, whatever order it was ticked in", () => {
    const expected: Array<string> = [
      IncidentFeedEventType.IncidentCreated,
      IncidentFeedEventType.PublicNote,
      IncidentFeedEventType.RootCause,
    ];

    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: [
          IncidentFeedEventType.RootCause,
          IncidentFeedEventType.IncidentCreated,
          IncidentFeedEventType.PublicNote,
        ],
        knownEventTypes,
      }),
    ).toEqual(expected);

    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: [
          IncidentFeedEventType.PublicNote,
          IncidentFeedEventType.RootCause,
          IncidentFeedEventType.IncidentCreated,
        ],
        knownEventTypes,
      }),
    ).toEqual(expected);
  });

  test("keeps each event type once", () => {
    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: [
          IncidentFeedEventType.RootCause,
          IncidentFeedEventType.RootCause,
          IncidentFeedEventType.IncidentCreated,
          IncidentFeedEventType.RootCause,
        ],
        knownEventTypes,
      }),
    ).toEqual([
      IncidentFeedEventType.IncidentCreated,
      IncidentFeedEventType.RootCause,
    ]);
  });

  test("keeps each event type once even when the feed's own list repeats it", () => {
    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: [IncidentFeedEventType.RootCause],
        knownEventTypes: [
          IncidentFeedEventType.RootCause,
          IncidentFeedEventType.PublicNote,
          IncidentFeedEventType.RootCause,
        ],
      }),
    ).toEqual([IncidentFeedEventType.RootCause]);
  });

  test("drops event types the feed does not have", () => {
    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: [
          "NotAnEventType",
          IncidentFeedEventType.PublicNote,
          MonitorFeedEventType.MonitorStatusChanged,
          "",
        ],
        knownEventTypes,
      }),
    ).toEqual([IncidentFeedEventType.PublicNote]);
  });

  test("an empty selection stays empty - no filter", () => {
    expect(
      sanitizeFeedEventTypes({ selectedEventTypes: [], knownEventTypes }),
    ).toEqual([]);
  });

  test("a selection made only of unknown event types becomes no filter", () => {
    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: ["NotAnEventType"],
        knownEventTypes,
      }),
    ).toEqual([]);
  });

  test("a feed with no event types keeps nothing", () => {
    expect(
      sanitizeFeedEventTypes({
        selectedEventTypes: [IncidentFeedEventType.RootCause],
        knownEventTypes: [],
      }),
    ).toEqual([]);
  });

  test("does not change the lists it is given", () => {
    const selectedEventTypes: Array<string> = [
      IncidentFeedEventType.RootCause,
      "NotAnEventType",
    ];
    const known: Array<string> = [...knownEventTypes];

    sanitizeFeedEventTypes({ selectedEventTypes, knownEventTypes: known });

    expect(selectedEventTypes).toEqual([
      IncidentFeedEventType.RootCause,
      "NotAnEventType",
    ]);
    expect(known).toEqual(knownEventTypes);
  });
});

describe("isFeedSortOrder", () => {
  test("accepts both sort orders", () => {
    expect(isFeedSortOrder(SortOrder.Ascending)).toBe(true);
    expect(isFeedSortOrder(SortOrder.Descending)).toBe(true);
  });

  test("accepts the stored string form of both sort orders", () => {
    // What localStorage hands back after a reload.
    expect(isFeedSortOrder("ASC")).toBe(true);
    expect(isFeedSortOrder("DESC")).toBe(true);
  });

  test("rejects anything else", () => {
    const values: Array<unknown> = [
      "asc",
      "desc",
      "Ascending",
      "Descending",
      "",
      undefined,
      null,
      1,
      -1,
      true,
      {},
      [SortOrder.Ascending],
    ];

    for (const value of values) {
      expect(isFeedSortOrder(value)).toBe(false);
    }
  });
});

describe("getFeedOptionsKey", () => {
  test("equal options give equal keys", () => {
    expect(
      getFeedOptionsKey({
        sortOrder: SortOrder.Ascending,
        eventTypes: [
          IncidentFeedEventType.PublicNote,
          IncidentFeedEventType.RootCause,
        ],
      }),
    ).toBe(
      getFeedOptionsKey({
        sortOrder: SortOrder.Ascending,
        eventTypes: [
          IncidentFeedEventType.PublicNote,
          IncidentFeedEventType.RootCause,
        ],
      }),
    );

    expect(getFeedOptionsKey(DEFAULT_FEED_OPTIONS)).toBe(
      getFeedOptionsKey({ sortOrder: SortOrder.Descending, eventTypes: [] }),
    );
  });

  test("any change of sort order or filter gives a different key", () => {
    const eventTypes: Array<string> = [
      IncidentFeedEventType.IncidentCreated,
      IncidentFeedEventType.PublicNote,
      IncidentFeedEventType.RootCause,
    ];
    const keys: Array<string> = [];

    // Every sort order with every subset of the three event types.
    for (const sortOrder of [SortOrder.Descending, SortOrder.Ascending]) {
      for (let mask: number = 0; mask < 1 << eventTypes.length; mask++) {
        keys.push(
          getFeedOptionsKey({
            sortOrder,
            eventTypes: eventTypes.filter(
              (_eventType: string, index: number) => {
                return (mask & (1 << index)) !== 0;
              },
            ),
          }),
        );
      }
    }

    expect(keys.length).toBe(16);
    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  test("a sort order change is not mistaken for a filter change", () => {
    const sortedOnly: string = getFeedOptionsKey({
      sortOrder: SortOrder.Ascending,
      eventTypes: [],
    });
    const filteredOnly: string = getFeedOptionsKey({
      sortOrder: SortOrder.Descending,
      eventTypes: [SortOrder.Ascending],
    });

    expect(sortedOnly).not.toBe(filteredOnly);
    expect(sortedOnly).not.toBe(getFeedOptionsKey(DEFAULT_FEED_OPTIONS));
    expect(filteredOnly).not.toBe(getFeedOptionsKey(DEFAULT_FEED_OPTIONS));
  });

  test("a sanitized selection gives the same key whatever order it was ticked in", () => {
    const knownEventTypes: Array<string> = Object.values(IncidentFeedEventType);

    const tickedOneWay: string = getFeedOptionsKey({
      sortOrder: SortOrder.Descending,
      eventTypes: sanitizeFeedEventTypes({
        selectedEventTypes: [
          IncidentFeedEventType.RootCause,
          IncidentFeedEventType.PublicNote,
        ],
        knownEventTypes,
      }),
    });
    const tickedTheOther: string = getFeedOptionsKey({
      sortOrder: SortOrder.Descending,
      eventTypes: sanitizeFeedEventTypes({
        selectedEventTypes: [
          IncidentFeedEventType.PublicNote,
          IncidentFeedEventType.RootCause,
        ],
        knownEventTypes,
      }),
    });

    expect(tickedOneWay).toBe(tickedTheOther);
  });
});

describe("isFeedFiltered", () => {
  test("no event types means no filter", () => {
    expect(isFeedFiltered(DEFAULT_FEED_OPTIONS)).toBe(false);
    expect(
      isFeedFiltered({ sortOrder: SortOrder.Ascending, eventTypes: [] }),
    ).toBe(false);
  });

  test("any event type means a filter", () => {
    expect(
      isFeedFiltered({
        sortOrder: SortOrder.Descending,
        eventTypes: [IncidentFeedEventType.RootCause],
      }),
    ).toBe(true);
    expect(
      isFeedFiltered({
        sortOrder: SortOrder.Ascending,
        eventTypes: Object.values(IncidentFeedEventType),
      }),
    ).toBe(true);
  });
});

describe("isDefaultFeedOptions", () => {
  test("newest first with no filter is the default", () => {
    expect(isDefaultFeedOptions(DEFAULT_FEED_OPTIONS)).toBe(true);
    expect(
      isDefaultFeedOptions({ sortOrder: SortOrder.Descending, eventTypes: [] }),
    ).toBe(true);
  });

  test("oldest first is not the default", () => {
    expect(
      isDefaultFeedOptions({ sortOrder: SortOrder.Ascending, eventTypes: [] }),
    ).toBe(false);
  });

  test("a filter is not the default", () => {
    expect(
      isDefaultFeedOptions({
        sortOrder: SortOrder.Descending,
        eventTypes: [IncidentFeedEventType.RootCause],
      }),
    ).toBe(false);
    expect(
      isDefaultFeedOptions({
        sortOrder: SortOrder.Ascending,
        eventTypes: [IncidentFeedEventType.RootCause],
      }),
    ).toBe(false);
  });
});

describe("feed option defaults", () => {
  test("a feed opens newest first with no filter", () => {
    expect(DEFAULT_FEED_SORT_ORDER).toBe(SortOrder.Descending);
    expect(DEFAULT_FEED_OPTIONS).toEqual({
      sortOrder: SortOrder.Descending,
      eventTypes: [],
    });
  });

  test("the sort choices are newest first, then oldest first", () => {
    expect(
      FEED_SORT_ORDER_OPTIONS.map(
        (option: FeedSortOrderOption): { value: SortOrder; label: string } => {
          return { value: option.value, label: option.label };
        },
      ),
    ).toEqual([
      { value: SortOrder.Descending, label: "Newest first" },
      { value: SortOrder.Ascending, label: "Oldest first" },
    ]);
  });

  test("each sort choice names a different IconProp", () => {
    /*
     * This only guards the table. Whether the two IconProps also DRAW
     * different glyphs (BarsArrowUp was once a copy of BarsArrowDown) is
     * checked where the icon is rendered, in the button and Icon tests.
     */
    const icons: Array<IconProp> = FEED_SORT_ORDER_OPTIONS.map(
      (option: FeedSortOrderOption): IconProp => {
        return option.icon;
      },
    );

    for (const icon of icons) {
      expect(Object.values(IconProp)).toContain(icon);
    }

    expect(new Set<IconProp>(icons).size).toBe(icons.length);
  });

  test("the default sort order is one of the choices", () => {
    expect(
      FEED_SORT_ORDER_OPTIONS.some((option: FeedSortOrderOption) => {
        return option.value === DEFAULT_FEED_SORT_ORDER;
      }),
    ).toBe(true);
  });
});

describe("getFeedEventTypeQuery", () => {
  test("an unfiltered feed adds nothing to the query", () => {
    expect(
      getFeedEventTypeQuery<IncidentFeed>(
        "incidentFeedEventType",
        DEFAULT_FEED_OPTIONS,
      ),
    ).toEqual({});

    const query: Query<IncidentFeed> = getFeedEventTypeQuery<IncidentFeed>(
      "incidentFeedEventType",
      { sortOrder: SortOrder.Ascending, eventTypes: [] },
    );

    expect(Object.keys(query)).toEqual([]);
  });

  test("a filtered feed asks for the selected event types in its own column", () => {
    const options: FeedOptions = {
      sortOrder: SortOrder.Descending,
      eventTypes: [
        IncidentFeedEventType.IncidentStateChanged,
        IncidentFeedEventType.RootCause,
      ],
    };

    const query: Record<string, unknown> = getFeedEventTypeQuery<IncidentFeed>(
      "incidentFeedEventType",
      options,
    ) as unknown as Record<string, unknown>;

    expect(Object.keys(query)).toEqual(["incidentFeedEventType"]);

    const includes: unknown = query["incidentFeedEventType"];

    expect(includes).toBeInstanceOf(Includes);
    expect((includes as Includes).values).toEqual([
      IncidentFeedEventType.IncidentStateChanged,
      IncidentFeedEventType.RootCause,
    ]);
  });

  test("the key follows the column it is given", () => {
    const query: Record<string, unknown> = getFeedEventTypeQuery<MonitorFeed>(
      "monitorFeedEventType",
      {
        sortOrder: SortOrder.Ascending,
        eventTypes: [MonitorFeedEventType.MonitorStatusChanged],
      },
    ) as unknown as Record<string, unknown>;

    expect(Object.keys(query)).toEqual(["monitorFeedEventType"]);
    expect((query["monitorFeedEventType"] as Includes).values).toEqual([
      MonitorFeedEventType.MonitorStatusChanged,
    ]);
  });

  test("the sort order does not leak into the query", () => {
    const eventTypes: Array<string> = [IncidentFeedEventType.PublicNote];

    const newestFirst: Record<string, unknown> =
      getFeedEventTypeQuery<IncidentFeed>("incidentFeedEventType", {
        sortOrder: SortOrder.Descending,
        eventTypes,
      }) as unknown as Record<string, unknown>;
    const oldestFirst: Record<string, unknown> =
      getFeedEventTypeQuery<IncidentFeed>("incidentFeedEventType", {
        sortOrder: SortOrder.Ascending,
        eventTypes,
      }) as unknown as Record<string, unknown>;

    expect((newestFirst["incidentFeedEventType"] as Includes).toJSON()).toEqual(
      (oldestFirst["incidentFeedEventType"] as Includes).toJSON(),
    );
  });

  test("holds a copy of the selection, not the reader's live list", () => {
    const options: FeedOptions = {
      sortOrder: SortOrder.Descending,
      eventTypes: [IncidentFeedEventType.PublicNote],
    };

    const query: Record<string, unknown> = getFeedEventTypeQuery<IncidentFeed>(
      "incidentFeedEventType",
      options,
    ) as unknown as Record<string, unknown>;
    const includes: Includes = query["incidentFeedEventType"] as Includes;

    expect(includes.values).not.toBe(options.eventTypes);

    options.eventTypes.push(IncidentFeedEventType.RootCause);
    options.eventTypes[0] = IncidentFeedEventType.PrivateNote;

    expect(includes.values).toEqual([IncidentFeedEventType.PublicNote]);
  });

  test("serialises as an Includes operator for the API", () => {
    const query: Record<string, unknown> = getFeedEventTypeQuery<IncidentFeed>(
      "incidentFeedEventType",
      {
        sortOrder: SortOrder.Descending,
        eventTypes: [
          IncidentFeedEventType.OnCallPolicy,
          IncidentFeedEventType.OwnerUserAdded,
        ],
      },
    ) as unknown as Record<string, unknown>;

    expect((query["incidentFeedEventType"] as Includes).toJSON()).toEqual({
      _type: ObjectType.Includes,
      value: [
        IncidentFeedEventType.OnCallPolicy,
        IncidentFeedEventType.OwnerUserAdded,
      ],
    });
  });
});

describe("getFeedNoItemsMessage", () => {
  const noItemsMessage: string = "No activity yet for this incident.";

  test("an unfiltered feed keeps its own message", () => {
    expect(
      getFeedNoItemsMessage({ options: DEFAULT_FEED_OPTIONS, noItemsMessage }),
    ).toBe(noItemsMessage);
    expect(
      getFeedNoItemsMessage({
        options: { sortOrder: SortOrder.Ascending, eventTypes: [] },
        noItemsMessage,
      }),
    ).toBe(noItemsMessage);
  });

  test("a filtered feed says the filter matched nothing", () => {
    // Otherwise the check below would pass on a blank empty state.
    expect(FILTERED_FEED_NO_ITEMS_MESSAGE.trim()).not.toBe("");

    expect(
      getFeedNoItemsMessage({
        options: {
          sortOrder: SortOrder.Descending,
          eventTypes: [IncidentFeedEventType.RootCause],
        },
        noItemsMessage,
      }),
    ).toBe(FILTERED_FEED_NO_ITEMS_MESSAGE);
  });
});

describe("getFeedOptionsSummary", () => {
  test("an unfiltered feed shows all event types", () => {
    expect(
      getFeedOptionsSummary({
        options: DEFAULT_FEED_OPTIONS,
        eventTypeCount: 12,
      }),
    ).toBe("Newest first, all event types");
  });

  test("names the oldest-first order", () => {
    expect(
      getFeedOptionsSummary({
        options: { sortOrder: SortOrder.Ascending, eventTypes: [] },
        eventTypeCount: 12,
      }),
    ).toBe("Oldest first, all event types");
  });

  test("counts the selection against the feed's event types", () => {
    expect(
      getFeedOptionsSummary({
        options: {
          sortOrder: SortOrder.Descending,
          eventTypes: [
            IncidentFeedEventType.PublicNote,
            IncidentFeedEventType.RootCause,
          ],
        },
        eventTypeCount: 5,
      }),
    ).toBe("Newest first, 2 of 5 event types");

    expect(
      getFeedOptionsSummary({
        options: {
          sortOrder: SortOrder.Ascending,
          eventTypes: [IncidentFeedEventType.PublicNote],
        },
        eventTypeCount: 5,
      }),
    ).toBe("Oldest first, 1 of 5 event types");
  });

  test("a feed with one event type reads in the singular", () => {
    expect(
      getFeedOptionsSummary({
        options: {
          sortOrder: SortOrder.Descending,
          eventTypes: [IncidentFeedEventType.PublicNote],
        },
        eventTypeCount: 1,
      }),
    ).toBe("Newest first, 1 of 1 event type");
  });

  test("an unknown sort order reads as the default", () => {
    expect(
      getFeedOptionsSummary({
        options: {
          sortOrder: "sideways" as unknown as SortOrder,
          eventTypes: [],
        },
        eventTypeCount: 3,
      }),
    ).toBe("Newest first, all event types");
  });
});

describe("event types named like Object.prototype members", () => {
  /*
   * The shared label table is a Map. As an object literal, looking up
   * "constructor" or "toString" returned the inherited function, and the
   * checklist's sort then threw on a.label.localeCompare.
   */
  test.each<[string, string]>([
    ["constructor", "Constructor"],
    ["toString", "To String"],
    ["valueOf", "Value of"],
    ["hasOwnProperty", "Has Own Property"],
    ["__proto__", "Proto"],
  ])("%s gets a string label", (eventType: string, label: string) => {
    const result: unknown = getFeedEventTypeLabel(eventType);

    expect(typeof result).toBe("string");
    expect(result).toBe(label);
  });

  test("a checklist containing them still builds and sorts", () => {
    const options: Array<FeedEventTypeOption> = getFeedEventTypeOptions({
      eventTypes: ["toString", "constructor", "OwnerUserAdded"],
    });

    expect(
      options.map((option: FeedEventTypeOption) => {
        return option.label;
      }),
    ).toEqual(["Constructor", "To String", "User Added as Owner"]);
  });
});

describe("translateFeedOptionsText", () => {
  test("returns the English text when there is no translator", () => {
    expect(translateFeedOptionsText({ text: "Sort by time" })).toBe(
      "Sort by time",
    );
  });

  test("uses the translation when there is one", () => {
    expect(
      translateFeedOptionsText({
        text: "Sort by time",
        translate: (text: string | undefined): string | undefined => {
          return text === "Sort by time" ? "Nach Zeit sortieren" : text;
        },
      }),
    ).toBe("Nach Zeit sortieren");
  });

  test("falls back to the English text when the translator has nothing", () => {
    expect(
      translateFeedOptionsText({
        text: "Sort by time",
        translate: (): string | undefined => {
          return undefined;
        },
      }),
    ).toBe("Sort by time");
    expect(
      translateFeedOptionsText({
        text: "Sort by time",
        translate: (): string | undefined => {
          return "";
        },
      }),
    ).toBe("Sort by time");
  });

  test("fills placeholders after looking the whole sentence up", () => {
    const lookedUp: Array<string | undefined> = [];

    expect(
      translateFeedOptionsText({
        text: FEED_OPTIONS_TEXT.showingSomeEventTypes,
        values: { selected: 2, total: 23 },
        translate: (text: string | undefined): string | undefined => {
          lookedUp.push(text);
          return "{{total}} Ereignistypen, davon {{selected}} angezeigt.";
        },
      }),
    ).toBe("23 Ereignistypen, davon 2 angezeigt.");
    expect(lookedUp).toEqual([FEED_OPTIONS_TEXT.showingSomeEventTypes]);
  });

  test("leaves a placeholder with no value visible", () => {
    expect(
      translateFeedOptionsText({
        text: "Showing {{selected}} of {{total}} event types.",
        values: { selected: 1 },
      }),
    ).toBe("Showing 1 of {{total}} event types.");
  });

  test("tolerates spaces inside the braces and repeats", () => {
    expect(
      translateFeedOptionsText({
        text: "{{ a }} and {{a}}",
        values: { a: "x" },
      }),
    ).toBe("x and x");
  });

  test("every template names only the placeholders the control fills", () => {
    const allowed: Set<string> = new Set<string>([
      "selected",
      "total",
      "search",
      "sortOrder",
      "count",
    ]);

    const unfilled: Array<string> = [];

    for (const text of Object.values(FEED_OPTIONS_TEXT)) {
      for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
        if (!allowed.has(match[1]!)) {
          unfilled.push(`${match[1]} in "${text}"`);
        }
      }
    }

    // Anything listed here would show raw braces to the reader.
    expect(unfilled).toEqual([]);
  });

  test("the trigger has no separate accessible-name template", () => {
    /*
     * The button's name is its visible "Filter & Sort" label and the state
     * summary is its description, so the old "Filter and sort feed:
     * {{summary}}" sentence is gone rather than left untranslated.
     */
    expect(Object.keys(FEED_OPTIONS_TEXT)).not.toContain(
      "triggerAccessibleName",
    );
  });

  test("the search announcement counts the matching event types", () => {
    expect(FEED_OPTIONS_TEXT.searchResults).toBe(
      "Matching event types: {{count}}",
    );
  });
});

describe("getFeedOptionsSummary in another language", () => {
  const GERMAN: Record<string, string> = {
    "Newest first": "Neueste zuerst",
    "Oldest first": "\u00c4lteste zuerst",
    "{{sortOrder}}, all event types": "{{sortOrder}}, alle Ereignistypen",
    "{{sortOrder}}, {{selected}} of {{total}} event types":
      "{{sortOrder}}, {{selected}} von {{total}} Ereignistypen",
  };

  const translate: (text: string | undefined) => string | undefined = (
    text: string | undefined,
  ): string | undefined => {
    return text === undefined ? undefined : GERMAN[text];
  };

  test("translates the order and the sentence around it", () => {
    expect(
      getFeedOptionsSummary({
        options: DEFAULT_FEED_OPTIONS,
        eventTypeCount: 12,
        translate,
      }),
    ).toBe("Neueste zuerst, alle Ereignistypen");

    expect(
      getFeedOptionsSummary({
        options: {
          sortOrder: SortOrder.Ascending,
          eventTypes: [IncidentFeedEventType.PublicNote],
        },
        eventTypeCount: 12,
        translate,
      }),
    ).toBe("\u00c4lteste zuerst, 1 von 12 Ereignistypen");
  });

  test("a sentence with no translation stays English, with its numbers", () => {
    expect(
      getFeedOptionsSummary({
        options: {
          sortOrder: SortOrder.Descending,
          eventTypes: [IncidentFeedEventType.PublicNote],
        },
        eventTypeCount: 1,
        translate,
      }),
    ).toBe("Neueste zuerst, 1 of 1 event type");
  });
});
