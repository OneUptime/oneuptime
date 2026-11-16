/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A rule OneUptime switched off because every record a list of it was
 * limited to was deleted (#9066) says so where people look for it: beside
 * its status in its table - "Limited to deleted records", whose description
 * says what was deleted and what to do - and above what it applies to on
 * its Edit form. Rules saved with a list still holding records, or never
 * limited at all, are drawn exactly as before.
 *
 * The real pages, through the real ModelTable (Incidents > Rules > On-Call
 * Rules) and RuleTable (Monitors > Settings > Label Rules): only the
 * network, the permissions and the translations are stubbed. What the list
 * asks the API for, and what each row draws, is read off the page.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import Route from "../../../Types/API/Route";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import Label from "../../../Models/DatabaseModels/Label";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { RuleEmptiedLimit } from "../../../Types/Rules/RuleEmptiedLimit";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Field, {
  CustomElementProps,
} from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { replaceLegacyRuleCriteriaFields } from "../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import IncidentOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOnCallRules";
import MonitorLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorLabelRules";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const CHECKOUT_DELETED: RuleEmptiedLimit = {
  list: "monitors",
  names: ["Checkout"],
  count: 1,
  deletedAt: "2026-11-16T10:00:00.000Z",
  switchedOff: true,
};

interface ListRequest {
  modelType: { name: string };
  select?: Record<string, unknown>;
}

let listRequests: Array<ListRequest> = [];

// Answers the rule table with these rows; every other list is empty.
function serveRules(modelName: string, rules: Array<BaseModel>): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (request: unknown): Promise<never> => {
      const listRequest: ListRequest = request as ListRequest;
      listRequests.push(listRequest);

      const rows: Array<BaseModel> =
        listRequest.modelType.name === modelName ? rules : [];

      return {
        data: rows,
        count: rows.length,
        skip: 0,
        limit: 50,
      } as unknown as never;
    });

  jest.spyOn(ModelAPI, "count").mockImplementation(async (): Promise<never> => {
    return 0 as unknown as never;
  });
}

async function renderPage(
  Page: FunctionComponent<PageComponentProps>,
  path: string,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <Page
        pageRoute={new Route(`/dashboard/${PROJECT_ID}/${path}`)}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });
}

// The table row a rule is drawn in, found by its name.
async function rowOf(name: string): Promise<HTMLElement> {
  const cells: Array<HTMLElement> = await screen.findAllByText(name);
  const row: HTMLElement | null =
    cells
      .map((cell: HTMLElement): HTMLElement | null => {
        return cell.closest("tr");
      })
      .find((candidate: HTMLElement | null): boolean => {
        return candidate !== null;
      }) || null;

  if (!row) {
    throw new Error(`The rule ${name} is not drawn in a table row.`);
  }

  return row;
}

function ruleListRequest(modelName: string): ListRequest {
  const request: ListRequest | undefined = listRequests.find(
    (candidate: ListRequest): boolean => {
      return candidate.modelType.name === modelName;
    },
  );

  if (!request) {
    throw new Error(`The page never listed ${modelName}.`);
  }

  return request;
}

beforeEach(() => {
  listRequests = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Incidents > Rules > On-Call Rules", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/incidents/settings/on-call-rules`,
    );
  });

  test("says Limited to deleted records beside the status of the rule whose only monitor was deleted, and only there", async () => {
    serveRules("IncidentOnCallRule", [
      Object.assign(new IncidentOnCallRule(), {
        _id: "22222222-2222-4222-8222-000000000001",
        name: "Page Payments for Checkout",
        description: "",
        isEnabled: false,
        emptiedLimits: [CHECKOUT_DELETED],
      }),
      Object.assign(new IncidentOnCallRule(), {
        _id: "22222222-2222-4222-8222-000000000002",
        name: "Page Platform for everything",
        description: "",
        isEnabled: true,
        emptiedLimits: null,
      }),
    ]);

    await renderPage(IncidentOnCallRules, "incidents/settings/on-call-rules");

    const switchedOff: HTMLElement = await rowOf("Page Payments for Checkout");
    const untouched: HTMLElement = await rowOf("Page Platform for everything");

    const pill: HTMLElement = within(switchedOff).getByTestId(
      "rule-emptied-limits",
    );
    expect(pill).toHaveTextContent("Limited to deleted records");
    // Its status is still said: off.
    expect(switchedOff).toHaveTextContent("Disabled");
    expect(
      within(pill).getByRole("button", { name: "Limited to deleted records" }),
    ).toHaveAccessibleDescription(
      "Monitors: Checkout, deleted Nov 16, 2026. OneUptime switched this rule off when they were deleted. Switched on as it is, the rule would not be limited by these lists at all. Edit it to choose what it applies to, then switch it on.",
    );

    expect(within(untouched).queryByTestId("rule-emptied-limits")).toBeNull();
    expect(screen.getAllByTestId("rule-emptied-limits")).toHaveLength(1);
  });

  test("reads each rule's note with the rules", async () => {
    serveRules("IncidentOnCallRule", []);

    await renderPage(IncidentOnCallRules, "incidents/settings/on-call-rules");

    await waitFor(() => {
      expect(ruleListRequest("IncidentOnCallRule")).toBeDefined();
    });

    const select: Record<string, unknown> =
      ruleListRequest("IncidentOnCallRule").select || {};

    expect(select["emptiedLimits"]).toBe(true);
    expect(select["isEnabled"]).toBe(true);
    expect(select["name"]).toBe(true);
  });
});

describe("Monitors > Settings > Label Rules", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/monitors/settings/label-rules`,
    );
  });

  test("says it beside a label rule whose only label was deleted, beside Adds nothing's place", async () => {
    serveRules("MonitorLabelRule", [
      Object.assign(new MonitorLabelRule(), {
        _id: "33333333-3333-4333-8333-000000000001",
        name: "Tag the old production monitors",
        description: "",
        isEnabled: false,
        labelsToAdd: [
          Object.assign(new Label(), {
            _id: "0000000a-0000-4000-8000-000000000001",
          }),
        ],
        emptiedLimits: [
          {
            ...CHECKOUT_DELETED,
            list: "monitorLabels",
            names: ["Old production"],
          },
        ],
      }),
    ]);

    await renderPage(MonitorLabelRules, "monitors/settings/label-rules");

    const row: HTMLElement = await rowOf("Tag the old production monitors");

    expect(
      within(within(row).getByTestId("rule-emptied-limits")).getByRole(
        "button",
        { name: "Limited to deleted records" },
      ),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        "Monitor Labels: Old production, deleted Nov 16, 2026.",
      ) as unknown as string,
    );
    // It adds a label, so only the note is said.
    expect(within(row).queryByTestId("rule-adds-nothing")).toBeNull();
  });
});

describe("a rule's Edit form", () => {
  type Rule = Record<string, unknown>;

  const MONITORS_FIELD: Field<Rule> = {
    field: { monitors: true },
    title: "Monitors",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    required: false,
  };

  const criteriaElement: (values: Rule) => ReactElement = (
    values: Rule,
  ): ReactElement => {
    const fields: Array<Field<Rule>> = replaceLegacyRuleCriteriaFields(
      new IncidentOnCallRule(),
      [MONITORS_FIELD] as unknown as Array<Field<IncidentOnCallRule>>,
    ) as unknown as Array<Field<Rule>>;

    const criteria: Field<Rule> | undefined = fields.find(
      (field: Field<Rule>): boolean => {
        return Object.keys(field.field || {})[0] === "criteria";
      },
    );

    return criteria!.getCustomElement!(
      values as FormValues<Rule>,
      {
        onChange: () => {},
      } as unknown as CustomElementProps,
    );
  };

  test("says above what the rule applies to that its monitors were deleted, and what to do", () => {
    render(
      <div>
        {criteriaElement({
          monitors: [],
          emptiedLimits: [CHECKOUT_DELETED],
        })}
      </div>,
    );

    const alert: HTMLElement = screen.getByTestId("rule-emptied-limits-alert");
    expect(alert).toHaveTextContent("Limited to deleted records");
    expect(alert).toHaveTextContent(
      "Monitors: Checkout, deleted Nov 16, 2026.",
    );
    expect(alert).toHaveTextContent(
      "Edit it to choose what it applies to, then switch it on.",
    );
    // And the conditions are there to choose, under it.
    expect(screen.getByTestId("rule-criteria-builder")).toBeInTheDocument();
  });

  test("says nothing more for a rule with no note", () => {
    render(<div>{criteriaElement({ monitors: [] })}</div>);

    expect(screen.queryByTestId("rule-emptied-limits-alert")).toBeNull();
  });
});
