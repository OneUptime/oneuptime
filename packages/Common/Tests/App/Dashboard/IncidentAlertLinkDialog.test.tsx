import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The link dialog on an incident's Linked Alerts page and on an alert's
 * Linked Incidents page. It replaced the table's built-in create form, whose
 * picker listed bare titles - three "Checkout API is offline" alerts could
 * not be told apart. What is pinned:
 *
 *   - nothing is read until the dialog opens, and then the most recent
 *     records are listed newest first, labelled with their number, while the
 *     dropdown still searches every record by title on the server;
 *   - submitting creates one IncidentAlert between the page's record and the
 *     chosen one, closes the dialog and refreshes the table;
 *   - a refusal keeps the dialog open with the reason in it (a duplicate in
 *     the same plain words however the server caught it), and keeps the
 *     choice so the user can try again.
 *
 * ModelTable is stubbed to capture its props (the card buttons, the refresh
 * toggle) and BasicFormModal to render what the user would read.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

type CapturedTableProps = Record<string, any>;

let capturedTables: Array<CapturedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): React.ReactElement => {
      capturedTables.push(props);
      return <div data-testid="model-table" />;
    },
  };
});

interface CapturedModalProps {
  title: string;
  description?: string;
  isLoading?: boolean;
  error?: string;
  submitButtonText?: string;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  formProps: {
    error?: string;
    initialValues?: Record<string, unknown>;
    fields: Array<Record<string, any>>;
  };
}

let capturedModal: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): React.ReactElement => {
      capturedModal = props;

      const options: Array<{ label: string; value: string }> =
        props.formProps.fields[0]!["dropdownOptions"] || [];

      return (
        <div data-testid="link-dialog">
          <h2>{props.title}</h2>
          <p>{props.description}</p>
          {props.isLoading && <span data-testid="link-dialog-loading" />}
          {props.error && (
            <p data-testid="link-dialog-modal-error">{props.error}</p>
          )}
          {props.formProps.error && (
            <p data-testid="link-dialog-error">{props.formProps.error}</p>
          )}
          <ul>
            {options.map((option: { label: string; value: string }) => {
              return <li key={option.value}>{option.label}</li>;
            })}
          </ul>
        </div>
      );
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

import IncidentViewAlerts from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Alerts";
import AlertViewIncidents from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Incidents";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { LINK_OPTIONS_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlert/IncidentAlertLink";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { INCIDENT_ALERT_ALREADY_LINKED_MESSAGE } from "../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const MODEL_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";

const ALERT_63_ID: string = "22222222-2222-4222-8222-000000000063";
const ALERT_57_ID: string = "22222222-2222-4222-8222-000000000057";
const INCIDENT_12_ID: string = "44444444-4444-4444-8444-000000000012";
const INCIDENT_11_ID: string = "44444444-4444-4444-8444-000000000011";

type ListResultFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResult: ListResultFunction = (data: Array<unknown>) => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

/*
 * Two alerts from one monitor with the same title, newest first - the case
 * a title-only picker could not handle.
 */
type RecentAlertsFunction = () => Array<Alert>;

const recentAlerts: RecentAlertsFunction = (): Array<Alert> => {
  const newest: Alert = new Alert();
  newest._id = ALERT_63_ID;
  newest.title = "Checkout API is offline";
  newest.alertNumber = 63;
  newest.alertNumberWithPrefix = "ALT-63";

  const older: Alert = new Alert();
  older._id = ALERT_57_ID;
  older.title = "Checkout API is offline";
  older.alertNumber = 57;

  return [newest, older];
};

type RecentIncidentsFunction = () => Array<Incident>;

const recentIncidents: RecentIncidentsFunction = (): Array<Incident> => {
  const newest: Incident = new Incident();
  newest._id = INCIDENT_12_ID;
  newest.title = "Checkout outage";
  newest.incidentNumber = 12;
  newest.incidentNumberWithPrefix = "INC-12";

  const older: Incident = new Incident();
  older._id = INCIDENT_11_ID;
  older.title = "Checkout outage";
  older.incidentNumber = 11;

  return [newest, older];
};

let failOptions: boolean = false;

type AnswerListFunction = (request: any) => Promise<unknown>;

const answerList: AnswerListFunction = async (
  request: any,
): Promise<unknown> => {
  if (request.modelType === AlertState || request.modelType === IncidentState) {
    return listResult([]);
  }

  if (failOptions) {
    throw new Error("Forbidden");
  }

  if (request.modelType === Alert) {
    return listResult(recentAlerts());
  }

  if (request.modelType === Incident) {
    return listResult(recentIncidents());
  }

  return listResult([]);
};

type ActAsyncFunction = (body: () => Promise<void>) => Promise<void>;

/*
 * zone.js reschedules the microtask React's act() uses to check that its
 * thenable was awaited; hooking then() up synchronously answers that check
 * in time (as BulkIncidentLinkActions.test.tsx does).
 */
const actAsync: ActAsyncFunction = (
  body: () => Promise<void>,
): Promise<void> => {
  const scope: PromiseLike<void> = act(body) as unknown as PromiseLike<void>;

  return new Promise<void>(
    (resolve: () => void, reject: (reason: unknown) => void): void => {
      scope.then(resolve, reject);
    },
  );
};

type FailWithFunction = (message: string) => () => Promise<never>;

const failWith: FailWithFunction = (message: string) => {
  return async (): Promise<never> => {
    throw new Error(message);
  };
};

type LatestTableFunction = () => CapturedTableProps;

const latestTable: LatestTableFunction = (): CapturedTableProps => {
  return capturedTables[capturedTables.length - 1]!;
};

type OpenPageFunction = (
  page: React.FunctionComponent<PageComponentProps>,
) => Promise<void>;

const openPage: OpenPageFunction = async (
  page: React.FunctionComponent<PageComponentProps>,
): Promise<void> => {
  const Page: React.FunctionComponent<PageComponentProps> = page;

  render(
    <MemoryRouter>
      <Page
        pageRoute={new Route("/dashboard/page")}
        currentProject={new Project()}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  // The state list lands after the first render.
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(capturedTables.length).toBeGreaterThan(1);
  });
};

type OpenDialogFunction = (title: string) => Promise<void>;

/* Presses the page's link card button and waits for the options to load. */
const openDialog: OpenDialogFunction = async (title: string): Promise<void> => {
  const button: CardButtonSchema | undefined = (
    latestTable()["cardProps"]["buttons"] as Array<CardButtonSchema>
  ).find((candidate: CardButtonSchema): boolean => {
    return candidate.title === title;
  });

  expect(button).toBeDefined();

  act(() => {
    button!.onClick();
  });

  await waitFor(() => {
    expect(capturedModal).not.toBeNull();
    expect(capturedModal!.isLoading).toBe(false);
  });
};

type SubmitFunction = (value: unknown) => Promise<void>;

const submit: SubmitFunction = async (value: unknown): Promise<void> => {
  if (!capturedModal) {
    throw new Error("The link dialog is not open.");
  }

  const onSubmit: CapturedModalProps["onSubmit"] = capturedModal.onSubmit;

  await actAsync(async () => {
    await onSubmit({ linkedRecordId: value });
  });
};

type OptionRequestsFunction = () => Array<any>;

const optionRequests: OptionRequestsFunction = (): Array<any> => {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((request: any): boolean => {
      return request.modelType === Alert || request.modelType === Incident;
    });
};

type CreatedLinkFunction = () => IncidentAlert;

const createdLink: CreatedLinkFunction = (): IncidentAlert => {
  expect(createMock).toHaveBeenCalledTimes(1);

  const request: any = createMock.mock.calls[0]![0];

  expect(request.modelType).toBe(IncidentAlert);

  return request.model as IncidentAlert;
};

type DialogIsOpenFunction = () => boolean;

const dialogIsOpen: DialogIsOpenFunction = (): boolean => {
  return Boolean(document.querySelector('[data-testid="link-dialog"]'));
};

describe("the link dialog on the Linked pages", () => {
  beforeEach(() => {
    capturedTables = [];
    capturedModal = null;
    failOptions = false;
    getListMock.mockReset();
    createMock.mockReset();
    getListMock.mockImplementation(answerList);
    createMock.mockResolvedValue({});
    PermissionGate.clearPermissionPropsCache();

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(MODEL_ID));
    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return [Permission.ProjectMember];
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("an incident's Link Alert", () => {
    test("reads no alerts until the dialog opens", async () => {
      await openPage(IncidentViewAlerts);

      expect(optionRequests()).toHaveLength(0);
      expect(dialogIsOpen()).toBe(false);
    });

    test("lists recent alerts newest first, by number, and still searches by title", async () => {
      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      const requests: Array<any> = optionRequests();

      expect(requests).toHaveLength(1);
      expect(requests[0].modelType).toBe(Alert);
      expect(requests[0].limit).toBe(LINK_OPTIONS_LIMIT);
      expect(requests[0].sort).toEqual({ createdAt: SortOrder.Descending });

      expect(capturedModal!.title).toBe("Link Alert");
      expect(capturedModal!.submitButtonText).toBe("Link Alert");
      expect(capturedModal!.description).toBe(
        "Select an alert to link to this incident.",
      );

      const field: Record<string, any> = capturedModal!.formProps.fields[0]!;

      expect(capturedModal!.formProps.fields).toHaveLength(1);
      expect(field["title"]).toBe("Alert");
      expect(field["placeholder"]).toBe("Select an alert");
      expect(field["required"]).toBe(true);
      expect(field["dropdownModal"]).toEqual({
        type: Alert,
        labelField: "title",
        valueField: "_id",
      });

      const labels: Array<string> = Array.from(
        document.querySelectorAll('[data-testid="link-dialog"] li'),
      ).map((item: Element): string => {
        return item.textContent || "";
      });

      expect(labels).toEqual([
        "ALT-63: Checkout API is offline",
        "#57: Checkout API is offline",
      ]);
      expect(field["dropdownOptions"]).toEqual([
        { label: "ALT-63: Checkout API is offline", value: ALERT_63_ID },
        { label: "#57: Checkout API is offline", value: ALERT_57_ID },
      ]);
    });

    test("links the chosen alert to this incident, closes and refreshes the table", async () => {
      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      const refreshBefore: unknown = latestTable()["refreshToggle"];

      await submit(ALERT_57_ID);

      const link: IncidentAlert = createdLink();

      expect(link.incidentId?.toString()).toBe(MODEL_ID);
      expect(link.alertId?.toString()).toBe(ALERT_57_ID);
      expect(link.projectId?.toString()).toBe(PROJECT_ID);

      await waitFor(() => {
        expect(dialogIsOpen()).toBe(false);
      });

      expect(latestTable()["refreshToggle"]).not.toBe(refreshBefore);
    });

    test("accepts the chosen option as an object", async () => {
      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      await submit({ label: "ALT-63: x", value: ALERT_63_ID });

      expect(createdLink().alertId?.toString()).toBe(ALERT_63_ID);
    });

    test("keeps the dialog open with the reason when the link is refused", async () => {
      createMock.mockImplementation(
        failWith(
          "The alert to link does not exist in this project, or you do not have access to it.",
        ),
      );

      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      const refreshBefore: unknown = latestTable()["refreshToggle"];

      await submit(ALERT_63_ID);

      await waitFor(() => {
        expect(screen.getByTestId("link-dialog-error")).toHaveTextContent(
          "The alert to link does not exist in this project, or you do not have access to it.",
        );
      });

      expect(dialogIsOpen()).toBe(true);
      expect(capturedModal!.isLoading).toBe(false);
      expect(latestTable()["refreshToggle"]).toBe(refreshBefore);

      /*
       * Once, on the form: BasicFormModal would also hand its own error prop
       * to the modal body, showing the same sentence twice.
       */
      expect(capturedModal!.error).toBeUndefined();
      expect(
        screen.queryByTestId("link-dialog-modal-error"),
      ).not.toBeInTheDocument();

      // The choice survives, so trying again does not mean finding it again.
      expect(capturedModal!.formProps.initialValues).toEqual({
        linkedRecordId: ALERT_63_ID,
      });
    });

    test("says a duplicate is already linked, however the server caught it", async () => {
      createMock.mockImplementation(
        failWith(
          "A Incident Alert with the same Incident Id, Alert Id, Project Id already exists. Please use different values and try again.",
        ),
      );

      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");
      await submit(ALERT_63_ID);

      await waitFor(() => {
        expect(screen.getByTestId("link-dialog-error")).toHaveTextContent(
          INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
        );
      });
    });

    test("replaces the last reason with the new one", async () => {
      createMock
        .mockImplementationOnce(failWith(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE))
        .mockImplementationOnce(failWith("Alert not found."));

      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");
      await submit(ALERT_63_ID);

      await waitFor(() => {
        expect(screen.getByTestId("link-dialog-error")).toHaveTextContent(
          INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
        );
      });

      await submit(ALERT_57_ID);

      await waitFor(() => {
        expect(screen.getByTestId("link-dialog-error")).toHaveTextContent(
          "Alert not found.",
        );
      });
      expect(screen.getAllByTestId("link-dialog-error")).toHaveLength(1);
      expect(capturedModal!.formProps.initialValues).toEqual({
        linkedRecordId: ALERT_57_ID,
      });
    });

    test("clears the last error when trying again", async () => {
      createMock
        .mockImplementationOnce(failWith(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE))
        .mockResolvedValueOnce({});

      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");
      await submit(ALERT_63_ID);

      await waitFor(() => {
        expect(screen.getByTestId("link-dialog-error")).toBeInTheDocument();
      });

      await submit(ALERT_57_ID);

      await waitFor(() => {
        expect(dialogIsOpen()).toBe(false);
      });
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    test("still opens, and still links, when recent alerts cannot be read", async () => {
      failOptions = true;

      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      expect(capturedModal!.formProps.fields[0]!["dropdownOptions"]).toEqual(
        [],
      );
      expect(capturedModal!.formProps.error).toBeUndefined();

      await submit(ALERT_63_ID);

      expect(createdLink().alertId?.toString()).toBe(ALERT_63_ID);
    });

    test("closing the dialog links nothing and leaves the table alone", async () => {
      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      const refreshBefore: unknown = latestTable()["refreshToggle"];
      const onClose: () => void = capturedModal!.onClose;

      act(() => {
        onClose();
      });

      expect(dialogIsOpen()).toBe(false);
      expect(createMock).not.toHaveBeenCalled();
      expect(latestTable()["refreshToggle"]).toBe(refreshBefore);
    });

    test("submitting nothing links nothing", async () => {
      await openPage(IncidentViewAlerts);
      await openDialog("Link Alert");

      await submit("");

      expect(createMock).not.toHaveBeenCalled();
      expect(dialogIsOpen()).toBe(true);
    });
  });

  describe("an alert's Link Incident", () => {
    test("lists recent incidents newest first, by number", async () => {
      await openPage(AlertViewIncidents);

      expect(optionRequests()).toHaveLength(0);

      await openDialog("Link Incident");

      const requests: Array<any> = optionRequests();

      expect(requests).toHaveLength(1);
      expect(requests[0].modelType).toBe(Incident);
      expect(requests[0].sort).toEqual({ createdAt: SortOrder.Descending });

      expect(capturedModal!.title).toBe("Link Incident");
      expect(capturedModal!.submitButtonText).toBe("Link Incident");
      expect(capturedModal!.description).toBe(
        "Select an incident to link this alert to.",
      );

      const field: Record<string, any> = capturedModal!.formProps.fields[0]!;

      expect(field["title"]).toBe("Incident");
      expect(field["placeholder"]).toBe("Select an incident");
      expect(field["dropdownModal"]).toEqual({
        type: Incident,
        labelField: "title",
        valueField: "_id",
      });
      expect(field["dropdownOptions"]).toEqual([
        { label: "INC-12: Checkout outage", value: INCIDENT_12_ID },
        { label: "#11: Checkout outage", value: INCIDENT_11_ID },
      ]);
    });

    test("links this alert to the chosen incident, closes and refreshes the table", async () => {
      await openPage(AlertViewIncidents);
      await openDialog("Link Incident");

      const refreshBefore: unknown = latestTable()["refreshToggle"];

      await submit(INCIDENT_12_ID);

      const link: IncidentAlert = createdLink();

      expect(link.incidentId?.toString()).toBe(INCIDENT_12_ID);
      expect(link.alertId?.toString()).toBe(MODEL_ID);
      expect(link.projectId?.toString()).toBe(PROJECT_ID);

      await waitFor(() => {
        expect(dialogIsOpen()).toBe(false);
      });

      expect(latestTable()["refreshToggle"]).not.toBe(refreshBefore);
    });

    test("shows an already-linked refusal in the dialog", async () => {
      createMock.mockImplementation(
        failWith(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE),
      );

      await openPage(AlertViewIncidents);
      await openDialog("Link Incident");
      await submit(INCIDENT_12_ID);

      await waitFor(() => {
        expect(screen.getByTestId("link-dialog-error")).toHaveTextContent(
          INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
        );
      });

      expect(dialogIsOpen()).toBe(true);
    });
  });
});
