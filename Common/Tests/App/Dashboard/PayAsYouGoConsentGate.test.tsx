import BaseAPI from "../../../UI/Utils/API/API";
import ObjectID from "../../../Types/ObjectID";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Route from "../../../Types/API/Route";
import Project from "../../../Models/DatabaseModels/Project";
import Permission, { UserPermission } from "../../../Types/Permission";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { getTelemetryPayAsYouGoFormFields } from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo";

/*
 * Telemetry and single-monitor creation retain pricing notices without
 * requiring an additional acknowledgement. Their ordinary form validation
 * and model payload boundaries still apply.
 */

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getCommonHeaders: () => {
        return {};
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __payAsYouGoGateConfig: MutableConfig }
).__payAsYouGoGateConfig = config;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __payAsYouGoGateConfig: MutableConfig | undefined;
          }
        ).__payAsYouGoGateConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

/*
 * These render real forms that validate on every keystroke, so give the waits
 * room to survive a loaded CI box.
 */
const WAIT_TIMEOUT: number = 20000;

type RenderIngestionKeyFormFunction = (name?: string) => void;

const renderIngestionKeyForm: RenderIngestionKeyFormFunction = (
  name?: string,
): void => {
  render(
    <ModelForm<TelemetryIngestionKey>
      modelType={TelemetryIngestionKey}
      id="create-ingestion-key-form"
      name="Create Ingestion Key"
      formType={FormType.Create}
      submitButtonText="Create Ingestion Key"
      initialValues={name ? { name } : undefined}
      fields={[
        ...getTelemetryPayAsYouGoFormFields(),
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          dataTestId: "ingestion-key-name",
        },
      ]}
    />,
  );
};

function renderMonitorPage(monitorType: MonitorType): void {
  const project: Project = new Project();
  project.id = new ObjectID("11111111-1111-4111-8111-111111111111");

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(project.id);
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (paramName: string): string | null => {
      return paramName === "monitorType" ? monitorType : null;
    },
  );

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

async function advanceMonitorInfo(): Promise<void> {
  await userEvent.type(
    await screen.findByPlaceholderText(
      "Monitor Name",
      {},
      { timeout: WAIT_TIMEOUT },
    ),
    "Marketing site",
  );
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(
    await screen.findByTestId("monitor-steps", {}, { timeout: WAIT_TIMEOUT }),
  ).toBeInTheDocument();
}

describe("Pay as you go creation notices", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(ObjectID.generate());
    jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValue({ data: { isAllowed: true } } as any);
    config.billingEnabled = true;
    createOrUpdateMock.mockReset();
    getItemMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
    getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);
  });

  describe("creating a telemetry ingestion key on the Free plan", () => {
    it("keeps the pricing notice without an acknowledgement section or checkbox", async () => {
      renderIngestionKeyForm();

      expect(
        await screen.findByText(
          "Telemetry is a pay as you go feature",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("telemetry-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "I understand telemetry sent with this key is billed as I use it",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("I agree to these usage charges"),
      ).not.toBeInTheDocument();
    });

    it("still requires a name before creating an ingestion key", async () => {
      renderIngestionKeyForm();
      await screen.findByTestId(
        "ingestion-key-name",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      await userEvent.click(screen.getByText("Create Ingestion Key"));

      expect(
        await screen.findByText(
          "Name is required.",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    it("submits a prefilled key without consent and excludes notice and legacy acknowledgement fields from the payload", async () => {
      renderIngestionKeyForm("Production");
      await waitFor(() => {
        expect(screen.getByTestId("ingestion-key-name")).toHaveValue(
          "Production",
        );
      });
      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const call: any = createOrUpdateMock.mock.calls[0]?.[0];
      expect(call?.model?.name).toBe("Production");
      for (const fieldKey of [
        "telemetryPayAsYouGoNotice",
        "telemetryPayAsYouGoAcknowledged",
      ]) {
        expect(call?.miscDataProps ?? {}).not.toHaveProperty(fieldKey);
        expect(JSON.stringify(call?.model ?? {})).not.toContain(fieldKey);
      }
    });
  });

  describe("creating a telemetry ingestion key off the Free plan", () => {
    it("asks for nothing extra on a paid plan", async () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Growth,
      );

      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );

      expect(
        screen.queryByTestId("telemetry-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Telemetry is a pay as you go feature"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    it("asks for nothing extra on a self-hosted install", async () => {
      config.billingEnabled = false;

      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );

      expect(
        screen.queryByTestId("telemetry-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });
  });

  describe("creating a monitor on the Free plan", () => {
    it.each([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Logs,
      MonitorType.IncomingRequest,
      MonitorType.SSLCertificate,
    ])(
      "shows the page warning and advances %s without billing acknowledgement",
      async (monitorType: MonitorType) => {
        renderMonitorPage(monitorType);

        const pricingNotice: HTMLElement = await screen.findByTestId(
          "monitor-pay-as-you-go-card",
        );
        expect(pricingNotice).toHaveTextContent("$1");
        expect(pricingNotice).toHaveTextContent("per monitor per month");
        await screen.findByPlaceholderText("Monitor Name");

        expect(
          screen.queryByTestId("monitor-pay-as-you-go-consent"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(/I understand this monitor is billed/i),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("I agree to these usage charges"),
        ).not.toBeInTheDocument();

        await advanceMonitorInfo();
      },
    );
  });

  describe("creating a monitor off the Free plan", () => {
    it("advances without a warning or acknowledgement on a paid plan", async () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Growth,
      );
      renderMonitorPage(MonitorType.Website);

      await advanceMonitorInfo();

      expect(
        screen.queryByTestId("monitor-pay-as-you-go-card"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("monitor-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
    });

    it("advances without a warning or acknowledgement on a self-hosted install", async () => {
      config.billingEnabled = false;
      renderMonitorPage(MonitorType.Website);

      await advanceMonitorInfo();

      expect(
        screen.queryByTestId("monitor-pay-as-you-go-card"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("monitor-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
    });
  });
});
