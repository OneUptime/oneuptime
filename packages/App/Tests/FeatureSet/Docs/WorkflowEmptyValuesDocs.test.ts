import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import Alert from "Common/Models/DatabaseModels/Alert";
import SelectUtil from "Common/Server/Types/Database/SelectUtil";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import { JSONObject } from "Common/Types/JSON";
import ComponentMetadata from "Common/Types/Workflow/Component";
import BaseModelComponents from "Common/Types/Workflow/Components/BaseModel";
import { ConditionOperator } from "Common/Types/Workflow/Components/Condition";
import { evaluateCondition } from "Common/Types/Workflow/Components/ConditionEvaluation";
import SlackComponents from "Common/Types/Workflow/Components/Slack";
import { takesEmptyValues } from "Common/Types/Workflow/EmptyValues";

/*
 * What the workflow pages say about a value with nothing in it, held to what a
 * run does (issue 5761). A reader meets the reference in the Variables page's
 * Gotchas, and the same words in the Triggers, Components and Runs pages. Each
 * translation carries the same reference, by WorkflowDocsTranslations' rule
 * that every piece of inline code is kept; that is checked here as well, for
 * the two a reader may copy.
 */

const MONITOR_REFERENCE: string =
  "{{local.components.alert-on-create-1.returnValues.model.monitor.name}}";

const SLO_LOOP: string =
  "{{#each local.components.alert-on-create-1.returnValues.model.serviceLevelObjectives}}{{name}}{{/each}}";

const VARIABLES: string = readPage("en", "workflows/variables");
const TRIGGERS: string = readPage("en", "workflows/triggers");
const COMPONENTS: string = readPage("en", "workflows/components");
const RUNS: string = readPage("en", "workflows/runs-and-logs");

const storageWithAlert: (model: JSONObject) => JSONObject = (
  model: JSONObject,
): JSONObject => {
  return {
    local: {
      variables: {},
      components: { "alert-on-create-1": { returnValues: { model: model } } },
    },
    global: { variables: {} },
  };
};

const NO_MONITOR: JSONObject = storageWithAlert({
  monitor: null,
  serviceLevelObjectives: [{ _id: "s-1", name: "Overall Calendar Month" }],
});

const gotcha: () => string = (): string => {
  return VARIABLES.split("\n").find((line: string): boolean => {
    return line.startsWith(
      "- **A field with nothing in it comes through empty.**",
    );
  }) as string;
};

describe("the Variables page's gotcha", () => {
  it("comes straight after the one about a reference to nothing", () => {
    const lines: Array<string> = VARIABLES.split("\n");

    expect(lines[lines.indexOf(gotcha()) - 1]).toMatch(
      /^- \*\*A reference that doesn't resolve is left as-is, not blanked\.\*\*/,
    );
  });

  it("is right that an alert no monitor raised has nothing to give", () => {
    expect(gotcha()).toContain(`\`${MONITOR_REFERENCE}\` has nothing to give`);
    expect(
      VMUtil.replaceValueInPlace(
        NO_MONITOR,
        `Monitor: [${MONITOR_REFERENCE}]`,
        false,
        {},
      ),
    ).toBe("Monitor: []");
  });

  it("is right that on its own in JSON it is null", () => {
    expect(gotcha()).toContain("on its own in JSON it's `null`");
    expect(
      JSON.parse(
        VMUtil.replaceValueInPlace(
          NO_MONITOR,
          `{"monitor": ${MONITOR_REFERENCE}}`,
          true,
          {},
        ),
      ),
    ).toEqual({ monitor: null });
  });

  it("is right about what keeps the reference as written", () => {
    expect(gotcha()).toContain(
      "A URL and a block that reads or writes records are the exceptions",
    );

    const slack: ComponentMetadata = SlackComponents.find(
      (step: ComponentMetadata): boolean => {
        return step.id === "slack-send-message-to-channel";
      },
    ) as ComponentMetadata;

    expect(
      takesEmptyValues({
        metadata: slack,
        argument: slack.arguments.find((argument: { id: string }): boolean => {
          return argument.id === "webhook-url";
        }) as ComponentMetadata["arguments"][number],
      }),
    ).toBe(false);

    for (const step of BaseModelComponents.getComponents(new Alert())) {
      for (const argument of step.arguments) {
        expect(takesEmptyValues({ metadata: step, argument: argument })).toBe(
          false,
        );
      }
    }
  });

  it("is right that is empty tells them apart", () => {
    expect(gotcha()).toContain("**is empty** in an **If / Else**");
    expect(
      evaluateCondition({
        valueToCheck: VMUtil.replaceValueInPlace(
          NO_MONITOR,
          MONITOR_REFERENCE,
          false,
          {},
        ),
        operator: ConditionOperator.IsEmpty,
      }),
    ).toBe(true);
  });

  it("gives a loop that names the SLO behind the alert", () => {
    expect(gotcha()).toContain(`\`${SLO_LOOP}\``);
    expect(VMUtil.replaceValueInPlace(NO_MONITOR, SLO_LOOP, false, {})).toBe(
      "Overall Calendar Month",
    );
  });

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("%s has both references to copy", (language: string) => {
    const page: string = readPage(language, "workflows/variables");

    expect(page).toContain(`\`${MONITOR_REFERENCE}\``);
    expect(page).toContain(`\`${SLO_LOOP}\``);
  });
});

describe("the other workflow pages", () => {
  it("Triggers says a field the record has nothing in comes through empty too", () => {
    expect(TRIGGERS).toContain(
      "A field you didn't select comes through empty. So does a field the record has nothing in, such as the monitor of an alert no monitor raised.",
    );
  });

  it("Components is right that a related record asked for whole passes on its ID", () => {
    expect(COMPONENTS).toContain(
      'A related record\'s fields go under its key, as in `{"monitor": {"name": true}}`: `{"monitor": true}` passes on only its ID.',
    );
    expect(
      SelectUtil.sanitizeSelect(Alert, { monitor: true } as never).select,
    ).toEqual({ monitor: { _id: true } });
    expect(
      SelectUtil.sanitizeSelect(Alert, { monitor: { name: true } } as never)
        .select,
    ).toEqual({ monitor: { name: true, _id: true } });
  });

  it("Runs says both reasons a value can come through empty, and where each is said", () => {
    expect(RUNS).toContain(
      "the earlier block ran but has nothing in that field. Either the record holds no value there, which the **Full Log** tab notes on a line of its own, or the block doesn't pass the field on, which the step warns about.",
    );
  });
});
