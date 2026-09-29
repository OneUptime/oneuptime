import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The alerts table's "Link to Incident" and "Declare Incident" bulk actions
 * (useBulkIncidentLinkActions). They sit on every alerts list in the product,
 * so what is pinned here is what a user would notice going wrong:
 *
 *   - gating: a viewer sees both actions locked with the missing permission,
 *     a member can use them, declaring also needs incident create, and
 *     linking to an existing incident also needs to read incidents;
 *   - the cap: above MAX_ALERTS_PER_INCIDENT_LINK_ACTION selected alerts
 *     both actions stay on the menu, locked, with a reason;
 *   - linking: one IncidentAlert per alert, progress after each, an alert
 *     that is already linked counts as done, other failures are isolated;
 *   - declaring: navigates to the create page with the selected ids.
 *
 * The dialog is the shared LinkIncidentAlertModal, whose BasicFormModal is
 * stubbed here to capture its props - the contract is the field it declares,
 * the numbered options it is handed, and onSubmit.
 */

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

interface CapturedModalProps {
  title: string;
  description?: string;
  isLoading?: boolean;
  submitButtonText?: string;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  formProps: {
    fields: Array<Record<string, any>>;
  };
}

let capturedModal: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): React.ReactElement => {
      capturedModal = props;
      return <div data-testid="basic-form-modal">{props.title}</div>;
    },
  };
});

import useBulkIncidentLinkActions, {
  BulkIncidentLinkActionsResult,
  DECLARE_CAP_TOOLTIP,
  DECLARE_INCIDENT_ACTION_TITLE,
  LINK_CAP_TOOLTIP,
  LINK_TO_INCIDENT_ACTION_TITLE,
  getDeclareIncidentFromAlertsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions";
import { LINK_OPTIONS_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlert/IncidentAlertLink";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Route from "../../../Types/API/Route";
import {
  INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const INCIDENT_ID: string = "44444444-4444-4444-8444-444444444444";

type MakeAlertFunction = (index: number) => Alert;

const makeAlert: MakeAlertFunction = (index: number): Alert => {
  const alert: Alert = new Alert();
  alert._id = `22222222-2222-4222-8222-${index.toString().padStart(12, "0")}`;
  alert.title = `Alert ${index}`;
  return alert;
};

type MakeAlertsFunction = (count: number) => Array<Alert>;

const makeAlerts: MakeAlertsFunction = (count: number): Array<Alert> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return makeAlert(index + 1);
  });
};

type MakeIncidentFunction = (data: {
  id: string;
  title?: string;
  incidentNumber?: number;
  incidentNumberWithPrefix?: string;
}) => Incident;

const makeIncident: MakeIncidentFunction = (data: {
  id: string;
  title?: string;
  incidentNumber?: number;
  incidentNumberWithPrefix?: string;
}): Incident => {
  const incident: Incident = new Incident();
  incident._id = data.id;
  if (data.title !== undefined) {
    incident.title = data.title;
  }
  if (data.incidentNumber !== undefined) {
    incident.incidentNumber = data.incidentNumber;
  }
  if (data.incidentNumberWithPrefix !== undefined) {
    incident.incidentNumberWithPrefix = data.incidentNumberWithPrefix;
  }
  return incident;
};

type ListResultFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResult: ListResultFunction = (data: Array<unknown>) => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

let permissionsForTest: Array<Permission> = [];
let currentResult: BulkIncidentLinkActionsResult | null = null;

const Harness: FunctionComponent = (): ReactElement => {
  const result: BulkIncidentLinkActionsResult = useBulkIncidentLinkActions();
  currentResult = result;
  return <div>{result.modals}</div>;
};

type RenderHarnessFunction = () => void;

const renderHarness: RenderHarnessFunction = (): void => {
  render(<Harness />);
};

type ActionsFunction = () => Array<BulkActionButtonSchema<Alert>>;

const actions: ActionsFunction = (): Array<BulkActionButtonSchema<Alert>> => {
  if (!currentResult) {
    throw new Error("The hook has not rendered.");
  }
  return currentResult.bulkActions;
};

/*
 * What the action bar shows for a selection: BulkUpdateForm keeps only the
 * actions whose isVisible accepts the selected items.
 */
type VisibleActionFunction = (
  title: string,
  items: Array<Alert>,
) => BulkActionButtonSchema<Alert>;

const visibleAction: VisibleActionFunction = (
  title: string,
  items: Array<Alert>,
): BulkActionButtonSchema<Alert> => {
  const visible: Array<BulkActionButtonSchema<Alert>> = actions().filter(
    (action: BulkActionButtonSchema<Alert>): boolean => {
      return (
        action.title === title &&
        (!action.isVisible || action.isVisible(items) !== false)
      );
    },
  );

  expect(visible).toHaveLength(1);

  return visible[0]!;
};

interface ProgressSnapshot {
  inProgress: number;
  success: Array<string>;
  failed: Array<string>;
  failedMessages: Array<string>;
  total: number;
}

let progressSnapshots: Array<ProgressSnapshot> = [];
let callOrder: Array<string> = [];

type MakeActionPropsFunction = (
  items: Array<Alert>,
) => BulkActionOnClickProps<Alert>;

const makeActionProps: MakeActionPropsFunction = (
  items: Array<Alert>,
): BulkActionOnClickProps<Alert> => {
  return {
    items: items,
    onProgressInfo: (info: ProgressInfo<Alert>): void => {
      progressSnapshots.push({
        inProgress: info.inProgressItems.length,
        success: info.successItems.map((item: Alert): string => {
          return item.title || "";
        }),
        failed: info.failed.map((failure: BulkActionFailed<Alert>): string => {
          return failure.item.title || "";
        }),
        failedMessages: info.failed.map(
          (failure: BulkActionFailed<Alert>): string => {
            return String(failure.failedMessage);
          },
        ),
        total: info.totalItems.length,
      });
      callOrder.push("progress");
    },
    onBulkActionStart: (): void => {
      callOrder.push("start");
    },
    onBulkActionEnd: (): void => {
      callOrder.push("end");
    },
  };
};

type ActAsyncFunction = (body: () => Promise<void>) => Promise<void>;

/*
 * zone.js reschedules the microtask React's act() uses to check that its
 * thenable was awaited, so a plain `await act(...)` is reported as
 * un-awaited. Hooking then() up synchronously answers that check in time (as
 * BulkLabelActions.test.tsx does).
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

/*
 * A call that throws from inside rather than a promise that is already
 * rejected: zone.js sees an eagerly rejected promise before the hook's catch
 * is attached and prints its stack on every run.
 */
type FailWithFunction = (message: string) => () => Promise<never>;

const failWith: FailWithFunction = (message: string) => {
  return async (): Promise<never> => {
    throw new Error(message);
  };
};

type ClickFunction = (title: string, items: Array<Alert>) => Promise<void>;

const click: ClickFunction = async (
  title: string,
  items: Array<Alert>,
): Promise<void> => {
  await actAsync(async () => {
    await visibleAction(title, items).onClick(makeActionProps(items));
  });
};

type SubmitLinkFunction = (incidentId: unknown) => Promise<void>;

const submitLink: SubmitLinkFunction = async (
  incidentId: unknown,
): Promise<void> => {
  if (!capturedModal) {
    throw new Error("The Link to Incident dialog is not open.");
  }

  const onSubmit: CapturedModalProps["onSubmit"] = capturedModal.onSubmit;

  await actAsync(async () => {
    await onSubmit({ linkedRecordId: incidentId });
  });
};

type CreatedLinkFunction = (callIndex: number) => IncidentAlert;

const createdLink: CreatedLinkFunction = (callIndex: number): IncidentAlert => {
  const call: Array<any> = createMock.mock.calls[callIndex] as Array<any>;
  expect(call[0].modelType).toBe(IncidentAlert);
  return call[0].model as IncidentAlert;
};

describe("useBulkIncidentLinkActions", () => {
  let navigateSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    capturedModal = null;
    currentResult = null;
    progressSnapshots = [];
    callOrder = [];
    permissionsForTest = [Permission.ProjectMember];
    getListMock.mockReset();
    createMock.mockReset();
    getListMock.mockResolvedValue(listResult([]));
    createMock.mockResolvedValue({});
    PermissionGate.clearPermissionPropsCache();

    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return permissionsForTest;
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("permission gating", () => {
    test("leaves both actions working for a project member", () => {
      renderHarness();

      const items: Array<Alert> = makeAlerts(2);

      expect(
        visibleAction(LINK_TO_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
      expect(
        visibleAction(DECLARE_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
    });

    test("locks both actions for a viewer, saying which permission is missing", () => {
      permissionsForTest = [Permission.Viewer];
      renderHarness();

      const items: Array<Alert> = makeAlerts(2);
      const link: BulkActionButtonSchema<Alert> = visibleAction(
        LINK_TO_INCIDENT_ACTION_TITLE,
        items,
      );
      const declare: BulkActionButtonSchema<Alert> = visibleAction(
        DECLARE_INCIDENT_ACTION_TITLE,
        items,
      );

      expect(link.disabled).toBe(true);
      expect(link.tooltip).toContain(
        "You do not have permission to create this Incident Alert.",
      );
      expect(declare.disabled).toBe(true);
      expect(declare.tooltip).toContain(
        "You do not have permission to create this Incident.",
      );
    });

    test("keeps locked actions on the menu rather than dropping them", () => {
      permissionsForTest = [Permission.Viewer];
      renderHarness();

      const titles: Array<string> = actions().map(
        (action: BulkActionButtonSchema<Alert>): string => {
          return action.title;
        },
      );

      expect(titles).toEqual([
        LINK_TO_INCIDENT_ACTION_TITLE,
        DECLARE_INCIDENT_ACTION_TITLE,
      ]);
    });

    /*
     * An alert role alone may create the link row, but the server only links
     * an incident the caller can read - and the incident picker could not
     * list any - so the action is locked with the read permission it needs.
     */
    test("locks linking for an alert member who cannot read incidents", () => {
      permissionsForTest = [Permission.AlertMember];
      renderHarness();

      const items: Array<Alert> = makeAlerts(1);
      const link: BulkActionButtonSchema<Alert> = visibleAction(
        LINK_TO_INCIDENT_ACTION_TITLE,
        items,
      );
      const declare: BulkActionButtonSchema<Alert> = visibleAction(
        DECLARE_INCIDENT_ACTION_TITLE,
        items,
      );

      expect(link.disabled).toBe(true);
      expect(link.tooltip).toContain(
        "You do not have permission to read this Incident.",
      );
      expect(declare.disabled).toBe(true);
      expect(declare.tooltip).toContain(
        "You do not have permission to create this Incident.",
      );
    });

    test("lets an alert member who can also read incidents link, but not declare", () => {
      permissionsForTest = [Permission.AlertMember, Permission.IncidentViewer];
      renderHarness();

      const items: Array<Alert> = makeAlerts(1);
      const declare: BulkActionButtonSchema<Alert> = visibleAction(
        DECLARE_INCIDENT_ACTION_TITLE,
        items,
      );

      expect(
        visibleAction(LINK_TO_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
      expect(declare.disabled).toBe(true);
      expect(declare.tooltip).toContain(
        "You do not have permission to create this Incident.",
      );
    });

    test("names the link permission first when both are missing", () => {
      permissionsForTest = [Permission.AlertViewer];
      renderHarness();

      const link: BulkActionButtonSchema<Alert> = visibleAction(
        LINK_TO_INCIDENT_ACTION_TITLE,
        makeAlerts(1),
      );

      expect(link.disabled).toBe(true);
      expect(link.tooltip).toContain(
        "You do not have permission to create this Incident Alert.",
      );
    });

    test("locks declaring for someone who may create incidents but not links", () => {
      permissionsForTest = [Permission.CreateProjectIncident];
      renderHarness();

      const declare: BulkActionButtonSchema<Alert> = visibleAction(
        DECLARE_INCIDENT_ACTION_TITLE,
        makeAlerts(1),
      );

      expect(declare.disabled).toBe(true);
      expect(declare.tooltip).toContain(
        "You do not have permission to create this Incident Alert.",
      );
    });

    test("does not accuse anyone before the permission snapshot has loaded", () => {
      permissionsForTest = [];
      renderHarness();

      const items: Array<Alert> = makeAlerts(1);

      expect(
        visibleAction(LINK_TO_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
      expect(
        visibleAction(DECLARE_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
    });

    test("leaves both working for a master admin", () => {
      permissionsForTest = [];
      jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
      renderHarness();

      const items: Array<Alert> = makeAlerts(1);

      expect(
        visibleAction(LINK_TO_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
      expect(
        visibleAction(DECLARE_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
    });
  });

  describe(`the ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alert cap`, () => {
    test("offers both actions up to the cap", () => {
      renderHarness();

      const items: Array<Alert> = makeAlerts(
        MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
      );

      expect(
        visibleAction(LINK_TO_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
      expect(
        visibleAction(DECLARE_INCIDENT_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
    });

    test("locks both actions above the cap, with a reason", () => {
      renderHarness();

      const items: Array<Alert> = makeAlerts(
        MAX_ALERTS_PER_INCIDENT_LINK_ACTION + 1,
      );
      const link: BulkActionButtonSchema<Alert> = visibleAction(
        LINK_TO_INCIDENT_ACTION_TITLE,
        items,
      );
      const declare: BulkActionButtonSchema<Alert> = visibleAction(
        DECLARE_INCIDENT_ACTION_TITLE,
        items,
      );

      expect(link.disabled).toBe(true);
      expect(link.tooltip).toBe(LINK_CAP_TOOLTIP);
      expect(LINK_CAP_TOOLTIP).toContain(
        `${MAX_ALERTS_PER_INCIDENT_LINK_ACTION}`,
      );
      expect(declare.disabled).toBe(true);
      expect(declare.tooltip).toBe(DECLARE_CAP_TOOLTIP);
    });

    test("keeps the permission reason for a viewer above the cap", () => {
      permissionsForTest = [Permission.Viewer];
      renderHarness();

      const link: BulkActionButtonSchema<Alert> = visibleAction(
        LINK_TO_INCIDENT_ACTION_TITLE,
        makeAlerts(MAX_ALERTS_PER_INCIDENT_LINK_ACTION + 1),
      );

      expect(link.disabled).toBe(true);
      expect(link.tooltip).toContain("You do not have permission");
    });

    test("does nothing if the working action is invoked with too many alerts anyway", async () => {
      renderHarness();

      const items: Array<Alert> = makeAlerts(
        MAX_ALERTS_PER_INCIDENT_LINK_ACTION + 1,
      );
      const working: Array<BulkActionButtonSchema<Alert>> = actions().filter(
        (action: BulkActionButtonSchema<Alert>): boolean => {
          return !action.disabled;
        },
      );

      expect(working).toHaveLength(2);

      for (const action of working) {
        await actAsync(async () => {
          await action.onClick(makeActionProps(items));
        });
      }

      expect(capturedModal).toBeNull();
      expect(getListMock).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(callOrder).toEqual([]);
    });
  });

  describe("Link to Incident", () => {
    test("opens the dialog and lists recent incidents by number and title", async () => {
      getListMock.mockResolvedValue(
        listResult([
          makeIncident({
            id: "44444444-4444-4444-8444-000000000001",
            title: "Database is down",
            incidentNumber: 42,
            incidentNumberWithPrefix: "INC-42",
          }),
          makeIncident({
            id: "44444444-4444-4444-8444-000000000002",
            title: "Checkout errors",
            incidentNumber: 41,
          }),
        ]),
      );
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(2));

      await waitFor(() => {
        expect(capturedModal?.isLoading).toBe(false);
      });

      expect(capturedModal?.title).toBe("Link to Incident");
      expect(capturedModal?.submitButtonText).toBe("Link Alerts");
      expect(getListMock).toHaveBeenCalledTimes(1);

      const request: any = getListMock.mock.calls[0]![0];

      expect(request.modelType).toBe(Incident);
      expect(request.limit).toBe(LINK_OPTIONS_LIMIT);
      expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
      expect(request.select).toEqual({
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      });

      const field: Record<string, any> = capturedModal!.formProps.fields[0]!;

      expect(capturedModal!.formProps.fields).toHaveLength(1);
      expect(field["field"]).toEqual({ linkedRecordId: true });
      expect(field["title"]).toBe("Incident");
      expect(field["placeholder"]).toBe("Select an incident");
      expect(field["required"]).toBe(true);
      expect(field["dropdownModal"]).toEqual({
        type: Incident,
        labelField: "title",
        valueField: "_id",
      });
      expect(field["dropdownOptions"]).toEqual([
        {
          label: "INC-42: Database is down",
          value: "44444444-4444-4444-8444-000000000001",
        },
        {
          label: "#41: Checkout errors",
          value: "44444444-4444-4444-8444-000000000002",
        },
      ]);
    });

    test("still opens the dialog when the incident list cannot be read", async () => {
      getListMock.mockImplementation(failWith("Forbidden"));
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(1));

      await waitFor(() => {
        expect(capturedModal?.isLoading).toBe(false);
      });

      expect(capturedModal!.formProps.fields[0]!["dropdownOptions"]).toEqual(
        [],
      );
    });

    test("creates one link per alert, reporting progress after each", async () => {
      renderHarness();
      const items: Array<Alert> = makeAlerts(3);

      await click(LINK_TO_INCIDENT_ACTION_TITLE, items);
      await submitLink(INCIDENT_ID);

      expect(createMock).toHaveBeenCalledTimes(3);

      items.forEach((alert: Alert, index: number) => {
        const link: IncidentAlert = createdLink(index);

        expect(link.incidentId?.toString()).toBe(INCIDENT_ID);
        expect(link.alertId?.toString()).toBe(alert._id);
        expect(link.projectId?.toString()).toBe(PROJECT_ID);
      });

      expect(callOrder).toEqual([
        "start",
        "progress",
        "progress",
        "progress",
        "end",
      ]);
      expect(progressSnapshots).toEqual([
        {
          inProgress: 2,
          success: ["Alert 1"],
          failed: [],
          failedMessages: [],
          total: 3,
        },
        {
          inProgress: 1,
          success: ["Alert 1", "Alert 2"],
          failed: [],
          failedMessages: [],
          total: 3,
        },
        {
          inProgress: 0,
          success: ["Alert 1", "Alert 2", "Alert 3"],
          failed: [],
          failedMessages: [],
          total: 3,
        },
      ]);

      // The dialog closes so the progress modal is visible.
      expect(
        document.querySelector('[data-testid="basic-form-modal"]'),
      ).toBeNull();
    });

    test("does not read incidents until the dialog opens", () => {
      renderHarness();

      expect(getListMock).not.toHaveBeenCalled();
      expect(capturedModal).toBeNull();
    });

    test("counts an alert that is already linked as done and isolates other failures", async () => {
      createMock
        .mockImplementationOnce(failWith(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE))
        .mockImplementationOnce(failWith("You cannot read this alert."))
        .mockResolvedValueOnce({});
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(3));
      await submitLink(INCIDENT_ID);

      expect(createMock).toHaveBeenCalledTimes(3);
      expect(progressSnapshots[progressSnapshots.length - 1]).toEqual({
        inProgress: 0,
        success: ["Alert 1", "Alert 3"],
        failed: ["Alert 2"],
        failedMessages: ["You cannot read this alert."],
        total: 3,
      });
      expect(callOrder[callOrder.length - 1]).toBe("end");
    });

    /*
     * Two links for the same pair that race past the model's check are
     * refused by the unique index instead, in its own words. The alert is
     * linked either way, so it still counts as done.
     */
    test("counts a duplicate caught by the unique index as done too", async () => {
      createMock
        .mockImplementationOnce(
          failWith(
            "A Incident Alert with the same Incident Id, Alert Id, Project Id already exists. Please use different values and try again.",
          ),
        )
        .mockResolvedValueOnce({});
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(2));
      await submitLink(INCIDENT_ID);

      expect(progressSnapshots[progressSnapshots.length - 1]).toEqual({
        inProgress: 0,
        success: ["Alert 1", "Alert 2"],
        failed: [],
        failedMessages: [],
        total: 2,
      });
    });

    test("accepts the selected incident as a dropdown option object", async () => {
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(1));
      await submitLink({ label: "INC-1: x", value: INCIDENT_ID });

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createdLink(0).incidentId?.toString()).toBe(INCIDENT_ID);
    });

    test("starts nothing without an incident", async () => {
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(2));
      await submitLink("");

      expect(createMock).not.toHaveBeenCalled();
      expect(callOrder).toEqual([]);
    });

    test("closing the dialog links nothing", async () => {
      renderHarness();

      await click(LINK_TO_INCIDENT_ACTION_TITLE, makeAlerts(2));

      const onClose: () => void = capturedModal!.onClose;

      act(() => {
        onClose();
      });

      expect(
        document.querySelector('[data-testid="basic-form-modal"]'),
      ).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
      expect(callOrder).toEqual([]);
    });
  });

  describe("Declare Incident", () => {
    test("navigates to the create page with the selected alert ids", async () => {
      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      await click(DECLARE_INCIDENT_ACTION_TITLE, items);

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
        `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${items[0]!._id},${items[1]!._id}`,
      );
      // No progress modal: it is a navigation, not a bulk write.
      expect(callOrder).toEqual([]);
      expect(createMock).not.toHaveBeenCalled();
    });
  });
});

describe("the bulk incident link helpers", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("builds the declare route from the shared query parameter", () => {
    const route: Route = getDeclareIncidentFromAlertsRoute(["a", "b", "c"]);

    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/incidents/create?alertIds=a,b,c`,
    );
  });
});
