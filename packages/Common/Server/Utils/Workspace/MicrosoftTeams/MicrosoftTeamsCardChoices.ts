import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import Label from "../../../../Models/DatabaseModels/Label";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import MonitorService from "../../../Services/MonitorService";
import MonitorStatusService from "../../../Services/MonitorStatusService";
import LabelService from "../../../Services/LabelService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import { truncateToLength } from "../../Database/TruncateColumnValue";
import MicrosoftTeamsMessageSize from "./MicrosoftTeamsMessageSize";

/*
 * The choice lists of the "create incident" and "create maintenance" cards.
 *
 * Those cards used to list every monitor, label and on-call policy of the
 * project (up to 10,000 of each), which Microsoft Teams refuses as too large
 * once a project has a few hundred of them (issue #4111). Each list is now
 * read up to a cap (monitors, labels and on-call policies in name order,
 * severities and monitor statuses in their own order), and fitCardToBudget()
 * shortens the long lists until the card fits a size budget. Whatever is
 * left off is named on the card, so the user knows to add it in OneUptime.
 */

// A type, not an interface, so a list of them is a JSONValue on a card.
export type MicrosoftTeamsCardChoice = {
  title: string;
  value: string;
};

// The choices of one list, and how many records the project has in all.
export interface MicrosoftTeamsCardChoiceList {
  choices: Array<MicrosoftTeamsCardChoice>;
  totalCount: number;
}

export interface MicrosoftTeamsFittedCard<TKey extends string> {
  card: JSONObject;
  // How many choices of each list the card shows.
  shownCounts: Record<TKey, number>;
  // False when the card is over budget even with every trimmable list empty.
  fitsBudget: boolean;
}

/*
 * Most choices read for one list. The size budget, not these caps, decides
 * how many a card shows; the caps only keep the reads small. More than a
 * couple of hundred entries is not a usable dropdown anyway.
 */
export const MICROSOFT_TEAMS_MAX_MONITOR_CHOICES: number = 250;
export const MICROSOFT_TEAMS_MAX_LABEL_CHOICES: number = 100;
export const MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES: number = 100;
export const MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES: number = 50;
export const MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES: number = 50;

// Longer names are cut: a Teams dropdown shows about this much of a row.
export const MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH: number = 80;

type NamedRecord = {
  _id?: string | undefined;
  name?: string | undefined;
};

export default class MicrosoftTeamsCardChoices {
  // Rows to choices, skipping rows without a name or id.
  public static toChoices(
    rows: Array<NamedRecord>,
  ): Array<MicrosoftTeamsCardChoice> {
    const choices: Array<MicrosoftTeamsCardChoice> = [];

    for (const row of rows) {
      const title: string = (row.name || "").trim();
      const value: string = row._id?.toString() || "";

      if (!title || !value) {
        continue;
      }

      choices.push({
        title:
          title.length > MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH
            ? truncateToLength(
                title,
                MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH - 1,
              ) + "…"
            : title,
        value: value,
      });
    }

    return choices;
  }

  /*
   * Builds the card from every choice it was given, then, while it is over
   * the budget, shortens the longest trimmable list by a quarter (at least by
   * one). The longest list goes first because it is what makes the card big,
   * and shortening it by a share keeps the number of rebuilds small even for
   * hundreds of choices. Lists that are not trimmable are always shown whole.
   */
  public static fitCardToBudget<TKey extends string>(data: {
    lists: Record<TKey, MicrosoftTeamsCardChoiceList>;
    trimmableKeys: ReadonlyArray<TKey>;
    budgetInBytes: number;
    buildCard: (
      shownLists: Record<TKey, MicrosoftTeamsCardChoiceList>,
    ) => JSONObject;
  }): MicrosoftTeamsFittedCard<TKey> {
    const keys: Array<TKey> = Object.keys(data.lists) as Array<TKey>;
    const shownCounts: Record<TKey, number> = {} as Record<TKey, number>;

    for (const key of keys) {
      shownCounts[key] = data.lists[key].choices.length;
    }

    // No budget: leave every trimmable list off in one go.
    if (data.budgetInBytes <= 0) {
      for (const key of data.trimmableKeys) {
        shownCounts[key] = 0;
      }
    }

    const build: () => JSONObject = (): JSONObject => {
      const shownLists: Record<TKey, MicrosoftTeamsCardChoiceList> =
        {} as Record<TKey, MicrosoftTeamsCardChoiceList>;

      for (const key of keys) {
        shownLists[key] = {
          choices: data.lists[key].choices.slice(0, shownCounts[key]),
          totalCount: data.lists[key].totalCount,
        };
      }

      return data.buildCard(shownLists);
    };

    let card: JSONObject = build();

    while (
      MicrosoftTeamsMessageSize.getSizeInBytes(card) > data.budgetInBytes
    ) {
      let longestKey: TKey | null = null;

      for (const key of data.trimmableKeys) {
        if (
          shownCounts[key] > 0 &&
          (longestKey === null || shownCounts[key] > shownCounts[longestKey])
        ) {
          longestKey = key;
        }
      }

      if (longestKey === null) {
        return { card: card, shownCounts: shownCounts, fitsBudget: false };
      }

      const count: number = shownCounts[longestKey];
      shownCounts[longestKey] = Math.min(count - 1, Math.floor(count * 0.75));
      card = build();
    }

    return { card: card, shownCounts: shownCounts, fitsBudget: true };
  }

  // A small line of text on a card, such as what a list leaves out.
  public static buildNoteElement(text: string): JSONObject {
    return {
      type: "TextBlock",
      text: text,
      wrap: true,
      isSubtle: true,
      size: "Small",
      spacing: "Small",
    };
  }

  // The note element for a list the card could not show in full, or null.
  public static buildNotShownNoteElement(data: {
    list: MicrosoftTeamsCardChoiceList;
    pluralNoun: string;
    addLaterHint: string;
  }): JSONObject | null {
    const note: string | null = this.getNotShownNote(data);

    return note ? this.buildNoteElement(note) : null;
  }

  // The button a card offers when it had to leave something off.
  public static buildCreateInOneUptimeAction(url: string): JSONObject {
    return {
      type: "Action.OpenUrl",
      title: "Create in OneUptime",
      url: url,
    };
  }

  /*
   * The line shown under a list the card could not show in full, or null
   * when it shows every record.
   */
  public static getNotShownNote(data: {
    list: MicrosoftTeamsCardChoiceList;
    pluralNoun: string; // e.g. "monitors"
    addLaterHint: string; // e.g. "You can add them to the incident in OneUptime after it is created."
  }): string | null {
    const shownCount: number = data.list.choices.length;
    const totalCount: number = Math.max(data.list.totalCount, shownCount);

    if (shownCount >= totalCount) {
      return null;
    }

    if (shownCount === 0) {
      return `This project has ${totalCount} ${data.pluralNoun}, too many to list in Microsoft Teams. ${data.addLaterHint}`;
    }

    return `Showing the first ${shownCount} of ${totalCount} ${data.pluralNoun}, by name. ${data.addLaterHint}`;
  }

  public static async getMonitorChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsCardChoiceList> {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return {
      choices: this.toChoices(monitors),
      totalCount:
        monitors.length < MICROSOFT_TEAMS_MAX_MONITOR_CHOICES
          ? monitors.length
          : (
              await MonitorService.countBy({
                query: {
                  projectId: projectId,
                },
                props: {
                  isRoot: true,
                },
              })
            ).toNumber(),
    };
  }

  public static async getMonitorStatusChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsCardChoiceList> {
    const monitorStatuses: Array<MonitorStatus> =
      await MonitorStatusService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          priority: SortOrder.Ascending,
        },
        limit: MICROSOFT_TEAMS_MAX_MONITOR_STATUS_CHOICES,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const choices: Array<MicrosoftTeamsCardChoice> =
      this.toChoices(monitorStatuses);

    return { choices: choices, totalCount: choices.length };
  }

  public static async getLabelChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsCardChoiceList> {
    const labels: Array<Label> = await LabelService.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: MICROSOFT_TEAMS_MAX_LABEL_CHOICES,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return {
      choices: this.toChoices(labels),
      totalCount:
        labels.length < MICROSOFT_TEAMS_MAX_LABEL_CHOICES
          ? labels.length
          : (
              await LabelService.countBy({
                query: {
                  projectId: projectId,
                },
                props: {
                  isRoot: true,
                },
              })
            ).toNumber(),
    };
  }

  public static async getIncidentSeverityChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsCardChoiceList> {
    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: MICROSOFT_TEAMS_MAX_SEVERITY_CHOICES,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const choices: Array<MicrosoftTeamsCardChoice> = this.toChoices(severities);

    return { choices: choices, totalCount: choices.length };
  }

  public static async getOnCallDutyPolicyChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsCardChoiceList> {
    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: projectId,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return {
      choices: this.toChoices(policies),
      totalCount:
        policies.length < MICROSOFT_TEAMS_MAX_ON_CALL_POLICY_CHOICES
          ? policies.length
          : (
              await OnCallDutyPolicyService.countBy({
                query: {
                  projectId: projectId,
                },
                props: {
                  isRoot: true,
                },
              })
            ).toNumber(),
    };
  }
}
