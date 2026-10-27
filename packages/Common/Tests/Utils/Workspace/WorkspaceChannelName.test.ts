import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { NUMBER_PREFIX_COLUMNS } from "../../../Utils/Project/NumberPrefix";
import WorkspaceChannelName, {
  NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE,
  WorkspaceChannelNameDescription,
  WorkspaceChannelNameExample,
  WorkspaceChannelNameParts,
} from "../../../Utils/Workspace/WorkspaceChannelName";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * THE NAME OF A CHANNEL A NOTIFICATION RULE CREATES (WorkspaceChannelName).
 *
 * The customer's question: a prefix of foo- names incident INC-123's channel
 * foo-inc-123 - can it simply be inc-123? Now it can: without a prefix the
 * channel is the record's own name. What this suite holds:
 *
 *   - every kind of record's own name, in Slack and Microsoft Teams, with
 *     and without the project's number prefixes, and the names that have no
 *     letter of their own (#42 -> incident-42);
 *   - a rule WITH a prefix names every channel exactly as the code before
 *     this did, for thousands of generated prefixes and record names, in
 *     both workspaces (the old pipeline is written out below);
 *   - what used to fail now fits: Slack's 80 characters and Teams' 50, the
 *     prefix shortened before the record's part, and the names tried after
 *     a taken one (-2 ... -5);
 *   - what the rule form's preview is told: the example record, and whether
 *     the prefix lost characters or the name was shortened.
 */

const SLACK: WorkspaceType = WorkspaceType.Slack;
const TEAMS: WorkspaceType = WorkspaceType.MicrosoftTeams;
const BOTH: Array<WorkspaceType> = [SLACK, TEAMS];

const ALL_EVENT_TYPES: Array<NotificationRuleEventType> = Object.values(
  NotificationRuleEventType,
);

function incident(numberWithPrefix?: string): WorkspaceChannelNameParts {
  return WorkspaceChannelName.forNumberedRecord({
    eventType: NotificationRuleEventType.Incident,
    number: 42,
    numberWithPrefix: numberWithPrefix,
  });
}

function nameOf(data: {
  workspaceType: WorkspaceType;
  prefix: string | null | undefined;
  parts: WorkspaceChannelNameParts;
  attempt?: number;
}): string {
  return WorkspaceChannelName.getChannelName(data);
}

/*
 * The names channels were given before an empty prefix meant none, step by
 * step as the code did it: the rule's prefix or the default of its kind,
 * then the record's part with what Slack does not take left out
 * (WorkspaceNotificationRuleService), then Slack's or Teams' own clean-up
 * of the whole name (SlackUtil / MicrosoftTeamsUtil.createChannel).
 */
const NOT_SLACK: RegExp = /[^a-z0-9\-_]/g;
const NOT_TEAMS: RegExp = /[^a-zA-Z0-9\-_\s]/g;

const HAS_LOWERCASE_LETTER: RegExp = /[a-z]/;
const ONLY_CHANNEL_CHARACTERS: RegExp = /^[a-z0-9\-_]+$/;
const RECORD_WORD: RegExp = /^[a-z][a-z-]*[a-z]$/;

function legacyName(data: {
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
  template: string | undefined;
  suffix: string;
}): string {
  const name: string =
    (data.template || `oneuptime-${data.eventType.toLowerCase()}-`) +
    data.suffix.toLowerCase().replace(NOT_SLACK, "");

  return data.workspaceType === SLACK
    ? name.toLowerCase().replace(NOT_SLACK, "")
    : name.replace(NOT_TEAMS, "");
}

describe("a rule without a prefix names the channel after its record", () => {
  test.each(BOTH)(
    "the customer's case: incident INC-123 gets inc-123 (%s)",
    (workspaceType: WorkspaceType) => {
      expect(
        nameOf({
          workspaceType,
          prefix: "",
          parts: WorkspaceChannelName.forNumberedRecord({
            eventType: NotificationRuleEventType.Incident,
            number: 123,
            numberWithPrefix: "INC-123",
          }),
        }),
      ).toBe("inc-123");
    },
  );

  test.each([
    [NotificationRuleEventType.Incident, "INC-42", "inc-42"],
    [NotificationRuleEventType.Alert, "ALT-42", "alt-42"],
    [NotificationRuleEventType.IncidentEpisode, "IE-42", "ie-42"],
    [NotificationRuleEventType.AlertEpisode, "AE-42", "ae-42"],
    [NotificationRuleEventType.ScheduledMaintenance, "SM-42", "sm-42"],
  ])(
    "%s %s gets %s, in Slack and Microsoft Teams",
    (
      eventType: NotificationRuleEventType,
      numberWithPrefix: string,
      expected: string,
    ) => {
      for (const workspaceType of BOTH) {
        expect(
          nameOf({
            workspaceType,
            prefix: "",
            parts: WorkspaceChannelName.forNumberedRecord({
              eventType,
              number: 42,
              numberWithPrefix,
            }),
          }),
        ).toBe(expected);
      }
    },
  );

  test.each([
    [NotificationRuleEventType.Incident, "incident-42"],
    [NotificationRuleEventType.Alert, "alert-42"],
    [NotificationRuleEventType.IncidentEpisode, "incident-episode-42"],
    [NotificationRuleEventType.AlertEpisode, "alert-episode-42"],
    [NotificationRuleEventType.ScheduledMaintenance, "maintenance-42"],
  ])(
    "a project without number prefixes writes %s #42: its channel is %s, not a bare 42",
    (eventType: NotificationRuleEventType, expected: string) => {
      for (const workspaceType of BOTH) {
        for (const numberWithPrefix of ["#42", undefined, null, ""]) {
          expect(
            nameOf({
              workspaceType,
              prefix: undefined,
              parts: WorkspaceChannelName.forNumberedRecord({
                eventType,
                number: 42,
                numberWithPrefix,
              }),
            }),
          ).toBe(expected);
        }
      }
    },
  );

  test("a number prefix of characters a channel name may not hold falls back to what the record is", () => {
    // Number prefixes take letters of any script and - _ . / : #.
    expect(
      nameOf({ workspaceType: SLACK, prefix: "", parts: incident("事件-42") }),
    ).toBe("incident-42");
    expect(
      nameOf({ workspaceType: TEAMS, prefix: "", parts: incident("Инц-42") }),
    ).toBe("incident-42");
    expect(
      nameOf({ workspaceType: SLACK, prefix: "", parts: incident("#:42") }),
    ).toBe("incident-42");
  });

  test("a number prefix with symbols keeps its letters and numbers", () => {
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "",
        parts: incident("OPS/INC:42"),
      }),
    ).toBe("opsinc42");
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "",
        parts: incident("Ops_Inc.42"),
      }),
    ).toBe("ops_inc42");
    // Never starting with a separator.
    expect(
      nameOf({ workspaceType: SLACK, prefix: "", parts: incident("-INC-42") }),
    ).toBe("inc-42");
    expect(
      nameOf({ workspaceType: TEAMS, prefix: "", parts: incident("_INC-42") }),
    ).toBe("inc-42");
  });

  test("a monitor's or on-call policy's channel is its name, as channels after names have always been written", () => {
    const apiHealth: WorkspaceChannelNameParts =
      WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: "API Health",
      });

    expect(nameOf({ workspaceType: SLACK, prefix: "", parts: apiHealth })).toBe(
      "apihealth",
    );
    expect(nameOf({ workspaceType: TEAMS, prefix: "", parts: apiHealth })).toBe(
      "apihealth",
    );

    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "",
        parts: WorkspaceChannelName.forNamedRecord({
          eventType: NotificationRuleEventType.OnCallDutyPolicy,
          name: "Primary On-Call",
        }),
      }),
    ).toBe("primaryon-call");
  });

  test("a name with no letter is named after what the record is", () => {
    expect(
      WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: "2024",
      }).ownName,
    ).toBe("monitor-2024");
    expect(
      WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: "!!!",
      }).ownName,
    ).toBe("monitor");
    expect(
      WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        name: "日本",
      }).ownName,
    ).toBe("on-call-policy");
  });

  test("every own name has a letter and does not start with a separator", () => {
    const names: Array<string> = generatedTexts(3000, 4123, [
      "INC-",
      "#",
      "-",
      "_",
      "4",
      "2",
      "a",
      "Z",
      "é",
      "事",
      " ",
      "/",
      ":",
      ".",
    ]);

    const badNames: Array<{
      eventType: string;
      text: string;
      ownName: string;
    }> = [];

    for (const eventType of ALL_EVENT_TYPES) {
      for (const text of names) {
        const ownName: string = WorkspaceChannelName.isNumberedRecord(eventType)
          ? WorkspaceChannelName.forNumberedRecord({
              eventType,
              number: 42,
              numberWithPrefix: text,
            }).ownName
          : WorkspaceChannelName.forNamedRecord({ eventType, name: text })
              .ownName;

        if (
          !HAS_LOWERCASE_LETTER.test(ownName) ||
          ownName.startsWith("-") ||
          ownName.startsWith("_") ||
          !ONLY_CHANNEL_CHARACTERS.test(ownName)
        ) {
          badNames.push({ eventType, text, ownName });
        }
      }
    }

    expect(badNames.slice(0, 20)).toEqual([]);
  });

  test.each(["", "   ", "\t", undefined, null])(
    "a prefix of %p is no prefix",
    (prefix: string | undefined | null) => {
      expect(WorkspaceChannelName.hasPrefix(prefix)).toBe(false);
      expect(
        WorkspaceChannelName.getPrefix({ newChannelTemplateName: prefix }),
      ).toBe("");

      for (const workspaceType of BOTH) {
        expect(
          nameOf({ workspaceType, prefix, parts: incident("INC-42") }),
        ).toBe("inc-42");
      }
    },
  );

  test("a prefix that is not text is no prefix", () => {
    expect(
      WorkspaceChannelName.getPrefix({
        newChannelTemplateName: 5 as unknown as string,
      }),
    ).toBe("");
    expect(
      WorkspaceChannelName.getPrefix({
        newChannelTemplateName: { a: 1 } as unknown as string,
      }),
    ).toBe("");
  });
});

describe("a rule with a prefix puts it in front", () => {
  test.each(BOTH)(
    "the customer's foo- names incident INC-123's channel foo-inc-123 (%s)",
    (workspaceType: WorkspaceType) => {
      expect(
        nameOf({
          workspaceType,
          prefix: "foo-",
          parts: WorkspaceChannelName.forNumberedRecord({
            eventType: NotificationRuleEventType.Incident,
            number: 123,
            numberWithPrefix: "INC-123",
          }),
        }),
      ).toBe("foo-inc-123");
    },
  );

  test("Slack lowercases the prefix and leaves out what it does not take; Teams keeps capitals and spaces", () => {
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "Prod Team #1/",
        parts: incident("INC-42"),
      }),
    ).toBe("prodteam1inc-42");
    expect(
      nameOf({
        workspaceType: TEAMS,
        prefix: "Prod Team #1/",
        parts: incident("INC-42"),
      }),
    ).toBe("Prod Team 1inc-42");
    expect(
      nameOf({
        workspaceType: TEAMS,
        prefix: "Incident ",
        parts: incident("INC-42"),
      }),
    ).toBe("Incident inc-42");
  });

  test("a scheduled maintenance event's channel keeps its bare number after a prefix, as it always had", () => {
    const parts: WorkspaceChannelNameParts =
      WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        number: 7,
        numberWithPrefix: "SM-7",
      });

    expect(nameOf({ workspaceType: SLACK, prefix: "maint-", parts })).toBe(
      "maint-7",
    );
    expect(nameOf({ workspaceType: SLACK, prefix: "", parts })).toBe("sm-7");
  });

  test("the old defaults name channels as they did", () => {
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: WorkspaceChannelName.getLegacyDefaultPrefix(
          NotificationRuleEventType.Incident,
        ),
        parts: incident("INC-42"),
      }),
    ).toBe("oneuptime-incident-inc-42");

    const maintenance: WorkspaceChannelNameParts =
      WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        number: 42,
        numberWithPrefix: "SM-42",
      });
    const maintenancePrefix: string =
      WorkspaceChannelName.getLegacyDefaultPrefix(
        NotificationRuleEventType.ScheduledMaintenance,
      );

    expect(maintenancePrefix).toBe("oneuptime-scheduled maintenance-");
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: maintenancePrefix,
        parts: maintenance,
      }),
    ).toBe("oneuptime-scheduledmaintenance-42");
    expect(
      nameOf({
        workspaceType: TEAMS,
        prefix: maintenancePrefix,
        parts: maintenance,
      }),
    ).toBe("oneuptime-scheduled maintenance-42");

    const policy: WorkspaceChannelNameParts =
      WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        name: "Primary",
      });
    const policyPrefix: string = WorkspaceChannelName.getLegacyDefaultPrefix(
      NotificationRuleEventType.OnCallDutyPolicy,
    );

    expect(policyPrefix).toBe("oneuptime-on-call duty policy-");
    expect(
      nameOf({ workspaceType: SLACK, prefix: policyPrefix, parts: policy }),
    ).toBe("oneuptime-on-calldutypolicy-primary");
  });

  test.each(ALL_EVENT_TYPES)(
    "the old default of a %s rule is oneuptime- and its kind, as the server wrote it",
    (eventType: NotificationRuleEventType) => {
      expect(WorkspaceChannelName.getLegacyDefaultPrefix(eventType)).toBe(
        `oneuptime-${eventType.toLowerCase()}-`,
      );
    },
  );

  test("a prefix of characters no channel name holds leaves the record's part as it always followed one", () => {
    expect(
      nameOf({ workspaceType: SLACK, prefix: "#", parts: incident("INC-42") }),
    ).toBe("inc-42");
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "#",
        parts: WorkspaceChannelName.forNumberedRecord({
          eventType: NotificationRuleEventType.ScheduledMaintenance,
          number: 42,
          numberWithPrefix: "SM-42",
        }),
      }),
    ).toBe("42");
  });

  test("nothing left of the prefix nor the record: the record's own name, never an empty name", () => {
    const parts: WorkspaceChannelNameParts =
      WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: "???",
      });

    expect(nameOf({ workspaceType: SLACK, prefix: "!!!", parts })).toBe(
      "monitor",
    );
    expect(nameOf({ workspaceType: TEAMS, prefix: "  ##  ", parts })).toBe(
      "monitor",
    );
  });

  test("a Microsoft Teams name does not start with a space or an underscore", () => {
    expect(
      nameOf({
        workspaceType: TEAMS,
        prefix: " prod-",
        parts: incident("INC-42"),
      }),
    ).toBe("prod-inc-42");
    expect(
      nameOf({
        workspaceType: TEAMS,
        prefix: "__prod-",
        parts: incident("INC-42"),
      }),
    ).toBe("prod-inc-42");
    // Slack leaves them out, or keeps an underscore, as it always did.
    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "_prod-",
        parts: incident("INC-42"),
      }),
    ).toBe("_prod-inc-42");
  });

  /*
   * Existing rules keep their names: for every prefix a rule holds, the
   * name is the one the old code made - wherever the old code made one the
   * workspace took (it fits, and in Teams starts and ends with neither a
   * space nor an underscore).
   */
  test("thousands of prefixes and records: every name the old code made is made again", () => {
    const prefixes: Array<string> = generatedTexts(1500, 9001, [
      "prod-",
      "Ops",
      " ",
      "#",
      "_",
      "-",
      "é",
      "日",
      "/",
      ".",
      "1",
      "INC",
      "x",
    ]).filter((prefix: string): boolean => {
      return prefix.trim().length > 0;
    });

    const records: Array<{
      eventType: NotificationRuleEventType;
      suffix: string;
      parts: WorkspaceChannelNameParts;
    }> = [];

    for (const text of generatedTexts(40, 77, [
      "INC-",
      "#",
      "4",
      "2",
      "API",
      " ",
      "Health",
      "é",
      "_",
    ])) {
      for (const eventType of ALL_EVENT_TYPES) {
        if (WorkspaceChannelName.isNumberedRecord(eventType)) {
          const parts: WorkspaceChannelNameParts =
            WorkspaceChannelName.forNumberedRecord({
              eventType,
              number: 42,
              numberWithPrefix: text,
            });

          records.push({
            eventType,
            parts,
            // The old callers: the bare number for maintenance, else the number with its prefix.
            suffix:
              eventType === NotificationRuleEventType.ScheduledMaintenance
                ? "42"
                : text || "42",
          });
        } else {
          records.push({
            eventType,
            parts: WorkspaceChannelName.forNamedRecord({
              eventType,
              name: text,
            }),
            suffix: text.toLowerCase(),
          });
        }
      }
    }

    let compared: number = 0;

    const differences: Array<{
      workspaceType: WorkspaceType;
      prefix: string;
      suffix: string;
      name: string;
      legacy: string;
    }> = [];

    for (const workspaceType of BOTH) {
      const maxLength: number =
        WorkspaceChannelName.getMaxLength(workspaceType);

      for (const prefix of prefixes) {
        for (const record of records) {
          const legacy: string = legacyName({
            workspaceType,
            eventType: record.eventType,
            template: prefix,
            suffix: record.suffix,
          });

          const workspaceTookIt: boolean =
            legacy.length > 0 &&
            legacy.length <= maxLength &&
            (workspaceType === SLACK ||
              (legacy === legacy.trim() && !legacy.startsWith("_")));

          if (!workspaceTookIt) {
            continue;
          }

          compared++;

          const name: string = nameOf({
            workspaceType,
            prefix,
            parts: record.parts,
          });

          if (name !== legacy) {
            differences.push({
              workspaceType,
              prefix,
              suffix: record.suffix,
              name,
              legacy,
            });
          }
        }
      }
    }

    expect(differences.slice(0, 20)).toEqual([]);

    // The sweep compared plenty of names, in both workspaces.
    expect(compared).toBeGreaterThan(100000);
  });
});

describe("names fit the workspace", () => {
  test.each([
    [SLACK, 80],
    [TEAMS, 50],
  ])(
    "%s takes %d characters",
    (workspaceType: WorkspaceType, maxLength: number) => {
      expect(WorkspaceChannelName.getMaxLength(workspaceType)).toBe(maxLength);
    },
  );

  test.each(BOTH)(
    "a long prefix is shortened, and the record's part stays whole (%s)",
    (workspaceType: WorkspaceType) => {
      const maxLength: number =
        WorkspaceChannelName.getMaxLength(workspaceType);

      const description: WorkspaceChannelNameDescription =
        WorkspaceChannelName.describe({
          workspaceType,
          prefix: "a".repeat(120),
          parts: incident("INC-42"),
        });

      expect(description.name).toBe(`${"a".repeat(maxLength - 6)}inc-42`);
      expect(description.name).toHaveLength(maxLength);
      expect(description.shortened).toBe(true);
      expect(description.prefixChanged).toBe(false);
    },
  );

  test.each(BOTH)(
    "a record's part longer than the workspace takes is cut, and no prefix is left (%s)",
    (workspaceType: WorkspaceType) => {
      const maxLength: number =
        WorkspaceChannelName.getMaxLength(workspaceType);

      const parts: WorkspaceChannelNameParts =
        WorkspaceChannelName.forNamedRecord({
          eventType: NotificationRuleEventType.Monitor,
          name: "m".repeat(200),
        });

      expect(nameOf({ workspaceType, prefix: "prod-", parts })).toBe(
        "m".repeat(maxLength),
      );
      expect(nameOf({ workspaceType, prefix: "", parts })).toBe(
        "m".repeat(maxLength),
      );
    },
  );

  test("a name that fits is not shortened", () => {
    const description: WorkspaceChannelNameDescription =
      WorkspaceChannelName.describe({
        workspaceType: SLACK,
        prefix: "a".repeat(74),
        parts: incident("INC-42"),
      });

    expect(description.name).toHaveLength(80);
    expect(description.shortened).toBe(false);
  });

  test("every name fits, whatever the prefix and the record", () => {
    const prefixes: Array<string> = generatedTexts(400, 31, [
      "prod-",
      "x".repeat(17),
      " ",
      "É",
    ]);

    for (const workspaceType of BOTH) {
      for (const prefix of prefixes) {
        for (const attempt of [1, 2, 5]) {
          const name: string = nameOf({
            workspaceType,
            prefix,
            parts: WorkspaceChannelName.forNamedRecord({
              eventType: NotificationRuleEventType.Monitor,
              name: "n".repeat(prefix.length % 97),
            }),
            attempt,
          });

          expect(name.length).toBeGreaterThan(0);
          expect(name.length).toBeLessThanOrEqual(
            WorkspaceChannelName.getMaxLength(workspaceType),
          );
        }
      }
    }
  });
});

describe("a name somebody has already: the names tried after it", () => {
  test("-2 to -5 after the name", () => {
    expect(WorkspaceChannelName.MAX_NAME_ATTEMPTS).toBe(5);

    for (const workspaceType of BOTH) {
      expect(
        [1, 2, 3, 4, 5].map((attempt: number): string => {
          return nameOf({
            workspaceType,
            prefix: "",
            parts: incident("INC-42"),
            attempt,
          });
        }),
      ).toEqual(["inc-42", "inc-42-2", "inc-42-3", "inc-42-4", "inc-42-5"]);
    }

    expect(
      nameOf({
        workspaceType: SLACK,
        prefix: "prod-",
        parts: incident("INC-42"),
        attempt: 2,
      }),
    ).toBe("prod-inc-42-2");
  });

  test("the number after a long name still fits: the prefix gives way first", () => {
    const name: string = nameOf({
      workspaceType: SLACK,
      prefix: "p".repeat(100),
      parts: incident("INC-42"),
      attempt: 3,
    });

    expect(name).toBe(`${"p".repeat(72)}inc-42-3`);
    expect(name).toHaveLength(80);

    const teamsName: string = nameOf({
      workspaceType: TEAMS,
      prefix: "",
      parts: WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: "q".repeat(70),
      }),
      attempt: 4,
    });

    expect(teamsName).toBe(`${"q".repeat(48)}-4`);
  });
});

describe("Test Rule's channel", () => {
  test("with a prefix: the prefix and the random letters, as Test Rule always named it", () => {
    const parts: WorkspaceChannelNameParts = WorkspaceChannelName.forTest({
      randomText: "AbCdE",
    });

    expect(nameOf({ workspaceType: SLACK, prefix: "prod-", parts })).toBe(
      "prod-abcde",
    );
    expect(
      legacyName({
        workspaceType: SLACK,
        eventType: NotificationRuleEventType.Incident,
        template: "prod-",
        suffix: "AbCdE",
      }),
    ).toBe("prod-abcde");
  });

  test("without one: test- and the random letters, never a channel of random letters alone", () => {
    const parts: WorkspaceChannelNameParts = WorkspaceChannelName.forTest({
      randomText: "AbCdE",
    });

    for (const workspaceType of BOTH) {
      expect(nameOf({ workspaceType, prefix: "", parts })).toBe("test-abcde");
    }
  });
});

describe("what the rule form's preview is told", () => {
  test("Slack lowercasing or leaving out characters is a change to the prefix; Teams keeps capitals", () => {
    const parts: WorkspaceChannelNameParts = incident("INC-42");

    expect(
      WorkspaceChannelName.describe({
        workspaceType: SLACK,
        prefix: "Prod-",
        parts,
      }).prefixChanged,
    ).toBe(true);
    expect(
      WorkspaceChannelName.describe({
        workspaceType: TEAMS,
        prefix: "Prod-",
        parts,
      }).prefixChanged,
    ).toBe(false);
    expect(
      WorkspaceChannelName.describe({
        workspaceType: TEAMS,
        prefix: "Prod#",
        parts,
      }).prefixChanged,
    ).toBe(true);
    expect(
      WorkspaceChannelName.describe({
        workspaceType: SLACK,
        prefix: "prod-",
        parts,
      }).prefixChanged,
    ).toBe(false);
    expect(
      WorkspaceChannelName.describe({ workspaceType: SLACK, prefix: "", parts })
        .prefixChanged,
    ).toBe(false);
  });

  test("an example of a numbered record is number 42 as the project writes it", () => {
    const example: WorkspaceChannelNameExample =
      WorkspaceChannelName.getExample({
        eventType: NotificationRuleEventType.Incident,
        numberPrefixes: { [NotificationRuleEventType.Incident]: "INC-" },
      });

    expect(example.recordName).toBe("INC-42");
    expect(example.parts).toEqual({ afterPrefix: "INC-42", ownName: "inc-42" });

    const noPrefix: WorkspaceChannelNameExample =
      WorkspaceChannelName.getExample({
        eventType: NotificationRuleEventType.Alert,
        numberPrefixes: { [NotificationRuleEventType.Alert]: null },
      });

    expect(noPrefix.recordName).toBe("#42");
    expect(noPrefix.parts.ownName).toBe("alert-42");

    const maintenance: WorkspaceChannelNameExample =
      WorkspaceChannelName.getExample({
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        numberPrefixes: {
          [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
        },
      });

    expect(maintenance.recordName).toBe("SM-42");
    expect(maintenance.parts).toEqual({ afterPrefix: "42", ownName: "sm-42" });
  });

  test("an example of a monitor or on-call policy is one of the project's, or a made-up one", () => {
    expect(
      WorkspaceChannelName.getExample({
        eventType: NotificationRuleEventType.Monitor,
        recordName: "API Health",
      }),
    ).toEqual({
      recordName: "API Health",
      parts: { afterPrefix: "api health", ownName: "apihealth" },
    });
    expect(
      WorkspaceChannelName.getExample({
        eventType: NotificationRuleEventType.Monitor,
      }).recordName,
    ).toBe("Website");
    expect(
      WorkspaceChannelName.getExample({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        recordName: "   ",
      }).recordName,
    ).toBe("Primary");
  });

  test("the numbered kinds are the ones with a number prefix column, and every column is one", () => {
    expect(
      ALL_EVENT_TYPES.filter((eventType: NotificationRuleEventType) => {
        return WorkspaceChannelName.isNumberedRecord(eventType);
      }).sort(),
    ).toEqual(
      [
        NotificationRuleEventType.Incident,
        NotificationRuleEventType.Alert,
        NotificationRuleEventType.IncidentEpisode,
        NotificationRuleEventType.AlertEpisode,
        NotificationRuleEventType.ScheduledMaintenance,
      ].sort(),
    );

    expect(Object.values(NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE).sort()).toEqual(
      NUMBER_PREFIX_COLUMNS.map((column: { column: string }): string => {
        return column.column;
      }).sort(),
    );
  });

  test.each(ALL_EVENT_TYPES)(
    "a %s has a word of its own for a name without letters",
    (eventType: NotificationRuleEventType) => {
      expect(WorkspaceChannelName.getRecordWord(eventType)).toMatch(
        RECORD_WORD,
      );
    },
  );
});

describe("long text", () => {
  /*
   * A prefix and a monitor's name are typed by people: each pattern here is
   * one character class, so the time grows in line with the text.
   */
  test("a 400,000-character prefix and name are named in well under 2 seconds", () => {
    const longText: string = "Ab #-_ é".repeat(50000);

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (const workspaceType of BOTH) {
          WorkspaceChannelName.describe({
            workspaceType,
            prefix: longText,
            parts: WorkspaceChannelName.forNamedRecord({
              eventType: NotificationRuleEventType.Monitor,
              name: longText,
            }),
            attempt: 3,
          });
          WorkspaceChannelName.forNumberedRecord({
            eventType: NotificationRuleEventType.Incident,
            number: 42,
            numberWithPrefix: `${"-".repeat(400000)}42`,
          });
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  // The worst case for trimming a Teams name's end: runs of spaces that do not end it.
  test("a 400,000-character Microsoft Teams prefix of spaces and tabs is named in well under 2 seconds", () => {
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return WorkspaceChannelName.getChannelName({
          workspaceType: WorkspaceType.MicrosoftTeams,
          prefix: `${"\t".repeat(200000)}x${" \t".repeat(100000)}`,
          parts: incident("INC-42"),
        });
      },
      limitInMs: 2000,
    });
    const name: string = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(name.endsWith("inc-42")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(
      WorkspaceChannelName.MICROSOFT_TEAMS_MAX_LENGTH,
    );
  });
});
