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
} from "@testing-library/react";
import { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudEnvironmentSource,
  CloudResourceEnvironment,
} from "../../../Types/Cloud/CloudResourceEnvironment";
import {
  CLOUD_SAVINGS_ACTION_TITLES,
  CloudSavingsActionGroup,
  CloudSavingsActionKind,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsNotOffered,
} from "../../../Types/Cloud/CloudSavingsAction";
import {
  CloudOffHoursPreview,
  CloudOffHoursSkipReason,
  CloudSavingsConnectionState,
  CloudSavingsOffer,
  CloudSavingsSummary,
} from "../../../Types/Cloud/CloudSavingsApiTypes";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { Translator, createTranslator } from "../../../Types/Translator";
import Toast from "../../../UI/Utils/Toast";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudSavingsApi from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Savings/CloudSavingsApi";
import CloudSavingsApplyModal, {
  APPLY_ADMINS_APPROVE,
  APPLY_ASK_BUTTON,
  APPLY_BUTTON,
  APPLY_IN_CLOUD_BUTTON,
  APPLY_PULL_REQUEST_BUTTON,
  APPLY_WAITS,
  APPLY_YOU_APPROVE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Savings/CloudSavingsApplyModal";
import CloudSavingsActionsStrip, {
  hasCloudSavingsActivity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Savings/CloudSavingsActionsStrip";
import CloudOffHoursPreviewModal from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Savings/CloudOffHoursPreviewModal";
import { getSavingsRuleMatchText } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Savings/CloudSavingsAiRulesTable";
import {
  getClockProblem,
  getWorkingDaysText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Schedules";

/*
 * ACTING ON SAVINGS, AS A PERSON MEETS IT (#11010): the dialog Apply opens,
 * the strip of what changes came to, what an off-hours schedule picks, and
 * the words a savings AI rule's row and a schedule's hours are read in -
 * drawn with the savings API stood in for.
 *
 *   - Apply: what changes, what it saves, how it is undone, who approves.
 *     An approver applies it at once, as them; anyone else asks for it. A
 *     resource declared in code opens a pull request first, the cloud as
 *     the second choice. A commitment is bought in the cloud's console,
 *     never here, and a connection that does not allow the change says so,
 *     with no button to press. A refusal stays in the dialog.
 *   - The strip: only once anything was done, the bill's figures first.
 *   - A schedule's preview: each resource, and why one is left running.
 */

const RECOMMENDATION_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000a1",
);
const ENGLISH: Translator = createTranslator(undefined, "en");

function offerOf(overrides: Partial<CloudSavingsOffer> = {}): CloudSavingsOffer {
  return {
    cloudCostRecommendationId: RECOMMENDATION_ID.toString(),
    provider: CloudProvider.AWS,
    resourceName: "orders-dev",
    resourceId: "i-0abc1234def567890",
    resourceType: "EC2 instance",
    region: "eu-west-1",
    monthlySavings: 61.33,
    currency: "USD",
    kind: CloudSavingsActionKind.StopInstance,
    restarts: false,
    undo: CloudSavingsActionUndo.Undoable,
    connectionState: CloudSavingsConnectionState.Ready,
    environment: CloudResourceEnvironment.NonProduction,
    environmentSource: CloudEnvironmentSource.Tag,
    owners: [{ userId: "70000000-0000-4000-8000-000000000071", name: "Alice Owner" }],
    ownerTeams: [],
    approvedBy: "owners",
    canApprove: true,
    canRequest: true,
    needsTwoApprovals: false,
    ...overrides,
  } as CloudSavingsOffer;
}

async function openApply(offer: CloudSavingsOffer): Promise<{
  onClose: Mock<() => void>;
  onDone: Mock<() => void>;
}> {
  getJestSpyOn(CloudSavingsApi, "getOffer").mockResolvedValue(offer);
  const onClose: Mock<() => void> = jest.fn<() => void>();
  const onDone: Mock<() => void> = jest.fn<() => void>();

  await act(async () => {
    render(
      <MemoryRouter>
        <CloudSavingsApplyModal
          cloudCostRecommendationId={RECOMMENDATION_ID}
          onClose={onClose}
          onDone={onDone}
        />
      </MemoryRouter>,
    );
  });
  await screen.findByTestId("cloud-savings-apply");

  return { onClose, onDone };
}

function submitButton(): HTMLElement | null {
  return screen.queryByTestId("modal-footer-submit-button");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/savings`);
  getJestSpyOn(Toast, "success").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Apply, for a saving OneUptime makes", () => {
  test("says what changes, what it saves, how it is undone and who approves it", async () => {
    await openApply(offerOf());

    expect(
      screen.getByText(
        CLOUD_SAVINGS_ACTION_TITLES[CloudSavingsActionKind.StopInstance],
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cloud-savings-apply-sentence")).toHaveTextContent(
      "Stops orders-dev.",
    );
    expect(screen.getByTestId("cloud-savings-apply-saves")).toHaveTextContent(
      "$61.33",
    );
    expect(screen.getByTestId("cloud-savings-apply-undo")).toHaveTextContent(
      "Can be undone with one press.",
    );
    expect(
      screen.getByTestId("cloud-savings-apply-approvers"),
    ).toHaveTextContent("Alice Owner");
    expect(
      screen.getByTestId("cloud-savings-apply-approvers"),
    ).toHaveTextContent(APPLY_YOU_APPROVE);
    expect(submitButton()).toHaveTextContent(APPLY_BUTTON);
  });

  test("an approver's Apply makes it at once, as them, with the final snapshot asked for", async () => {
    const apply: jest.SpyInstance = getJestSpyOn(
      CloudSavingsApi,
      "apply",
    ).mockResolvedValue({
      actionId: "20000000-0000-4000-8000-0000000000b1",
      status: CloudSavingsActionStatus.Applying,
    });
    const { onClose, onDone } = await openApply(offerOf());

    await act(async () => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(apply).toHaveBeenCalledWith({
      cloudCostRecommendationId: RECOMMENDATION_ID,
      finalSnapshot: true,
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("someone who may not approve it asks for it: it waits for an owner", async () => {
    await openApply(offerOf({ canApprove: false }));

    expect(submitButton()).toHaveTextContent(APPLY_ASK_BUTTON);
    expect(
      screen.getByTestId("cloud-savings-apply-approvers"),
    ).toHaveTextContent(APPLY_WAITS);
  });

  test("a resource nobody owns is approved by a project owner or admin", async () => {
    await openApply(
      offerOf({ owners: [], approvedBy: "admins", canApprove: false }),
    );

    expect(
      screen.getByTestId("cloud-savings-apply-approvers"),
    ).toHaveTextContent(APPLY_ADMINS_APPROVE);
  });

  test("a disk deleted without its final snapshot says it cannot be undone", async () => {
    await openApply(
      offerOf({
        kind: CloudSavingsActionKind.DeleteVolume,
        resourceName: "data-old",
        finalSnapshot: "offered",
        undo: CloudSavingsActionUndo.FromSnapshot,
      }),
    );

    expect(screen.getByTestId("cloud-savings-apply-undo")).not.toHaveTextContent(
      "cannot be undone",
    );

    // The toggle, as a person turns the final snapshot off.
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("cloud-savings-final-snapshot")
          .querySelector("button") ||
          screen.getByTestId("cloud-savings-final-snapshot"),
      );
    });

    expect(screen.getByTestId("cloud-savings-apply-undo")).toHaveTextContent(
      "Cannot be undone.",
    );
  });

  test("a refusal stays in the dialog, saying why", async () => {
    getJestSpyOn(CloudSavingsApi, "apply").mockResolvedValue({
      actionId: "20000000-0000-4000-8000-0000000000b2",
      status: CloudSavingsActionStatus.Failed,
      summary:
        "AWS refused ec2:StopInstances on instance i-0abc1234def567890: the access key may not call it.",
    });
    const { onClose } = await openApply(offerOf());

    await act(async () => {
      fireEvent.click(submitButton()!);
    });

    expect(
      await screen.findByText(
        "AWS refused ec2:StopInstances on instance i-0abc1234def567890: the access key may not call it.",
      ),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Apply, for a resource declared in code", () => {
  test("opens a pull request first, in the repository that declares it; the cloud is the second choice", async () => {
    const fixInCode: jest.SpyInstance = getJestSpyOn(
      CloudSavingsApi,
      "fixInCode",
    ).mockResolvedValue({
      aiRunId: "30000000-0000-4000-8000-0000000000c1",
      codeRepositoryName: "acme/infra",
    });
    const apply: jest.SpyInstance = getJestSpyOn(CloudSavingsApi, "apply");
    const { onClose } = await openApply(
      offerOf({
        declaredInCode: {
          managedAs: "Terraform",
          codeRepositoryId: "40000000-0000-4000-8000-0000000000d1",
          codeRepositoryName: "acme/infra",
        },
      }),
    );

    expect(submitButton()).toHaveTextContent(APPLY_PULL_REQUEST_BUTTON);
    expect(screen.getByTestId("cloud-savings-apply-in-cloud")).toHaveTextContent(
      APPLY_IN_CLOUD_BUTTON,
    );
    expect(
      screen.getByText(
        "Declared in Terraform: change it in code, or the next deploy puts it back. OneUptime AI opens a pull request in acme/infra.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(fixInCode).toHaveBeenCalledWith({
      cloudCostRecommendationId: RECOMMENDATION_ID,
    });
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("Apply, for a saving OneUptime does not make here", () => {
  test("a commitment is bought in the cloud's console: a link, and no button to press", async () => {
    await openApply(
      offerOf({
        kind: undefined,
        notOffered: CloudSavingsNotOffered.Commitment,
        purchaseUrl:
          "https://console.aws.amazon.com/cost-management/home#/savings-plans/purchase",
      }),
    );

    expect(screen.getByTestId("cloud-savings-not-offered")).toHaveTextContent(
      "OneUptime never buys a commitment.",
    );
    expect(screen.getByTestId("cloud-savings-purchase-link")).toHaveAttribute(
      "href",
      "https://console.aws.amazon.com/cost-management/home#/savings-plans/purchase",
    );
    expect(submitButton()).toBeNull();
  });

  test("Savings actions off on the connection: what to turn on, and no button to press", async () => {
    await openApply(
      offerOf({
        connectionState: CloudSavingsConnectionState.SavingsActionsOff,
        cloudConnectionId: "50000000-0000-4000-8000-0000000000e1",
      }),
    );

    expect(
      screen.getByTestId("cloud-savings-connection-state"),
    ).toHaveTextContent("Turn on Savings actions");
    expect(submitButton()).toBeNull();
  });

  test("a change already waiting or under way is not asked for twice", async () => {
    await openApply(
      offerOf({
        openActionId: "20000000-0000-4000-8000-0000000000b3",
        openActionStatus: CloudSavingsActionStatus.Proposed,
      }),
    );

    expect(
      screen.getByText(
        "This change is already waiting for approval or under way. Its card is on Cloud > Savings.",
      ),
    ).toBeInTheDocument();
    expect(submitButton()).toBeNull();
  });
});

const NOTHING_DONE: CloudSavingsSummary = {
  currency: "USD",
  savedThisMonth: 0,
  realisedCount: 0,
  measuringCount: 0,
  promisedMonthly: 0,
  scheduledHoursThisMonth: 0,
  changesCount: 0,
  waitingCount: 0,
  waitingForYouCount: 0,
};

describe("what acting on savings came to", () => {
  test("nothing done yet: no strip, so a project that never applied a saving sees no zeros", async () => {
    expect(hasCloudSavingsActivity(null)).toBe(false);
    expect(hasCloudSavingsActivity(NOTHING_DONE)).toBe(false);

    await act(async () => {
      render(<CloudSavingsActionsStrip summary={NOTHING_DONE} />);
    });

    expect(screen.queryByTestId("cloud-savings-actions-strip")).toBeNull();
  });

  test.each([
    ["realisedCount"],
    ["measuringCount"],
    ["changesCount"],
    ["waitingCount"],
    ["scheduledHoursThisMonth"],
  ])("anything done - %s - draws it", (field: string) => {
    expect(
      hasCloudSavingsActivity({ ...NOTHING_DONE, [field]: 1 }),
    ).toBe(true);
  });

  test("what the bill shows first, then what is being checked, what waits and the hours schedules stopped", async () => {
    await act(async () => {
      render(
        <CloudSavingsActionsStrip
          summary={{
            ...NOTHING_DONE,
            savedThisMonth: 123.45,
            realisedCount: 2,
            measuringCount: 1,
            promisedMonthly: 40,
            waitingCount: 3,
            waitingForYouCount: 2,
            scheduledHoursThisMonth: 13,
          }}
        />,
      );
    });

    const strip: HTMLElement = screen.getByTestId("cloud-savings-actions-strip");

    expect(strip).toHaveTextContent("Saved this month");
    expect(strip).toHaveTextContent("$123.45");
    expect(strip).toHaveTextContent("2 changes seen in the bill");
    expect(strip).toHaveTextContent("$40.00 a month promised");
    expect(strip).toHaveTextContent("2 for you");
    expect(strip).toHaveTextContent("13 hours stopped");
    expect(strip.textContent!.indexOf("Saved this month")).toBeLessThan(
      strip.textContent!.indexOf("Checking the bill"),
    );
  });
});

describe("what an off-hours schedule picks", () => {
  const SCHEDULE_ID: ObjectID = new ObjectID(
    "60000000-0000-4000-8000-0000000000f1",
  );

  async function openPreview(
    preview: CloudOffHoursPreview | Error,
  ): Promise<void> {
    const read: jest.SpyInstance = getJestSpyOn(
      CloudSavingsApi,
      "getSchedulePreview",
    );

    if (preview instanceof Error) {
      read.mockRejectedValue(preview);
    } else {
      read.mockResolvedValue(preview);
    }

    await act(async () => {
      render(
        <CloudOffHoursPreviewModal
          scheduleId={SCHEDULE_ID}
          onClose={(): void => {
            return undefined;
          }}
        />,
      );
    });
  }

  test("each resource, stopped off hours or left running with why", async () => {
    await openPreview({
      resources: [
        {
          cloudResourceId: "r-1",
          name: "orders-dev",
          resourceType: "EC2 instance",
          provider: CloudProvider.AWS,
          environment: CloudResourceEnvironment.NonProduction,
        },
        {
          cloudResourceId: "r-2",
          name: "orders-prod",
          resourceType: "EC2 instance",
          provider: CloudProvider.AWS,
          environment: CloudResourceEnvironment.Production,
          skipReason: CloudOffHoursSkipReason.Production,
        },
        {
          cloudResourceId: "r-3",
          name: "batch-7",
          resourceType: "EC2 instance",
          provider: CloudProvider.AWS,
          environment: CloudResourceEnvironment.Unknown,
          skipReason: CloudOffHoursSkipReason.EnvironmentNotKnown,
        },
      ],
      isCapped: false,
    } as unknown as CloudOffHoursPreview);

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "cloud-off-hours-preview-row",
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("orders-dev");
    expect(rows[0]).toHaveTextContent("Stopped off hours");
    expect(rows[1]).toHaveTextContent("Left running: it is production.");
    expect(rows[2]).toHaveTextContent(
      "Left running: nothing says it is not production.",
    );
    expect(
      screen.queryByText("Only the first 500 resources are listed."),
    ).toBeNull();
  });

  test("nothing carries its tag yet: says how to add one", async () => {
    await openPreview({
      resources: [],
      isCapped: false,
    } as unknown as CloudOffHoursPreview);

    expect(
      await screen.findByText("No resource carries this schedule's tag yet."),
    ).toBeInTheDocument();
  });

  test("a read that failed says why, in the dialog, and lists nothing", async () => {
    await openPreview(new Error("The schedule was deleted."));

    expect(
      await screen.findByText("The schedule was deleted."),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("cloud-off-hours-preview-row")).toEqual([]);
  });
});

describe("the words a savings rule and a schedule are read in", () => {
  function savingsRule(
    overrides: Partial<AutoRemediationRule>,
  ): AutoRemediationRule {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    Object.assign(rule, overrides);
    return rule;
  }

  test("a rule's row says the changes, environments and clouds it covers", () => {
    expect(
      getSavingsRuleMatchText(
        savingsRule({
          cloudSavingActionGroups: [CloudSavingsActionGroup.Stop],
          cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
        } as Partial<AutoRemediationRule>),
        ENGLISH,
      ),
    ).toBe("Stop idle instances and databases · Non-production · Every cloud");
    expect(getSavingsRuleMatchText(savingsRule({}), ENGLISH)).toBe(
      "Every change · Any environment · Every cloud",
    );
  });

  test("and the conditions its builder wrote, or the builder's words when lists cannot say them", () => {
    expect(
      getSavingsRuleMatchText(
        savingsRule({
          criteria: {
            schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
            filterCondition: FilterCondition.All,
            filters: [
              {
                field: "cloudSavingProviders",
                operator: RuleCriteriaOperator.HasAnyOf,
                value: [CloudProvider.GCP],
              },
            ],
          },
        } as Partial<AutoRemediationRule>),
        ENGLISH,
      ),
    ).toBe("Every change · Any environment · Google Cloud");
    expect(
      getSavingsRuleMatchText(
        savingsRule({
          criteria: {
            schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
            filterCondition: FilterCondition.Any,
            filters: [
              {
                field: "cloudSavingProviders",
                operator: RuleCriteriaOperator.HasAnyOf,
                value: [CloudProvider.GCP],
              },
            ],
          },
        } as Partial<AutoRemediationRule>),
        ENGLISH,
      ),
    ).toBe("Only savings that match conditions");
  });

  test("a schedule's days: a run of them as its ends, others listed", () => {
    expect(
      getWorkingDaysText(
        [
          DayOfWeek.Monday,
          DayOfWeek.Tuesday,
          DayOfWeek.Wednesday,
          DayOfWeek.Thursday,
          DayOfWeek.Friday,
        ],
        ENGLISH,
      ),
    ).toBe("Mon–Fri");
    expect(
      getWorkingDaysText(
        [DayOfWeek.Friday, DayOfWeek.Monday, DayOfWeek.Wednesday],
        ENGLISH,
      ),
    ).toBe("Mon, Wed, Fri");
  });

  test("a schedule's hours are a 24-hour clock: anything else is said before it is saved", () => {
    expect(getClockProblem("08:00", ENGLISH)).toBeNull();
    expect(getClockProblem("19:30", ENGLISH)).toBeNull();

    for (const typo of ["8am", "25:00", "19:60", "", "7:5"]) {
      expect(getClockProblem(typo, ENGLISH)).toBe(
        "Write the time on a 24-hour clock, such as 08:00 or 19:00.",
      );
    }
  });
});
