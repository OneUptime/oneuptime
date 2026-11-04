import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { OpenStackAuditAttribute } from "../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { ChangeEventAttribute } from "../../../Utils/Telemetry/ChangeEventFields";
import { OpenStackWhoChangedThis } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartFeed";
import { getOpenStackPartRoutes } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartRoutes";
import { OpenStackPart } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/UseOpenStackPart";

/*
 * Who Changed This, on a part's page: who did what around the moment its state last changed.
 * Over a stand-in for the network, because what matters is what it asks for:
 *
 *   - a part's audit events by the part's own id, which is what an API call's path says. Real
 *     clouds' events say "unknown" for their target, so asking by target finds nothing;
 *   - only around that moment, and only when there is one;
 *   - a notification's actor when there is no audit filter, and nothing at all when nobody
 *     said anything: a cloud without an audit trail has no card that says nothing.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(120000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
        i18n: { language: "en", changeLanguage: async (): Promise<void> => {} },
      };
    },
    initReactI18next: { type: "3rdParty", init: (): void => {} },
    Trans: ({ children }: { children: React.ReactNode }): React.ReactNode => {
      return children;
    },
  };
});

const INSTANCE: string = "bcee0abb-08c3-430a-9a53-cce3284714eb";
const CLOUD: string = "prod-eu";
const CHANGED_AT: Date = new Date("2026-11-04T21:38:42.000Z");

interface Asked {
  model: string;
  attributes: JSONObject;
  from: Date;
  to: Date;
  limit: number;
}

let asked: Array<Asked> = [];
let auditEvents: Array<JSONObject> = [];
let changeEvents: Array<JSONObject> = [];
let auditFails: boolean = false;

function part(kind: OpenStackResourceKind = OpenStackResourceKind.Instance): {
  part: OpenStackPart;
  row: OpenStackResource;
} {
  const row: OpenStackResource = new OpenStackResource();
  row.kind = kind;
  row.externalId = INSTANCE;
  row.name = "web-1";
  row.status = "SHUTOFF";
  row.stateChangedAt = CHANGED_AT;

  const cloudId: ObjectID = ObjectID.generate();

  return {
    row,
    part: {
      kind,
      openStackCloudId: cloudId,
      externalId: INSTANCE,
      routes: getOpenStackPartRoutes(cloudId),
      isLoadingCloud: false,
      cloudError: "",
      cloudName: CLOUD,
      row,
      isLoadingRow: false,
      rowError: "",
      refreshToken: 0,
      retry: (): void => {},
    },
  };
}

function audit(fields: {
  who: string;
  action: string;
  status?: string;
  at?: string;
}): JSONObject {
  return {
    _id: `${fields.who}-${fields.action}`,
    time: fields.at || "2026-11-04T21:38:42.000Z",
    message: `${fields.who} ${fields.action} on instance web-1`,
    principalUser: fields.who,
    statusName: fields.status || "Success",
    attributes: { [OpenStackAuditAttribute.Action]: fields.action },
  };
}

beforeEach(() => {
  asked = [];
  auditEvents = [];
  changeEvents = [];
  auditFails = false;

  jest
    .spyOn(PermissionGate, "check")
    .mockReturnValue({ isAllowed: true } as never);
  jest.spyOn(AnalyticsModelAPI, "getList").mockImplementation((async (options: {
    modelType: new () => SecurityEvent | ChangeEvent;
    query: { attributes: JSONObject; time: { startValue: Date; endValue: Date } };
    limit: number;
  }) => {
    const isAudit: boolean = options.modelType === SecurityEvent;

    asked.push({
      model: isAudit ? "SecurityEvent" : "ChangeEvent",
      attributes: options.query.attributes,
      from: options.query.time.startValue,
      to: options.query.time.endValue,
      limit: options.limit,
    });

    if (isAudit && auditFails) {
      throw new Error("The read failed");
    }

    const data: Array<JSONObject> = isAudit ? auditEvents : changeEvents;

    return { data, count: data.length, skip: 0, limit: options.limit };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Who Changed This", () => {
  test("names who did what, in words, reading by the part's own id", async () => {
    auditEvents = [audit({ who: "alice", action: "update/os-stop" })];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    const card: HTMLElement = await screen.findByTestId(
      "openstack-who-changed-this",
    );

    expect(card).toHaveTextContent("alice");
    expect(card).toHaveTextContent("stopped it");
    expect(screen.getByText("Who changed this")).toBeInTheDocument();
    expect(asked[0]?.model).toBe("SecurityEvent");
    expect(asked[0]?.attributes).toEqual({
      [OpenStackAuditAttribute.Cloud]: CLOUD,
      [OpenStackAuditAttribute.PartId]: INSTANCE,
    });
  });

  test("reads around the moment its state changed, and no further", async () => {
    auditEvents = [audit({ who: "alice", action: "delete" })];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    await screen.findByTestId("openstack-who-changed-this");

    expect(asked[0]?.from.getTime()).toBe(
      CHANGED_AT.getTime() - 15 * 60 * 1000,
    );
    expect(asked[0]?.to.getTime()).toBe(CHANGED_AT.getTime() + 5 * 60 * 1000);
    expect(asked[0]?.limit).toBe(10);
  });

  test.each([
    ["create", "created it"],
    ["update", "changed it"],
    ["delete", "deleted it"],
    ["update/os-start", "started it"],
    ["update/reboot", "rebooted it"],
    ["update/os-migrateLive", "live migrated it"],
  ])("%s reads as %s", async (action: string, words: string) => {
    auditEvents = [audit({ who: "alice", action })];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    expect(
      await screen.findByTestId("openstack-who-changed-this"),
    ).toHaveTextContent(words);
  });

  test("an action it has no words for is written as the audit filter wrote it", async () => {
    auditEvents = [audit({ who: "alice", action: "update/os-somethingNew" })];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    const card: HTMLElement = await screen.findByTestId(
      "openstack-who-changed-this",
    );

    expect(card).toHaveTextContent("os-somethingNew");
    expect(card).not.toHaveTextContent("update/");
  });

  test("something refused says it failed", async () => {
    auditEvents = [
      audit({
        who: "mallory",
        action: "update/os-migrateLive",
        status: "Failure",
      }),
    ];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    expect(
      await screen.findByTestId("openstack-who-changed-this"),
    ).toHaveTextContent("Failed");
  });

  test("a read refused changed nothing, so it is not an answer", async () => {
    auditEvents = [
      audit({ who: "mallory", action: "read/list", status: "Failure" }),
      audit({ who: "alice", action: "update/reboot" }),
    ];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    const card: HTMLElement = await screen.findByTestId(
      "openstack-who-changed-this",
    );

    expect(card).toHaveTextContent("alice");
    expect(card).not.toHaveTextContent("mallory");
  });

  test("with no audit filter, a notification's own actor still says who", async () => {
    changeEvents = [
      {
        _id: "change-1",
        time: "2026-11-04T21:38:42.000Z",
        title: "Instance stopped",
        attributes: { [ChangeEventAttribute.CloudActor]: "alice" },
      },
    ];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    const card: HTMLElement = await screen.findByTestId(
      "openstack-who-changed-this",
    );

    expect(card).toHaveTextContent("alice");
    expect(card).toHaveTextContent("Instance stopped");
    expect(
      asked.map((one: Asked): string => {
        return one.model;
      }),
    ).toEqual(["SecurityEvent", "ChangeEvent"]);
  });

  test("a notification that names nobody is no answer", async () => {
    changeEvents = [
      {
        _id: "change-1",
        time: "2026-11-04T21:38:42.000Z",
        title: "Instance stopped",
        attributes: {},
      },
    ];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    const { container } = render(
      <OpenStackWhoChangedThis part={given.part} row={given.row} />,
    );

    await waitFor(() => {
      expect(asked).toHaveLength(2);
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("with nobody to name, there is no card at all", async () => {
    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    const { container } = render(
      <OpenStackWhoChangedThis part={given.part} row={given.row} />,
    );

    await waitFor(() => {
      expect(asked).toHaveLength(2);
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("with no moment to read around, nothing is read", () => {
    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    delete given.row.stateChangedAt;

    const { container } = render(
      <OpenStackWhoChangedThis part={given.part} row={given.row} />,
    );

    expect(asked).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });

  test("a read that fails leaves the page as it was", async () => {
    auditFails = true;

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    const { container } = render(
      <OpenStackWhoChangedThis part={given.part} row={given.row} />,
    );

    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("a role that may not read security events still gets a notification's actor", async () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false } as never);
    changeEvents = [
      {
        _id: "change-1",
        time: "2026-11-04T21:38:42.000Z",
        title: "Instance stopped",
        attributes: { [ChangeEventAttribute.CloudActor]: "alice" },
      },
    ];

    const given: { part: OpenStackPart; row: OpenStackResource } = part();

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    await screen.findByTestId("openstack-who-changed-this");

    expect(
      asked.map((one: Asked): string => {
        return one.model;
      }),
    ).toEqual(["ChangeEvent"]);
  });

  test("a kind no audit event can name reads only its notifications", async () => {
    const given: { part: OpenStackPart; row: OpenStackResource } = part(
      OpenStackResourceKind.Hypervisor,
    );

    given.row.hypervisorName = "compute-01.example.internal";

    render(<OpenStackWhoChangedThis part={given.part} row={given.row} />);

    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });

    expect(asked[0]?.model).toBe("ChangeEvent");
    expect(asked[0]?.attributes["openstack.host"]).toBe("compute-01");
  });
});
