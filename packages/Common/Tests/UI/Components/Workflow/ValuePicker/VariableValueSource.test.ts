/*
 * The workflow's own variables and the project's global ones, as two groups
 * of the picker - each inserting the reference the runner resolves:
 * {{local.variables.X}} for this workflow's, {{global.variables.X}} for the
 * project's.
 */

import {
  GLOBAL_VARIABLES_GROUP_ID,
  OAUTH_BADGE,
  SECRET_BADGE,
  WORKFLOW_VARIABLES_GROUP_ID,
  buildVariableGroups,
} from "../../../../../UI/Components/Workflow/ValuePicker/VariableValueSource";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { describe, expect, test } from "@jest/globals";

describe("buildVariableGroups", () => {
  const groups: Array<ValueSuggestionGroup> = buildVariableGroups([
    { name: "SLACK_URL", isGlobal: true, isSecret: true },
    { name: "DEPLOY_ENV", isGlobal: false, description: "staging or prod" },
    { name: "API_TOKEN", isGlobal: true, isOAuth: true, isSecret: true },
    { name: "API_BASE", isGlobal: false },
    { name: "", isGlobal: false },
  ]);

  test("this workflow's variables, then the global ones", () => {
    expect(
      groups.map((group: ValueSuggestionGroup) => {
        return [group.id, group.kind, group.title];
      }),
    ).toEqual([
      [
        WORKFLOW_VARIABLES_GROUP_ID,
        ValueSuggestionGroupKind.WorkflowVariables,
        "Workflow variables",
      ],
      [
        GLOBAL_VARIABLES_GROUP_ID,
        ValueSuggestionGroupKind.GlobalVariables,
        "Global variables",
      ],
    ]);
  });

  test("after every step's values", () => {
    for (const group of groups) {
      expect(group.order).toBeGreaterThanOrEqual(1000);
    }
  });

  test("each by name, with the reference the runner resolves", () => {
    expect(
      groups[0]!.items.map((item: ValueSuggestion) => {
        return [item.label, item.reference];
      }),
    ).toEqual([
      ["API_BASE", "{{local.variables.API_BASE}}"],
      ["DEPLOY_ENV", "{{local.variables.DEPLOY_ENV}}"],
    ]);

    expect(
      groups[1]!.items.map((item: ValueSuggestion) => {
        return [item.label, item.reference];
      }),
    ).toEqual([
      ["API_TOKEN", "{{global.variables.API_TOKEN}}"],
      ["SLACK_URL", "{{global.variables.SLACK_URL}}"],
    ]);
  });

  test("a description is shown, and a secret or an OAuth token says so", () => {
    expect(groups[0]!.items[1]!.description).toBe("staging or prod");
    expect(groups[1]!.items[0]!.badges).toEqual([OAUTH_BADGE]);
    expect(groups[1]!.items[1]!.badges).toEqual([SECRET_BADGE]);
    expect(groups[0]!.items[0]!.badges).toBeUndefined();
  });

  test("a variable without a name is left out", () => {
    expect(
      groups.flatMap((group: ValueSuggestionGroup) => {
        return group.items;
      }),
    ).toHaveLength(4);
  });

  test("no variables, no groups", () => {
    expect(buildVariableGroups([])).toEqual([]);
    expect(
      buildVariableGroups([{ name: "ONLY_GLOBAL", isGlobal: true }]).map(
        (group: ValueSuggestionGroup) => {
          return group.id;
        },
      ),
    ).toEqual([GLOBAL_VARIABLES_GROUP_ID]);
  });
});
