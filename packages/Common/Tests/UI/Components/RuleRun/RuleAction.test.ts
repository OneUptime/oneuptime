import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AlertOwnerRule from "../../../../Models/DatabaseModels/AlertOwnerRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HostLabelRule from "../../../../Models/DatabaseModels/HostLabelRule";
import HostOwnerRule from "../../../../Models/DatabaseModels/HostOwnerRule";
import IncidentEpisodeLabelRule from "../../../../Models/DatabaseModels/IncidentEpisodeLabelRule";
import IncidentLabelRule from "../../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenanceOwnerRule from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import Team from "../../../../Models/DatabaseModels/Team";
import {
  doesRuleAddNothing,
  getRuleActionColumns,
  getRuleActionSelect,
  INHERITED_LABEL_COLUMNS,
  INHERITED_OWNER_COLUMNS,
  isAnyColumnSwitchedOn,
  LABEL_RULE_LIST_COLUMNS,
  OWNER_RULE_LIST_COLUMNS,
  RULE_ADDS_NOTHING_TEXT,
  RULE_ADDS_NOTHING_TOOLTIP,
  RuleActionColumns,
} from "../../../../UI/Components/RuleRun/RuleAction";
import {
  CREATOR_TEAM_LIST_COLUMNS,
  CREATOR_TEAM_OWNER_RULE_ADDS_NOTHING_MESSAGE,
  doesNewRuleAddSomething,
  getRuleAddsNothingMessage,
  INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE,
  OWNER_RULE_ADDS_NOTHING_MESSAGE,
} from "../../../../Utils/Rules/RuleAction";

/*
 * What a label or owner rule adds, read off its model and its saved row:
 * the lists it names (labels; people and teams) and, on an incident, alert
 * or scheduled maintenance rule, the switches it inherits with. A rule
 * saved before the form asked may add nothing; its table says so (RuleTable)
 * and its Edit form lets it be renamed, switched off or deleted all the
 * same (Dashboard Utils/Form/ResourceRuleForm).
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Models",
  "DatabaseModels",
);

type LoadFunction = (file: string) => BaseModel;

const loadModel: LoadFunction = (file: string): BaseModel => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const loaded: { default: { new (): BaseModel } } = require(
    path.join(MODELS_DIRECTORY, file),
  ) as { default: { new (): BaseModel } };

  return new loaded.default();
};

const RULE_MODEL_FILE: RegExp = /(?:Label|Owner)Rule\.ts$/;
const LABEL_RULE_MODEL_FILE: RegExp = /LabelRule\.ts$/;

const ruleModelFiles: Array<string> = fs
  .readdirSync(MODELS_DIRECTORY)
  .filter((file: string): boolean => {
    return RULE_MODEL_FILE.test(file);
  })
  .sort();

describe("what a rule model adds, by column", () => {
  test("a label rule adds its labels", () => {
    expect(getRuleActionColumns(new HostLabelRule())).toEqual({
      listColumns: ["labelsToAdd"],
      switchColumns: [],
    });
  });

  test("an owner rule adds its people and teams", () => {
    expect(getRuleActionColumns(new HostOwnerRule())).toEqual({
      listColumns: ["ownerUsers", "ownerTeams"],
      switchColumns: [],
    });
  });

  test("an incident, alert or maintenance rule also adds what it inherits", () => {
    expect(getRuleActionColumns(new IncidentLabelRule())).toEqual({
      listColumns: ["labelsToAdd"],
      switchColumns: [...INHERITED_LABEL_COLUMNS],
    });
    expect(getRuleActionColumns(new AlertOwnerRule())).toEqual({
      listColumns: ["ownerUsers", "ownerTeams", "creatorTeams"],
      switchColumns: [...INHERITED_OWNER_COLUMNS],
    });
    expect(getRuleActionColumns(new ScheduledMaintenanceOwnerRule())).toEqual({
      listColumns: ["ownerUsers", "ownerTeams"],
      switchColumns: [...INHERITED_OWNER_COLUMNS],
    });
  });

  /*
   * An incident's or alert's owner rule also lists teams for the creator's
   * team: a list it adds from, as its people and teams are.
   */
  test("an incident or alert owner rule also adds the creator's team", () => {
    for (const model of [new IncidentOwnerRule(), new AlertOwnerRule()]) {
      expect(getRuleActionColumns(model)!.listColumns).toEqual([
        "ownerUsers",
        "ownerTeams",
        ...CREATOR_TEAM_LIST_COLUMNS,
      ]);
    }

    expect(
      getRuleActionColumns(new ScheduledMaintenanceOwnerRule())!.listColumns,
    ).not.toContain("creatorTeams");
    expect(
      getRuleActionColumns(new HostOwnerRule())!.listColumns,
    ).not.toContain("creatorTeams");
  });

  test("an episode's rule inherits nothing", () => {
    expect(getRuleActionColumns(new IncidentEpisodeLabelRule())).toEqual({
      listColumns: ["labelsToAdd"],
      switchColumns: [],
    });
  });

  test("any other model is not a label or owner rule", () => {
    expect(getRuleActionColumns(new IncidentOnCallRule())).toBeNull();
    expect(getRuleActionColumns(new Monitor())).toBeNull();
    expect(getRuleActionColumns(new Label())).toBeNull();
  });

  /*
   * Every label and owner rule model, read for real: each is known, and the
   * switches named here are the model's own - all of them.
   */
  test("knows every label and owner rule model, and each one's switches", () => {
    expect(ruleModelFiles.length).toBeGreaterThanOrEqual(60);

    for (const file of ruleModelFiles) {
      const model: BaseModel = loadModel(file);
      const action: RuleActionColumns | null = getRuleActionColumns(model);
      const isLabelRule: boolean = LABEL_RULE_MODEL_FILE.test(file);
      const switchPrefix: string = isLabelRule
        ? "inheritLabelsFrom"
        : "inheritOwnersFrom";

      expect({ file, known: action !== null }).toEqual({ file, known: true });
      expect({ file, lists: action!.listColumns }).toEqual({
        file,
        lists: isLabelRule
          ? [...LABEL_RULE_LIST_COLUMNS]
          : [
              ...OWNER_RULE_LIST_COLUMNS,
              ...CREATOR_TEAM_LIST_COLUMNS.filter((column: string): boolean => {
                return model.hasColumn(column);
              }),
            ],
      });
      expect({ file, switches: action!.switchColumns }).toEqual({
        file,
        switches: model
          .getTableColumns()
          .columns.filter((column: string): boolean => {
            return column.startsWith(switchPrefix);
          }),
      });
    }
  });
});

describe("what a rule table selects", () => {
  test("the lists by id, and the switches", () => {
    expect(
      getRuleActionSelect(getRuleActionColumns(new IncidentLabelRule())!),
    ).toEqual({
      labelsToAdd: { _id: true },
      inheritLabelsFromMonitors: true,
      inheritLabelsFromHosts: true,
      inheritLabelsFromKubernetesClusters: true,
      inheritLabelsFromDockerHosts: true,
      inheritLabelsFromPodmanHosts: true,
      inheritLabelsFromServices: true,
    });
    expect(
      getRuleActionSelect(getRuleActionColumns(new HostOwnerRule())!),
    ).toEqual({
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
    expect(
      getRuleActionSelect(getRuleActionColumns(new IncidentOwnerRule())!),
    ).toMatchObject({
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
      creatorTeams: { _id: true },
      inheritOwnersFromServices: true,
    });
  });
});

describe("whether any switch is on", () => {
  test("in a form's values or a saved rule", () => {
    expect(isAnyColumnSwitchedOn({}, INHERITED_LABEL_COLUMNS)).toBe(false);
    expect(isAnyColumnSwitchedOn(undefined, INHERITED_LABEL_COLUMNS)).toBe(
      false,
    );
    expect(isAnyColumnSwitchedOn(null, INHERITED_LABEL_COLUMNS)).toBe(false);
    expect(
      isAnyColumnSwitchedOn(
        { inheritLabelsFromHosts: false, inheritLabelsFromServices: true },
        INHERITED_LABEL_COLUMNS,
      ),
    ).toBe(true);
    // Only true is on: a value that is not a switch's is not.
    expect(
      isAnyColumnSwitchedOn(
        { inheritLabelsFromHosts: "true" },
        INHERITED_LABEL_COLUMNS,
      ),
    ).toBe(false);
    // The other kind's switches are not these.
    expect(
      isAnyColumnSwitchedOn(
        { inheritOwnersFromMonitors: true },
        INHERITED_LABEL_COLUMNS,
      ),
    ).toBe(false);
  });
});

describe("a rule that adds nothing", () => {
  const labelRule: RuleActionColumns = getRuleActionColumns(
    new HostLabelRule(),
  )!;
  const ownerRule: RuleActionColumns = getRuleActionColumns(
    new HostOwnerRule(),
  )!;
  const incidentLabelRule: RuleActionColumns = getRuleActionColumns(
    new IncidentLabelRule(),
  )!;

  const switchesOff: Record<string, boolean> = Object.fromEntries(
    INHERITED_LABEL_COLUMNS.map((column: string): [string, boolean] => {
      return [column, false];
    }),
  );

  test("is a label rule with no labels", () => {
    expect(doesRuleAddNothing({ labelsToAdd: [] }, labelRule)).toBe(true);
    expect(
      doesRuleAddNothing(
        Object.assign(new HostLabelRule(), { labelsToAdd: [] }),
        labelRule,
      ),
    ).toBe(true);
  });

  test("is not one that adds a label", () => {
    expect(
      doesRuleAddNothing(
        { labelsToAdd: [Object.assign(new Label(), { _id: "a" })] },
        labelRule,
      ),
    ).toBe(false);
  });

  test("is an owner rule with neither people nor teams", () => {
    expect(
      doesRuleAddNothing({ ownerUsers: [], ownerTeams: [] }, ownerRule),
    ).toBe(true);
    expect(
      doesRuleAddNothing(
        {
          ownerUsers: [],
          ownerTeams: [Object.assign(new Team(), { _id: "t" })],
        },
        ownerRule,
      ),
    ).toBe(false);
  });

  test("is an event's rule with no labels and every inherit switch off", () => {
    expect(
      doesRuleAddNothing(
        { labelsToAdd: [], ...switchesOff },
        incidentLabelRule,
      ),
    ).toBe(true);

    for (const column of INHERITED_LABEL_COLUMNS) {
      expect(
        doesRuleAddNothing(
          { labelsToAdd: [], ...switchesOff, [column]: true },
          incidentLabelRule,
        ),
      ).toBe(false);
    }
  });

  /*
   * A table that could not read a list or a switch - not selected, or a
   * column the viewer may not read - knows nothing of it: the rule is never
   * said to add nothing on a guess.
   */
  test("is never guessed from what the row does not carry", () => {
    expect(doesRuleAddNothing({}, labelRule)).toBe(false);
    expect(doesRuleAddNothing({ labelsToAdd: null }, labelRule)).toBe(false);
    expect(doesRuleAddNothing(undefined, labelRule)).toBe(false);
    expect(doesRuleAddNothing({ ownerUsers: [] }, ownerRule)).toBe(false);
    expect(doesRuleAddNothing({ labelsToAdd: [] }, incidentLabelRule)).toBe(
      false,
    );

    const oneSwitchUnread: Record<string, unknown> = {
      labelsToAdd: [],
      ...switchesOff,
    };
    delete oneSwitchUnread["inheritLabelsFromServices"];

    expect(doesRuleAddNothing(oneSwitchUnread, incidentLabelRule)).toBe(false);
  });

  test("is an incident or alert owner rule that also lists no team for the creator's team", () => {
    const incidentOwnerRule: RuleActionColumns = getRuleActionColumns(
      new IncidentOwnerRule(),
    )!;
    const ownerSwitchesOff: Record<string, boolean> = Object.fromEntries(
      INHERITED_OWNER_COLUMNS.map((column: string): [string, boolean] => {
        return [column, false];
      }),
    );
    const nothing: Record<string, unknown> = {
      ownerUsers: [],
      ownerTeams: [],
      creatorTeams: [],
      ...ownerSwitchesOff,
    };

    expect(doesRuleAddNothing(nothing, incidentOwnerRule)).toBe(true);
    expect(
      doesRuleAddNothing(
        {
          ...nothing,
          creatorTeams: [Object.assign(new Team(), { _id: "t" })],
        },
        incidentOwnerRule,
      ),
    ).toBe(false);

    // Its teams not read: not known to be empty.
    const creatorTeamsUnread: Record<string, unknown> = { ...nothing };
    delete creatorTeamsUnread["creatorTeams"];

    expect(doesRuleAddNothing(creatorTeamsUnread, incidentOwnerRule)).toBe(
      false,
    );
  });

  test("says so in a few words, and what to do about it", () => {
    expect(RULE_ADDS_NOTHING_TEXT).toBe("Adds nothing");
    expect(RULE_ADDS_NOTHING_TOOLTIP).toBe(
      "This rule adds nothing when it matches. Edit it to choose what it adds, or delete it.",
    );
  });
});

/*
 * A NEW rule made through the API, Terraform, a workflow or an import must
 * add something: a team listed for the creator's team is something, and the
 * answer to an incident or alert owner rule that adds nothing names it.
 */
describe("a new rule", () => {
  const incidentOwnerRule: RuleActionColumns = getRuleActionColumns(
    new IncidentOwnerRule(),
  )!;

  test("adds something when it lists a team for the creator's team", () => {
    expect(doesNewRuleAddSomething({}, incidentOwnerRule)).toBe(false);
    expect(
      doesNewRuleAddSomething({ creatorTeams: [] }, incidentOwnerRule),
    ).toBe(false);
    expect(
      doesNewRuleAddSomething(
        { creatorTeams: ["a0a0a0a0-0000-4000-8000-000000000003"] },
        incidentOwnerRule,
      ),
    ).toBe(true);
    expect(
      doesNewRuleAddSomething(
        { creatorTeams: [{ _id: "a0a0a0a0-0000-4000-8000-000000000003" }] },
        incidentOwnerRule,
      ),
    ).toBe(true);
  });

  test("that adds nothing is told what it may add, in its own fields", () => {
    expect(getRuleAddsNothingMessage(incidentOwnerRule)).toBe(
      CREATOR_TEAM_OWNER_RULE_ADDS_NOTHING_MESSAGE,
    );
    expect(
      getRuleAddsNothingMessage(getRuleActionColumns(new AlertOwnerRule())!),
    ).toBe(CREATOR_TEAM_OWNER_RULE_ADDS_NOTHING_MESSAGE);
    expect(
      getRuleAddsNothingMessage(
        getRuleActionColumns(new ScheduledMaintenanceOwnerRule())!,
      ),
    ).toBe(INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE);
    expect(
      getRuleAddsNothingMessage(getRuleActionColumns(new HostOwnerRule())!),
    ).toBe(OWNER_RULE_ADDS_NOTHING_MESSAGE);
    expect(CREATOR_TEAM_OWNER_RULE_ADDS_NOTHING_MESSAGE).toContain(
      "Creator's Teams",
    );
  });
});
