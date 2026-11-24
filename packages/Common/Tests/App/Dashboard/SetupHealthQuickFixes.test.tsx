/** @timezone UTC */

import "@testing-library/jest-dom";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SetupHealthApi from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthApi";
import SetupHealthView from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthView";
import SetupHealthQuickFixApi, {
  CREATE_ON_CALL_RULE_WORDS,
  SetupHealthPolicyChoice,
  SetupHealthQuickFixKind,
  TURN_ON_CHANNEL_UNDO,
  TURN_ON_CHANNEL_WORDS,
  canApplySetupHealthQuickFix,
  getEventKind,
  getOnCallRuleName,
  getSetupHealthQuickFixKind,
  isAlertRuleFix,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthQuickFix";
import ProjectNotificationChannelsStore from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import { ProjectNotificationChannel } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import { RULE_NAME_MAX_LENGTH } from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthAnswer,
  SetupHealthCheck,
  SetupHealthEventKind,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  getSetupHealthCounts,
  makeSetupHealthFinding,
} from "../../../Types/SetupHealth/SetupHealth";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * SETUP HEALTH'S ONE-CLICK FIXES (#7299): which findings have one, who may
 * apply it, the dialog that says exactly what will change, the request it
 * makes once confirmed - and that the list is worked out again after it,
 * so the finding fixed is gone. Someone who may not make the change keeps
 * the link to the page that fixes it, and nothing else.
 */

const PROJECT: string = "68127299-0000-4000-8000-000000000001";
const MONITOR: string = "68127299-0000-4000-8000-0000000000a1";
const PRIMARY: string = "68127299-0000-4000-8000-0000000000b1";
const SECONDARY: string = "68127299-0000-4000-8000-0000000000b2";

const translator: Translator = getGlobalTranslator();

function channelOff(channel: OnCallPageChannel): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.ChannelOff,
    level: SetupHealthLevel.PagesWillNotArrive,
    subject: channel,
    record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
    related: [
      {
        kind: SetupHealthRecordKind.Monitor,
        id: MONITOR,
        name: "Checkout API",
      },
    ],
    fix: SetupHealthFix.ProjectNotificationSettings,
    words: SETUP_HEALTH_WORDS.channelOff,
    values: { channel: channel },
  });
}

function pagesNobody(
  kind: SetupHealthEventKind,
  level: SetupHealthLevel = SetupHealthLevel.WorthFixing,
): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: level,
    subject: kind,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: MONITOR,
      name: "Checkout API",
    },
    fix:
      level === SetupHealthLevel.Suggestion
        ? SetupHealthFix.OnCallGuidedSetup
        : kind === SetupHealthEventKind.Alert
          ? SetupHealthFix.AlertOnCallRules
          : SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody[kind],
    values: { monitor: "Checkout API" },
  });
}

const OWNER_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.OneOwner,
  level: SetupHealthLevel.Suggestion,
  record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
  fix: SetupHealthFix.ProjectOwners,
  words: SETUP_HEALTH_WORDS.oneOwner,
});

function answer(findings: Array<SetupHealthFinding>): SetupHealthAnswer {
  return {
    findings: findings,
    dismissed: [],
    counts: getSetupHealthCounts(findings),
    monitorCount: 3,
    checkedAt: new Date().toISOString(),
  };
}

const ALLOWED: PermissionGateResult = { isAllowed: true };
const REFUSED: PermissionGateResult = {
  isAllowed: false,
  disabledReason: "You don't have permission to do this.",
};

describe("which findings have a one-click fix", () => {
  test.each([
    [OnCallPageChannel.SMS],
    [OnCallPageChannel.Call],
    [OnCallPageChannel.WhatsApp],
    [OnCallPageChannel.Telegram],
  ])(
    "%s switched off: turned on, as Notification Channels does",
    (channel: OnCallPageChannel) => {
      expect(getSetupHealthQuickFixKind(channelOff(channel))).toBe(
        SetupHealthQuickFixKind.TurnOnChannel,
      );
    },
  );

  test("a channel a project has no switch for has none", () => {
    expect(
      getSetupHealthQuickFixKind(channelOff(OnCallPageChannel.Push)),
    ).toBeNull();
  });

  test("a monitor whose incidents or alerts page nobody, in a project with a policy: an on-call rule for that monitor", () => {
    for (const kind of [
      SetupHealthEventKind.Incident,
      SetupHealthEventKind.Alert,
    ]) {
      expect(getSetupHealthQuickFixKind(pagesNobody(kind))).toBe(
        SetupHealthQuickFixKind.CreateOnCallRule,
      );
    }

    expect(isAlertRuleFix(pagesNobody(SetupHealthEventKind.Alert))).toBe(true);
    expect(isAlertRuleFix(pagesNobody(SetupHealthEventKind.Incident))).toBe(
      false,
    );
    expect(getEventKind(pagesNobody(SetupHealthEventKind.Alert))).toBe(
      SetupHealthEventKind.Alert,
    );
  });

  test("with no on-call policy yet there is nothing to page: the guided setup stays the fix", () => {
    expect(
      getSetupHealthQuickFixKind(
        pagesNobody(SetupHealthEventKind.Incident, SetupHealthLevel.Suggestion),
      ),
    ).toBeNull();
  });

  test("every other check has none", () => {
    expect(getSetupHealthQuickFixKind(OWNER_FINDING)).toBeNull();
    expect(
      getSetupHealthQuickFixKind({
        ...OWNER_FINDING,
        check: SetupHealthCheck.PolicyNotRun,
        fix: SetupHealthFix.IncidentOnCallRules,
      }),
    ).toBeNull();
  });
});

describe("who may apply it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a channel: someone the switch's own column lets flip it", () => {
    const column: SpyInstance<typeof PermissionGate.checkColumnUpdate> = jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue(ALLOWED);

    expect(canApplySetupHealthQuickFix(channelOff(OnCallPageChannel.SMS))).toBe(
      true,
    );
    expect(column.mock.calls[0]![1]).toBe("enableSmsNotifications");

    column.mockReturnValue(REFUSED);

    expect(
      canApplySetupHealthQuickFix(channelOff(OnCallPageChannel.Call)),
    ).toBe(false);
  });

  test("an on-call rule: someone who may create rules of its kind and read the policies", () => {
    const check: SpyInstance<typeof PermissionGate.check> = jest
      .spyOn(PermissionGate, "check")
      .mockImplementation((model: unknown, action: ModelAction) => {
        if (model instanceof AlertOnCallRule) {
          return REFUSED;
        }

        return model instanceof IncidentOnCallRule ||
          (model instanceof OnCallDutyPolicy && action === ModelAction.Read)
          ? ALLOWED
          : REFUSED;
      });

    expect(
      canApplySetupHealthQuickFix(pagesNobody(SetupHealthEventKind.Incident)),
    ).toBe(true);
    expect(
      canApplySetupHealthQuickFix(pagesNobody(SetupHealthEventKind.Alert)),
    ).toBe(false);
    expect(check).toHaveBeenCalled();
  });

  test("nobody, for a finding with no one-click fix", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue(ALLOWED);
    jest.spyOn(PermissionGate, "checkColumnUpdate").mockReturnValue(ALLOWED);

    expect(canApplySetupHealthQuickFix(OWNER_FINDING)).toBe(false);
  });
});

describe("the on-call rule's name", () => {
  test("names the policy and the monitor, in the language of the person who makes it", () => {
    expect(
      getOnCallRuleName({
        policyName: "Primary",
        monitorName: "Checkout API",
        translator: translator,
      }),
    ).toBe("Page Primary for Checkout API");

    const german: string = getOnCallRuleName({
      policyName: "Primary",
      monitorName: "Checkout API",
      translator: dashboardTranslator("de"),
    });

    expect(german).toContain("Primary");
    expect(german).toContain("Checkout API");
    expect(german).not.toBe("Page Primary for Checkout API");
  });

  test("long names give way, ending in …, so the name fits its column", () => {
    const name: string = getOnCallRuleName({
      policyName: "P".repeat(80),
      monitorName: "M".repeat(80),
      translator: translator,
    });

    expect(Array.from(name).length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
    expect(name.startsWith("Page P")).toBe(true);
    expect(name).toContain(" for M");
    expect(name).toContain("…");
  });

  test("is stored with plain spaces, and runs of space as one", () => {
    const name: string = getOnCallRuleName({
      policyName: "  Platform \n primary ",
      monitorName: "Checkout   API",
      translator: dashboardTranslator("fr"),
    });

    expect(name).not.toContain(NO_BREAK_SPACE);
    expect(name).not.toContain(" ");
    expect(name).toContain("Platform primary");
    expect(name).toContain("Checkout API");
  });
});

// What jest.spyOn makes of a generic method: the method at its constraint.
type MethodOf<Method extends (...args: Array<never>) => unknown> = (
  ...args: Parameters<Method>
) => ReturnType<Method>;

describe("the requests", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("turning a channel on writes the project's switch, and tells the lists on screen", async () => {
    const update: SpyInstance<MethodOf<typeof ModelAPI.updateById>> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);
    const record: SpyInstance<
      typeof ProjectNotificationChannelsStore.recordChannel
    > = jest
      .spyOn(ProjectNotificationChannelsStore, "recordChannel")
      .mockImplementation(() => {
        return undefined;
      });

    await SetupHealthQuickFixApi.turnOnChannel(ProjectNotificationChannel.Call);

    expect(update).toHaveBeenCalledWith({
      modelType: Project,
      id: new ObjectID(PROJECT),
      data: { enableCallNotifications: true },
    });
    expect(record).toHaveBeenCalledWith(
      new ObjectID(PROJECT),
      ProjectNotificationChannel.Call,
      true,
    );
  });

  test("an incident rule pages the policy picked for that monitor's new incidents, and matches nothing else", async () => {
    const create: SpyInstance<MethodOf<typeof ModelAPI.create>> = jest
      .spyOn(ModelAPI, "create")
      .mockResolvedValue({} as never);

    await SetupHealthQuickFixApi.createOnCallRule({
      eventKind: SetupHealthEventKind.Incident,
      monitorId: MONITOR,
      monitorName: "Checkout API",
      policy: { id: PRIMARY, name: "Primary" },
      translator: translator,
    });

    const sent: { model: BaseModel; modelType: unknown } = create.mock
      .calls[0]![0] as unknown as { model: BaseModel; modelType: unknown };
    const rule: IncidentOnCallRule = sent.model as IncidentOnCallRule;

    expect(sent.modelType).toBe(IncidentOnCallRule);
    expect(rule.name).toBe("Page Primary for Checkout API");
    expect(rule.isEnabled).toBe(true);
    expect(rule.projectId?.toString()).toBe(PROJECT);
    expect(
      (rule.monitors || []).map((monitor: BaseModel): string => {
        return String(monitor._id);
      }),
    ).toEqual([MONITOR]);
    expect(
      (rule.onCallDutyPolicies || []).map((policy: BaseModel): string => {
        return String(policy._id);
      }),
    ).toEqual([PRIMARY]);
    // No other condition: severities, labels, patterns are left empty.
    expect(rule.incidentSeverities).toBeUndefined();
    expect(rule.monitorNamePattern).toBeUndefined();
  });

  test("an alert rule is an alert on-call rule", async () => {
    const create: SpyInstance<MethodOf<typeof ModelAPI.create>> = jest
      .spyOn(ModelAPI, "create")
      .mockResolvedValue({} as never);

    await SetupHealthQuickFixApi.createOnCallRule({
      eventKind: SetupHealthEventKind.Alert,
      monitorId: MONITOR,
      monitorName: "Checkout API",
      policy: { id: PRIMARY, name: "Primary" },
      translator: translator,
    });

    expect(
      (create.mock.calls[0]![0] as unknown as { modelType: unknown }).modelType,
    ).toBe(AlertOnCallRule);
  });

  test("the policies offered are the ones in service, by name", async () => {
    const list: SpyInstance<MethodOf<typeof ModelAPI.getList>> = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue({
        data: [
          Object.assign(new OnCallDutyPolicy(), {
            _id: PRIMARY,
            name: "Primary",
          }),
        ],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);

    // With what tells it from a policy of its name (#10064).
    expect(await SetupHealthQuickFixApi.getPolicies()).toEqual([
      {
        id: PRIMARY,
        name: "Primary",
        sharedName: {
          kind: SharedNameKind.OnCallPolicy,
          description: undefined,
          createdAt: undefined,
        },
      },
    ]);

    const asked: {
      modelType: unknown;
      query: unknown;
      select: Record<string, unknown>;
    } = list.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      query: unknown;
      select: Record<string, unknown>;
    };

    expect(asked.modelType).toBe(OnCallDutyPolicy);
    expect(asked.query).toEqual({ isArchived: false });
    expect(asked.select).toEqual({
      _id: true,
      name: true,
      description: true,
      createdAt: true,
    });
  });
});

describe("the one-click fixes on Setup Health", () => {
  let getAnswer: SpyInstance<typeof SetupHealthApi.getAnswer>;
  let send: SpyInstance<typeof ProductEvents.send>;
  let gate: SpyInstance<typeof PermissionGate.check>;
  let column: SpyInstance<typeof PermissionGate.checkColumnUpdate>;

  function renderView(): void {
    render(
      <MemoryRouter>
        <SetupHealthView />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    getAnswer = jest.spyOn(SetupHealthApi, "getAnswer");
    send = jest.spyOn(ProductEvents, "send").mockImplementation(() => {
      return undefined;
    });
    gate = jest.spyOn(PermissionGate, "check").mockReturnValue(ALLOWED);
    column = jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue(ALLOWED);
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("SMS off: Turn On SMS beside the link, a dialog that says what changes, then the list without it", async () => {
    getAnswer.mockResolvedValue(
      answer([channelOff(OnCallPageChannel.SMS), OWNER_FINDING]),
    );
    const turnOn: SpyInstance<typeof SetupHealthQuickFixApi.turnOnChannel> =
      jest
        .spyOn(SetupHealthQuickFixApi, "turnOnChannel")
        .mockResolvedValue(undefined as never);
    renderView();

    const row: HTMLElement = (
      await screen.findAllByTestId("setup-health-finding")
    )[0]!;
    const button: HTMLElement = within(row).getByTestId(
      "setup-health-quick-fix",
    );

    expect(button).toHaveTextContent(
      TURN_ON_CHANNEL_WORDS[ProjectNotificationChannel.SMS].button,
    );
    // The link to the page that fixes it stays, after the one-click fix.
    expect(within(row).getByTestId("setup-health-fix")).toHaveTextContent(
      "Open Notification Channels",
    );
    expect(
      button.compareDocumentPosition(
        within(row).getByTestId("setup-health-fix"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(button);

    // Nothing changes before the person confirms.
    expect(turnOn).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("setup-health-quick-fix-change"),
    ).toHaveTextContent(
      TURN_ON_CHANNEL_WORDS[ProjectNotificationChannel.SMS].whatChanges,
    );
    expect(screen.getByTestId("setup-health-quick-fix-undo")).toHaveTextContent(
      TURN_ON_CHANNEL_UNDO,
    );

    getAnswer.mockResolvedValue(answer([OWNER_FINDING]));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(turnOn).toHaveBeenCalledWith(ProjectNotificationChannel.SMS);
    });
    // Worked out again, not the minute-old answer: the finding is gone.
    await waitFor(() => {
      expect(getAnswer).toHaveBeenLastCalledWith({ refresh: true });
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(1);
    });
    expect(screen.queryByTestId("setup-health-quick-fix-dialog")).toBeNull();
    expect(send).toHaveBeenCalledWith(ProductEventName.SetupHealthFixApplied, {
      check: SetupHealthCheck.ChannelOff,
      level: SetupHealthLevel.PagesWillNotArrive,
    });
  });

  test("Cancel changes nothing", async () => {
    getAnswer.mockResolvedValue(answer([channelOff(OnCallPageChannel.Call)]));
    const turnOn: SpyInstance<typeof SetupHealthQuickFixApi.turnOnChannel> =
      jest
        .spyOn(SetupHealthQuickFixApi, "turnOnChannel")
        .mockResolvedValue(undefined as never);
    renderView();

    fireEvent.click(await screen.findByTestId("setup-health-quick-fix"));
    expect(
      screen.getByTestId("setup-health-quick-fix-change"),
    ).toHaveTextContent(
      TURN_ON_CHANNEL_WORDS[ProjectNotificationChannel.Call].whatChanges,
    );
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("setup-health-quick-fix-dialog")).toBeNull();
    expect(turnOn).not.toHaveBeenCalled();
    expect(getAnswer).toHaveBeenCalledTimes(1);
  });

  test("a change the server refuses says why, in the dialog, and the finding stays", async () => {
    getAnswer.mockResolvedValue(answer([channelOff(OnCallPageChannel.SMS)]));
    jest
      .spyOn(SetupHealthQuickFixApi, "turnOnChannel")
      .mockRejectedValue(
        new Error("You don't have permission to change this setting."),
      );
    renderView();

    fireEvent.click(await screen.findByTestId("setup-health-quick-fix"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText(
        "You don't have permission to change this setting.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("setup-health-quick-fix-dialog")).toBeVisible();
    expect(getAnswer).toHaveBeenCalledTimes(1);
  });

  test("someone who may not flip the switch keeps only the link", async () => {
    column.mockReturnValue(REFUSED);
    getAnswer.mockResolvedValue(answer([channelOff(OnCallPageChannel.SMS)]));
    renderView();

    const row: HTMLElement = await screen.findByTestId("setup-health-finding");

    expect(within(row).queryByTestId("setup-health-quick-fix")).toBeNull();
    expect(within(row).getByTestId("setup-health-fix")).toBeInTheDocument();
  });

  test("a monitor that pages nobody, with one policy: the dialog names it, and the rule is made on confirm", async () => {
    getAnswer.mockResolvedValue(
      answer([pagesNobody(SetupHealthEventKind.Incident)]),
    );
    jest
      .spyOn(SetupHealthQuickFixApi, "getPolicies")
      .mockResolvedValue([{ id: PRIMARY, name: "Primary" }]);
    const create: SpyInstance<typeof SetupHealthQuickFixApi.createOnCallRule> =
      jest
        .spyOn(SetupHealthQuickFixApi, "createOnCallRule")
        .mockResolvedValue(undefined as never);
    renderView();

    const button: HTMLElement = await screen.findByTestId(
      "setup-health-quick-fix",
    );

    expect(button).toHaveTextContent(CREATE_ON_CALL_RULE_WORDS.button);

    fireEvent.click(button);

    expect(
      await screen.findByTestId("setup-health-quick-fix-change"),
    ).toHaveTextContent(
      "Every new incident of Checkout API will page on-call policy Primary.",
    );
    expect(screen.getByTestId("setup-health-quick-fix-undo")).toHaveTextContent(
      CREATE_ON_CALL_RULE_WORDS.undo[SetupHealthEventKind.Incident],
    );
    // One policy: nothing to pick.
    expect(screen.queryByTestId("setup-health-quick-fix-policy")).toBeNull();

    getAnswer.mockResolvedValue(answer([]));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKind: SetupHealthEventKind.Incident,
          monitorId: MONITOR,
          monitorName: "Checkout API",
          policy: { id: PRIMARY, name: "Primary" },
        }),
      );
    });
    await waitFor(() => {
      expect(getAnswer).toHaveBeenLastCalledWith({ refresh: true });
    });
    expect(send).toHaveBeenCalledWith(ProductEventName.SetupHealthFixApplied, {
      check: SetupHealthCheck.MonitorPagesNobody,
      level: SetupHealthLevel.WorthFixing,
    });
  });

  test("with several policies, none is guessed: nothing can be made until one is picked", async () => {
    const policies: Array<SetupHealthPolicyChoice> = [
      { id: PRIMARY, name: "Primary" },
      { id: SECONDARY, name: "Secondary" },
    ];

    getAnswer.mockResolvedValue(
      answer([pagesNobody(SetupHealthEventKind.Alert)]),
    );
    jest
      .spyOn(SetupHealthQuickFixApi, "getPolicies")
      .mockResolvedValue(policies);
    const create: SpyInstance<typeof SetupHealthQuickFixApi.createOnCallRule> =
      jest
        .spyOn(SetupHealthQuickFixApi, "createOnCallRule")
        .mockResolvedValue(undefined as never);
    renderView();

    fireEvent.click(await screen.findByTestId("setup-health-quick-fix"));

    expect(
      await screen.findByTestId("setup-health-quick-fix-policy"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("setup-health-quick-fix-change")).toBeNull();
    expect(screen.getByTestId("setup-health-quick-fix-undo")).toHaveTextContent(
      CREATE_ON_CALL_RULE_WORDS.undo[SetupHealthEventKind.Alert],
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(create).not.toHaveBeenCalled();

    // Picked: the sentence names it, and the rule pages it.
    fireEvent.keyDown(
      within(screen.getByTestId("setup-health-quick-fix-policy")).getByRole(
        "combobox",
      ),
      { key: "ArrowDown", code: "ArrowDown" },
    );
    fireEvent.click(await screen.findByText("Secondary"));

    expect(
      await screen.findByTestId("setup-health-quick-fix-change"),
    ).toHaveTextContent(
      "Every new alert of Checkout API will page on-call policy Secondary.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKind: SetupHealthEventKind.Alert,
          policy: { id: SECONDARY, name: "Secondary" },
        }),
      );
    });
  });

  test("with no policy in service, it says so and makes nothing", async () => {
    getAnswer.mockResolvedValue(
      answer([pagesNobody(SetupHealthEventKind.Incident)]),
    );
    jest.spyOn(SetupHealthQuickFixApi, "getPolicies").mockResolvedValue([]);
    renderView();

    fireEvent.click(await screen.findByTestId("setup-health-quick-fix"));

    expect(
      await screen.findByText(CREATE_ON_CALL_RULE_WORDS.noPolicy),
    ).toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
  });

  test("someone who may not create on-call rules keeps only the link", async () => {
    gate.mockImplementation((model: unknown) => {
      return model instanceof IncidentOnCallRule ? REFUSED : ALLOWED;
    });
    getAnswer.mockResolvedValue(
      answer([pagesNobody(SetupHealthEventKind.Incident)]),
    );
    renderView();

    const row: HTMLElement = await screen.findByTestId("setup-health-finding");

    expect(within(row).queryByTestId("setup-health-quick-fix")).toBeNull();
    expect(within(row).getByTestId("setup-health-fix")).toHaveTextContent(
      "Set Up Paging",
    );
  });
});

describe("the one-click fixes' words, in every Dashboard language", () => {
  const LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
    "ar",
  ];

  const WORDS: Array<string> = [
    ...Object.values(TURN_ON_CHANNEL_WORDS).flatMap(
      (words: { button: string; whatChanges: string }): Array<string> => {
        return [words.button, words.whatChanges];
      },
    ),
    TURN_ON_CHANNEL_UNDO,
    CREATE_ON_CALL_RULE_WORDS.button,
    ...Object.values(CREATE_ON_CALL_RULE_WORDS.whatChanges),
    ...Object.values(CREATE_ON_CALL_RULE_WORDS.undo),
    CREATE_ON_CALL_RULE_WORDS.ruleName,
  ];

  test.each(LANGUAGES)("%s words each of them", (language: string) => {
    const reader: Translator = dashboardTranslator(language);

    for (const words of WORDS) {
      expect({
        words: words,
        translated: reader.hasTranslation(words),
      }).toEqual({ words: words, translated: true });
    }
  });

  test("a sentence keeps the names it is handed, in every language", () => {
    for (const language of LANGUAGES) {
      const reader: Translator = dashboardTranslator(language);

      for (const template of Object.values(
        CREATE_ON_CALL_RULE_WORDS.whatChanges,
      )) {
        const filled: string = reader.translateTemplate(template, {
          monitor: "Checkout API",
          policy: "Primary",
        });

        expect(filled).toContain("Checkout API");
        expect(filled).toContain("Primary");
        expect(filled).not.toContain("{{");
      }
    }
  });
});
