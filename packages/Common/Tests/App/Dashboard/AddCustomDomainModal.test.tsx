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
  waitFor,
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import * as React from "react";

/*
 * Add Custom Domain, for a status page, a dashboard and a form: from the
 * page to a verified domain without leaving it.
 *
 * It used to ask for a subdomain and one of the project's VERIFIED domains,
 * with a link that opened Project Settings in a new tab to add and verify
 * one. Now it asks for the address people will open, and:
 *
 *   - on a domain the project has verified, adds the custom domain at once
 *     (the table then opens its DNS Setup, as before);
 *   - on one it has not, or one it does not have, adds the domain to the
 *     project and becomes DNS Setup with both records - the domain's TXT,
 *     the address's CNAME - each with its own status. One Check now checks
 *     the TXT, adds the custom domain the moment it is found, and checks the
 *     CNAME; each record says what was looked up and what came back;
 *   - who may add a project domain, and who may verify one, is asked
 *     before, not refused after;
 *   - on a self-hosted server, what the server still needs is said first.
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

const mockApiGetCalls: Array<string> = [];
let mockApiAnswers: Record<string, Array<unknown>> = {};

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (call: ApiGetCall): Promise<unknown> => {
        const url: string = call.url.toString();
        mockApiGetCalls.push(url);

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
import {
  ADD_CUSTOM_DOMAIN_TEST_IDS,
  CustomDomainCopy,
  DNS_SETUP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import { CustomDomainAddressCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainAddress";
import {
  CustomDomainKind,
  CustomDomainModel,
  DASHBOARD_CUSTOM_DOMAINS,
  FORM_CUSTOM_DOMAINS,
  STATUS_PAGE_CUSTOM_DOMAINS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import Permission from "../../../Types/Permission";
import ObjectID from "../../../Types/ObjectID";
import DomainType from "../../../Types/Domain";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Domain from "../../../Models/DatabaseModels/Domain";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "../../../Types/CustomDomain/DnsRecordCheck";
import DnsRecordCheckJSON from "../../../Types/CustomDomain/DnsRecordCheck";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";
import {
  CustomDomainReadinessCheckId,
  CustomDomainReadinessOutcome,
  CustomDomainReadinessWords,
} from "../../../Types/CustomDomain/CustomDomainServerReadiness";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const PARENT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000001",
);
const PROJECT_DOMAIN_ID: string = "40000000-0000-4000-8000-000000000001";
const CUSTOM_DOMAIN_ID: string = "50000000-0000-4000-8000-000000000001";

interface KindCase {
  name: string;
  kind: CustomDomainKind;
  placeholder: string;
  crudApiPath: string;
}

const KINDS: Array<KindCase> = [
  {
    name: "a status page's",
    kind: STATUS_PAGE_CUSTOM_DOMAINS,
    placeholder: "status.example.com",
    crudApiPath: "/status-page-domain/",
  },
  {
    name: "a dashboard's",
    kind: DASHBOARD_CUSTOM_DOMAINS,
    placeholder: "dashboard.example.com",
    crudApiPath: "/dashboard-domain/",
  },
  {
    name: "a form's",
    kind: FORM_CUSTOM_DOMAINS,
    placeholder: "report.example.com",
    crudApiPath: "/form-domain/",
  },
];

function ok(body: JSONObject): unknown {
  return {
    isFailure: (): boolean => {
      return false;
    },
    data: body,
  };
}

function failed(message: string): unknown {
  return {
    isFailure: (): boolean => {
      return true;
    },
    message,
  };
}

function record(
  type: DnsRecordType,
  outcome: DnsRecordCheckOutcome,
  extra?: Partial<DnsRecordCheck>,
): JSONObject {
  return DnsRecordCheckJSON.toJSON({
    type,
    name: type === DnsRecordType.TXT ? "acme.com" : "status.acme.com",
    expectedValue:
      type === DnsRecordType.TXT ? "oneuptime-verification-abc" : mockCnameRecord,
    foundValues: [],
    outcome,
    checkedAt: new Date("2026-11-11T10:00:00.000Z"),
    ...extra,
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
let getList: jest.SpiedFunction<typeof ModelAPI.getList>;
let create: jest.SpiedFunction<typeof ModelAPI.create>;
let createdModels: Array<BaseModel>;
let permissions: Array<Permission>;

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

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function typeAddress(kindCase: KindCase, address: string): Promise<void> {
  const input: HTMLElement = within(dialog()).getByPlaceholderText(
    kindCase.placeholder,
  );

  await act(async (): Promise<void> => {
    fireEvent.change(input, { target: { value: address } });
  });
}

async function clickButton(name: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByRole("button", { name }));
  });
  await settle();
  await settle();
}

async function addAddress(kindCase: KindCase, address: string): Promise<void> {
  await typeAddress(kindCase, address);
  await clickButton(CustomDomainCopy.addSubmit);
}

function createdOf<T extends BaseModel>(type: { new (): T }): Array<T> {
  return createdModels.filter((model: BaseModel) => {
    return model instanceof type;
  }) as Array<T>;
}

beforeEach(() => {
  mockCnameRecord = "statuspage.oneuptime.com";
  mockBillingEnabled = true;
  mockApiGetCalls.length = 0;
  mockApiAnswers = {};
  projectDomains = [];
  createdModels = [];
  permissions = [Permission.ProjectAdmin];

  PermissionGate.clearPermissionPropsCache();
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockImplementation((): Array<Permission> => {
      return permissions;
    });

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({} as never);

  getList = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return {
      data: projectDomains,
      count: projectDomains.length,
      skip: 0,
      limit: 100,
    };
  }) as never);

  create = jest.spyOn(ModelAPI, "create").mockImplementation((async (data: {
    model: BaseModel;
  }) => {
    createdModels.push(data.model);

    if (data.model instanceof Domain) {
      projectDomains.push(
        projectDomain(false, data.model.domain?.toString() || ""),
      );
      return new HTTPResponse(200, { _id: PROJECT_DOMAIN_ID }, {});
    }

    const row: Record<string, unknown> = data.model as unknown as Record<
      string,
      unknown
    >;

    return new HTTPResponse(
      200,
      {
        _id: CUSTOM_DOMAIN_ID,
        subdomain: row["subdomain"] as string,
        fullDomain: `${row["subdomain"] as string}.acme.com`,
      },
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(KINDS)("Add Custom Domain, on $name page", (kindCase: KindCase) => {
  test("asks for one thing, the address, and says two records may follow", () => {
    renderDialog(kindCase);

    expect(within(dialog()).getByText(CustomDomainCopy.addTitle)).toBeTruthy();
    expect(
      within(dialog()).getByPlaceholderText(kindCase.placeholder),
    ).toBeTruthy();
    expect(dialog().textContent).toContain(
      CustomDomainCopy.addAddressDescription,
    );
    // No subdomain, no list of domains to pick from.
    expect(within(dialog()).queryByText("Subdomain")).toBeNull();
    expect(within(dialog()).queryByText("Select domain")).toBeNull();
  });

  test("an address that is not one is refused, and nothing is read or added", async () => {
    renderDialog(kindCase);

    await addAddress(kindCase, "not a domain");

    await waitFor(() => {
      expect(dialog().textContent).toContain(
        CustomDomainAddressCopy.invalidAddress,
      );
    });
    expect(getList).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("on a domain the project has verified, the custom domain is added at once", async () => {
    projectDomains = [projectDomain(true)];

    const rendered: Rendered = renderDialog(kindCase);

    await addAddress(kindCase, "https://Status.Acme.com/");

    await waitFor(() => {
      expect(rendered.onAdded).toHaveBeenCalledTimes(1);
    });

    expect(createdOf(Domain)).toHaveLength(0);

    const created: Record<string, unknown> = createdModels[0] as unknown as Record<
      string,
      unknown
    >;

    expect(createdModels[0]).toBeInstanceOf(kindCase.kind.modelType);
    expect(created["subdomain"]).toBe("status");
    expect((created["domainId"] as ObjectID).toString()).toBe(
      PROJECT_DOMAIN_ID,
    );
    expect((created["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(
      (created[kindCase.kind.parentColumn] as ObjectID).toString(),
    ).toBe(PARENT_ID.toString());
    expect(created["isCustomCertificate"]).toBe(false);

    const added: CustomDomainModel = rendered.onAdded.mock.calls[0]![0];
    expect(added.fullDomain).toBe("status.acme.com");
    expect(rendered.onChanged).toHaveBeenCalled();
    // No TXT to check: the domain is verified.
    expect(mockApiGetCalls.join(" ")).not.toContain("/domain/check-txt/");
  });

  test("the root of a verified domain is added with no subdomain", async () => {
    projectDomains = [projectDomain(true)];

    const rendered: Rendered = renderDialog(kindCase);

    await addAddress(kindCase, "acme.com");

    await waitFor(() => {
      expect(rendered.onAdded).toHaveBeenCalledTimes(1);
    });

    expect(
      (createdModels[0] as unknown as Record<string, unknown>)["subdomain"],
    ).toBe("");
  });

  test("on a domain not verified yet, it becomes DNS Setup with both records", async () => {
    projectDomains = [projectDomain(false)];

    renderDialog(kindCase);

    await addAddress(kindCase, "status.acme.com");

    await waitFor(() => {
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord)).toBeTruthy();
    });

    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecordType).textContent,
    ).toBe("TXT");
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecordName).textContent,
    ).toBe("acme.com");
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecordValue).textContent,
    ).toBe("oneuptime-verification-abc");
    expect(screen.getByTestId(DNS_SETUP_TEST_IDS.recordType).textContent).toBe(
      "CNAME",
    );
    expect(screen.getByTestId(DNS_SETUP_TEST_IDS.recordName).textContent).toBe(
      "status.acme.com",
    );
    expect(screen.getByTestId(DNS_SETUP_TEST_IDS.recordValue).textContent).toBe(
      mockCnameRecord,
    );

    // The TXT comes first, and nothing is added before it is found.
    const order: number = screen
      .getByTestId(DNS_SETUP_TEST_IDS.txtRecord)
      .compareDocumentPosition(screen.getByTestId(DNS_SETUP_TEST_IDS.record));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.whatHappensNext).textContent,
    ).toBe(CustomDomainCopy.dnsSetupWhatHappensNextTwoRecords);
  });

  test("one Check now: the TXT first, then the domain is added and its CNAME checked, each with its own status", async () => {
    projectDomains = [projectDomain(false)];

    const rendered: Rendered = renderDialog(kindCase);

    await addAddress(kindCase, "status.acme.com");

    await waitFor(() => {
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord)).toBeTruthy();
    });

    // 1. The TXT is not there yet: nothing is added, the CNAME waits.
    mockApiAnswers = {
      "/domain/check-txt/": [
        ok({
          isVerified: false,
          records: [record(DnsRecordType.TXT, DnsRecordCheckOutcome.NotFound)],
        }),
        ok({
          isVerified: true,
          records: [record(DnsRecordType.TXT, DnsRecordCheckOutcome.Found)],
        }),
      ],
      "/check-dns/": [
        ok({
          isVerified: false,
          records: [
            record(DnsRecordType.CNAME, DnsRecordCheckOutcome.WrongValue, {
              foundValues: ["other.example.net"],
            }),
          ],
        }),
        ok({
          isVerified: true,
          records: [
            record(DnsRecordType.CNAME, DnsRecordCheckOutcome.Found, {
              foundValues: [mockCnameRecord],
            }),
          ],
          certificate: {
            certificateStatus: CustomDomainCertificateStatus.Issuing,
          },
        }),
      ],
    };

    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.txtStatus).textContent,
    ).toBe("Not found yet");
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.txtLookedUp).textContent,
    ).toContain("We looked up the TXT records of acme.com and got nothing.");
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.cnameStatus).textContent,
    ).toBe("Not checked yet");
    expect(create).not.toHaveBeenCalled();
    expect(mockApiGetCalls.join(" ")).toContain(
      `/domain/check-txt/${PROJECT_DOMAIN_ID}`,
    );

    // 2. The TXT is found: the domain is added, and its CNAME checked.
    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    await waitFor(() => {
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.cnameStatus).textContent,
      ).toBe("Wrong value");
    });
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.txtStatus).textContent,
    ).toBe("Found");
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.cnameLookedUp).textContent,
    ).toContain(
      `We looked up the CNAME record of status.acme.com and got other.example.net, but expected ${mockCnameRecord}.`,
    );
    expect(createdOf(kindCase.kind.modelType)).toHaveLength(1);
    expect(rendered.onChanged).toHaveBeenCalled();
    expect(mockApiGetCalls.join(" ")).toContain(
      `${kindCase.crudApiPath}check-dns/${CUSTOM_DOMAIN_ID}`,
    );

    // 3. The CNAME is found: verified, the TXT not asked again, nothing re-added.
    const txtChecks: number = mockApiGetCalls.filter((url: string) => {
      return url.includes("/domain/check-txt/");
    }).length;

    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    await waitFor(() => {
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.verified)).toBeTruthy();
    });
    expect(
      mockApiGetCalls.filter((url: string) => {
        return url.includes("/domain/check-txt/");
      }),
    ).toHaveLength(txtChecks);
    expect(createdOf(kindCase.kind.modelType)).toHaveLength(1);
    expect(dialog().textContent).toContain(CustomDomainCopy.dnsSetupVerified);
  });

  test("a domain the project does not have is added to it, then DNS Setup shows its TXT", async () => {
    renderDialog(kindCase);

    await addAddress(kindCase, "status.acme.com");

    await waitFor(() => {
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord)).toBeTruthy();
    });

    const domains: Array<Domain> = createdOf(Domain);

    expect(domains).toHaveLength(1);
    expect(domains[0]!.domain?.toString()).toBe("acme.com");
    expect(domains[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createdOf(kindCase.kind.modelType)).toHaveLength(0);
  });

  test("somebody who may not add project domains is told who can, and nothing is added", async () => {
    permissions = [Permission.ProjectMember];

    renderDialog(kindCase);

    await addAddress(kindCase, "status.acme.com");

    await waitFor(() => {
      expect(dialog().textContent).toContain(
        "acme.com is not one of this project's domains yet, and only somebody who may add project domains can add it.",
      );
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("somebody who may not verify the domain sees both records, with Check now locked and why", async () => {
    permissions = [Permission.ProjectMember];
    projectDomains = [projectDomain(false)];

    renderDialog(kindCase);

    await addAddress(kindCase, "status.acme.com");

    await waitFor(() => {
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord)).toBeTruthy();
    });

    expect(
      within(dialog()).getByRole("button", { name: "Check now" }),
    ).toBeDisabled();
    const reason: string | undefined = PermissionGate.check(
      new Domain(),
      ModelAction.Update,
    ).disabledReason;

    expect(reason).toBeTruthy();
    expect(
      screen.getByTestId(DNS_SETUP_TEST_IDS.checkNowLocked).textContent,
    ).toBe(reason);
  });

  test("a refusal when the domain is added - a name already in use - is said in the dialog", async () => {
    projectDomains = [projectDomain(false)];

    renderDialog(kindCase);

    await addAddress(kindCase, "status.acme.com");

    await waitFor(() => {
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.txtRecord)).toBeTruthy();
    });

    create.mockRejectedValue(
      new Error(
        "status.acme.com is already in use: a domain can show only one status page, dashboard or form.",
      ) as never,
    );

    mockApiAnswers = {
      "/domain/check-txt/": [
        ok({
          isVerified: true,
          records: [record(DnsRecordType.TXT, DnsRecordCheckOutcome.Found)],
        }),
      ],
    };

    await clickButton(CustomDomainCopy.dnsSetupCheckNow);

    await waitFor(() => {
      expect(dialog().textContent).toContain(
        "status.acme.com is already in use",
      );
    });
  });

  test("a certificate to upload goes with the domain when it is added", async () => {
    projectDomains = [projectDomain(true)];

    const rendered: Rendered = renderDialog(kindCase);

    await typeAddress(kindCase, "status.acme.com");

    // Open More fields, switch the upload on, paste the two.
    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("More fields"));
    });
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("switch", {
          name: /Upload Custom Certificate/,
        }),
      );
    });

    await act(async (): Promise<void> => {
      fireEvent.change(
        within(dialog()).getByPlaceholderText(/BEGIN CERTIFICATE/),
        { target: { value: "CERT" } },
      );
      fireEvent.change(
        within(dialog()).getByPlaceholderText(/BEGIN PRIVATE KEY/),
        { target: { value: "KEY" } },
      );
    });

    await clickButton(CustomDomainCopy.addSubmit);

    await waitFor(() => {
      expect(rendered.onAdded).toHaveBeenCalledTimes(1);
    });

    const created: Record<string, unknown> = createdModels[0] as unknown as Record<
      string,
      unknown
    >;

    expect(created["isCustomCertificate"]).toBe(true);
    expect(created["customCertificate"]).toBe("CERT");
    expect(created["customCertificateKey"]).toBe("KEY");
  });
});

describe("what a self-hosted server still needs, said before anything is added", () => {
  test("a server that is not ready says what is missing, failures first", async () => {
    mockBillingEnabled = false;
    mockApiAnswers = {
      "/server-readiness": [
        ok({
          target: "oneuptime.acme.com",
          checks: [
            {
              id: CustomDomainReadinessCheckId.TargetSet,
              outcome: CustomDomainReadinessOutcome.Pass,
              values: {
                target: "oneuptime.acme.com",
                variable: "STATUS_PAGE_CNAME_RECORD",
              },
            },
            {
              id: CustomDomainReadinessCheckId.FreeCertificates,
              outcome: CustomDomainReadinessOutcome.Warn,
              values: {},
            },
            {
              id: CustomDomainReadinessCheckId.Port80,
              outcome: CustomDomainReadinessOutcome.Fail,
              reason: "NotThisServer",
              values: { target: "oneuptime.acme.com", status: "404" },
            },
          ],
        }),
      ],
    };

    renderDialog(KINDS[0]!);
    await settle();

    const notice: HTMLElement = await screen.findByTestId(
      ADD_CUSTOM_DOMAIN_TEST_IDS.readiness,
    );

    expect(notice.textContent).toContain(
      CustomDomainReadinessWords.notReadyTitle,
    );

    const lines: Array<HTMLElement> = within(notice).getAllByTestId(
      ADD_CUSTOM_DOMAIN_TEST_IDS.readinessCheck,
    );

    expect(
      lines.map((line: HTMLElement) => {
        return line.getAttribute("data-check");
      }),
    ).toEqual([
      CustomDomainReadinessCheckId.Port80,
      CustomDomainReadinessCheckId.FreeCertificates,
    ]);
    expect(lines[0]!.textContent).toBe(
      "oneuptime.acme.com answers on port 80, but not as this OneUptime server (HTTP 404). A proxy or load balancer at that address must pass requests for every hostname on to OneUptime.",
    );
    expect(notice.textContent).toContain(
      "We checked from this server. People outside your network must reach oneuptime.acme.com on the same ports.",
    );
    expect(mockApiGetCalls.join(" ")).toContain(
      "/status-page-domain/server-readiness",
    );
  });

  test("a server that only lacks free certificates warns, under a gentler title", async () => {
    mockBillingEnabled = false;
    mockApiAnswers = {
      "/server-readiness": [
        ok({
          target: "oneuptime.acme.com",
          checks: [
            {
              id: CustomDomainReadinessCheckId.FreeCertificates,
              outcome: CustomDomainReadinessOutcome.Warn,
              values: {},
            },
          ],
        }),
      ],
    };

    renderDialog(KINDS[0]!);

    const notice: HTMLElement = await screen.findByTestId(
      ADD_CUSTOM_DOMAIN_TEST_IDS.readiness,
    );

    expect(notice.textContent).toContain(
      CustomDomainReadinessWords.warningTitle,
    );
    expect(notice.textContent).not.toContain("We checked from this server");
  });

  test("a ready server, an unreadable answer, and OneUptime Cloud say nothing", async () => {
    mockBillingEnabled = false;
    mockApiAnswers = {
      "/server-readiness": [
        ok({
          target: "oneuptime.acme.com",
          checks: [
            {
              id: CustomDomainReadinessCheckId.Port80,
              outcome: CustomDomainReadinessOutcome.Pass,
              values: { target: "oneuptime.acme.com" },
            },
          ],
        }),
      ],
    };

    renderDialog(KINDS[0]!);
    await settle();
    expect(
      screen.queryByTestId(ADD_CUSTOM_DOMAIN_TEST_IDS.readiness),
    ).toBeNull();
    cleanup();

    mockApiAnswers = { "/server-readiness": [failed("offline")] };
    renderDialog(KINDS[0]!);
    await settle();
    expect(
      screen.queryByTestId(ADD_CUSTOM_DOMAIN_TEST_IDS.readiness),
    ).toBeNull();
    cleanup();

    mockBillingEnabled = true;
    mockApiGetCalls.length = 0;
    renderDialog(KINDS[0]!);
    await settle();
    expect(mockApiGetCalls).toEqual([]);
  });
});
