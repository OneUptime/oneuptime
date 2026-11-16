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
 * Project Settings -> Domains: Verify Domain, which checks the domain's TXT
 * record (check-txt). The dialog draws the record with DNS Setup's own
 * component (CustomDomainRecords, #7025): its type, name and value, each
 * with a copy button, what it is for, and - once Verify Domain has looked
 * it up - its status beside it and what was looked up under it. It used to
 * list the record as bold labels and say what the lookup found as the
 * dialog's error, above the record it was about. The table is a stand-in
 * that draws the page's row action; the dialog is the real one.
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

let mockTableProps: Record<string, unknown> | null = null;

const ROW_ONE: Record<string, unknown> = {
  _id: "40000000-0000-4000-8000-000000000001",
  domain: "acme.com",
  isVerified: false,
  domainVerificationText: "oneuptime-verification-abc",
};

const ROW_TWO: Record<string, unknown> = {
  _id: "40000000-0000-4000-8000-000000000002",
  domain: "example.org",
  isVerified: false,
  domainVerificationText: "oneuptime-verification-xyz",
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockTableProps = props;

      type ActionButton = {
        title: string;
        onClick: (
          item: Record<string, unknown>,
          done: () => void,
          fail: () => void,
        ) => void;
      };

      const actions: Array<ActionButton> = (props["actionButtons"] ||
        []) as never;

      return (
        <section data-testid="domains-table">
          {[ROW_ONE, ROW_TWO].map((row: Record<string, unknown>) => {
            return actions.map((action: ActionButton) => {
              return (
                <button
                  key={`${action.title}-${String(row["domain"])}`}
                  data-testid={`row-action-${String(row["domain"])}`}
                  onClick={() => {
                    action.onClick(
                      row,
                      () => {},
                      () => {},
                    );
                  }}
                >
                  {action.title}
                </button>
              );
            });
          })}
        </section>
      );
    },
  };
});

import Domains from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Domains";
import {
  CustomDomainCopy,
  DNS_SETUP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Route from "../../../Types/API/Route";
import { getJestSpyOn } from "../../Spy";

function renderPage(): void {
  render(
    <Domains
      {...({
        pageRoute: new Route("/dashboard/settings/domains"),
        currentProject: null,
        hasPaymentMethod: true,
      } as unknown as PageComponentProps)}
    />,
  );
}

async function openDialog(domain: string = "acme.com"): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId(`row-action-${domain}`));
  });

  return screen.getByTestId("modal");
}

async function pressVerify(dialog: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify Domain" }),
    );
  });

  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function verify(domain: string = "acme.com"): Promise<HTMLElement> {
  const dialog: HTMLElement = await openDialog(domain);
  await pressVerify(dialog);
  return dialog;
}

function answerCheckTxt(record: JSONObject | null): void {
  getJestSpyOn(API, "get").mockResolvedValue(
    new HTTPResponse(
      200,
      record
        ? { isVerified: false, records: [record] }
        : { isVerified: true, records: [] },
      {},
    ) as never,
  );
}

const TXT_WRONG_VALUE: JSONObject = {
  type: "TXT",
  name: "acme.com",
  expectedValue: "oneuptime-verification-abc",
  foundValues: ["v=spf1 -all"],
  outcome: "WrongValue",
};

beforeEach(() => {
  mockTableProps = null;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("10000000-0000-4000-8000-000000000001"));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({} as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Project Settings -> Domains: Verify Domain", () => {
  test("draws the TXT record with DNS Setup's record component: type, name and value, each with a copy button", async () => {
    renderPage();
    const dialog: HTMLElement = await openDialog();

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Verify acme.com",
    );
    expect(dialog).toHaveTextContent(CustomDomainCopy.verifyDomainIntro);

    const record: HTMLElement = within(dialog).getByTestId(
      DNS_SETUP_TEST_IDS.txtRecord,
    );

    expect(
      within(record).getByTestId(DNS_SETUP_TEST_IDS.txtRecordType),
    ).toHaveTextContent(/^TXT$/);
    expect(
      within(record).getByTestId(DNS_SETUP_TEST_IDS.txtRecordName),
    ).toHaveTextContent(/^acme\.com$/);
    expect(
      within(record).getByTestId(DNS_SETUP_TEST_IDS.txtRecordValue),
    ).toHaveTextContent(/^oneuptime-verification-abc$/);

    // Type, Name and Value as DNS Setup labels them, one copy button each.
    expect(record).toHaveTextContent("Type");
    expect(record).toHaveTextContent("Name");
    expect(record).toHaveTextContent("Value");
    expect(within(record).getAllByRole("button")).toHaveLength(3);

    // What the record is for, in DNS Setup's words.
    expect(dialog).toHaveTextContent(
      "Shows this project owns acme.com. You add it once, for every address on acme.com.",
    );

    // Nothing looked up yet: no status, no words under the record.
    expect(within(dialog).queryByTestId(DNS_SETUP_TEST_IDS.txtStatus)).toBe(
      null,
    );
    expect(within(dialog).queryByTestId(DNS_SETUP_TEST_IDS.txtLookedUp)).toBe(
      null,
    );
  });

  test("the bold labels and the separate propagation note it used to draw are gone", async () => {
    renderPage();
    const dialog: HTMLElement = await openDialog();

    expect(dialog).not.toHaveTextContent("Record Type:");
    expect(dialog).not.toHaveTextContent("Content:");
    expect(dialog).not.toHaveTextContent("@ or acme.com");
    expect(dialog).not.toHaveTextContent(
      "Please add TXT record to your domain",
    );
  });

  test("asks check-txt about the domain, and verifies nothing itself", async () => {
    answerCheckTxt(null);
    const update: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "updateById",
    );

    renderPage();
    const toggleBefore: unknown = mockTableProps!["refreshToggle"];

    // The table's refresh toggle is a date to the second: a minute later.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(Date.now() + 60 * 1000));

    await verify();

    const get: jest.SpyInstance<any, any> = API.get as never;

    expect(String(get.mock.calls[0]![0].url)).toContain(
      "/domain/check-txt/40000000-0000-4000-8000-000000000001",
    );
    expect(update).not.toHaveBeenCalled();
    // Found: the dialog closes, and the table reads its rows again.
    expect(screen.queryByTestId("modal")).toBeNull();
    expect(mockTableProps!["refreshToggle"]).not.toBe(toggleBefore);
  });

  test("a wrong value: the record's status says so beside it, and what was looked up is said under the record, not as the dialog's error", async () => {
    answerCheckTxt(TXT_WRONG_VALUE);

    renderPage();
    const dialog: HTMLElement = await verify();

    const status: HTMLElement = within(dialog).getByTestId(
      DNS_SETUP_TEST_IDS.txtStatus,
    );

    expect(status).toHaveAttribute("data-outcome", "WrongValue");
    expect(status).toHaveTextContent("Wrong value");

    const lookedUp: HTMLElement = within(dialog).getByTestId(
      DNS_SETUP_TEST_IDS.txtLookedUp,
    );

    expect(lookedUp).toHaveTextContent(
      'We looked up the TXT records of acme.com and got "v=spf1 -all", but none of them is oneuptime-verification-abc. Add a TXT record with the value oneuptime-verification-abc. The TXT records already there can stay.',
    );

    // Regression (#7025): the lookup is the record's, not an error above it.
    expect(within(dialog).queryByTestId("modal-error")).toBe(null);
    // The dialog stays, for the next try.
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test.each([
    [
      "NotFound",
      { foundValues: [] },
      "Not found yet",
      "We looked up the TXT records of acme.com and got nothing. Add a TXT record with the name acme.com and the value oneuptime-verification-abc at your DNS provider.",
    ],
    [
      "NameNotFound",
      { foundValues: [] },
      "Not found yet",
      "We looked up acme.com, and it does not exist in DNS yet. Check that acme.com is your domain, and add a TXT record with the value oneuptime-verification-abc at its DNS provider.",
    ],
    [
      "LookupFailed",
      { foundValues: [], lookupError: "ETIMEOUT" },
      "Could not check",
      "We could not look up the TXT record of acme.com: the DNS server did not answer. Try again in a few minutes.",
    ],
  ])(
    "%s: the status and the words DNS Setup uses for it",
    async (
      outcome: string,
      extra: JSONObject,
      statusText: string,
      words: string,
    ) => {
      answerCheckTxt({
        type: "TXT",
        name: "acme.com",
        expectedValue: "oneuptime-verification-abc",
        outcome: outcome,
        ...extra,
      });

      renderPage();
      const dialog: HTMLElement = await verify();

      const status: HTMLElement = within(dialog).getByTestId(
        DNS_SETUP_TEST_IDS.txtStatus,
      );

      expect(status).toHaveAttribute("data-outcome", outcome);
      expect(status).toHaveTextContent(statusText);
      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.txtLookedUp),
      ).toHaveTextContent(words);
      expect(within(dialog).queryByTestId("modal-error")).toBe(null);
    },
  );

  test("each try says when it looked, so a second try reads as new", async () => {
    answerCheckTxt({
      ...TXT_WRONG_VALUE,
      checkedAt: "2026-11-16T10:42:00.000Z",
    });

    renderPage();
    const dialog: HTMLElement = await verify();

    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.txtLookedUp),
    ).toHaveTextContent(/Checked at /);
  });

  test("a refusal - somebody who may not edit the domain - is said as the server says it, and no status is drawn", async () => {
    getJestSpyOn(API, "get").mockResolvedValue({
      isFailure: (): boolean => {
        return true;
      },
      message: "You do not have permission to edit this domain.",
    } as never);
    getJestSpyOn(API, "getFriendlyMessage").mockImplementation(
      (err: unknown): string => {
        return (err as { message: string }).message;
      },
    );

    renderPage();
    const dialog: HTMLElement = await verify();

    expect(within(dialog).getByTestId("modal-error")).toHaveTextContent(
      "You do not have permission to edit this domain.",
    );
    expect(within(dialog).queryByTestId(DNS_SETUP_TEST_IDS.txtStatus)).toBe(
      null,
    );
  });

  test("a try that fails after one that found the wrong value keeps the record's last status, and says what failed above", async () => {
    answerCheckTxt(TXT_WRONG_VALUE);

    renderPage();
    const dialog: HTMLElement = await verify();

    getJestSpyOn(API, "get").mockRejectedValue(new Error("offline") as never);
    getJestSpyOn(API, "getFriendlyMessage").mockReturnValue(
      "OneUptime could not be reached.",
    );

    await pressVerify(dialog);

    expect(within(dialog).getByTestId("modal-error")).toHaveTextContent(
      "OneUptime could not be reached.",
    );
    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.txtStatus),
    ).toHaveAttribute("data-outcome", "WrongValue");
  });

  test("opening another domain starts clean: its own record, no status or error from the last one", async () => {
    answerCheckTxt(TXT_WRONG_VALUE);

    renderPage();
    const dialog: HTMLElement = await verify();

    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.txtStatus),
    ).toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByTestId("modal")).toBeNull();

    const second: HTMLElement = await openDialog("example.org");

    expect(within(second).getByTestId("modal-title")).toHaveTextContent(
      "Verify example.org",
    );
    expect(
      within(second).getByTestId(DNS_SETUP_TEST_IDS.txtRecordValue),
    ).toHaveTextContent(/^oneuptime-verification-xyz$/);
    expect(within(second).queryByTestId(DNS_SETUP_TEST_IDS.txtStatus)).toBe(
      null,
    );
    expect(within(second).queryByTestId("modal-error")).toBe(null);
  });
});
