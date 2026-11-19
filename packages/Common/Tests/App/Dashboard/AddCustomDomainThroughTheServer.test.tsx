import {
  afterAll,
  afterEach,
  beforeAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import * as React from "react";

/*
 * ADD CUSTOM DOMAIN, ANSWERED BY THE SERVER ITSELF (#9997).
 *
 * Typing status.customer.com into a status page's Add Custom Domain, on a
 * project that did not have customer.com yet, answered "Domain must be a
 * string or an instance of Domain." The dialog adds the missing domain to
 * the project, sending it as the Dashboard sends every Domain - its JSON -
 * and the server's create hook took only text or the server's own subclass
 * of Domain, which the API never reads JSON back as. Every Add Custom
 * Domain on a new domain failed, for every kind, from 14.0.109 on.
 *
 * Its suite (AddCustomDomainModal.test.tsx) replaces ModelAPI.create, so
 * the domain it checks is the model the dialog built, never what the server
 * made of it: it passed. Here the dialog runs against the server. Nothing
 * on the Dashboard's side is replaced but the socket: its API client sends
 * every request over HTTP to the server's own routes - DomainAPI and the
 * kind's custom domain API, Express's body parser, the permission layer,
 * the services' hooks and the error handler (DashboardRequestsOverHttp) -
 * with the tables held in memory. Only what lies outside the server is
 * stood in for: DNS, as a zone the test adds the records the dialog shows
 * to, as a customer would at their DNS provider; and Let's Encrypt, as the
 * order of the certificate.
 *
 * For a status page's, a dashboard's and a form's custom domain:
 *
 *   - on a domain the project does not have, the dialog adds it to the
 *     project and shows its records: the TXT record with the text the
 *     server chose, the CNAME record for the address. Once they are
 *     added, one Check now verifies the domain, adds the custom domain,
 *     verifies its CNAME and orders its certificate;
 *   - on a domain the project has verified, the custom domain is added at
 *     once, and no domain is added;
 *   - on a domain the project has not verified yet, no domain is added,
 *     and the dialog shows that domain's own TXT record.
 */

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

// What each kind's CNAME record points to, as the Dashboard shows it.
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  const targets: Record<string, string> = {
    StatusPageCNameRecord: "statuspage.example.net",
    DashboardCNameRecord: "dashboards.example.net",
    FormCNameRecord: "statuspage.example.net",
  };

  for (const [name, target] of Object.entries(targets)) {
    Object.defineProperty(mocked, name, {
      get: (): string => {
        return target;
      },
    });
  }

  Object.defineProperty(mocked, "CUSTOM_DOMAIN_FREE_CERTIFICATES", {
    get: (): boolean => {
      return true;
    },
  });

  // OneUptime Cloud, as the server the issue was found on: no readiness to read.
  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return true;
    },
  });

  return mocked;
});

// And as the server checks it: the same targets.
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    StatusPageCNameRecord: "statuspage.example.net",
    DashboardCNameRecord: "dashboards.example.net",
    FormCNameRecord: "statuspage.example.net",
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import AddCustomDomainModal from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/AddCustomDomainModal";
import {
  CUSTOM_DOMAIN_VERIFIED_NEXT,
  CustomDomainCopy,
  DNS_SETUP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  CustomDomainKind,
  CustomDomainModel,
  DASHBOARD_CUSTOM_DOMAINS,
  FORM_CUSTOM_DOMAINS,
  STATUS_PAGE_CUSTOM_DOMAINS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import CommonAPI from "../../../Server/API/CommonAPI";
import DashboardDomainAPI from "../../../Server/API/DashboardDomainAPI";
import DomainAPI from "../../../Server/API/DomainAPI";
import FormDomainAPI from "../../../Server/API/FormDomainAPI";
import StatusPageDomainAPI from "../../../Server/API/StatusPageDomainAPI";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DomainService from "../../../Server/Services/DomainService";
import FormDomainService from "../../../Server/Services/FormDomainService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import CustomDomainDnsCheck from "../../../Server/Utils/CustomDomain/CustomDomainDnsCheck";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../../Types/CustomDomain/CustomDomainVerification";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "../../../Types/CustomDomain/DnsRecordCheck";
import DomainType from "../../../Types/Domain";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";

const PROJECT_ID: ObjectID = new ObjectID(
  "99970000-0000-4000-8000-0000000000a1",
);
const PARENT_ID: ObjectID = new ObjectID(
  "99970000-0000-4000-8000-0000000000b1",
);
const EXISTING_DOMAIN_ID: string = "99970000-0000-4000-8000-0000000000c1";
const EXISTING_VERIFICATION_TEXT: string =
  "oneuptime-verification-existing00000000";

// Each test of the whole flow makes a dozen requests through the server.
const FLOW_TIMEOUT_IN_MS: number = 60000;
const WAIT: { timeout: number } = { timeout: 15000 };

// What the page holds a figure to its word with ("15 minutes", #8770).
const NO_BREAK_SPACES: RegExp = /\u00a0/g;

interface CustomDomainService {
  orderCertOnceCnameIsVerified: (
    domain: BaseModel,
  ) => Promise<CustomDomainVerificationResult>;
}

interface KindCase {
  name: string;
  kind: CustomDomainKind;
  service: DatabaseService<BaseModel>;
  // The address field's placeholder: how the test finds the field.
  placeholder: string;
  // What the CNAME record must point to, on the Dashboard and the server.
  cnameTarget: string;
  // The kind's API path, from /api on.
  apiPath: string;
}

const KINDS: Array<KindCase> = [
  {
    name: "a status page's",
    kind: STATUS_PAGE_CUSTOM_DOMAINS,
    service: StatusPageDomainService as unknown as DatabaseService<BaseModel>,
    placeholder: "status.example.com",
    cnameTarget: "statuspage.example.net",
    apiPath: "/api/status-page-domain",
  },
  {
    name: "a dashboard's",
    kind: DASHBOARD_CUSTOM_DOMAINS,
    service: DashboardDomainService as unknown as DatabaseService<BaseModel>,
    placeholder: "dashboard.example.com",
    cnameTarget: "dashboards.example.net",
    apiPath: "/api/dashboard-domain",
  },
  {
    name: "a form's",
    kind: FORM_CUSTOM_DOMAINS,
    service: FormDomainService as unknown as DatabaseService<BaseModel>,
    placeholder: "report.example.com",
    cnameTarget: "statuspage.example.net",
    apiPath: "/api/form-domain",
  },
];

/*
 * The customer's DNS zone: the records they have added at their DNS
 * provider, by name. The server's lookups read it (CustomDomainDnsCheck).
 */
const zone: {
  txt: Map<string, Array<string>>;
  cname: Map<string, string>;
} = {
  txt: new Map<string, Array<string>>(),
  cname: new Map<string, string>(),
};

let server: DashboardRequestsOverHttp;
let domains: InMemoryTable;
let customDomains: Map<CustomDomainService, InMemoryTable>;
let certificateOrders: Array<BaseModel>;
let caller: DatabaseCommonInteractionProps;

interface Rendered {
  onClose: Mock<() => void>;
  onAdded: Mock<(domain: CustomDomainModel) => void>;
  onChanged: Mock<() => void>;
}

function renderDialog(kindCase: KindCase): Rendered {
  const onClose: Mock<() => void> = jest.fn();
  const onAdded: Mock<(domain: CustomDomainModel) => void> = jest.fn();
  const onChanged: Mock<() => void> = jest.fn();

  render(
    <AddCustomDomainModal
      kind={kindCase.kind}
      parentId={PARENT_ID}
      projectId={PROJECT_ID}
      onClose={onClose as never}
      onAdded={onAdded as never}
      onChanged={onChanged as never}
    />,
  );

  return { onClose, onAdded, onChanged };
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function addAddress(kindCase: KindCase, address: string): Promise<void> {
  const input: HTMLElement = within(dialog()).getByPlaceholderText(
    kindCase.placeholder,
  );

  await act(async (): Promise<void> => {
    fireEvent.change(input, { target: { value: address } });
  });

  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", {
        name: CustomDomainCopy.addSubmit,
      }),
    );
  });
}

async function checkNow(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", {
        name: CustomDomainCopy.dnsSetupCheckNow,
      }),
    );
  });
}

function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

// The record DNS Setup shows, as the customer copies it to their DNS provider.
function addShownRecordsToTheZone(): void {
  if (screen.queryByTestId(DNS_SETUP_TEST_IDS.txtRecord)) {
    zone.txt.set(textOf(DNS_SETUP_TEST_IDS.txtRecordName), [
      textOf(DNS_SETUP_TEST_IDS.txtRecordValue),
    ]);
  }

  zone.cname.set(
    textOf(DNS_SETUP_TEST_IDS.recordName),
    textOf(DNS_SETUP_TEST_IDS.recordValue),
  );
}

function storedName(value: unknown): string | null {
  return DomainType.getNameFrom(value);
}

function domainsAddedThroughTheApi(): Array<SentRequest> {
  return server.sentTo("POST", "/api/domain");
}

// Let's Encrypt: the order the server places once the CNAME is found.
async function orderCertificate(
  domain: BaseModel,
): Promise<CustomDomainVerificationResult> {
  certificateOrders.push(domain);

  return {
    certificateStatus: CustomDomainCertificateStatus.Issuing,
  };
}

// The DNS lookups of the server, answered from the zone.
function stubDns(): void {
  jest
    .spyOn(CustomDomainDnsCheck, "checkTxt")
    .mockImplementation((async (data: {
      domain: string;
      expectedValue: string;
    }): Promise<DnsRecordCheck> => {
      const name: string = data.domain.toLowerCase();
      const found: Array<string> = zone.txt.get(name) || [];

      return {
        type: DnsRecordType.TXT,
        name: name,
        expectedValue: data.expectedValue,
        foundValues: found,
        outcome: found.includes(data.expectedValue)
          ? DnsRecordCheckOutcome.Found
          : found.length > 0
            ? DnsRecordCheckOutcome.WrongValue
            : DnsRecordCheckOutcome.NotFound,
        checkedAt: new Date(),
      };
    }) as never);

  jest
    .spyOn(CustomDomainDnsCheck, "checkCname")
    .mockImplementation((async (data: {
      fullDomain: string;
      expectedTarget: string;
    }): Promise<DnsRecordCheck> => {
      const name: string = data.fullDomain.toLowerCase();
      const found: string | undefined = zone.cname.get(name);

      return {
        type: DnsRecordType.CNAME,
        name: name,
        expectedValue: data.expectedTarget,
        foundValues: found ? [found] : [],
        outcome:
          found === data.expectedTarget
            ? DnsRecordCheckOutcome.Found
            : found
              ? DnsRecordCheckOutcome.WrongValue
              : DnsRecordCheckOutcome.NotFound,
        checkedAt: new Date(),
      };
    }) as never);
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new DomainAPI().getRouter(),
    new StatusPageDomainAPI().getRouter(),
    new DashboardDomainAPI().getRouter(),
    new FormDomainAPI().getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  zone.txt.clear();
  zone.cname.clear();
  certificateOrders = [];

  // The person adding the domain: a Project Admin, on both sides.
  caller = {
    ...customDomainCaller({
      permissions: [Permission.ProjectAdmin],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  PermissionGate.clearPermissionPropsCache();
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  stubProjectDirectory({});
  stubDns();

  domains = useInMemoryTable(DomainService, []);

  // Every kind's table: a custom domain's name is looked up in all three.
  customDomains = new Map<CustomDomainService, InMemoryTable>();

  for (const kindCase of KINDS) {
    const service: CustomDomainService =
      kindCase.service as unknown as CustomDomainService;

    customDomains.set(service, useInMemoryTable(kindCase.service, []));

    jest
      .spyOn(service, "orderCertOnceCnameIsVerified")
      .mockImplementation(orderCertificate);
  }
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "Add Custom Domain, on $name page, through the server",
  (kindCase: KindCase) => {
    function customDomainTable(): InMemoryTable {
      return customDomains.get(
        kindCase.service as unknown as CustomDomainService,
      )!;
    }

    test(
      "on a domain the project does not have: adds it, shows its records, and one Check now verifies it, adds the custom domain and orders its certificate",
      async () => {
        const rendered: Rendered = renderDialog(kindCase);

        await addAddress(kindCase, "Status.Customer.com");

        // 1. The domain is added to the project, as the Dashboard sends it.
        await waitFor(() => {
          expect(domainsAddedThroughTheApi()).toHaveLength(1);
        }, WAIT);

        const added: SentRequest = domainsAddedThroughTheApi()[0]!;
        expect(
          ((added.body as JSONObject)["data"] as JSONObject)["domain"],
        ).toEqual({ _type: "Domain", value: "customer.com" });

        // Answered with the domain - not "Domain must be a string or an instance of Domain."
        expect({ status: added.status, answer: added.answer }).toEqual({
          status: 200,
          answer: expect.objectContaining({
            domain: { _type: "Domain", value: "customer.com" },
          }),
        });

        await waitFor(() => {
          expect(
            screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord),
          ).toBeInTheDocument();
        }, WAIT);

        expect(domains.inserts).toHaveLength(1);
        const domainRow: StoredRow = domains.rows[0]!;
        expect(storedName(domainRow["domain"])).toBe("customer.com");
        expect(String(domainRow["projectId"])).toBe(PROJECT_ID.toString());
        expect(domainRow["isVerified"]).toBeFalsy();

        // 2. DNS Setup shows both records: the TXT with the server's text.
        expect(textOf(DNS_SETUP_TEST_IDS.txtRecordType)).toBe("TXT");
        expect(textOf(DNS_SETUP_TEST_IDS.txtRecordName)).toBe("customer.com");
        expect(textOf(DNS_SETUP_TEST_IDS.txtRecordValue)).toBe(
          String(domainRow["domainVerificationText"]),
        );
        expect(textOf(DNS_SETUP_TEST_IDS.recordType)).toBe("CNAME");
        expect(textOf(DNS_SETUP_TEST_IDS.recordName)).toBe(
          "status.customer.com",
        );
        expect(textOf(DNS_SETUP_TEST_IDS.recordValue)).toBe(
          kindCase.cnameTarget,
        );

        // Nothing else is added before the TXT record is found.
        expect(customDomainTable().inserts).toHaveLength(0);
        expect(rendered.onAdded).not.toHaveBeenCalled();

        // 3. The customer adds both records, and checks once.
        addShownRecordsToTheZone();

        await checkNow();

        await waitFor(() => {
          expect(
            screen.getByTestId(DNS_SETUP_TEST_IDS.verified),
          ).toBeInTheDocument();
        }, WAIT);

        // The domain is verified, by its TXT record.
        expect(domains.get(String(domainRow["_id"]))!["isVerified"]).toBe(true);

        // The custom domain is added on it, under the address typed.
        expect(customDomainTable().inserts).toHaveLength(1);
        const customDomain: StoredRow = customDomainTable().rows[0]!;
        expect(customDomain["fullDomain"]).toBe("status.customer.com");
        expect(customDomain["subdomain"]).toBe("status");
        expect(String(customDomain["domainId"])).toBe(String(domainRow["_id"]));
        expect(String(customDomain[kindCase.kind.parentColumn])).toBe(
          PARENT_ID.toString(),
        );
        expect(String(customDomain["projectId"])).toBe(PROJECT_ID.toString());

        // Its CNAME is verified, and its certificate ordered.
        expect(
          customDomainTable().get(String(customDomain["_id"]))![
            "isCnameVerified"
          ],
        ).toBe(true);
        expect(certificateOrders).toHaveLength(1);
        expect(
          (certificateOrders[0] as unknown as Record<string, unknown>)[
            "fullDomain"
          ],
        ).toBe("status.customer.com");
        // As the page draws it: "15 minutes" held together by a no-break space (#8770).
        expect(
          (dialog().textContent || "").replace(NO_BREAK_SPACES, " "),
        ).toContain(
          CUSTOM_DOMAIN_VERIFIED_NEXT[
            CustomDomainCertificateStatus.Issuing
          ].replace("{{domain}}", "status.customer.com"),
        );
        expect(rendered.onChanged).toHaveBeenCalled();

        // Every request the dialog made was answered.
        expect(
          server.requests
            .filter((request: SentRequest): boolean => {
              return request.status >= 400;
            })
            .map((request: SentRequest): string => {
              return `${request.method} ${request.path}: ${request.status} ${JSON.stringify(request.answer)}`;
            }),
        ).toEqual([]);
        expect(
          server.sentTo(
            "GET",
            `/api/domain/check-txt/${String(domainRow["_id"])}`,
          ),
        ).toHaveLength(1);
        expect(
          server.sentTo(
            "GET",
            `${kindCase.apiPath}/check-dns/${String(customDomain["_id"])}`,
          ),
        ).toHaveLength(1);
      },
      FLOW_TIMEOUT_IN_MS,
    );

    test(
      "on a domain the project has verified: adds the custom domain at once, and no domain",
      async () => {
        domains.rows.push({
          _id: EXISTING_DOMAIN_ID,
          projectId: PROJECT_ID.toString(),
          domain: new DomainType("customer.com"),
          slug: "customer-com",
          isVerified: true,
          domainVerificationText: EXISTING_VERIFICATION_TEXT,
        });

        const rendered: Rendered = renderDialog(kindCase);

        await addAddress(kindCase, "status.customer.com");

        await waitFor(() => {
          expect(rendered.onAdded).toHaveBeenCalledTimes(1);
        }, WAIT);

        expect(domainsAddedThroughTheApi()).toHaveLength(0);
        expect(domains.inserts).toHaveLength(0);

        expect(customDomainTable().inserts).toHaveLength(1);
        const customDomain: StoredRow = customDomainTable().rows[0]!;
        expect(customDomain["fullDomain"]).toBe("status.customer.com");
        expect(String(customDomain["domainId"])).toBe(EXISTING_DOMAIN_ID);
        expect(String(customDomain[kindCase.kind.parentColumn])).toBe(
          PARENT_ID.toString(),
        );

        // What the table's DNS Setup opens on: the custom domain added.
        const added: CustomDomainModel = rendered.onAdded.mock.calls[0]![0];
        expect(added.fullDomain).toBe("status.customer.com");
        expect(added.id?.toString()).toBe(String(customDomain["_id"]));
        expect(rendered.onChanged).toHaveBeenCalled();
      },
      FLOW_TIMEOUT_IN_MS,
    );

    test(
      "on a domain the project has not verified yet: adds no domain, and shows that domain's own TXT record",
      async () => {
        domains.rows.push({
          _id: EXISTING_DOMAIN_ID,
          projectId: PROJECT_ID.toString(),
          domain: new DomainType("customer.com"),
          slug: "customer-com",
          isVerified: false,
          domainVerificationText: EXISTING_VERIFICATION_TEXT,
        });

        const rendered: Rendered = renderDialog(kindCase);

        await addAddress(kindCase, "status.customer.com");

        await waitFor(() => {
          expect(
            screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord),
          ).toBeInTheDocument();
        }, WAIT);

        expect(domainsAddedThroughTheApi()).toHaveLength(0);
        expect(domains.inserts).toHaveLength(0);
        expect(textOf(DNS_SETUP_TEST_IDS.txtRecordName)).toBe("customer.com");
        expect(textOf(DNS_SETUP_TEST_IDS.txtRecordValue)).toBe(
          EXISTING_VERIFICATION_TEXT,
        );
        expect(textOf(DNS_SETUP_TEST_IDS.recordName)).toBe(
          "status.customer.com",
        );
        expect(customDomainTable().inserts).toHaveLength(0);
        expect(rendered.onAdded).not.toHaveBeenCalled();

        // And Check now, with the records added, finishes it the same way.
        addShownRecordsToTheZone();

        await checkNow();

        await waitFor(() => {
          expect(
            screen.getByTestId(DNS_SETUP_TEST_IDS.verified),
          ).toBeInTheDocument();
        }, WAIT);

        expect(domains.get(EXISTING_DOMAIN_ID)!["isVerified"]).toBe(true);
        expect(customDomainTable().inserts).toHaveLength(1);
        expect(customDomainTable().rows[0]!["fullDomain"]).toBe(
          "status.customer.com",
        );
        expect(certificateOrders).toHaveLength(1);
      },
      FLOW_TIMEOUT_IN_MS,
    );
  },
);
