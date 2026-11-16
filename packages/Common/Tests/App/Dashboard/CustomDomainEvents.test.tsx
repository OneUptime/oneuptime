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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * The product events of putting a status page, a dashboard or a form on its
 * own domain (#7024): Add Custom Domain opened, the address's domain added
 * to the project, each DNS record Check now looked up, the domain verified,
 * and a self-hosted server that is not ready for custom domains yet.
 *
 * Held here:
 *
 *   - what each event carries, record by record and outcome by outcome,
 *     and that the catalog lists all of it, so nothing is dropped on the
 *     way out (toProductEventProperties);
 *   - that no event carries a domain, an address, a record's value or the
 *     server's CNAME target - the funnel says where people stop, never
 *     whose domain it was;
 *   - that the real dialogs send them, in the order a person meets them,
 *     numbered by the Check now they came from, through the one path that
 *     holds an event back without consent (UiAnalytics.capture);
 *   - that a server only warning, or OneUptime Cloud, sends no
 *     server_not_ready, and a notice sends it once however often it draws.
 *
 * Only the network is replaced (API, ModelAPI); the dialogs are the real
 * BasicFormModal and DNS Setup.
 */

let mockCnameRecord: string = "statuspage.oneuptime.com";
let mockBillingEnabled: boolean = true;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  const cnameRecord: PropertyDescriptor = {
    get: (): string => {
      return mockCnameRecord;
    },
  };

  Object.defineProperty(mocked, "StatusPageCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "DashboardCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "FormCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "CUSTOM_DOMAIN_FREE_CERTIFICATES", {
    get: (): boolean => {
      return true;
    },
  });
  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

type ApiGetCall = { url: { toString: () => string } };

let mockApiAnswers: Record<string, Array<unknown>> = {};

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (call: ApiGetCall): Promise<unknown> => {
        const url: string = call.url.toString();

        for (const route of Object.keys(mockApiAnswers)) {
          if (url.includes(route)) {
            const queue: Array<unknown> = mockApiAnswers[route]!;
            return queue.length > 1 ? queue.shift() : queue[0];
          }
        }

        return {
          isFailure: (): boolean => {
            return true;
          },
          message: `unmodelled ${url}`,
        };
      },
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import AddCustomDomainModal from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/AddCustomDomainModal";
import CustomDomainDnsSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainDnsSetupModal";
import CustomDomainEvents, {
  getCustomDomainEventKind,
  toCustomDomainEventToken,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainEvents";
import { CustomDomainCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  CustomDomainKind,
  DASHBOARD_CUSTOM_DOMAINS,
  FORM_CUSTOM_DOMAINS,
  STATUS_PAGE_CUSTOM_DOMAINS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Permission from "../../../Types/Permission";
import ObjectID from "../../../Types/ObjectID";
import DomainType from "../../../Types/Domain";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Domain from "../../../Models/DatabaseModels/Domain";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DnsRecordCheckJSON, {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "../../../Types/CustomDomain/DnsRecordCheck";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";
import {
  CustomDomainReadinessCheckId,
  CustomDomainReadinessOutcome,
  CustomDomainServerReadinessResult,
} from "../../../Types/CustomDomain/CustomDomainServerReadiness";
import {
  ProductEventName,
  getProductEventDefinition,
  isForbiddenPropertyName,
  toProductEventProperties,
} from "../../../Types/Analytics/ProductEvent";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const PARENT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000001",
);
const PROJECT_DOMAIN_ID: string = "40000000-0000-4000-8000-000000000001";
const CUSTOM_DOMAIN_ID: string = "50000000-0000-4000-8000-000000000001";

// What no event may carry: the domain, the address, the record's values.
const PRIVATE_WORDS: Array<string> = [
  "acme",
  "status.acme.com",
  "oneuptime-verification",
  "statuspage.oneuptime.com",
  "proxy.example.net",
  "104.21.0.1",
];

interface SentEvent {
  name: ProductEventName;
  properties: JSONObject;
}

let sent: Array<SentEvent> = [];
let unsubscribe: () => void = (): void => {};

function eventsNamed(name: ProductEventName): Array<JSONObject> {
  return sent
    .filter((event: SentEvent): boolean => {
      return event.name === name;
    })
    .map((event: SentEvent): JSONObject => {
      return event.properties;
    });
}

function eventNames(): Array<string> {
  return sent.map((event: SentEvent): string => {
    return event.name;
  });
}

function ok(body: JSONObject): unknown {
  return {
    isFailure: (): boolean => {
      return false;
    },
    data: body,
  };
}

function check(
  type: DnsRecordType,
  outcome: DnsRecordCheckOutcome,
  extra?: Partial<DnsRecordCheck>,
): DnsRecordCheck {
  return {
    type,
    name: type === DnsRecordType.TXT ? "acme.com" : "status.acme.com",
    expectedValue:
      type === DnsRecordType.TXT
        ? "oneuptime-verification-abc"
        : mockCnameRecord,
    foundValues: [],
    outcome,
    checkedAt: new Date("2026-11-16T10:00:00.000Z"),
    ...extra,
  };
}

function checkResult(
  record: DnsRecordCheck,
  isVerified: boolean,
  certificateStatus?: CustomDomainCertificateStatus,
): unknown {
  return ok({
    isVerified,
    records: [DnsRecordCheckJSON.toJSON(record)],
    ...(certificateStatus ? { certificate: { certificateStatus } } : {}),
  });
}

function projectDomain(isVerified: boolean, name: string = "acme.com"): Domain {
  const domain: Domain = new Domain();
  domain._id = PROJECT_DOMAIN_ID;
  domain.domain = new DomainType(name);
  domain.isVerified = isVerified;
  domain.domainVerificationText = "oneuptime-verification-abc";
  return domain;
}

let projectDomains: Array<Domain>;

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function clickButton(name: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByRole("button", { name }));
  });
  await settle();
  await settle();
}

function renderAdd(kind: CustomDomainKind): void {
  render(
    <AddCustomDomainModal
      kind={kind}
      parentId={PARENT_ID}
      projectId={PROJECT_ID}
      onClose={() => {}}
      onAdded={() => {}}
      onChanged={() => {}}
    />,
  );
}

async function addAddress(address: string, placeholder: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(within(dialog()).getByPlaceholderText(placeholder), {
      target: { value: address },
    });
  });
  await clickButton(CustomDomainCopy.addSubmit);
}

const NOT_READY: JSONObject = {
  target: "oneuptime.acme.com",
  checks: [
    {
      id: CustomDomainReadinessCheckId.TargetSet,
      outcome: CustomDomainReadinessOutcome.Pass,
      values: { target: "oneuptime.acme.com" },
    },
    {
      id: CustomDomainReadinessCheckId.TargetResolves,
      outcome: CustomDomainReadinessOutcome.Pass,
      values: { target: "oneuptime.acme.com", addresses: "10.0.0.5" },
    },
    {
      id: CustomDomainReadinessCheckId.Port80,
      outcome: CustomDomainReadinessOutcome.Fail,
      reason: "NoAnswer",
      values: { target: "oneuptime.acme.com" },
    },
    {
      id: CustomDomainReadinessCheckId.Port443,
      outcome: CustomDomainReadinessOutcome.Fail,
      values: { target: "oneuptime.acme.com" },
    },
    {
      id: CustomDomainReadinessCheckId.FreeCertificates,
      outcome: CustomDomainReadinessOutcome.Warn,
      values: {},
    },
  ],
};

const ONLY_WARNS: JSONObject = {
  target: "oneuptime.acme.com",
  checks: [
    {
      id: CustomDomainReadinessCheckId.TargetSet,
      outcome: CustomDomainReadinessOutcome.Pass,
      values: { target: "oneuptime.acme.com" },
    },
    {
      id: CustomDomainReadinessCheckId.FreeCertificates,
      outcome: CustomDomainReadinessOutcome.Warn,
      values: {},
    },
  ],
};

beforeEach(() => {
  mockCnameRecord = "statuspage.oneuptime.com";
  mockBillingEnabled = true;
  mockApiAnswers = {};
  projectDomains = [];
  sent = [];

  unsubscribe = ProductEvents.subscribe(
    (name: ProductEventName, properties: JSONObject): void => {
      sent.push({ name, properties });
    },
  );

  PermissionGate.clearPermissionPropsCache();
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({} as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return {
      data: projectDomains,
      count: projectDomains.length,
      skip: 0,
      limit: 100,
    };
  }) as never);

  jest.spyOn(ModelAPI, "create").mockImplementation((async (data: {
    model: BaseModel;
  }) => {
    if (data.model instanceof Domain) {
      projectDomains.push(
        projectDomain(false, data.model.domain?.toString() || ""),
      );
      return new HTTPResponse(200, { _id: PROJECT_DOMAIN_ID }, {});
    }

    return new HTTPResponse(
      200,
      {
        _id: CUSTOM_DOMAIN_ID,
        subdomain: "status",
        fullDomain: "status.acme.com",
      },
      {},
    );
  }) as never);
});

afterEach(() => {
  unsubscribe();
  cleanup();
  jest.restoreAllMocks();
});

describe("CustomDomainEvents: what each event carries", () => {
  test("each kind of custom domain is named as the events name it", () => {
    expect(getCustomDomainEventKind(STATUS_PAGE_CUSTOM_DOMAINS)).toBe(
      "status_page",
    );
    expect(getCustomDomainEventKind(DASHBOARD_CUSTOM_DOMAINS)).toBe(
      "dashboard",
    );
    expect(getCustomDomainEventKind(FORM_CUSTOM_DOMAINS)).toBe("form");
  });

  test("an outcome, a certificate status and a readiness check read as lower-case words", () => {
    expect(toCustomDomainEventToken(DnsRecordCheckOutcome.WrongValue)).toBe(
      "wrong_value",
    );
    expect(toCustomDomainEventToken(DnsRecordCheckOutcome.NameNotFound)).toBe(
      "name_not_found",
    );
    expect(toCustomDomainEventToken(DnsRecordCheckOutcome.LookupFailed)).toBe(
      "lookup_failed",
    );
    expect(toCustomDomainEventToken(DnsRecordCheckOutcome.Found)).toBe("found");
    expect(
      toCustomDomainEventToken(CustomDomainCertificateStatus.Issuing),
    ).toBe("issuing");
    expect(
      toCustomDomainEventToken(CustomDomainReadinessCheckId.TargetResolves),
    ).toBe("target_resolves");
    expect(toCustomDomainEventToken(CustomDomainReadinessCheckId.Port80)).toBe(
      "port80",
    );
  });

  test("Add Custom Domain opened, and the project's domain added, name only the kind", () => {
    CustomDomainEvents.addStarted(DASHBOARD_CUSTOM_DOMAINS);
    CustomDomainEvents.projectDomainAdded(FORM_CUSTOM_DOMAINS);

    expect(sent).toEqual([
      {
        name: ProductEventName.CustomDomainAddStarted,
        properties: { kind: "dashboard" },
      },
      {
        name: ProductEventName.CustomDomainProjectDomainAdded,
        properties: { kind: "form" },
      },
    ]);
  });

  test("a TXT record's check: which record, what it found and which Check now, nothing about a CNAME", () => {
    CustomDomainEvents.recordChecked({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      check: check(DnsRecordType.TXT, DnsRecordCheckOutcome.WrongValue, {
        foundValues: ["v=spf1 -all"],
      }),
      checkNumber: 3,
    });

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "status_page",
        record: "txt",
        outcome: "wrong_value",
        check_number: 3,
      },
    ]);
  });

  test("a CNAME a proxy hides is said as proxied (#1664)", () => {
    CustomDomainEvents.recordChecked({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      check: check(DnsRecordType.CNAME, DnsRecordCheckOutcome.NotFound, {
        addresses: ["104.21.0.1"],
        reachedOneUptime: false,
      }),
      checkNumber: 1,
    });

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "status_page",
        record: "cname",
        outcome: "not_found",
        check_number: 1,
        is_proxied: true,
        reached_one_uptime: false,
      },
    ]);
  });

  test("a right CNAME whose request a proxy answers says what answered it (#1521)", () => {
    CustomDomainEvents.recordChecked({
      kind: DASHBOARD_CUSTOM_DOMAINS,
      check: check(DnsRecordType.CNAME, DnsRecordCheckOutcome.Found, {
        foundValues: [mockCnameRecord],
        reachedOneUptime: false,
        httpStatus: 404,
      }),
      checkNumber: 2,
    });

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "dashboard",
        record: "cname",
        outcome: "found",
        check_number: 2,
        is_proxied: false,
        reached_one_uptime: false,
        http_status: 404,
      },
    ]);
  });

  test("a CNAME that reached OneUptime carries no HTTP status, whatever came before it", () => {
    CustomDomainEvents.recordChecked({
      kind: FORM_CUSTOM_DOMAINS,
      check: check(DnsRecordType.CNAME, DnsRecordCheckOutcome.Found, {
        reachedOneUptime: true,
        httpStatus: 301,
      }),
      checkNumber: 1,
    });

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "form",
        record: "cname",
        outcome: "found",
        check_number: 1,
        is_proxied: false,
        reached_one_uptime: true,
      },
    ]);
  });

  test("a CNAME not looked up yet - it waits for the TXT - and no check at all send nothing", () => {
    CustomDomainEvents.recordChecked({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      check: check(DnsRecordType.CNAME, DnsRecordCheckOutcome.NotCheckedYet),
      checkNumber: 1,
    });
    CustomDomainEvents.recordChecked({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      check: undefined,
      checkNumber: 1,
    });

    expect(sent).toEqual([]);
  });

  test("verified: what the certificate does next, how many records and which Check now", () => {
    CustomDomainEvents.verified({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      certificateStatus: CustomDomainCertificateStatus.Uploaded,
      recordCount: 2,
      checkNumber: 4,
    });

    expect(eventsNamed(ProductEventName.CustomDomainVerified)).toEqual([
      {
        kind: "status_page",
        certificate_status: "uploaded",
        record_count: 2,
        check_number: 4,
      },
    ]);
  });

  test("a server that is not ready names the checks that failed, never its target or a warning", () => {
    CustomDomainEvents.serverNotReady({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      source: "add",
      readiness: {
        target: "oneuptime.acme.com",
        checks: (NOT_READY["checks"] as Array<JSONObject>).map(
          (item: JSONObject) => {
            return item as never;
          },
        ),
      },
    });

    expect(eventsNamed(ProductEventName.CustomDomainServerNotReady)).toEqual([
      {
        kind: "status_page",
        source: "add",
        failed_checks: "port80.port443",
        failed_count: 2,
      },
    ]);
  });

  test("a server that only warns - no Let's Encrypt key - serves custom domains, and sends nothing", () => {
    const readiness: CustomDomainServerReadinessResult = {
      target: "oneuptime.acme.com",
      checks: (ONLY_WARNS["checks"] as Array<JSONObject>).map(
        (item: JSONObject) => {
          return item as never;
        },
      ),
    };

    CustomDomainEvents.serverNotReady({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      source: "dns_setup",
      readiness,
    });

    expect(sent).toEqual([]);
  });

  test("every property an event is sent with is in the catalog, so nothing is dropped on the way out", () => {
    CustomDomainEvents.addStarted(STATUS_PAGE_CUSTOM_DOMAINS);
    CustomDomainEvents.projectDomainAdded(STATUS_PAGE_CUSTOM_DOMAINS);
    CustomDomainEvents.recordChecked({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      check: check(DnsRecordType.CNAME, DnsRecordCheckOutcome.Found, {
        reachedOneUptime: false,
        httpStatus: 404,
      }),
      checkNumber: 1,
    });
    CustomDomainEvents.verified({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      certificateStatus: CustomDomainCertificateStatus.Failed,
      recordCount: 1,
      checkNumber: 1,
    });
    CustomDomainEvents.serverNotReady({
      kind: STATUS_PAGE_CUSTOM_DOMAINS,
      source: "dns_setup",
      readiness: {
        target: "oneuptime.acme.com",
        checks: (NOT_READY["checks"] as Array<JSONObject>).map(
          (item: JSONObject) => {
            return item as never;
          },
        ),
      },
    });

    expect(sent).toHaveLength(5);

    for (const event of sent) {
      expect(getProductEventDefinition(event.name)).not.toBeNull();

      // What the listener got is what the catalog lets out: compare both.
      expect(
        toProductEventProperties({
          name: event.name,
          properties: event.properties,
          isCloud: false,
        }),
      ).toEqual(event.properties);

      for (const property of Object.keys(event.properties)) {
        expect([property, isForbiddenPropertyName(property)]).toEqual([
          property,
          false,
        ]);
      }
    }
  });
});

describe("the dialogs send them, in the order a person meets them", () => {
  test("a domain the project does not have: opened, domain added, TXT not found, then TXT and CNAME found, verified", async () => {
    mockApiAnswers = {
      "/domain/check-txt/": [
        checkResult(
          check(DnsRecordType.TXT, DnsRecordCheckOutcome.NotFound),
          false,
        ),
        checkResult(
          check(DnsRecordType.TXT, DnsRecordCheckOutcome.Found, {
            foundValues: ["oneuptime-verification-abc"],
          }),
          true,
        ),
      ],
      "/status-page-domain/check-dns/": [
        checkResult(
          check(DnsRecordType.CNAME, DnsRecordCheckOutcome.Found, {
            foundValues: [mockCnameRecord],
            reachedOneUptime: true,
          }),
          true,
          CustomDomainCertificateStatus.Issuing,
        ),
      ],
    };

    renderAdd(STATUS_PAGE_CUSTOM_DOMAINS);

    expect(eventNames()).toEqual([ProductEventName.CustomDomainAddStarted]);

    await addAddress("status.acme.com", "status.example.com");

    expect(eventNames()).toEqual([
      ProductEventName.CustomDomainAddStarted,
      ProductEventName.CustomDomainProjectDomainAdded,
    ]);

    // DNS Setup with both records: the first Check now finds no TXT.
    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "status_page",
        record: "txt",
        outcome: "not_found",
        check_number: 1,
      },
    ]);

    // The second finds it, adds the domain and checks its CNAME.
    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(eventNames()).toEqual([
      ProductEventName.CustomDomainAddStarted,
      ProductEventName.CustomDomainProjectDomainAdded,
      ProductEventName.CustomDomainRecordChecked,
      ProductEventName.CustomDomainRecordChecked,
      ProductEventName.CustomDomainRecordChecked,
      ProductEventName.CustomDomainVerified,
    ]);

    expect(
      eventsNamed(ProductEventName.CustomDomainRecordChecked).slice(1),
    ).toEqual([
      {
        kind: "status_page",
        record: "txt",
        outcome: "found",
        check_number: 2,
      },
      {
        kind: "status_page",
        record: "cname",
        outcome: "found",
        check_number: 2,
        is_proxied: false,
        reached_one_uptime: true,
      },
    ]);

    expect(eventsNamed(ProductEventName.CustomDomainVerified)).toEqual([
      {
        kind: "status_page",
        certificate_status: "issuing",
        record_count: 2,
        check_number: 2,
      },
    ]);
  });

  test("a domain the project has but has not verified: no domain added, the TXT's check is the first", async () => {
    projectDomains = [projectDomain(false)];
    mockApiAnswers = {
      "/domain/check-txt/": [
        checkResult(
          check(DnsRecordType.TXT, DnsRecordCheckOutcome.WrongValue, {
            foundValues: ["v=spf1 -all"],
          }),
          false,
        ),
      ],
    };

    renderAdd(DASHBOARD_CUSTOM_DOMAINS);
    await addAddress("dash.acme.com", "dashboard.example.com");
    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(eventNames()).toEqual([
      ProductEventName.CustomDomainAddStarted,
      ProductEventName.CustomDomainRecordChecked,
    ]);
    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "dashboard",
        record: "txt",
        outcome: "wrong_value",
        check_number: 1,
      },
    ]);
  });

  test("DNS Setup on a domain already added: its CNAME's checks, then one record to verify", async () => {
    mockApiAnswers = {
      "/form-domain/check-dns/": [
        checkResult(
          check(DnsRecordType.CNAME, DnsRecordCheckOutcome.WrongValue, {
            foundValues: ["proxy.example.net"],
          }),
          false,
        ),
        checkResult(
          check(DnsRecordType.CNAME, DnsRecordCheckOutcome.Found, {
            foundValues: [mockCnameRecord],
          }),
          true,
          CustomDomainCertificateStatus.Issued,
        ),
      ],
    };

    render(
      <CustomDomainDnsSetupModal
        kind={FORM_CUSTOM_DOMAINS}
        domain={{
          id: new ObjectID(CUSTOM_DOMAIN_ID),
          fullDomain: "report.acme.com",
          subdomain: "report",
          isCustomCertificate: false,
          isCnameVerified: false,
        }}
        checkNowGate={{ isAllowed: true }}
        onClose={() => {}}
        onVerified={() => {}}
      />,
    );

    await clickButton(CustomDomainCopy.dnsSetupCheckNow);
    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "form",
        record: "cname",
        outcome: "wrong_value",
        check_number: 1,
        is_proxied: false,
      },
      {
        kind: "form",
        record: "cname",
        outcome: "found",
        check_number: 2,
        is_proxied: false,
      },
    ]);
    expect(eventsNamed(ProductEventName.CustomDomainVerified)).toEqual([
      {
        kind: "form",
        certificate_status: "issued",
        record_count: 1,
        check_number: 2,
      },
    ]);
  });

  test("a Check now that fails sends no record's outcome, and the next one counts on", async () => {
    let calls: number = 0;

    mockApiAnswers = {
      "/status-page-domain/check-dns/": [
        {
          isFailure: (): boolean => {
            calls++;
            return true;
          },
          message: "OneUptime could not be reached.",
        },
        checkResult(
          check(DnsRecordType.CNAME, DnsRecordCheckOutcome.NotFound),
          false,
        ),
      ],
    };

    render(
      <CustomDomainDnsSetupModal
        kind={STATUS_PAGE_CUSTOM_DOMAINS}
        domain={{
          id: new ObjectID(CUSTOM_DOMAIN_ID),
          fullDomain: "status.acme.com",
          subdomain: "status",
        }}
        checkNowGate={{ isAllowed: true }}
        onClose={() => {}}
        onVerified={() => {}}
      />,
    );

    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(calls).toBe(1);
    expect(sent).toEqual([]);

    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(eventsNamed(ProductEventName.CustomDomainRecordChecked)).toEqual([
      {
        kind: "status_page",
        record: "cname",
        outcome: "not_found",
        check_number: 2,
        is_proxied: false,
      },
    ]);
  });

  test("Check now locked for somebody who may not edit the domain sends nothing", async () => {
    render(
      <CustomDomainDnsSetupModal
        kind={STATUS_PAGE_CUSTOM_DOMAINS}
        domain={{
          id: new ObjectID(CUSTOM_DOMAIN_ID),
          fullDomain: "status.acme.com",
          subdomain: "status",
        }}
        checkNowGate={{
          isAllowed: false,
          disabledReason: "You need the Edit Status Page Domain permission.",
        }}
        onClose={() => {}}
        onVerified={() => {}}
      />,
    );

    const button: HTMLElement = within(dialog()).getByRole("button", {
      name: CustomDomainCopy.dnsSetupCheckNow,
    });

    await act(async (): Promise<void> => {
      fireEvent.click(button);
    });
    await settle();

    expect(sent).toEqual([]);
  });

  test("no event carries the domain, the address, a record's value or the server's CNAME target", async () => {
    mockApiAnswers = {
      "/domain/check-txt/": [
        checkResult(
          check(DnsRecordType.TXT, DnsRecordCheckOutcome.Found, {
            foundValues: ["oneuptime-verification-abc"],
          }),
          true,
        ),
      ],
      "/status-page-domain/check-dns/": [
        checkResult(
          check(DnsRecordType.CNAME, DnsRecordCheckOutcome.NotFound, {
            addresses: ["104.21.0.1"],
            foundValues: ["proxy.example.net"],
          }),
          false,
        ),
      ],
    };

    renderAdd(STATUS_PAGE_CUSTOM_DOMAINS);
    await addAddress("status.acme.com", "status.example.com");
    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(sent.length).toBeGreaterThanOrEqual(4);

    const everything: string = JSON.stringify(sent).toLowerCase();

    for (const word of PRIVATE_WORDS) {
      expect([word, everything.includes(word.toLowerCase())]).toEqual([
        word,
        false,
      ]);
    }
  });

  test("they go out through UiAnalytics.capture, which holds an event back without consent", async () => {
    const capture: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UiAnalytics, "capture")
      .mockImplementation((): void => {});

    renderAdd(FORM_CUSTOM_DOMAINS);

    expect(capture).toHaveBeenCalledWith(
      ProductEventName.CustomDomainAddStarted,
      expect.objectContaining({ kind: "form" }),
    );
  });
});

describe("custom_domain/server_not_ready", () => {
  test("a self-hosted server that is not ready says so once from Add Custom Domain, naming the checks that failed", async () => {
    mockBillingEnabled = false;
    mockApiAnswers = {
      "/status-page-domain/server-readiness": [ok(NOT_READY)],
    };

    renderAdd(STATUS_PAGE_CUSTOM_DOMAINS);
    await settle();
    await settle();

    // Drawn again (a keystroke): still one event.
    await act(async (): Promise<void> => {
      fireEvent.change(
        within(dialog()).getByPlaceholderText("status.example.com"),
        { target: { value: "status.acme.com" } },
      );
    });
    await settle();

    expect(eventsNamed(ProductEventName.CustomDomainServerNotReady)).toEqual([
      {
        kind: "status_page",
        source: "add",
        failed_checks: "port80.port443",
        failed_count: 2,
      },
    ]);
  });

  test("DNS Setup says where it was shown", async () => {
    mockBillingEnabled = false;
    mockApiAnswers = {
      "/dashboard-domain/server-readiness": [ok(NOT_READY)],
    };

    render(
      <CustomDomainDnsSetupModal
        kind={DASHBOARD_CUSTOM_DOMAINS}
        domain={{
          id: new ObjectID(CUSTOM_DOMAIN_ID),
          fullDomain: "dash.acme.com",
          subdomain: "dash",
        }}
        checkNowGate={{ isAllowed: true }}
        onClose={() => {}}
        onVerified={() => {}}
      />,
    );
    await settle();
    await settle();

    expect(eventsNamed(ProductEventName.CustomDomainServerNotReady)).toEqual([
      {
        kind: "dashboard",
        source: "dns_setup",
        failed_checks: "port80.port443",
        failed_count: 2,
      },
    ]);
  });

  test("a server that only warns sends nothing, though its notice is shown", async () => {
    mockBillingEnabled = false;
    mockApiAnswers = {
      "/status-page-domain/server-readiness": [ok(ONLY_WARNS)],
    };

    renderAdd(STATUS_PAGE_CUSTOM_DOMAINS);
    await settle();
    await settle();

    expect(
      within(dialog()).getByTestId("custom-domain-server-readiness"),
    ).toBeInTheDocument();
    expect(eventsNamed(ProductEventName.CustomDomainServerNotReady)).toEqual(
      [],
    );
  });

  test("OneUptime Cloud reads no readiness, and sends none", async () => {
    mockBillingEnabled = true;
    mockApiAnswers = {
      "/status-page-domain/server-readiness": [ok(NOT_READY)],
    };

    renderAdd(STATUS_PAGE_CUSTOM_DOMAINS);
    await settle();
    await settle();

    expect(eventsNamed(ProductEventName.CustomDomainServerNotReady)).toEqual(
      [],
    );
  });
});
