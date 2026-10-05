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

const ruleModelFiles: Array<string> = fs
  .readdirSync(MODELS_DIRECTORY)
  .filter((file: string): boolean => {
    return /(?:Label|Owner)Rule\.ts$/.test(file);
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
      listColumns: ["ownerUsers", "ownerTeams"],
      switchColumns: [...INHERITED_OWNER_COLUMNS],
    });
    expect(getRuleActionColumns(new ScheduledMaintenanceOwnerRule())).toEqual({
      listColumns: ["ownerUsers", "ownerTeams"],
      switchColumns: [...INHERITED_OWNER_COLUMNS],
    });
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
      const isLabelRule: boolean = /LabelRule\.ts$/.test(file);
      const switchPrefix: string = isLabelRule
        ? "inheritLabelsFrom"
        : "inheritOwnersFrom";

      expect({ file, known: action !== null }).toEqual({ file, known: true });
      expect({ file, lists: action!.listColumns }).toEqual({
        file,
        lists: isLabelRule
          ? [...LABEL_RULE_LIST_COLUMNS]
          : [...OWNER_RULE_LIST_COLUMNS],
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

  test("says so in a few words, and what to do about it", () => {
    expect(RULE_ADDS_NOTHING_TEXT).toBe("Adds nothing");
    expect(RULE_ADDS_NOTHING_TOOLTIP).toBe(
      "This rule adds nothing when it matches. Edit it to choose what it adds, or delete it.",
    );
  });
});
