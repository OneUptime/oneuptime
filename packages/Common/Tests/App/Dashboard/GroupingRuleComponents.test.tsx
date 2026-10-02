import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission from "../../../Types/Permission";

/*
 * The pieces the simplified Incident and Alert Grouping Rules pages are made
 * of, rendered for real: the list's Grouping column, the "Group incidents by"
 * cards, the switch-and-minutes settings, and the ready-made rules that are
 * added in one click. Only the network, the signed-in user's permissions and
 * the current project are stubbed.
 */

const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
    },
  };
});

let userPermissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return userPermissions;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

const PROJECT_ID: string = "00000000-0000-4000-8000-0000000000a1";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDType: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;
        return new ObjectIDType(PROJECT_ID);
      },
    },
  };
});

import GroupingRuleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingRuleSummary";
import GroupingModeField from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingModeField";
import MinutesSettingField, {
  MinutesSettingValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/MinutesSettingField";
import GroupingRuleTemplates from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingRuleTemplates";
import {
  GROUPING_RULE_COPY,
  GROUPING_RULE_TEMPLATES,
  GroupingMode,
  GroupingRuleKind,
  GroupingRuleTemplate,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import ObjectID from "../../../Types/ObjectID";

afterEach(() => {
  cleanup();
});

describe("GroupingRuleSummary", () => {
  test("says how a rule groups and for how long, with nothing else to note", () => {
    render(
      <GroupingRuleSummary
        kind={GroupingRuleKind.Incident}
        rule={{
          groupByMonitor: true,
          enableTimeWindow: true,
          timeWindowMinutes: 30,
        }}
      />,
    );

    expect(
      screen.getByTestId("grouping-rule-summary-grouping"),
    ).toHaveTextContent("One episode per monitor");
    expect(
      screen.getByTestId("grouping-rule-summary-timing"),
    ).toHaveTextContent(
      "New incidents join while they arrive within 30 minutes of the last one",
    );
    expect(
      screen.queryByTestId("grouping-rule-summary-details"),
    ).not.toBeInTheDocument();
  });

  test("lists what else the rule does as notes", () => {
    render(
      <GroupingRuleSummary
        kind={GroupingRuleKind.Incident}
        rule={
          Object.assign(new IncidentGroupingRule(), {
            groupByMonitor: true,
            groupBySeverity: true,
            enableTimeWindow: false,
            enableReopenWindow: true,
            reopenWindowMinutes: 60,
            showEpisodeOnStatusPage: true,
            onCallDutyPolicies: [{ _id: "a" }, { _id: "b" }],
          }) as unknown as Record<string, unknown>
        }
      />,
    );

    expect(
      screen.getByTestId("grouping-rule-summary-grouping"),
    ).toHaveTextContent("One episode per combination of: Monitor, Severity");
    expect(
      screen.getByTestId("grouping-rule-summary-timing"),
    ).toHaveTextContent(
      "New incidents keep joining until the episode is resolved",
    );

    const notes: Array<string> = within(
      screen.getByTestId("grouping-rule-summary-details"),
    )
      .getAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });

    expect(notes).toEqual([
      "Reopens episodes resolved in the last 1 hour",
      "Runs 2 on-call policies",
      "Shows episodes on status pages",
    ]);
  });

  test("speaks about alerts on the alert page", () => {
    render(
      <GroupingRuleSummary
        kind={GroupingRuleKind.Alert}
        rule={{
          enableTimeWindow: true,
          timeWindowMinutes: 10,
          enableInactivityTimeout: true,
          inactivityTimeoutMinutes: 1440,
        }}
      />,
    );

    expect(
      screen.getByTestId("grouping-rule-summary-grouping"),
    ).toHaveTextContent("All matching alerts share one episode");
    expect(
      screen.getByTestId("grouping-rule-summary-timing"),
    ).toHaveTextContent(
      "New alerts join while they arrive within 10 minutes of the last one",
    );
    expect(
      screen.getByTestId("grouping-rule-summary-details"),
    ).toHaveTextContent("Resolves after 1 day without new alerts");
  });
});

describe("GroupingModeField", () => {
  function Harness(props: {
    kind: GroupingRuleKind;
    initial: GroupingMode;
    onChange: (mode: GroupingMode) => void;
  }): ReactElement {
    const [mode, setMode] = useState<GroupingMode>(props.initial);

    return (
      <>
        <span id="mode-label">Group incidents by</span>
        <GroupingModeField
          kind={props.kind}
          value={mode}
          ariaLabelledby="mode-label"
          onChange={(next: GroupingMode): void => {
            setMode(next);
            props.onChange(next);
          }}
        />
      </>
    );
  }

  test("offers the four answers and Custom as cards, with the current one checked", () => {
    render(
      <Harness
        kind={GroupingRuleKind.Incident}
        initial={GroupingMode.Monitor}
        onChange={(): void => {}}
      />,
    );

    const group: HTMLElement = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-labelledby", "mode-label");

    const cards: Array<HTMLElement> = within(group).getAllByRole("radio");
    expect(
      cards.map((card: HTMLElement): string => {
        return card.getAttribute("data-testid") || "";
      }),
    ).toEqual([
      "card-select-option-monitor",
      "card-select-option-everything",
      "card-select-option-severity",
      "card-select-option-title",
      "card-select-option-custom",
    ]);

    expect(screen.getByTestId("card-select-option-monitor")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("card-select-option-severity")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.getByTestId("card-select-option-everything"),
    ).toHaveTextContent("Everything Together");
    expect(screen.getByTestId("card-select-option-severity")).toHaveTextContent(
      "such as all Critical incidents",
    );
  });

  test("describes the alert page's cards in alerts", () => {
    render(
      <Harness
        kind={GroupingRuleKind.Alert}
        initial={GroupingMode.Everything}
        onChange={(): void => {}}
      />,
    );

    expect(
      screen.getByTestId("card-select-option-everything"),
    ).toHaveTextContent("One shared episode for all matching alerts");
    expect(screen.getByTestId("card-select-option-severity")).toHaveTextContent(
      "such as all Critical alerts",
    );
  });

  test("picking a card hands over its answer, by mouse or keyboard", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Harness
        kind={GroupingRuleKind.Incident}
        initial={GroupingMode.Monitor}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("card-select-option-custom"));
    expect(onChange).toHaveBeenLastCalledWith(GroupingMode.Custom);
    expect(screen.getByTestId("card-select-option-custom")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.keyDown(screen.getByTestId("card-select-option-title"), {
      key: "Enter",
    });
    expect(onChange).toHaveBeenLastCalledWith(GroupingMode.Title);
  });
});

describe("MinutesSettingField", () => {
  function renderSetting(data: {
    enabled: boolean;
    minutes: unknown;
    error?: string;
    onChange?: (value: MinutesSettingValue) => void;
    onBlur?: () => void;
  }): void {
    render(
      <MinutesSettingField
        title={GROUPING_RULE_COPY.timeWindowTitle[GroupingRuleKind.Incident]}
        description={
          GROUPING_RULE_COPY.timeWindowDescription[GroupingRuleKind.Incident]
        }
        sentence={
          GROUPING_RULE_COPY.timeWindowSentence[GroupingRuleKind.Incident]
        }
        minutesLabel="Time Window"
        enabled={data.enabled}
        minutes={data.minutes}
        defaultMinutes={30}
        error={data.error}
        dataTestId="time-window-setting"
        onBlur={data.onBlur}
        onChange={
          data.onChange ||
          ((): void => {
            // Not asserted on.
          })
        }
      />,
    );
  }

  test("is a labelled switch, with its help, and no minutes while it is off", () => {
    renderSetting({ enabled: false, minutes: 30 });

    const toggle: HTMLElement = screen.getByRole("switch", {
      name: "Only group incidents that arrive close together",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(
      "When this is off, matching incidents keep joining the open episode until it is resolved.",
    );
    expect(
      screen.queryByTestId("time-window-setting-minutes-row"),
    ).not.toBeInTheDocument();
  });

  test("when on, draws the minutes inside its sentence, named for the setting", () => {
    renderSetting({ enabled: true, minutes: 30 });

    const row: HTMLElement = screen.getByTestId(
      "time-window-setting-minutes-row",
    );
    const input: HTMLElement = within(row).getByRole("spinbutton", {
      name: "Time Window",
    });

    expect(input).toHaveValue(30);
    // The words before the box, the box, and the words after it.
    expect(row.children).toHaveLength(3);
    expect(row.children[1]).toContainElement(input);
    expect(row.firstElementChild).toHaveTextContent(/^Within$/);
    expect(row.lastElementChild).toHaveTextContent(
      "minutes of the previous incident",
    );
  });

  test("turning it on starts from the default when no minutes are set", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderSetting({ enabled: false, minutes: undefined, onChange });

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledWith({ enabled: true, minutes: 30 });
  });

  test("turning it on keeps minutes that were set before", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderSetting({ enabled: false, minutes: 45, onChange });

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledWith({ enabled: true, minutes: 45 });
  });

  test("turning it off never leaves a cleared box behind", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderSetting({ enabled: true, minutes: "", onChange });

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledWith({ enabled: false, minutes: 30 });
  });

  test("typing hands over whole minutes as a number, and anything else as typed", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderSetting({ enabled: true, minutes: 30, onChange });

    const input: HTMLElement = screen.getByRole("spinbutton", {
      name: "Time Window",
    });

    fireEvent.change(input, { target: { value: "45" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, minutes: 45 });

    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, minutes: "" });
  });

  test("leaving the box tells the form it was touched", () => {
    const onBlur: MockFunction = getJestMockFunction();
    renderSetting({ enabled: true, minutes: 30, onBlur });

    fireEvent.blur(screen.getByRole("spinbutton"));

    expect(onBlur).toHaveBeenCalled();
  });

  test("an error is announced and tied to the box", () => {
    renderSetting({
      enabled: true,
      minutes: "",
      error: "Enter a whole number of minutes between 1 and 525600.",
    });

    const error: HTMLElement = screen.getByRole("alert");
    const input: HTMLElement = screen.getByRole("spinbutton");

    expect(error).toHaveTextContent(
      "Enter a whole number of minutes between 1 and 525600.",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });

  test("an error on a switched-off setting is not shown - it is not checked", () => {
    renderSetting({ enabled: false, minutes: "", error: "Not shown." });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("GroupingRuleTemplates", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ data: {} });
    userPermissions = [Permission.ProjectOwner];
  });

  function renderTemplates(data?: {
    kind?: GroupingRuleKind;
    showIntro?: boolean;
    onRuleAdded?: (added: { name: string }) => void;
    onCreateCustomRule?: () => void;
  }): void {
    const kind: GroupingRuleKind = data?.kind || GroupingRuleKind.Incident;

    if (kind === GroupingRuleKind.Alert) {
      render(
        <GroupingRuleTemplates<AlertGroupingRule>
          kind={kind}
          modelType={AlertGroupingRule}
          showIntro={data?.showIntro}
          onRuleAdded={data?.onRuleAdded || ((): void => {})}
          onCreateCustomRule={data?.onCreateCustomRule}
        />,
      );
      return;
    }

    render(
      <GroupingRuleTemplates<IncidentGroupingRule>
        kind={kind}
        modelType={IncidentGroupingRule}
        showIntro={data?.showIntro}
        onRuleAdded={data?.onRuleAdded || ((): void => {})}
        onCreateCustomRule={data?.onCreateCustomRule}
      />,
    );
  }

  test("shows the four ready-made rules, each with what it does", () => {
    renderTemplates();

    const cards: Array<HTMLElement> = within(
      screen.getByTestId("grouping-rule-templates"),
    ).getAllByRole("listitem");

    expect(cards).toHaveLength(4);
    expect(
      cards.map((card: HTMLElement): string => {
        return within(card).getByRole("heading").textContent || "";
      }),
    ).toEqual([
      "Group incidents from the same monitor",
      "Group incidents that happen together",
      "Group incidents by severity",
      "Group repeats of the same incident",
    ]);
    expect(cards[1]).toHaveTextContent(
      "Catches an outage that trips many monitors at once.",
    );
  });

  test("an empty list introduces grouping with a worked example", () => {
    renderTemplates({ showIntro: true });

    const section: HTMLElement = screen.getByRole("region", {
      name: "Start with a template",
    });

    expect(section).toHaveTextContent(
      "For example, when a database goes down and 20 monitors open incidents within five minutes",
    );
  });

  test("the dialog version leaves the introduction out", () => {
    renderTemplates();

    expect(screen.queryByText("Start with a template")).not.toBeInTheDocument();
  });

  test("Add Rule saves the template as an enabled rule in one click", async () => {
    const onRuleAdded: MockFunction = getJestMockFunction();
    renderTemplates({ onRuleAdded });

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Add Rule: Group incidents that happen together",
        }),
      );
    });

    await waitFor(() => {
      expect(onRuleAdded).toHaveBeenCalledWith({
        name: "Group incidents that happen together",
      });
    });

    expect(createMock).toHaveBeenCalledTimes(1);

    const request: { model: IncidentGroupingRule; modelType: unknown } = (
      createMock.mock.calls[0] as Array<{
        model: IncidentGroupingRule;
        modelType: unknown;
      }>
    )[0]!;

    expect(request.modelType).toBe(IncidentGroupingRule);
    expect(request.model).toBeInstanceOf(IncidentGroupingRule);
    expect(request.model.name).toBe("Group incidents that happen together");
    expect(request.model.isEnabled).toBe(true);
    expect(request.model.groupByMonitor).toBe(false);
    expect(request.model.groupBySeverity).toBe(false);
    expect(request.model.groupByIncidentTitle).toBe(false);
    expect(request.model.groupByIncidentLabels).toBe(false);
    expect(request.model.groupByMonitorLabels).toBe(false);
    expect(request.model.enableTimeWindow).toBe(true);
    expect(request.model.timeWindowMinutes).toBe(10);
    expect(request.model.projectId?.toString()).toBe(PROJECT_ID);
    // The server puts a new rule at the end of the list.
    expect(request.model.priority).toBeUndefined();
  });

  test.each(
    GROUPING_RULE_TEMPLATES.map((template: GroupingRuleTemplate) => {
      return [template.id, template];
    }),
  )(
    "%s saves its own answer and time window",
    async (_id: string, template: GroupingRuleTemplate) => {
      renderTemplates();

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByTestId(`grouping-rule-template-${template.id}-add`),
        );
      });

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });

      const model: IncidentGroupingRule = (
        createMock.mock.calls[0] as Array<{ model: IncidentGroupingRule }>
      )[0]!.model;

      expect(model.groupByMonitor).toBe(template.mode === GroupingMode.Monitor);
      expect(model.groupBySeverity).toBe(
        template.mode === GroupingMode.Severity,
      );
      expect(model.groupByIncidentTitle).toBe(
        template.mode === GroupingMode.Title,
      );
      expect(model.timeWindowMinutes).toBe(template.timeWindowMinutes);
    },
  );

  test("adds alert rules on the alert page", async () => {
    renderTemplates({ kind: GroupingRuleKind.Alert });

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Add Rule: Group repeats of the same alert",
        }),
      );
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: { model: AlertGroupingRule; modelType: unknown } = (
      createMock.mock.calls[0] as Array<{
        model: AlertGroupingRule;
        modelType: unknown;
      }>
    )[0]!;

    expect(request.modelType).toBe(AlertGroupingRule);
    expect(request.model.groupByAlertTitle).toBe(true);
    expect(request.model.name).toBe("Group repeats of the same alert");
    expect(request.model.timeWindowMinutes).toBe(60);
  });

  test("while one rule is being added, no second click can add another", async () => {
    let finish: (value: unknown) => void = (): void => {};
    createMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        finish = resolve;
      }),
    );
    const onRuleAdded: MockFunction = getJestMockFunction();
    renderTemplates({ onRuleAdded });

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByTestId("grouping-rule-template-same-monitor-add"),
      );
    });

    for (const template of GROUPING_RULE_TEMPLATES) {
      expect(
        screen.getByTestId(`grouping-rule-template-${template.id}-add`),
      ).toBeDisabled();
    }

    fireEvent.click(
      screen.getByTestId("grouping-rule-template-same-title-add"),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(onRuleAdded).not.toHaveBeenCalled();

    await act(async (): Promise<void> => {
      finish({ data: {} });
    });

    await waitFor(() => {
      expect(onRuleAdded).toHaveBeenCalledTimes(1);
    });
  });

  test("a refused save says why, adds nothing and lets the person try again", async () => {
    createMock.mockRejectedValueOnce(new Error("Rule limit reached."));
    const onRuleAdded: MockFunction = getJestMockFunction();
    renderTemplates({ onRuleAdded });

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByTestId("grouping-rule-template-same-monitor-add"),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("grouping-rule-templates-error"),
      ).toHaveTextContent("Rule limit reached.");
    });

    expect(onRuleAdded).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("grouping-rule-template-same-monitor-add"),
    ).not.toBeDisabled();

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByTestId("grouping-rule-template-same-monitor-add"),
      );
    });

    await waitFor(() => {
      expect(onRuleAdded).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("grouping-rule-templates-error"),
    ).not.toBeInTheDocument();
  });

  test("without permission to create rules the buttons are locked and say why", async () => {
    userPermissions = [Permission.ProjectMember];
    const onCreateCustomRule: MockFunction = getJestMockFunction();
    renderTemplates({ onCreateCustomRule });

    const add: HTMLElement = screen.getByTestId(
      "grouping-rule-template-same-monitor-add",
    );
    expect(add).toBeDisabled();
    expect(
      screen.getByTestId(
        "grouping-rule-template-same-monitor-add-disabled-wrapper",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("grouping-rule-templates-create-custom"),
    ).toBeDisabled();

    fireEvent.click(add);
    fireEvent.click(
      screen.getByTestId("grouping-rule-templates-create-custom"),
    );

    expect(createMock).not.toHaveBeenCalled();
    expect(onCreateCustomRule).not.toHaveBeenCalled();
  });

  test("before permissions are known the actions are left out rather than locked without a reason", () => {
    userPermissions = [];
    renderTemplates({ onCreateCustomRule: (): void => {} });

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(
      screen.queryByTestId("grouping-rule-template-same-monitor-add"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("grouping-rule-templates-create-custom"),
    ).not.toBeInTheDocument();
  });

  test("Create Custom Rule hands over to the regular form", () => {
    const onCreateCustomRule: MockFunction = getJestMockFunction();
    renderTemplates({ onCreateCustomRule });

    fireEvent.click(screen.getByRole("button", { name: "Create Custom Rule" }));

    expect(onCreateCustomRule).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("offers no custom rule where the caller has none to open", () => {
    renderTemplates();

    expect(
      screen.queryByTestId("grouping-rule-templates-create-custom"),
    ).not.toBeInTheDocument();
  });

  test("the rule is added to the project the person is in", async () => {
    renderTemplates();

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByTestId("grouping-rule-template-same-severity-add"),
      );
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const model: IncidentGroupingRule = (
      createMock.mock.calls[0] as Array<{ model: IncidentGroupingRule }>
    )[0]!.model;

    expect(model.projectId).toBeInstanceOf(ObjectID);
    expect(model.groupBySeverity).toBe(true);
  });
});
