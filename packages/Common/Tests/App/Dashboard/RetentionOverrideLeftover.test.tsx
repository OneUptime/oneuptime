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
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The retention override a Scale trial left behind, under the retention
 * upsell (Dashboard Components/TelemetryResource/RetentionOverrideLeftover).
 *
 * Retention overrides keep applying whatever the plan, and usage billing
 * follows them. A paid feature can always be switched off, on any plan: the
 * server lets the override columns go back to nothing whatever the plan, so
 * a project below Scale is offered exactly that, here - and nothing else.
 *
 * The real card, button and dialog are rendered; only the network, the
 * permission gate and the plan are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import RetentionOverrideLeftover from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/RetentionOverrideLeftover";
import RetentionOverrideLeftoverCopy, {
  RETENTION_OVERRIDE_COLUMNS,
  RETENTION_OVERRIDE_LEFTOVER_COPY,
  RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID,
  RETENTION_OVERRIDE_LEFTOVER_TEST_ID,
  RetentionOverrideLeftoverKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/RetentionOverrideLeftoverCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const RECORD_ID: string = "7c7c7c7c-0000-4000-8000-0000000000aa";

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

// What the record holds in its override columns.
let stored: Record<string, unknown> | Error = {};
let gate: PermissionGateResult = { isAllowed: true };
let refusal: Error | null = null;

beforeEach(() => {
  stored = {};
  gate = { isAllowed: true };
  refusal = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(
    async (request: {
      modelType: { new (): BaseModel };
    }): Promise<BaseModel> => {
      if (stored instanceof Error) {
        throw stored;
      }

      const model: BaseModel = new request.modelType();
      model._id = RECORD_ID;
      Object.assign(model, stored);
      return model;
    },
  );

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    if (refusal) {
      throw refusal;
    }

    return {};
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return PlanType.Growth;
    },
  );

  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderLeftover(
  kind: RetentionOverrideLeftoverKind = RetentionOverrideLeftoverKind.Resource,
): Promise<void> {
  await act(async () => {
    if (kind === RetentionOverrideLeftoverKind.Project) {
      render(
        <RetentionOverrideLeftover<Project>
          modelType={Project}
          modelId={new ObjectID(RECORD_ID)}
          kind={kind}
        />,
      );
      return;
    }

    render(
      <RetentionOverrideLeftover<Service>
        modelType={Service}
        modelId={new ObjectID(RECORD_ID)}
        kind={kind}
      />,
    );
  });

  await flush();
}

function removeButton(): HTMLElement {
  return screen.getByRole("button", {
    name: RetentionOverrideLeftoverCopy.removeButton,
  });
}

async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

describe("what it reads", () => {
  test("a resource's two override columns, of this record, and nothing else", async () => {
    await renderLeftover();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Service,
        select: {
          retainTelemetryDataForDays: true,
          telemetryRetentionConfig: true,
        },
      }),
    );
    expect(
      (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(RECORD_ID);
  });

  test("the project's retention by type, and nothing else", async () => {
    await renderLeftover(RetentionOverrideLeftoverKind.Project);

    expect(getItemMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Project,
        select: { telemetryRetentionConfig: true },
      }),
    );
  });

  test("the columns of each kind are the plan-gated override columns", () => {
    expect(RETENTION_OVERRIDE_COLUMNS).toEqual({
      [RetentionOverrideLeftoverKind.Resource]: [
        "retainTelemetryDataForDays",
        "telemetryRetentionConfig",
      ],
      [RetentionOverrideLeftoverKind.Project]: ["telemetryRetentionConfig"],
    });

    for (const column of RETENTION_OVERRIDE_COLUMNS[
      RetentionOverrideLeftoverKind.Resource
    ]) {
      expect(new Service().getColumnBillingAccessControl(column)).toEqual(
        expect.objectContaining({ update: PlanType.Scale }),
      );
    }

    expect(
      new Project().getColumnBillingAccessControl("telemetryRetentionConfig"),
    ).toEqual(expect.objectContaining({ update: PlanType.Scale }));
  });
});

describe("nothing to remove draws nothing", () => {
  test.each([
    ["nothing stored", {}],
    [
      "nulls",
      { retainTelemetryDataForDays: null, telemetryRetentionConfig: null },
    ],
  ])("%s", async (_label: string, values: Record<string, unknown>) => {
    stored = values;

    await renderLeftover();

    expect(
      screen.queryByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a read that fails draws nothing: the upsell is the page", async () => {
    stored = new Error("network down");

    await renderLeftover();

    expect(
      screen.queryByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("an override left on a resource", () => {
  test.each([
    ["its own retention", { retainTelemetryDataForDays: 90 }],
    [
      "its retention by type",
      { telemetryRetentionConfig: { logs: { default: 30 } } },
    ],
  ])(
    "%s: says what is set, that the plan does not include it, and what setting one again takes",
    async (_label: string, values: Record<string, unknown>) => {
      stored = values;

      await renderLeftover();

      expect(
        screen.getByTestId(RETENTION_OVERRIDE_LEFTOVER_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: RETENTION_OVERRIDE_LEFTOVER_COPY[
            RetentionOverrideLeftoverKind.Resource
          ].title,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Telemetry from here is kept for its own retention, not the project's. Your plan does not include retention overrides: you can remove this one, but setting one again needs the Scale plan.",
        ),
      ).toBeInTheDocument();
      expect(removeButton()).toBeEnabled();
    },
  );

  test("Remove Override asks first, saying only new telemetry changes", async () => {
    stored = { retainTelemetryDataForDays: 90 };

    await renderLeftover();
    await press(removeButton());

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      RetentionOverrideLeftoverCopy.confirmTitle,
    );
    expect(dialog).toHaveTextContent(
      "From now on, telemetry from here is kept for the project's retention. What is already stored keeps the retention it was stored with.",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("cancelling writes nothing, and the card still offers the removal", async () => {
    stored = { retainTelemetryDataForDays: 90 };

    await renderLeftover();
    await press(removeButton());
    await press(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(removeButton()).toBeInTheDocument();
  });

  test("confirmed, both columns go back to nothing - the default every plan may write - and the card says so", async () => {
    stored = {
      retainTelemetryDataForDays: 90,
      telemetryRetentionConfig: { logs: { default: 30 } },
    };

    await renderLeftover();
    await press(removeButton());
    await press(screen.getByTestId("modal-footer-submit-button"));

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Service,
        data: {
          retainTelemetryDataForDays: null,
          telemetryRetentionConfig: null,
        },
      }),
    );
    expect(
      (updateByIdMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(RECORD_ID);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(
      screen.getByTestId(RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID),
    ).toHaveTextContent(
      "Removed. Telemetry from here is kept for the project's retention from now on.",
    );
    expect(
      screen.getByTestId(RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID),
    ).toHaveAttribute("role", "status");
    // Nothing left to remove.
    expect(
      screen.queryByRole("button", {
        name: RetentionOverrideLeftoverCopy.removeButton,
      }),
    ).not.toBeInTheDocument();
  });

  test("a refused removal keeps the dialog open with the server's reason, and the override stays offered", async () => {
    stored = { retainTelemetryDataForDays: 90 };
    refusal = new Error("You do not have permission to do this.");

    await renderLeftover();
    await press(removeButton());
    await press(screen.getByTestId("modal-footer-submit-button"));

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "You do not have permission to do this.",
    );
    expect(
      screen.queryByTestId(RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("someone who may not change it sees the button locked, with why, and cannot open the dialog", async () => {
    stored = { retainTelemetryDataForDays: 90 };
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Service permission.",
    };

    await renderLeftover();

    expect(removeButton()).toBeDisabled();

    await press(removeButton());

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("retention by type a trial left on the project", () => {
  test("is offered for removal, which writes it back to nothing", async () => {
    stored = { telemetryRetentionConfig: { traces: { default: 60 } } };

    await renderLeftover(RetentionOverrideLeftoverKind.Project);

    expect(
      screen.getByRole("heading", { name: "Retention by Telemetry Type" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Some types of telemetry are kept for their own retention, not the project's default. Your plan does not include retention by telemetry type: you can remove it, but setting it again needs the Scale plan.",
      ),
    ).toBeInTheDocument();

    await press(removeButton());

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "From now on, each type of telemetry is kept for the project's default retention, unless a service or resource has its own. What is already stored keeps the retention it was stored with.",
    );

    await press(screen.getByTestId("modal-footer-submit-button"));

    expect(updateByIdMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Project,
        data: { telemetryRetentionConfig: null },
      }),
    );
    expect(
      screen.getByTestId(RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID),
    ).toHaveTextContent(
      "Removed. Telemetry is kept for the project's default retention from now on.",
    );
  });
});
