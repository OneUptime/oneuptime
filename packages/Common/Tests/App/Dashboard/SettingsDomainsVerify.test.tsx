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
 * record (check-txt) and, when it is not found, says what was looked up
 * and what came back - the words a status page's DNS Setup uses - where it
 * used to say only "Verification TXT record ... not found". The table is a
 * stand-in that draws the page's row action; the dialog is the real one.
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

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockTableProps = props;

      const row: Record<string, unknown> = {
        _id: "40000000-0000-4000-8000-000000000001",
        domain: "acme.com",
        isVerified: false,
        domainVerificationText: "oneuptime-verification-abc",
      };

      const actions: Array<{
        title: string;
        onClick: (
          item: Record<string, unknown>,
          done: () => void,
          fail: () => void,
        ) => void;
      }> = (props["actionButtons"] || []) as never;

      return (
        <section data-testid="domains-table">
          {actions.map((action: { title: string; onClick: never }) => {
            return (
              <button
                key={action.title}
                onClick={() => {
                  (
                    action.onClick as (
                      item: Record<string, unknown>,
                      done: () => void,
                      fail: () => void,
                    ) => void
                  )(
                    row,
                    () => {},
                    () => {},
                  );
                }}
              >
                {action.title}
              </button>
            );
          })}
        </section>
      );
    },
  };
});

import Domains from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Domains";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ObjectID from "../../../Types/ObjectID";
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

async function verify(): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Verify Domain" }));
  });

  const dialog: HTMLElement = screen.getByTestId("modal");

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

  return dialog;
}

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
  test("asks check-txt about the domain, and verifies nothing itself", async () => {
    const get: jest.SpyInstance<any, any> = getJestSpyOn(
      API,
      "get",
    ).mockResolvedValue(
      new HTTPResponse(200, { isVerified: true, records: [] }, {}) as never,
    );
    const update: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "updateById",
    );

    renderPage();
    await verify();

    expect(String(get.mock.calls[0]![0].url)).toContain(
      "/domain/check-txt/40000000-0000-4000-8000-000000000001",
    );
    expect(update).not.toHaveBeenCalled();
    // Found: the dialog closes, and the table reads its rows again.
    expect(screen.queryByTestId("modal")).toBeNull();
    expect(mockTableProps).not.toBeNull();
  });

  test("a record not found says what was looked up and what came back, and the dialog stays", async () => {
    getJestSpyOn(API, "get").mockResolvedValue(
      new HTTPResponse(
        200,
        {
          isVerified: false,
          records: [
            {
              type: "TXT",
              name: "acme.com",
              expectedValue: "oneuptime-verification-abc",
              foundValues: ["v=spf1 -all"],
              outcome: "WrongValue",
            },
          ],
        },
        {},
      ) as never,
    );

    renderPage();
    const dialog: HTMLElement = await verify();

    expect(dialog).toHaveTextContent(
      'We looked up the TXT records of acme.com and got "v=spf1 -all", but none of them is oneuptime-verification-abc. Add a TXT record with the value oneuptime-verification-abc. The TXT records already there can stay.',
    );
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test("a refusal - somebody who may not edit the domain - is said as the server says it", async () => {
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

    expect(dialog).toHaveTextContent(
      "You do not have permission to edit this domain.",
    );
  });
});
