import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * The table itself is not under test, only the form fields it hands to
 * ModelTable: capture them instead of rendering a real table.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

import AutoRemediationRulesTable, {
  buildCommandRunnerOptions,
  fetchCommandRunnerOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRulesTable";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * Known follow-up 6: the auto-remediation rule's "Command Runners" picker
 * listed every Runner row, kubernetes-agent Runners included. Those are
 * the in-cluster Runners the agent chart registers: they run kubectl for
 * their own cluster only and never run a Bash or SSH command, so a rule
 * narrowed to one could never run anything. The picker no longer offers
 * them — and no longer is an entity dropdown, which would list (and
 * search) every Runner row regardless.
 */

function makeRunner(id: string, name: string): Runner {
  return Object.assign(new Runner(), { _id: id, name });
}

const RUNNERS: Array<Runner> = [
  makeRunner("r-bash", "bash-runner"),
  makeRunner("r-agent", "kubernetes-agent/prod-east"),
  makeRunner("r-ssh", "ssh-bastion"),
  makeRunner("r-agent-2", "kubernetes-agent/staging"),
];

interface CapturedField {
  field?: Record<string, unknown>;
  dropdownModal?: unknown;
  fetchDropdownOptions?: (values: unknown) => Promise<Array<DropdownOption>>;
  description?: string;
}

function commandRunnersField(): CapturedField {
  const props: Record<string, unknown> | undefined =
    mockCapturedTableProps[mockCapturedTableProps.length - 1];
  const fields: Array<CapturedField> = (props?.["formFields"] ||
    []) as Array<CapturedField>;
  const field: CapturedField | undefined = fields.find(
    (candidate: CapturedField): boolean => {
      return Boolean(candidate.field?.["commandRunners"]);
    },
  );
  if (!field) {
    throw new Error("The rules table has no Command Runners field.");
  }
  return field;
}

let getListSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation(async (): Promise<ListResult<Runner>> => {
    return { data: RUNNERS, count: RUNNERS.length, skip: 0, limit: 10 };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Command Runners picker", () => {
  test("offers every Runner but the kubernetes-agent ones", () => {
    expect(buildCommandRunnerOptions(RUNNERS)).toEqual([
      { value: "r-bash", label: "bash-runner" },
      { value: "r-ssh", label: "ssh-bastion" },
    ]);
  });

  test("lists the project's Runners by name and drops the agent ones", async () => {
    const options: Array<DropdownOption> = await fetchCommandRunnerOptions();

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(["r-bash", "r-ssh"]);
    const request: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["modelType"]).toBe(Runner);
    expect(request["select"]).toEqual({ _id: true, name: true });
  });

  for (const trigger of [
    AutoRemediationTriggerEntity.Incident,
    AutoRemediationTriggerEntity.Alert,
  ]) {
    test(`the ${trigger} rule form uses the filtered list, not an entity dropdown`, async () => {
      render(
        <AutoRemediationRulesTable
          triggerEntityType={trigger}
          entityLabel={
            trigger === AutoRemediationTriggerEntity.Incident
              ? "incident"
              : "alert"
          }
        />,
      );

      const field: CapturedField = commandRunnersField();
      expect(field.dropdownModal).toBeUndefined();
      expect(field.description).toMatch(
        /kubernetes agent chart are not listed/i,
      );

      const options: Array<DropdownOption> = await field.fetchDropdownOptions!(
        {},
      );
      expect(
        options.map((option: DropdownOption): string => {
          return option.label;
        }),
      ).toEqual(["bash-runner", "ssh-bastion"]);
    });
  }
});
