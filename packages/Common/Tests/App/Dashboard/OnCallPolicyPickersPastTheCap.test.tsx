import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import React, { ReactElement, useState } from "react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import OnCallSetupApi, {
  POLICY_CHOICES_READ_AT_ONCE,
  PolicyChoice,
  PolicyChoiceFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi";
import PolicyChoicePicker, {
  getPolicyChoiceOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PolicyChoicePicker";
import SetupHealthQuickFixApi, {
  SETUP_HEALTH_POLICIES_READ_AT_ONCE,
  SetupHealthPolicyChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthQuickFix";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import PermissionGate from "../../../UI/Utils/PermissionGate";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DefaultInviteTeam",
  () => {
    return {
      __esModule: true,
      findDefaultInviteTeam: async (): Promise<null> => {
        return null;
      },
      canSignedInUserInviteToEveryTeam: (): boolean => {
        return true;
      },
    };
  },
);

/*
 * AN ON-CALL POLICY TO PICK, PAST THE PROJECT'S FIRST 10,000 (#10764).
 *
 * The On-Call guided setup's "Who else is on call?" (the policy to add
 * people to) and Setup Health's quick fix (the policy a new on-call rule
 * pages) offered the project's first 10,000 policies in service by name,
 * read once, so a policy past them could not be picked. Each offers the
 * first 50 and searches the server for what is typed (PolicyChoicePicker),
 * archived policies never offered, the one picked kept named. On a fake
 * project of 10,050 policies in service, two past them and an archived one
 * (CappedListServer), as the list route answers.
 */

const LATE_POLICY_ID: string = "70000000-0000-4000-8000-000000000001";
const ARCHIVED_POLICY_ID: string = "70000000-0000-4000-8000-000000000002";
const OTHER_LATE_POLICY_ID: string = "70000000-0000-4000-8000-000000000003";

const POLICIES_BEFORE_IT: number = LIMIT_PER_PROJECT + 50;

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");

let server: CappedListServer;

beforeAll(() => {
  server = new CappedListServer();
  server.add(
    OnCallDutyPolicy,
    namesSortingFirst(POLICIES_BEFORE_IT, "AP").map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          isArchived: false,
        };
      },
    ),
  );
  server.add(OnCallDutyPolicy, [
    {
      _id: LATE_POLICY_ID,
      name: "Warehouse rota",
      description: "Pickers and packers",
      createdAt: MARCH,
      isArchived: false,
    },
    {
      _id: OTHER_LATE_POLICY_ID,
      name: "Yard rota",
      isArchived: false,
    },
    {
      _id: ARCHIVED_POLICY_ID,
      name: "Warehouse rota (old)",
      isArchived: true,
    },
  ]);
});

beforeEach(() => {
  server.calls.length = 0;
  server.install();
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function policyReads(): Array<CappedListCall> {
  return server.callsFor(OnCallDutyPolicy);
}

function searchedFor(): Array<string> {
  return policyReads()
    .filter((call: CappedListCall): boolean => {
      return call.query["name"] instanceof Search;
    })
    .map((call: CappedListCall): string => {
      return (call.query["name"] as Search<string>).toString();
    });
}

describe("OnCallSetupApi: the policies the step offers", () => {
  test("REGRESSION: as it opens, the first 50 in service by name - never the project's first 10,000 - and what the person may do", async () => {
    const facts: PolicyChoiceFacts = await OnCallSetupApi.loadPolicyChoices();

    expect(facts.policies).toHaveLength(POLICY_CHOICES_READ_AT_ONCE);
    expect(facts.policies[0]!.name).toBe("AP000001");
    expect(facts.mayCreatePolicy).toBe(true);

    const [read] = policyReads();

    expect(read!.limit).toBe(POLICY_CHOICES_READ_AT_ONCE);
    expect(read!.sort).toEqual({ name: SortOrder.Ascending });
    // An archived policy pages no one: never offered (#8234).
    expect(read!.query).toEqual({ isArchived: false });
  });

  test("REGRESSION: a policy past the first 10,000 is found on the server by what is typed - an archived one never", async () => {
    const found: Array<PolicyChoice> =
      await OnCallSetupApi.searchPolicyChoices(" warehouse ");

    expect(
      found.map((entry: PolicyChoice): string => {
        return entry.id;
      }),
    ).toEqual([LATE_POLICY_ID]);
    expect(searchedFor()).toEqual(["warehouse"]);

    // Another past them, by another search.
    expect(
      (await OnCallSetupApi.searchPolicyChoices("yard")).map(
        (entry: PolicyChoice): string => {
          return entry.id;
        },
      ),
    ).toEqual([OTHER_LATE_POLICY_ID]);

    const [read] = policyReads();

    expect(read!.limit).toBe(POLICY_CHOICES_READ_AT_ONCE);
    expect(read!.query["isArchived"]).toBe(false);
  });

  test("each policy found comes with what tells it from another of its name (#10314)", async () => {
    const found: Array<PolicyChoice> =
      await OnCallSetupApi.searchPolicyChoices("warehouse");

    expect(found).toEqual([
      {
        id: LATE_POLICY_ID,
        name: "Warehouse rota",
        sharedName: {
          kind: SharedNameKind.OnCallPolicy,
          description: "Pickers and packers",
          createdAt: MARCH,
        },
      },
    ]);
    expect(policyReads()[0]!.select).toEqual({
      _id: true,
      name: true,
      description: true,
      createdAt: true,
    });
  });

  test("nothing is asked of the server for an empty box", async () => {
    expect(await OnCallSetupApi.searchPolicyChoices("   ")).toEqual([]);
    expect(policyReads()).toEqual([]);
  });
});

describe("SetupHealthQuickFixApi: the policies a new on-call rule may page", () => {
  test("REGRESSION: as the dialog opens, the first 50 in service by name - never the project's first 10,000", async () => {
    const policies: Array<SetupHealthPolicyChoice> =
      await SetupHealthQuickFixApi.getPolicies();

    expect(policies).toHaveLength(SETUP_HEALTH_POLICIES_READ_AT_ONCE);
    expect(policies[0]!.name).toBe("AP000001");

    const [read] = policyReads();

    expect(read!.limit).toBe(SETUP_HEALTH_POLICIES_READ_AT_ONCE);
    expect(read!.sort).toEqual({ name: SortOrder.Ascending });
    expect(read!.query).toEqual({ isArchived: false });
  });

  test("REGRESSION: a policy past them is found on the server by what is typed, with what tells it apart - an archived one never", async () => {
    expect(await SetupHealthQuickFixApi.searchPolicies("warehouse")).toEqual([
      {
        id: LATE_POLICY_ID,
        name: "Warehouse rota",
        sharedName: {
          kind: SharedNameKind.OnCallPolicy,
          description: "Pickers and packers",
          createdAt: MARCH,
        },
      },
    ]);
    expect(searchedFor()).toEqual(["warehouse"]);
    expect(policyReads()[0]!.query["isArchived"]).toBe(false);
    expect(policyReads()[0]!.limit).toBe(SETUP_HEALTH_POLICIES_READ_AT_ONCE);
  });

  test("nothing is asked of the server for an empty box", async () => {
    expect(await SetupHealthQuickFixApi.searchPolicies("  ")).toEqual([]);
    expect(policyReads()).toEqual([]);
  });
});

describe("getPolicyChoiceOptions", () => {
  const choice: (id: string, name: string) => PolicyChoice = (
    id: string,
    name: string,
  ): PolicyChoice => {
    return { id, name, sharedName: { kind: SharedNameKind.OnCallPolicy } };
  };

  test("the first policies, then what the search found, then the one picked - each once, with its facts", () => {
    const options: Array<DropdownOption> = getPolicyChoiceOptions({
      policies: [choice("a", "AP000001"), choice("b", "AP000002")],
      found: [choice("b", "AP000002"), choice(LATE_POLICY_ID, "Warehouse")],
      picked: choice(LATE_POLICY_ID, "Warehouse"),
    });

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(["a", "b", LATE_POLICY_ID]);
    expect(options[2]).toEqual({
      value: LATE_POLICY_ID,
      label: "Warehouse",
      isUserContent: true,
      sharedName: { kind: SharedNameKind.OnCallPolicy },
    });
  });
});

describe("the step's policy picker", () => {
  let firstPolicies: Array<PolicyChoice>;
  let changes: Array<string>;

  beforeEach(async () => {
    changes = [];
    firstPolicies = (await OnCallSetupApi.loadPolicyChoices()).policies;
    server.calls.length = 0;
  });

  // The step keeps the policy chosen, as OnCallGuidedSetup does.
  function StepHarness(props: { policies: Array<PolicyChoice> }): ReactElement {
    const [chosen, setChosen] = useState<string>(props.policies[0]!.id);

    return (
      <div>
        <p id="policy-label">Policy</p>
        <PolicyChoicePicker<PolicyChoice>
          policies={props.policies}
          value={chosen}
          search={(text: string): Promise<Array<PolicyChoice>> => {
            return OnCallSetupApi.searchPolicyChoices(text);
          }}
          ariaLabelledby="policy-label"
          dataTestId="on-call-setup-policy-choice"
          onChange={(next: PolicyChoice) => {
            changes.push(next.id);
            setChosen(next.id);
          }}
        />
      </div>
    );
  }

  async function typeInPicker(text: string): Promise<void> {
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: text },
      });
    });
  }

  test("opens on the first policy, and searches the server for what is typed - finding one past the first 10,000", async () => {
    render(<StepHarness policies={firstPolicies} />);

    expect(screen.getByText("AP000001")).toBeInTheDocument();
    // Nothing more is read as it opens.
    expect(policyReads()).toEqual([]);

    await typeInPicker("warehouse");

    expect(await screen.findByText("Warehouse rota")).toBeInTheDocument();
    expect(screen.queryByText("Warehouse rota (old)")).toBeNull();
    // Asked once typing rested, for what was typed.
    expect(searchedFor()).toEqual(["warehouse"]);
  });

  test("REGRESSION: a policy past them is picked, and stays named while other searches come and go", async () => {
    render(<StepHarness policies={firstPolicies} />);

    await typeInPicker("warehouse");

    const option: HTMLElement = await screen.findByText("Warehouse rota");

    await act(async () => {
      fireEvent.click(option);
    });

    expect(changes).toEqual([LATE_POLICY_ID]);

    // Another search that does not find it: the pick keeps its name.
    await typeInPicker("AP000002");
    await waitFor(() => {
      expect(searchedFor()).toEqual(["warehouse", "AP000002"]);
    });
    await act(async () => {
      fireEvent.blur(screen.getByRole("combobox"));
    });

    expect(screen.getByText("Warehouse rota")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(LATE_POLICY_ID);
  });

  test("the newest search wins: an earlier answer arriving late is not offered", async () => {
    let releaseFirst: (() => void) | null = null;

    const search: typeof OnCallSetupApi.searchPolicyChoices =
      OnCallSetupApi.searchPolicyChoices.bind(OnCallSetupApi);

    jest
      .spyOn(OnCallSetupApi, "searchPolicyChoices")
      .mockImplementation(async (text: string) => {
        if (text === "warehouse") {
          await new Promise<void>((resolve: () => void) => {
            releaseFirst = resolve;
          });
        }

        return await search(text);
      });

    render(<StepHarness policies={firstPolicies} />);

    await typeInPicker("warehouse");
    await waitFor(() => {
      expect(releaseFirst).not.toBeNull();
    });

    await typeInPicker("AP000003");
    expect(await screen.findByText("AP000003")).toBeInTheDocument();

    await act(async () => {
      releaseFirst!();
    });

    expect(screen.queryByText("Warehouse rota")).toBeNull();
  });

  test("the step reading its policies again drops what an earlier search found", async () => {
    const { rerender } = render(<StepHarness policies={firstPolicies} />);

    await typeInPicker("warehouse");
    expect(await screen.findByText("Warehouse rota")).toBeInTheDocument();

    // A policy picked was deleted since: the step reads them again.
    rerender(<StepHarness policies={[...firstPolicies]} />);

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "Warehouse" },
      });
    });

    // Typed, but not answered yet: nothing found before is offered.
    expect(screen.queryByText("Warehouse rota")).toBeNull();
  });

  test("a search that fails leaves the first policies offered, and nothing is picked", async () => {
    jest.spyOn(server, "list").mockImplementation((): never => {
      throw new Error("Payment required");
    });

    render(<StepHarness policies={firstPolicies} />);

    await typeInPicker("AP0000");

    await waitFor(() => {
      expect(screen.getByText("AP000002")).toBeInTheDocument();
    });
    expect(changes).toEqual([]);
  });
});
