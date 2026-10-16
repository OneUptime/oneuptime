import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  render,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Location, MemoryRouter } from "react-router-dom";

/*
 * Admin > Projects creates a project with the same one-page form as the
 * Dashboard's Create New Project dialog (CreateProjectFormFields): the name,
 * and on a deployment with billing the plan picker and a promo code folded
 * under More fields. It used to have a copy of the old two-step form - Basic,
 * then Select Plan - with its own "Yearly Plan (Save 20%)" switch.
 */

let billingEnabled: boolean = true;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

jest.mock("../../../UI/Config", () => {
  const config: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };
  Object.defineProperty(config, "BILLING_ENABLED", {
    get: () => {
      return billingEnabled;
    },
  });
  config["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };
  return config;
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
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

type CapturedTableProps = {
  formFields?: Array<Field<Project>> | undefined;
  formSteps?: Array<unknown> | undefined;
  isCreateable?: boolean | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import Projects from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/Index";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { getCreateProjectFormFields } from "../../../UI/Components/Project/CreateProjectFormFields";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import Navigation from "../../../UI/Utils/Navigation";
import Project from "../../../Models/DatabaseModels/Project";

interface FieldShape {
  key: string;
  title: string | undefined;
  fieldType: FormFieldSchemaType | undefined;
  required: unknown;
  stepId: string | undefined;
  defaultValue: unknown;
  folded: string | undefined;
}

function shapeOf(field: Field<Project>): FieldShape {
  return {
    key: Object.keys(field.field || {})[0] || "",
    title: field.title,
    fieldType: field.fieldType,
    required: field.required,
    stepId: field.stepId,
    defaultValue: field.defaultValue,
    folded: field.collapsibleSection?.title,
  };
}

async function renderPage(): Promise<RenderResult> {
  Navigation.setLocation({
    pathname: "/admin/projects",
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  const rendered: RenderResult = render(
    <MemoryRouter>
      <Projects />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return rendered;
}

beforeEach(() => {
  billingEnabled = true;
  capturedTableProps = null;
});

afterEach(() => {
  cleanup();
});

describe("Admin > Projects > Create Project", () => {
  test("with billing on, is the Dashboard's one-page form: name, plan, and the promo code under More fields", async () => {
    await renderPage();

    expect(capturedTableProps!.isCreateable).toBe(true);
    expect(capturedTableProps!.formSteps).toBeUndefined();
    expect((capturedTableProps!.formFields || []).map(shapeOf)).toEqual(
      getCreateProjectFormFields({
        isBillingEnabled: true,
        plans: SubscriptionPlan.getSubscriptionPlans(CLOUD_PLAN_ENV),
      }).map(shapeOf),
    );
    expect((capturedTableProps!.formFields || []).map(shapeOf)).toEqual([
      {
        key: "name",
        title: "Project Name",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        stepId: undefined,
        defaultValue: undefined,
        folded: undefined,
      },
      {
        key: "paymentProviderPlanId",
        title: "Plan",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: true,
        stepId: undefined,
        defaultValue: "price_free_year",
        folded: undefined,
      },
      {
        key: "paymentProviderPromoCode",
        title: "Promo Code",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        stepId: undefined,
        defaultValue: undefined,
        folded: "More fields",
      },
    ]);
  });

  test("with billing off, asks for the name alone", async () => {
    billingEnabled = false;

    await renderPage();

    expect(capturedTableProps!.formSteps).toBeUndefined();
    expect(
      (capturedTableProps!.formFields || []).map((field: Field<Project>) => {
        return field.title;
      }),
    ).toEqual(["Project Name"]);
  });

  /*
   * The old form rebuilt its fields in an effect each time its yearly switch
   * flipped. The list is now built once, so a re-render of the page hands the
   * open create form the very same fields, and nothing in it starts over.
   */
  test("hands the table the same fields on every render, not a new list each time", async () => {
    const rendered: RenderResult = await renderPage();
    const first: Array<Field<Project>> | undefined =
      capturedTableProps!.formFields;

    rendered.rerender(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>,
    );

    expect(capturedTableProps!.formFields).toBe(first);
  });
});
