import "@testing-library/jest-dom";
import { RenderResult, cleanup, render, waitFor } from "@testing-library/react";
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
  createEditModalWidth?: ModalWidth | undefined;
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
import { ModalWidth } from "../../../UI/Components/Modal/Modal";
import { getCreateProjectFormFields } from "../../../UI/Components/Project/CreateProjectFormFields";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import Navigation from "../../../UI/Utils/Navigation";
import Project from "../../../Models/DatabaseModels/Project";
import {
  CUSTOM_TRIAL_TERMS,
  PlanPickerCopy,
  TRIAL_BADGE,
  TRIAL_TERMS,
  getPlanAudience,
} from "../../../UI/Components/Billing/PlanPicker/PlanPickerCopy";
import { NEW_TAB_DESCRIPTION } from "../../../UI/Components/Markdown.tsx/MarkdownLink";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

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
    // The plans need the room the Dashboard's dialog gives them.
    expect(capturedTableProps!.createEditModalWidth).toBe(ModalWidth.Medium);
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
    expect(capturedTableProps!.createEditModalWidth).toBe(ModalWidth.Normal);
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

/*
 * The Admin Dashboard looks every string up in its own locale files, not the
 * Dashboard's. The shared form's strings were translated for the Dashboard
 * only, so in German the Admin's create dialog read "Neues Projekt
 * erstellen" over "Such as your company or team name...", "Plan", "Monthly |
 * Yearly" and every plan's line in English. Each string the form draws is in
 * every Admin locale, worded as the Dashboard words it, so the two dialogs
 * say the same thing.
 */
describe("Admin > Projects > Create Project, in every Admin Dashboard language", () => {
  const LANGUAGES: Array<string> = [
    "en",
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
  ];

  const FEATURE_SETS: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
  );

  function readLocale(
    app: "AdminDashboard" | "Dashboard",
    code: string,
  ): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(
        path.join(FEATURE_SETS, app, "src", "Locales", `${code}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;
  }

  const plans: Array<SubscriptionPlan> =
    SubscriptionPlan.getSubscriptionPlans(CLOUD_PLAN_ENV);

  // What the form's fields say: titles, hints and the placeholder.
  const fieldStrings: Array<string> = getCreateProjectFormFields({
    isBillingEnabled: true,
    plans: plans,
  }).flatMap((field: Field<Project>): Array<string> => {
    return [field.title, field.description, field.placeholder].filter(
      (text: unknown): text is string => {
        return typeof text === "string" && text.length > 0;
      },
    );
  });

  // What the plan picker says (PlanPicker, PlanPickerCopy).
  const pickerStrings: Array<string> = [
    ...Object.values(PlanPickerCopy),
    ...plans
      .map((plan: SubscriptionPlan): string | null => {
        return getPlanAudience(plan);
      })
      .filter((line: string | null): line is string => {
        return Boolean(line);
      }),
    ...[TRIAL_BADGE, TRIAL_TERMS, CUSTOM_TRIAL_TERMS].flatMap(
      (plural: PluralTemplate): Array<string> => {
        return [plural.other, `${plural.other}_one`];
      },
    ),
    NEW_TAB_DESCRIPTION,
  ];

  const keys: Array<string> = Array.from(
    new Set<string>([...fieldStrings, ...pickerStrings]),
  );

  test("draws strings the Dashboard translates: the Admin carries each one", () => {
    // Every plan has its line, and the folded promo code its hint.
    expect(keys).toEqual(
      expect.arrayContaining([
        "Project Name",
        "Such as your company or team name. You can change it later.",
        "My Project",
        "Plan",
        "Promo Code",
        "If you have one, from an offer or a reseller.",
        "For one person getting started.",
        "Custom terms, a dedicated engineer and phone support.",
        "{{count}}-day free trial_one",
        "Compare plans",
      ]),
    );
  });

  test.each(LANGUAGES)(
    "%s: every string the form draws is in the Admin locale, as the Dashboard words it",
    (code: string) => {
      const admin: Record<string, unknown> = readLocale("AdminDashboard", code);
      const dashboard: Record<string, unknown> = readLocale("Dashboard", code);

      for (const key of keys) {
        expect({ code, key, admin: admin[key] }).toEqual({
          code,
          key,
          admin: dashboard[key],
        });
        expect(typeof admin[key]).toBe("string");
      }
    },
  );
});
