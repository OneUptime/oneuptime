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
 * DNS Setup: the dialog a custom domain - a status page's or a dashboard's -
 * opens when it is added, and from its DNS Setup row action until its record
 * is verified.
 *
 * It replaced "Add CNAME" (which added nothing - it showed the record, with a
 * Verify CNAME button) and "Order Free SSL" (an order the worker placed on
 * its own anyway). What it has to do, for both kinds:
 *
 *   - show the record the way DNS providers ask for it - type, name, value
 *     - each with a copy button;
 *   - Check now verifies the record at once, through the kind's own
 *     verify-cname;
 *   - a record that is not found keeps the dialog open with the reason;
 *   - a record that is found says what happens to the certificate next:
 *     issued within 15 minutes, already there, the uploaded one, or - when
 *     the order failed - why, and that it is tried again on its own.
 *
 * Only the network and the clipboard are replaced; the dialog is the real
 * Modal.
 */

let mockCnameRecord: string = "statuspage.oneuptime.com";

/*
 * Getters defined on the copy, not in an object literal: the compiled
 * spread copies a literal's getter once, as a value. Both kinds read the
 * same record here; one dialog is rendered at a time.
 */
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

  return mocked;
});

type ApiGetCall = { url: { toString: () => string } };

let mockApiGet: (call: ApiGetCall) => Promise<unknown> = async () => {
  return {};
};

const mockApiGetCalls: Array<ApiGetCall> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (call: ApiGetCall): Promise<unknown> => {
        mockApiGetCalls.push(call);
        return mockApiGet(call);
      },
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import CustomDomainDnsSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainDnsSetupModal";
import {
  CustomDomainCopy,
  DNS_SETUP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  CustomDomainKind,
  CustomDomainModel,
  DASHBOARD_CUSTOM_DOMAINS,
  STATUS_PAGE_CUSTOM_DOMAINS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import ObjectID from "../../../Types/ObjectID";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";
import Clipboard from "../../../UI/Utils/Clipboard";

const DOMAIN_ID: string = "0193c0de-0000-4aaa-8bbb-00000000d0d0";

interface KindCase {
  name: string;
  kind: CustomDomainKind;
  cnameRecord: string;
  // What DNS Setup's first sentence says the domain points to.
  pointsTo: string;
  verifyRoute: string;
  // The setting that switches this kind's custom domains on.
  variable: string;
  helmValue: string;
}

const KINDS: Array<KindCase> = [
  {
    name: "a status page's",
    kind: STATUS_PAGE_CUSTOM_DOMAINS,
    cnameRecord: "statuspage.oneuptime.com",
    pointsTo: "your status page",
    verifyRoute: "/status-page-domain/verify-cname/",
    variable: "STATUS_PAGE_CNAME_RECORD",
    helmValue: "statusPage.cnameRecord",
  },
  {
    name: "a dashboard's",
    kind: DASHBOARD_CUSTOM_DOMAINS,
    cnameRecord: "dashboards.oneuptime.com",
    pointsTo: "your dashboard",
    verifyRoute: "/dashboard-domain/verify-cname/",
    variable: "DASHBOARD_CNAME_RECORD",
    helmValue: "dashboard.cnameRecord",
  },
];

// What verify-cname answers for a found record.
function found(body: Record<string, unknown>): unknown {
  return {
    isFailure: (): boolean => {
      return false;
    },
    data: body,
  };
}

// What it answers for a record that is not found yet.
function notFound(message: string): unknown {
  return {
    isFailure: (): boolean => {
      return true;
    },
    message: message,
  };
}

type Rendered = {
  onClose: Mock<() => void>;
  onVerified: Mock<() => void>;
};

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function clickCheckNow(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Check now" }),
    );
  });
}

describe.each(KINDS)(
  "the DNS Setup dialog of $name domain",
  (kindCase: KindCase) => {
    function domain(
      extra: {
        subdomain?: string;
        isCustomCertificate?: boolean;
        isCnameVerified?: boolean;
      } = {},
    ): CustomDomainModel {
      const row: CustomDomainModel = new kindCase.kind.modelType();
      row._id = DOMAIN_ID;
      row.fullDomain =
        extra.subdomain === ""
          ? "acme.com"
          : `${extra.subdomain ?? "status"}.acme.com`;
      row.subdomain = extra.subdomain ?? "status";
      row.isCustomCertificate = extra.isCustomCertificate ?? false;
      row.isCnameVerified = extra.isCnameVerified ?? false;
      return row;
    }

    function renderDialog(
      row: CustomDomainModel = domain(),
      options?: { hasExpiredCertificate?: boolean },
    ): Rendered {
      const onClose: Mock<() => void> = jest.fn();
      const onVerified: Mock<() => void> = jest.fn();

      render(
        <CustomDomainDnsSetupModal
          kind={kindCase.kind}
          domain={row}
          hasExpiredCertificate={options?.hasExpiredCertificate}
          onClose={onClose as never}
          onVerified={onVerified as never}
        />,
      );

      return { onClose, onVerified };
    }

    beforeEach(() => {
      mockCnameRecord = kindCase.cnameRecord;
      mockApiGetCalls.length = 0;
      mockApiGet = async (): Promise<unknown> => {
        return found({
          certificateStatus: CustomDomainCertificateStatus.Issuing,
        });
      };
    });

    afterEach(() => {
      cleanup();
      jest.restoreAllMocks();
    });

    test("is titled DNS Setup and shows the record field by field", () => {
      renderDialog();

      expect(
        within(dialog()).getByRole("heading", { name: "DNS Setup" }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.recordType),
      ).toHaveTextContent(/^CNAME$/);
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.recordName),
      ).toHaveTextContent(/^status\.acme\.com$/);
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.recordValue),
      ).toHaveTextContent(kindCase.cnameRecord);

      const record: HTMLElement = screen.getByTestId(DNS_SETUP_TEST_IDS.record);
      expect(within(record).getByText("Type")).toBeInTheDocument();
      expect(within(record).getByText("Name")).toBeInTheDocument();
      expect(within(record).getByText("Value")).toBeInTheDocument();
    });

    test("says what to do, and what happens without anyone clicking anything", () => {
      renderDialog();

      expect(dialog()).toHaveTextContent(
        `Add this record at your DNS provider to point status.acme.com to ${kindCase.pointsTo}.`,
      );
      expect(dialog()).toHaveTextContent(
        CustomDomainCopy.dnsSetupWhatHappensNext,
      );
      expect(dialog()).not.toHaveTextContent("24 hours");
    });

    test("each field has its own copy button, which copies that field", async () => {
      const copied: Array<string> = [];
      jest
        .spyOn(Clipboard, "copyToClipboard")
        .mockImplementation(async (text: string): Promise<boolean> => {
          copied.push(text);
          return true;
        });

      renderDialog();

      for (const [name, value] of [
        ["Copy record type", "CNAME"],
        ["Copy record name", "status.acme.com"],
        ["Copy record value", kindCase.cnameRecord],
      ] as Array<[string, string]>) {
        await act(async (): Promise<void> => {
          fireEvent.click(within(dialog()).getByRole("button", { name }));
        });

        expect(copied[copied.length - 1]).toBe(value);
      }
    });

    test("a root domain gets a word about providers that refuse a CNAME there", () => {
      renderDialog(domain({ subdomain: "" }));

      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.recordName),
      ).toHaveTextContent(/^acme\.com$/);
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.rootDomainNote),
      ).toHaveTextContent("ALIAS, ANAME or flattened CNAME");
    });

    test("a subdomain does not", () => {
      renderDialog();

      expect(
        screen.queryByTestId(DNS_SETUP_TEST_IDS.rootDomainNote),
      ).toBeNull();
    });

    test("a domain on an uploaded certificate is told it is served with that certificate", () => {
      renderDialog(domain({ isCustomCertificate: true }));

      expect(dialog()).toHaveTextContent(
        CustomDomainCopy.dnsSetupWhatHappensNextUploaded,
      );
    });

    /*
     * DNS Setup also shows on a verified domain whose free certificate is
     * not issued yet: an order that keeps failing. It says so, rather than
     * asking for a record that is already in place.
     */
    test("a verified domain without its certificate is told so, and that Check now tries again", () => {
      renderDialog(domain({ isCnameVerified: true }));

      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.whatHappensNext),
      ).toHaveTextContent(CustomDomainCopy.dnsSetupVerifiedNotIssued);
      expect(dialog()).not.toHaveTextContent(
        CustomDomainCopy.dnsSetupWhatHappensNext,
      );
      // The record is still there to check against.
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.recordName),
      ).toHaveTextContent(/^status\.acme\.com$/);
      expect(
        within(dialog()).getByRole("button", { name: "Check now" }),
      ).toBeInTheDocument();
    });

    /*
     * And on a verified domain whose free certificate has expired - its
     * renewals keep failing. "Not issued yet" would be wrong; Check now
     * renews it now.
     */
    test("a verified domain whose certificate has expired is told so, and that Check now tries again", () => {
      renderDialog(domain({ isCnameVerified: true }), {
        hasExpiredCertificate: true,
      });

      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.whatHappensNext),
      ).toHaveTextContent(CustomDomainCopy.dnsSetupVerifiedExpired);
      expect(dialog()).not.toHaveTextContent(
        CustomDomainCopy.dnsSetupVerifiedNotIssued,
      );
      expect(
        within(dialog()).getByRole("button", { name: "Check now" }),
      ).toBeInTheDocument();
    });

    test("an expired certificate is about a verified domain only: one waiting for DNS is asked for its record", () => {
      renderDialog(domain({ isCnameVerified: false }), {
        hasExpiredCertificate: true,
      });

      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.whatHappensNext),
      ).toHaveTextContent(CustomDomainCopy.dnsSetupWhatHappensNext);
    });

    test("Check now asks this kind's verify-cname about this domain", async () => {
      renderDialog();

      await clickCheckNow();

      expect(mockApiGetCalls).toHaveLength(1);
      expect(mockApiGetCalls[0]!.url.toString()).toContain(
        `${kindCase.verifyRoute}${DOMAIN_ID}`,
      );
    });

    test("a record that is not found keeps the dialog open with the reason, and Check now can be tried again", async () => {
      mockApiGet = async (): Promise<unknown> => {
        return notFound(
          `We could not find a CNAME record for status.acme.com that points to ${kindCase.cnameRecord} yet.`,
        );
      };

      const rendered: Rendered = renderDialog();

      await clickCheckNow();

      expect(dialog()).toHaveTextContent(
        "We could not find a CNAME record for status.acme.com",
      );
      expect(screen.getByTestId(DNS_SETUP_TEST_IDS.record)).toBeInTheDocument();
      expect(rendered.onVerified).not.toHaveBeenCalled();
      expect(
        within(dialog()).getByRole("button", { name: "Check now" }),
      ).toBeEnabled();
    });

    test("a found record: the certificate is being issued, live within 15 minutes", async () => {
      const rendered: Rendered = renderDialog();

      await clickCheckNow();

      await waitFor(() => {
        expect(screen.getByTestId(DNS_SETUP_TEST_IDS.verified)).toBeVisible();
      });

      expect(dialog()).toHaveTextContent("Your CNAME record is verified.");
      expect(dialog()).toHaveTextContent(
        "We are issuing a free SSL certificate for status.acme.com. It is usually live within 15 minutes.",
      );
      expect(rendered.onVerified).toHaveBeenCalledTimes(1);

      // Nothing left to check: the record is gone, and Done closes.
      expect(screen.queryByTestId(DNS_SETUP_TEST_IDS.record)).toBeNull();
      expect(
        within(dialog()).queryByRole("button", { name: "Check now" }),
      ).toBeNull();

      fireEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
      expect(rendered.onClose).toHaveBeenCalledTimes(1);
    });

    test("a found record on a domain that has its certificate already says so", async () => {
      mockApiGet = async (): Promise<unknown> => {
        return found({
          certificateStatus: CustomDomainCertificateStatus.Issued,
        });
      };

      renderDialog();
      await clickCheckNow();

      expect(dialog()).toHaveTextContent(
        "status.acme.com already has its free SSL certificate, and we renew it automatically.",
      );
    });

    test("a found record on a domain with an uploaded certificate says that one is served", async () => {
      mockApiGet = async (): Promise<unknown> => {
        return found({
          certificateStatus: CustomDomainCertificateStatus.Uploaded,
        });
      };

      renderDialog(domain({ isCustomCertificate: true }));
      await clickCheckNow();

      expect(dialog()).toHaveTextContent(
        "status.acme.com is served with the certificate you uploaded.",
      );
    });

    test("a failed order says why, and that it is tried again without anyone doing anything, without promising when", async () => {
      mockApiGet = async (): Promise<unknown> => {
        return found({
          certificateStatus: CustomDomainCertificateStatus.Failed,
          certificateError:
            "Unable to order certificate for status.acme.com. Please make sure that your server can be accessed publicly over port 80 (HTTP) and port 443 (HTTPS).",
        });
      };

      const rendered: Rendered = renderDialog();
      await clickCheckNow();

      expect(dialog()).toHaveTextContent("Your CNAME record is verified.");
      expect(dialog()).toHaveTextContent(
        "We could not issue a free SSL certificate for status.acme.com yet. We keep trying automatically.",
      );
      expect(dialog()).not.toHaveTextContent("every 15 minutes");
      expect(
        screen.getByTestId(DNS_SETUP_TEST_IDS.certificateError),
      ).toHaveTextContent("accessed publicly over port 80");
      // Verified all the same.
      expect(rendered.onVerified).toHaveBeenCalledTimes(1);
    });

    /*
     * A server from before Check now ordered - the dashboard route answered
     * an empty body until now - reads as issuing, which is what the domain's
     * certificate then does.
     */
    test("an answer from an older server, with no body, reads as issuing", async () => {
      mockApiGet = async (): Promise<unknown> => {
        return found({});
      };

      renderDialog();
      await clickCheckNow();

      expect(dialog()).toHaveTextContent(
        "We are issuing a free SSL certificate for status.acme.com.",
      );
    });

    test("Close closes without checking", () => {
      const rendered: Rendered = renderDialog();

      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-close-button"),
      );

      expect(rendered.onClose).toHaveBeenCalledTimes(1);
      expect(mockApiGetCalls).toHaveLength(0);
    });

    /*
     * An installation without this kind's CNAME record cannot verify any
     * domain; the dialog says how to switch custom domains on, and offers no
     * Check now that could only fail.
     */
    test("without this kind's CNAME record it says how to enable custom domains, with no Check now", () => {
      mockCnameRecord = "";

      renderDialog();

      expect(dialog()).toHaveTextContent(
        "Custom Domains not enabled for this OneUptime installation.",
      );
      expect(dialog()).toHaveTextContent(kindCase.variable);
      expect(dialog()).toHaveTextContent(kindCase.helmValue);
      expect(
        within(dialog()).queryByRole("button", { name: "Check now" }),
      ).toBeNull();
      expect(screen.queryByTestId(DNS_SETUP_TEST_IDS.record)).toBeNull();
    });

    test("the id in the request is the domain's own", async () => {
      const row: CustomDomainModel = domain();
      row._id = ObjectID.generate().toString();

      renderDialog(row);
      await clickCheckNow();

      expect(mockApiGetCalls[0]!.url.toString()).toContain(
        `/verify-cname/${row._id}`,
      );
    });
  },
);
