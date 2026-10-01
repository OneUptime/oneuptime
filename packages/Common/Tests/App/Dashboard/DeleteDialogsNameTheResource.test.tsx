import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "../../../UI/Utils/User";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import { getJestSpyOn } from "../../Spy";
import {
  WIDGET_TITLE_ARGUMENTS,
  getWidgetDisplayName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal";
import { getExceptionDisplayName } from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSettings";
import DeleteAccount, {
  DELETE_ACCOUNT_TEMPLATE,
  DELETE_UNNAMED_ACCOUNT_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/DeleteAccount";
import {
  REMOVE_SLA_RULE_TEMPLATE,
  REMOVE_UNNAMED_SLA_RULE_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Sla";

/*
 * The Dashboard's own delete dialogs - the ones that do not go through
 * ModelDelete or a table - name what they delete too: a dashboard widget by
 * its title, an exception by its type and message, your account by the email
 * you sign in with, an incident's SLA rule by its name.
 */

type MakeWidgetFunction = (
  argumentsValue: Record<string, unknown> | undefined,
) => DashboardBaseComponent;

const makeWidget: MakeWidgetFunction = (
  argumentsValue: Record<string, unknown> | undefined,
): DashboardBaseComponent => {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    componentType: DashboardComponentType.Chart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 3,
    arguments: argumentsValue,
  };
};

describe("a dashboard widget's name", () => {
  it.each([
    ["title", { title: "Open incidents" }, "Open incidents"],
    ["chartTitle", { chartTitle: "CPU by host" }, "CPU by host"],
    ["widgetTitle", { widgetTitle: "Checkout SLO" }, "Checkout SLO"],
    ["tableTitle", { tableTitle: "Slowest endpoints" }, "Slowest endpoints"],
    ["gaugeTitle", { gaugeTitle: "Error budget" }, "Error budget"],
  ])(
    "is read from %s",
    (_key: string, args: Record<string, unknown>, name: string) => {
      expect(getWidgetDisplayName(makeWidget(args))).toBe(name);
    },
  );

  it("reads the widget kinds' title settings in a fixed order", () => {
    expect(WIDGET_TITLE_ARGUMENTS).toEqual([
      "title",
      "chartTitle",
      "widgetTitle",
      "tableTitle",
      "gaugeTitle",
    ]);
    expect(
      getWidgetDisplayName(makeWidget({ chartTitle: "B", title: "A" })),
    ).toBe("A");
  });

  it("skips a blank title for the next one", () => {
    expect(
      getWidgetDisplayName(makeWidget({ title: "   ", chartTitle: "CPU" })),
    ).toBe("CPU");
  });

  it("is empty for an untitled widget, and for none at all", () => {
    expect(getWidgetDisplayName(makeWidget({ text: "Hello" }))).toBe("");
    expect(getWidgetDisplayName(makeWidget(undefined))).toBe("");
    expect(getWidgetDisplayName(undefined)).toBe("");
  });

  it("puts a multi-line title on one line", () => {
    expect(
      getWidgetDisplayName(makeWidget({ title: "Errors\nper   minute" })),
    ).toBe("Errors per minute");
  });
});

describe("an exception's name", () => {
  type MakeExceptionFunction = (
    values: Partial<Record<"exceptionType" | "message", string>>,
  ) => TelemetryException;

  const makeException: MakeExceptionFunction = (
    values: Partial<Record<"exceptionType" | "message", string>>,
  ): TelemetryException => {
    const exception: TelemetryException = new TelemetryException();

    if (values.exceptionType !== undefined) {
      exception.exceptionType = values.exceptionType;
    }

    if (values.message !== undefined) {
      exception.message = values.message;
    }

    return exception;
  };

  it("is its type and message, the way an exception is written", () => {
    expect(
      getExceptionDisplayName(
        makeException({
          exceptionType: "TypeError",
          message: "Cannot read properties of undefined",
        }),
      ),
    ).toBe("TypeError: Cannot read properties of undefined");
  });

  it("is whichever of the two was recorded", () => {
    expect(
      getExceptionDisplayName(makeException({ message: "Socket hang up" })),
    ).toBe("Socket hang up");
    expect(
      getExceptionDisplayName(makeException({ exceptionType: "OOMKilled" })),
    ).toBe("OOMKilled");
  });

  it("is empty when neither was recorded", () => {
    expect(getExceptionDisplayName(makeException({}))).toBe("");
    expect(
      getExceptionDisplayName(
        makeException({ exceptionType: " ", message: "" }),
      ),
    ).toBe("");
  });

  it("puts a multi-line message on one line", () => {
    expect(
      getExceptionDisplayName(
        makeException({ exceptionType: "Error", message: "first\n  second" }),
      ),
    ).toBe("Error: first second");
  });
});

describe("the sentences", () => {
  it("keep each name slot once, so a locale can move it", () => {
    expect(REMOVE_SLA_RULE_TEMPLATE.match(/\{\{name\}\}/g)).toHaveLength(1);
    expect(DELETE_ACCOUNT_TEMPLATE.match(/\{\{email\}\}/g)).toHaveLength(1);
  });

  it("fall back to what the dialogs said before when there is no name", () => {
    expect(REMOVE_UNNAMED_SLA_RULE_SENTENCE).toBe(
      "Are you sure you want to remove this SLA rule from the incident? This will delete all SLA tracking data for this rule.",
    );
    expect(DELETE_UNNAMED_ACCOUNT_SENTENCE).toBe(
      "Are you sure you want to delete your account? This action is permanent and cannot be undone. All your personal data will be removed.",
    );
  });
});

describe("Delete Account", () => {
  beforeEach(() => {
    jest.restoreAllMocks();

    // No projects left, so the account can be deleted.
    getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 100,
    } as never);
    getJestSpyOn(UserUtil, "getUserId").mockReturnValue(
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  type OpenDialogFunction = () => Promise<void>;

  const openDialog: OpenDialogFunction = async (): Promise<void> => {
    render(
      <DeleteAccount
        pageRoute={new Route("/dashboard/user-settings/delete-account")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Delete Account" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));
  };

  it("names the account by the email it signs in with", async () => {
    getJestSpyOn(UserUtil, "getEmail").mockReturnValue(
      new Email("jane@example.com"),
    );

    await openDialog();

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete your account (jane@example.com)? This action is permanent and cannot be undone. All your personal data will be removed.",
    );
    expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
      /^jane@example.com$/,
    );
  });

  it("asks the way it always did when the email is not known", async () => {
    getJestSpyOn(UserUtil, "getEmail").mockReturnValue(null);

    await openDialog();

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      DELETE_UNNAMED_ACCOUNT_SENTENCE,
    );
    expect(screen.queryByTestId("delete-confirmation-name")).toBeNull();
  });
});
