import { describe, expect, test } from "@jest/globals";
import Project from "../../../Models/DatabaseModels/Project";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  ALERT_NOUNS,
  INCIDENT_NOUNS,
} from "../../../Types/Episode/EpisodeMembersAdd";
import EpisodeSingleMembership, {
  ALERT_IN_ANOTHER_EPISODE_REASON,
  ALERT_SINGLE_MEMBERSHIP,
  ALERT_SINGLE_MEMBERSHIP_COLUMN,
  EpisodeSingleMembershipKind,
  INCIDENT_IN_ANOTHER_EPISODE_REASON,
  INCIDENT_SINGLE_MEMBERSHIP,
  INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
  MAX_RECORDS_NAMED_IN_REFUSAL,
} from "../../../Types/Episode/EpisodeSingleMembership";
import Permission from "../../../Types/Permission";

/*
 * One episode per incident, or per alert (EpisodeSingleMembership): what the
 * server and the dashboard share - the Project columns that turn it on, and
 * every word a refusal says. The maintainer's ask: "some customers don't
 * want [an incident in many episodes], so can we create a setting in alert /
 * incident settings to allow alert to be in only one episode and same for
 * incidents."
 */

describe("the Project columns", () => {
  const columns: ReturnType<typeof getTableColumns> = getTableColumns(
    new Project(),
  );

  test.each([
    [INCIDENT_SINGLE_MEMBERSHIP_COLUMN, "limitIncidentsToOneEpisode"],
    [ALERT_SINGLE_MEMBERSHIP_COLUMN, "limitAlertsToOneEpisode"],
  ])(
    "%s is a Project switch, off by default",
    (column: string, name: string) => {
      expect(column).toBe(name);

      const tableColumn:
        | ReturnType<typeof getTableColumns>[string]
        | undefined = columns[column];

      expect(tableColumn).toBeDefined();
      expect(tableColumn?.type).toBe(TableColumnType.Boolean);
      // Off for every project, existing or new: today's behaviour.
      expect(tableColumn?.defaultValue).toBe(false);
      expect(tableColumn?.isDefaultValueColumn).toBe(true);
      expect(tableColumn?.required).toBe(true);
    },
  );

  test.each([
    INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
    ALERT_SINGLE_MEMBERSHIP_COLUMN,
  ])(
    "%s is changed by project owners and admins only, and read by every member",
    (column: string) => {
      const project: Project = new Project();
      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = project.getColumnAccessControlFor(column) || {};

      expect(access.update).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]);
      // Never set while a project is being created: it starts off.
      expect(access.create).toEqual([]);
      /*
       * Every project member reads it: the add dialogs read it to know
       * what they may offer.
       */
      expect(access.read).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.ProjectUser,
        ]),
      );
    },
  );

  test("the API describes what each switch does, and that nobody is taken out of an episode", () => {
    expect(columns[INCIDENT_SINGLE_MEMBERSHIP_COLUMN]?.title).toBe(
      "Limit Incidents to One Episode",
    );
    expect(columns[ALERT_SINGLE_MEMBERSHIP_COLUMN]?.title).toBe(
      "Limit Alerts to One Episode",
    );
    expect(columns[INCIDENT_SINGLE_MEMBERSHIP_COLUMN]?.description).toContain(
      "Incidents that are already in several episodes stay in them.",
    );
    expect(columns[ALERT_SINGLE_MEMBERSHIP_COLUMN]?.description).toContain(
      "Alerts that are already in several episodes stay in them.",
    );
  });
});

describe("the kinds", () => {
  test("each names its column, its nouns, its rule and where its switch is", () => {
    expect(INCIDENT_SINGLE_MEMBERSHIP).toEqual({
      column: "limitIncidentsToOneEpisode",
      nouns: INCIDENT_NOUNS,
      singularTitle: "Incident",
      rule: "an incident can be in only one episode in this project",
      settingLocation: "Incidents > Settings > Episode Membership",
      inAnotherEpisodeReason: INCIDENT_IN_ANOTHER_EPISODE_REASON,
    });
    expect(ALERT_SINGLE_MEMBERSHIP).toEqual({
      column: "limitAlertsToOneEpisode",
      nouns: ALERT_NOUNS,
      singularTitle: "Alert",
      rule: "an alert can be in only one episode in this project",
      settingLocation: "Alerts > Settings > Episode Membership",
      inAnotherEpisodeReason: ALERT_IN_ANOTHER_EPISODE_REASON,
    });
  });

  test("the reasons a batch gives are fixed sentences, so the dialogs list every such one under one reason and translate it", () => {
    expect(INCIDENT_IN_ANOTHER_EPISODE_REASON).toBe(
      "Already in another episode. An incident can be in only one episode in this project.",
    );
    expect(ALERT_IN_ANOTHER_EPISODE_REASON).toBe(
      "Already in another episode. An alert can be in only one episode in this project.",
    );
  });
});

describe("getLabel", () => {
  test("is the number with the project's prefix", () => {
    expect(EpisodeSingleMembership.getLabel("INC-12", 12)).toBe("INC-12");
    expect(EpisodeSingleMembership.getLabel("  IE-3  ", 3)).toBe("IE-3");
  });

  test("is #<number> without a prefix", () => {
    expect(EpisodeSingleMembership.getLabel(undefined, 12)).toBe("#12");
    expect(EpisodeSingleMembership.getLabel("", 7)).toBe("#7");
    expect(EpisodeSingleMembership.getLabel("   ", 0)).toBe("#0");
  });

  test("is null when the number is unknown", () => {
    expect(EpisodeSingleMembership.getLabel(undefined, undefined)).toBeNull();
    expect(EpisodeSingleMembership.getLabel(null, null)).toBeNull();
  });
});

describe("getAddRefusal", () => {
  test.each([
    [
      INCIDENT_SINGLE_MEMBERSHIP,
      "Incident INC-12 is already in episode IE-3, and an incident can be in only one episode in this project. Remove it from episode IE-3 first, or turn this off in Incidents > Settings > Episode Membership.",
    ],
    [
      ALERT_SINGLE_MEMBERSHIP,
      "Alert INC-12 is already in episode IE-3, and an alert can be in only one episode in this project. Remove it from episode IE-3 first, or turn this off in Alerts > Settings > Episode Membership.",
    ],
  ])(
    "names the record and the episode it is in",
    (kind: EpisodeSingleMembershipKind, expected: string) => {
      expect(
        EpisodeSingleMembership.getAddRefusal({
          kind: kind,
          recordLabel: "INC-12",
          episodeLabel: "IE-3",
        }),
      ).toBe(expected);
    },
  );

  test("says 'another episode' for an episode the caller cannot see", () => {
    expect(
      EpisodeSingleMembership.getAddRefusal({
        kind: INCIDENT_SINGLE_MEMBERSHIP,
        recordLabel: "INC-12",
        episodeLabel: null,
      }),
    ).toBe(
      "Incident INC-12 is already in another episode, and an incident can be in only one episode in this project. Remove it from that episode first, or turn this off in Incidents > Settings > Episode Membership.",
    );
  });

  test("says 'this alert' when the record's number is unknown", () => {
    expect(
      EpisodeSingleMembership.getAddRefusal({
        kind: ALERT_SINGLE_MEMBERSHIP,
        recordLabel: null,
        episodeLabel: "AE-9",
      }),
    ).toBe(
      "This alert is already in episode AE-9, and an alert can be in only one episode in this project. Remove it from episode AE-9 first, or turn this off in Alerts > Settings > Episode Membership.",
    );
  });
});

describe("getNewEpisodeRefusal", () => {
  test("one record", () => {
    expect(
      EpisodeSingleMembership.getNewEpisodeRefusal({
        kind: INCIDENT_SINGLE_MEMBERSHIP,
        recordLabels: ["INC-12"],
      }),
    ).toBe(
      "Incident INC-12 is already in an episode, and an incident can be in only one episode in this project. Leave it out, or remove it from its episode first.",
    );
  });

  test("one record without a number", () => {
    expect(
      EpisodeSingleMembership.getNewEpisodeRefusal({
        kind: ALERT_SINGLE_MEMBERSHIP,
        recordLabels: [null],
      }),
    ).toBe(
      "One of the alerts is already in an episode, and an alert can be in only one episode in this project. Leave it out, or remove it from its episode first.",
    );
  });

  test("several records, named in the order given", () => {
    expect(
      EpisodeSingleMembership.getNewEpisodeRefusal({
        kind: INCIDENT_SINGLE_MEMBERSHIP,
        recordLabels: ["INC-14", "INC-12", "#3"],
      }),
    ).toBe(
      "INC-14, INC-12 and #3 are already in an episode, and an incident can be in only one episode in this project. Leave them out, or remove them from their episodes first.",
    );
  });

  test("several records, some without a number, are counted", () => {
    expect(
      EpisodeSingleMembership.getNewEpisodeRefusal({
        kind: ALERT_SINGLE_MEMBERSHIP,
        recordLabels: ["ALT-1", null, "ALT-3"],
      }),
    ).toBe(
      "3 of the alerts are already in an episode, and an alert can be in only one episode in this project. Leave them out, or remove them from their episodes first.",
    );
  });

  test(`past ${MAX_RECORDS_NAMED_IN_REFUSAL}, the rest are counted`, () => {
    const labels: Array<string> = Array.from(
      { length: MAX_RECORDS_NAMED_IN_REFUSAL + 3 },
      (_value: unknown, index: number): string => {
        return `INC-${index + 1}`;
      },
    );

    expect(
      EpisodeSingleMembership.getNewEpisodeRefusal({
        kind: INCIDENT_SINGLE_MEMBERSHIP,
        recordLabels: labels,
      }),
    ).toBe(
      "INC-1, INC-2, INC-3, INC-4, INC-5, INC-6, INC-7, INC-8, INC-9, INC-10 and 3 more incidents are already in an episode, and an incident can be in only one episode in this project. Leave them out, or remove them from their episodes first.",
    );
  });
});

describe("joinLabels", () => {
  test("one, two and three labels", () => {
    expect(EpisodeSingleMembership.joinLabels(["A"], INCIDENT_NOUNS)).toBe("A");
    expect(EpisodeSingleMembership.joinLabels(["A", "B"], INCIDENT_NOUNS)).toBe(
      "A and B",
    );
    expect(
      EpisodeSingleMembership.joinLabels(["A", "B", "C"], INCIDENT_NOUNS),
    ).toBe("A, B and C");
  });

  test("one more past the limit is singular", () => {
    const labels: Array<string> = Array.from(
      { length: MAX_RECORDS_NAMED_IN_REFUSAL + 1 },
      (_value: unknown, index: number): string => {
        return `ALT-${index + 1}`;
      },
    );

    expect(EpisodeSingleMembership.joinLabels(labels, ALERT_NOUNS)).toBe(
      "ALT-1, ALT-2, ALT-3, ALT-4, ALT-5, ALT-6, ALT-7, ALT-8, ALT-9, ALT-10 and 1 more alert",
    );
  });

  test("none is empty", () => {
    expect(EpisodeSingleMembership.joinLabels([], ALERT_NOUNS)).toBe("");
  });
});
