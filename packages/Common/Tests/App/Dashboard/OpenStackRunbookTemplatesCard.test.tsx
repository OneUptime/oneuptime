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

/*
 * The six runbooks on an OpenStack cloud's AI agent page: one line each until someone opens
 * one, and adding one writes an ordinary runbook of manual steps for the team to own. Only
 * the network and the current project are stubbed.
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

const PROJECT_ID: string = "6d6d6d6d-0000-4000-8000-000000000001";
const RUNBOOK_ID: string = "6d6d6d6d-0000-4000-8000-000000000002";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return PROJECT_ID;
      },
    },
  };
});

import OpenStackRunbookTemplatesCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRunbookTemplatesCard";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_RUNBOOK_TEMPLATES,
  OpenStackRunbookTemplate,
} from "../../../Types/OpenStack/OpenStackRunbookTemplates";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";

const COMPUTE_DOWN: OpenStackRunbookTemplate = OPENSTACK_RUNBOOK_TEMPLATES[0]!;

function renderCard(): void {
  render(<OpenStackRunbookTemplatesCard />);
}

async function clickAdd(template: OpenStackRunbookTemplate): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`openstack-runbook-add-${template.id}`));
  });
}

describe("the runbooks for the common failures", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("lists all six, folded, so a page read in a failure isn't six pages long", () => {
    renderCard();

    expect(OPENSTACK_RUNBOOK_TEMPLATES).toHaveLength(6);

    for (const template of OPENSTACK_RUNBOOK_TEMPLATES) {
      const row: HTMLElement = screen.getByTestId(
        `openstack-runbook-${template.id}`,
      );

      expect(row.tagName).toBe("DETAILS");
      expect(row).not.toHaveAttribute("open");
      expect(within(row).getByText(template.name)).toBeInTheDocument();
    }
  });

  test("says what to check, what each read is, and every fix with its tier", () => {
    renderCard();

    const row: HTMLElement = screen.getByTestId(
      `openstack-runbook-${COMPUTE_DOWN.id}`,
    );

    for (const check of COMPUTE_DOWN.checks) {
      expect(within(row).getByText(check.title)).toBeInTheDocument();
      if (check.command) {
        expect(within(row).getByText(check.command)).toBeInTheDocument();
      }
    }

    expect(
      within(row).getByText(
        "openstack compute service set --enable HOST nova-compute",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("Safe")).toBeInTheDocument();
    expect(within(row).getByText("Riskier")).toBeInTheDocument();
    expect(within(row).getByText("Always asks a person")).toBeInTheDocument();
  });

  test("the two below OpenStack say a person does it, with no command to run", () => {
    renderCard();

    for (const id of [
      "openstack-rabbitmq-partition",
      "openstack-galera-lost-quorum",
    ]) {
      const row: HTMLElement = screen.getByTestId(`openstack-runbook-${id}`);

      expect(within(row).getByText("By hand")).toBeInTheDocument();
      expect(within(row).queryByText("Safe")).toBeNull();
      expect(within(row).queryByText("Riskier")).toBeNull();
      expect(within(row).queryByText("Always asks a person")).toBeNull();
    }
  });

  test("adding one writes an enabled runbook of manual steps, and nothing else", async () => {
    createMock.mockImplementation(async (): Promise<unknown> => {
      const saved: Runbook = new Runbook();
      saved.id = new ObjectID(RUNBOOK_ID);

      return { data: saved };
    });

    renderCard();
    await clickAdd(COMPUTE_DOWN);

    expect(createMock).toHaveBeenCalledTimes(1);

    const sent: { model: Runbook; modelType: unknown } = createMock.mock
      .calls[0]![0] as { model: Runbook; modelType: unknown };

    expect(sent.modelType).toBe(Runbook);
    expect(sent.model.name).toBe(COMPUTE_DOWN.name);
    expect(sent.model.description).toBe(COMPUTE_DOWN.whenItIsFor);
    expect(sent.model.isEnabled).toBe(true);
    expect(sent.model.projectId?.toString()).toBe(PROJECT_ID);

    const steps: Array<RunbookStep> = sent.model
      .steps as unknown as Array<RunbookStep>;

    expect(steps).toHaveLength(
      COMPUTE_DOWN.checks.length + COMPUTE_DOWN.fixes.length,
    );
    for (const step of steps) {
      expect(step.type).toBe(RunbookStepType.Manual);
    }

    // It said it worked, by way of the runbook itself, and can't be added twice by a double click.
    const row: HTMLElement = screen.getByTestId(
      `openstack-runbook-${COMPUTE_DOWN.id}`,
    );

    expect(
      within(row).getByText("Added. Open the runbook"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`openstack-runbook-add-${COMPUTE_DOWN.id}`),
    ).toBeNull();
    // Another runbook is still there to add.
    expect(
      screen.getByTestId(
        `openstack-runbook-add-${OPENSTACK_RUNBOOK_TEMPLATES[1]!.id}`,
      ),
    ).toBeInTheDocument();
  });

  test("a refusal is shown, and it can be tried again", async () => {
    createMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to create a runbook.");
    });

    renderCard();
    await clickAdd(COMPUTE_DOWN);

    expect(screen.getByTestId("openstack-runbook-error")).toHaveTextContent(
      "You do not have permission to create a runbook.",
    );
    expect(
      screen.getByTestId(`openstack-runbook-add-${COMPUTE_DOWN.id}`),
    ).toBeInTheDocument();
  });
});
