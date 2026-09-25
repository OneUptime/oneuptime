import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The helpers every alert-to-incident link entry point shares (the alerts
 * table's bulk action and the two Linked pages): numbered option labels, the
 * newest-first option lists, creating the link, recognising a duplicate, and
 * locking a link button the user could not use.
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

import {
  LINK_OPTIONS_LIMIT,
  createIncidentAlertLink,
  fetchAlertLinkOptions,
  fetchIncidentLinkOptions,
  getAlertOptionLabel,
  getIncidentOptionLabel,
  isAlreadyLinkedError,
  lockUnlessAllowed,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlert/IncidentAlertLink";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import { INCIDENT_ALERT_ALREADY_LINKED_MESSAGE } from "../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../Types/ObjectID";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const INCIDENT_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_ID: string = "22222222-2222-4222-8222-222222222222";

type ListResultFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResult: ListResultFunction = (data: Array<unknown>) => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

type MakeIncidentFunction = (data: {
  id?: string;
  title?: string;
  incidentNumber?: number;
  incidentNumberWithPrefix?: string;
}) => Incident;

const makeIncident: MakeIncidentFunction = (data: {
  id?: string;
  title?: string;
  incidentNumber?: number;
  incidentNumberWithPrefix?: string;
}): Incident => {
  const incident: Incident = new Incident();
  if (data.id !== undefined) {
    incident._id = data.id;
  }
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

type MakeAlertFunction = (data: {
  id?: string;
  title?: string;
  alertNumber?: number;
  alertNumberWithPrefix?: string;
}) => Alert;

const makeAlert: MakeAlertFunction = (data: {
  id?: string;
  title?: string;
  alertNumber?: number;
  alertNumberWithPrefix?: string;
}): Alert => {
  const alert: Alert = new Alert();
  if (data.id !== undefined) {
    alert._id = data.id;
  }
  if (data.title !== undefined) {
    alert.title = data.title;
  }
  if (data.alertNumber !== undefined) {
    alert.alertNumber = data.alertNumber;
  }
  if (data.alertNumberWithPrefix !== undefined) {
    alert.alertNumberWithPrefix = data.alertNumberWithPrefix;
  }
  return alert;
};

describe("the incident alert link helpers", () => {
  beforeEach(() => {
    getListMock.mockReset();
    createMock.mockReset();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("option labels", () => {
    test("label an incident with its number when it has one", () => {
      expect(
        getIncidentOptionLabel(
          makeIncident({
            title: "Down",
            incidentNumber: 3,
            incidentNumberWithPrefix: "INC-3",
          }),
        ),
      ).toBe("INC-3: Down");
      expect(
        getIncidentOptionLabel(
          makeIncident({ title: "Down", incidentNumber: 3 }),
        ),
      ).toBe("#3: Down");
      expect(getIncidentOptionLabel(makeIncident({ title: "Down" }))).toBe(
        "Down",
      );
      expect(getIncidentOptionLabel(makeIncident({ incidentNumber: 3 }))).toBe(
        "#3",
      );
      expect(getIncidentOptionLabel(makeIncident({}))).toBe("");
    });

    test("label an alert with its number when it has one", () => {
      expect(
        getAlertOptionLabel(
          makeAlert({
            title: "Checkout API is offline",
            alertNumber: 63,
            alertNumberWithPrefix: "ALT-63",
          }),
        ),
      ).toBe("ALT-63: Checkout API is offline");
      expect(
        getAlertOptionLabel(
          makeAlert({ title: "Checkout API is offline", alertNumber: 63 }),
        ),
      ).toBe("#63: Checkout API is offline");
      expect(getAlertOptionLabel(makeAlert({ title: "Offline" }))).toBe(
        "Offline",
      );
      expect(getAlertOptionLabel(makeAlert({ alertNumber: 63 }))).toBe("#63");
    });

    /*
     * The reason the labels exist: a monitor that goes offline three times
     * raises three alerts with the same title.
     */
    test("tell same-titled alerts apart", () => {
      const labels: Array<string> = [41, 57, 63].map(
        (alertNumber: number): string => {
          return getAlertOptionLabel(
            makeAlert({
              title: "Checkout API is offline",
              alertNumber: alertNumber,
            }),
          );
        },
      );

      expect(new Set(labels).size).toBe(3);
    });
  });

  describe("option lists", () => {
    test("list recent incidents newest first, by number", async () => {
      getListMock.mockResolvedValue(
        listResult([
          makeIncident({
            id: "44444444-4444-4444-8444-000000000002",
            title: "Database is down",
            incidentNumber: 42,
            incidentNumberWithPrefix: "INC-42",
          }),
          makeIncident({ title: "No id, so not selectable" }),
          makeIncident({
            id: "44444444-4444-4444-8444-000000000001",
            title: "Checkout errors",
            incidentNumber: 41,
          }),
        ]),
      );

      const options: Array<DropdownOption> = await fetchIncidentLinkOptions();
      const request: any = getListMock.mock.calls[0]![0];

      expect(request.modelType).toBe(Incident);
      expect(request.query).toEqual({});
      expect(request.limit).toBe(LINK_OPTIONS_LIMIT);
      expect(request.skip).toBe(0);
      expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
      expect(request.select).toEqual({
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      });
      expect(options).toEqual([
        {
          label: "INC-42: Database is down",
          value: "44444444-4444-4444-8444-000000000002",
        },
        {
          label: "#41: Checkout errors",
          value: "44444444-4444-4444-8444-000000000001",
        },
      ]);
    });

    test("list recent alerts newest first, by number", async () => {
      getListMock.mockResolvedValue(
        listResult([
          makeAlert({
            id: "22222222-2222-4222-8222-000000000063",
            title: "Checkout API is offline",
            alertNumber: 63,
            alertNumberWithPrefix: "ALT-63",
          }),
          makeAlert({
            id: "22222222-2222-4222-8222-000000000057",
            title: "Checkout API is offline",
            alertNumber: 57,
          }),
        ]),
      );

      const options: Array<DropdownOption> = await fetchAlertLinkOptions();
      const request: any = getListMock.mock.calls[0]![0];

      expect(request.modelType).toBe(Alert);
      expect(request.limit).toBe(LINK_OPTIONS_LIMIT);
      expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
      expect(request.select).toEqual({
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
      });
      expect(options).toEqual([
        {
          label: "ALT-63: Checkout API is offline",
          value: "22222222-2222-4222-8222-000000000063",
        },
        {
          label: "#57: Checkout API is offline",
          value: "22222222-2222-4222-8222-000000000057",
        },
      ]);
    });

    test("pass a failed read on to the caller", async () => {
      getListMock.mockImplementation(async (): Promise<never> => {
        throw new Error("Forbidden");
      });

      await expect(fetchAlertLinkOptions()).rejects.toThrow("Forbidden");
    });
  });

  describe("creating a link", () => {
    test("creates one IncidentAlert in the current project", async () => {
      createMock.mockResolvedValue({});

      await createIncidentAlertLink({
        incidentId: new ObjectID(INCIDENT_ID),
        alertId: new ObjectID(ALERT_ID),
      });

      expect(createMock).toHaveBeenCalledTimes(1);

      const request: any = createMock.mock.calls[0]![0];
      const link: IncidentAlert = request.model;

      expect(request.modelType).toBe(IncidentAlert);
      expect(link).toBeInstanceOf(IncidentAlert);
      expect(link.incidentId?.toString()).toBe(INCIDENT_ID);
      expect(link.alertId?.toString()).toBe(ALERT_ID);
      expect(link.projectId?.toString()).toBe(PROJECT_ID);
    });

    test("leaves the project to the server when none is selected", async () => {
      jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
      createMock.mockResolvedValue({});

      await createIncidentAlertLink({
        incidentId: new ObjectID(INCIDENT_ID),
        alertId: new ObjectID(ALERT_ID),
      });

      expect(
        (createMock.mock.calls[0]![0] as any).model.projectId,
      ).toBeUndefined();
    });

    test("passes a refusal on to the caller", async () => {
      createMock.mockImplementation(async (): Promise<never> => {
        throw new Error(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE);
      });

      await expect(
        createIncidentAlertLink({
          incidentId: new ObjectID(INCIDENT_ID),
          alertId: new ObjectID(ALERT_ID),
        }),
      ).rejects.toThrow(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE);
    });
  });

  describe("recognising a duplicate link", () => {
    test("matches the server's already-linked message", () => {
      expect(isAlreadyLinkedError(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE)).toBe(
        true,
      );
      expect(
        isAlreadyLinkedError(
          `  ${INCIDENT_ALERT_ALREADY_LINKED_MESSAGE.toUpperCase()}  `,
        ),
      ).toBe(true);
    });

    // The model's own unique-together message is the same constant.
    test("matches what the model says about a duplicate", () => {
      const message: string = new IncidentAlert().getUniqueColumnsTogether()[0]!
        .errorMessage;

      expect(isAlreadyLinkedError(message)).toBe(true);
    });

    /*
     * Two requests that race past the model's check are caught by the unique
     * index, whose translated message is worded differently.
     */
    test("matches the unique index's own wording", () => {
      expect(
        isAlreadyLinkedError(
          "A Incident Alert with the same Incident Id, Alert Id, Project Id already exists. Please use different values and try again.",
        ),
      ).toBe(true);
    });

    test("does not match other failures", () => {
      expect(isAlreadyLinkedError("")).toBe(false);
      expect(
        isAlreadyLinkedError(
          "The incident to link does not exist in this project, or you do not have access to it.",
        ),
      ).toBe(false);
      expect(
        isAlreadyLinkedError(
          "A Monitor with this Name already exists. Please use a different value and try again.",
        ),
      ).toBe(false);
      expect(isAlreadyLinkedError("Alert already linked")).toBe(false);
    });
  });

  describe("locking a link button", () => {
    const BUTTON: CardButtonSchema = {
      title: "Link Alert",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Link,
      onClick: (): void => {},
    };

    test("leaves an allowed button alone", () => {
      expect(lockUnlessAllowed(BUTTON, { isAllowed: true })).toBe(BUTTON);
    });

    test("locks it, saying why, for a known missing permission", () => {
      const onClick: MockFunction = getJestMockFunction();
      const locked: CardButtonSchema | null = lockUnlessAllowed(
        { ...BUTTON, onClick: onClick as unknown as () => void },
        {
          isAllowed: false,
          disabledReason: "You do not have permission to read this Alert.",
        },
      );

      expect(locked?.disabled).toBe(true);
      expect(locked?.tooltip).toBe(
        "You do not have permission to read this Alert.",
      );

      locked!.onClick();

      expect(onClick).not.toHaveBeenCalled();
    });

    test("leaves it alone when the answer is not known", () => {
      expect(lockUnlessAllowed(BUTTON, { isAllowed: false })).toBe(BUTTON);
    });

    test("keeps the reason a locked button already has, and a hidden one hidden", () => {
      const alreadyLocked: CardButtonSchema = {
        ...BUTTON,
        disabled: true,
        tooltip: "You do not have permission to create this Incident Alert.",
      };

      expect(
        lockUnlessAllowed(alreadyLocked, {
          isAllowed: false,
          disabledReason: "You do not have permission to read this Alert.",
        }),
      ).toBe(alreadyLocked);
      expect(
        lockUnlessAllowed(null, {
          isAllowed: false,
          disabledReason: "You do not have permission to read this Alert.",
        }),
      ).toBeNull();
    });
  });
});
