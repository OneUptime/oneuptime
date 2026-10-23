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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * "Please add delete option in more, also add bulk actions for this table."
 * - the maintainer, on Admin Dashboard > Enterprise Licenses, whose rows' ⋯
 * held only Show ID, beside two expired duplicates of one company's license.
 *
 * The real list page, its real table and the shared Delete and bulk flows,
 * over an in-memory set of licenses behind AdminModelAPI:
 *
 *   - each row's ⋯ offers Delete; its dialog names the license by company
 *     AND masked key (two rows here are the same company), says what
 *     deleting it does to the installations that use the key, and deletes
 *     that row only;
 *   - Bulk Actions offer Change Expiry Date and Delete; a bulk Delete names
 *     the licenses, says what goes, deletes each, and lists any the server
 *     refused with its words;
 *   - Change Expiry Date asks for a date after today, writes it to each
 *     license with its own update, leaves a license already expiring that
 *     day alone, and lists any the server refused.
 */

let refusedDeletes: Record<string, string> = {};
let refusedUpdates: Record<string, string> = {};
const deleteRequests: Array<string> = [];
const updateRequests: Array<{ id: string; data: Record<string, unknown> }> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("Common/UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

// The Admin Dashboard's reader: a master admin, with no project permissions.
jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactNode }): ReactElement => {
      return <div data-testid="page">{props.children}</div>;
    },
  };
});

// The notification settings card under the list is not what is tested here.
jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import EnterpriseLicenses from "../../../AdminDashboard/EnterpriseLicenses/Pages/Index";
import {
  getLicenseStatusText,
  getSeatUsageText,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/LicenseUtil";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "Common/Types/Date";
import { getDeleteConsequence } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

const NOW: Date = new Date("2026-10-23T09:00:00.000Z");

interface LicenseRow {
  _id: string;
  companyName: string;
  email?: string | undefined;
  licenseKey: string;
  isEvaluationLicense: boolean;
  canBeWhiteLabelled: boolean;
  expiresAt: Date;
  userLimit: number;
  currentUserCount: number;
}

const NETLOCK_A: LicenseRow = {
  _id: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e01",
  companyName: "Netlock.hu",
  licenseKey: `da74${"a".repeat(56)}7c7a`,
  isEvaluationLicense: true,
  canBeWhiteLabelled: false,
  expiresAt: new Date("2026-09-30T00:00:00.000Z"),
  userLimit: 50,
  currentUserCount: 0,
};

const NETLOCK_B: LicenseRow = {
  _id: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e02",
  companyName: "Netlock.hu",
  licenseKey: `e639${"b".repeat(56)}e1f4`,
  isEvaluationLicense: true,
  canBeWhiteLabelled: false,
  expiresAt: new Date("2026-09-30T00:00:00.000Z"),
  userLimit: 50,
  currentUserCount: 0,
};

const GOVTECH: LicenseRow = {
  _id: "6c1f0e2d-3b4a-4c5d-8e6f-7a8b9c0d1e03",
  companyName: "GovTech Singapore",
  licenseKey: `832c${"c".repeat(56)}8915`,
  isEvaluationLicense: false,
  canBeWhiteLabelled: false,
  expiresAt: new Date("2099-10-09T00:00:00.000Z"),
  userLimit: 150,
  currentUserCount: 13,
};

const NAME_A: string = "Netlock.hu · da74••••7c7a";
const NAME_B: string = "Netlock.hu · e639••••e1f4";
const NAME_GOVTECH: string = "GovTech Singapore · 832c••••8915";

let rows: Array<LicenseRow> = [];

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <EnterpriseLicenses />
      </MemoryRouter>,
    );
  });

  await screen.findAllByText("GovTech Singapore");
};

const rowOf: (maskedKey: string) => HTMLElement = (
  maskedKey: string,
): HTMLElement => {
  const cell: HTMLElement | undefined = screen
    .getAllByText(maskedKey)
    .find((element: HTMLElement): boolean => {
      return Boolean(element.closest("tr"));
    });

  if (!cell) {
    throw new Error(`No table row with key ${maskedKey}`);
  }

  return cell.closest("tr") as HTMLElement;
};

const openRowMenu: (maskedKey: string) => void = (maskedKey: string): void => {
  fireEvent.click(
    within(rowOf(maskedKey)).getByTestId("row-actions-more-button"),
  );
};

const menuItem: (name: string) => HTMLElement = (name: string): HTMLElement => {
  const item: HTMLElement | undefined = screen
    .getAllByRole("menuitem")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === name;
    });

  if (!item) {
    throw new Error(`No menu item ${name}`);
  }

  return item;
};

/*
 * A row's box, as the table names it: the kind, then the license's name
 * ("Select Enterprise License: Netlock.hu · da74••••7c7a"). The table draws
 * each row for a desk and for a phone; one box selects it.
 */
const select: (name: string) => void = (name: string): void => {
  fireEvent.click(
    screen.getAllByRole("checkbox", {
      name: `Select Enterprise License: ${name}`,
    })[0]!,
  );
};

// How a bulk result lists a license: the kind, then its name.
const listed: (name: string) => string = (name: string): string => {
  return `Enterprise License: ${name}`;
};

const openBulkActions: () => void = (): void => {
  fireEvent.click(screen.getByText("Bulk Actions"));
};

const dialog: () => HTMLElement = (): HTMLElement => {
  const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");
  return dialogs[dialogs.length - 1]!;
};

beforeEach(() => {
  rows = [NETLOCK_A, NETLOCK_B, GOVTECH];
  refusedDeletes = {};
  refusedUpdates = {};
  deleteRequests.length = 0;
  updateRequests.length = 0;

  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    "/admin/enterprise-licenses",
  );
  Navigation.setLocation({
    pathname: window.location.pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return NOW;
  });

  jest
    .spyOn(AdminModelAPI, "getItem")
    .mockImplementation(async (data: unknown): Promise<never> => {
      if ((data as { modelType: unknown }).modelType === GlobalConfig) {
        return Object.assign(new GlobalConfig(), {
          enterpriseLicenseExpiryReminderDays: 30,
        }) as never;
      }

      throw new Error("Unexpected detail request");
    });

  jest
    .spyOn(AdminModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: {
        modelType: unknown;
        select: Record<string, unknown>;
        skip: number;
        limit: number;
      } = data as {
        modelType: unknown;
        select: Record<string, unknown>;
        skip: number;
        limit: number;
      };

      if (request.modelType !== EnterpriseLicense) {
        throw new Error("Unexpected list request");
      }

      // The API answers only the columns asked for.
      const projected: Array<EnterpriseLicense> = rows.map(
        (row: LicenseRow): EnterpriseLicense => {
          const license: EnterpriseLicense = new EnterpriseLicense();

          for (const [key, value] of Object.entries(row)) {
            if (key === "_id" || request.select[key]) {
              Object.assign(license, { [key]: value });
            }
          }

          return license;
        },
      );

      return {
        data: projected,
        count: projected.length,
        skip: request.skip,
        limit: request.limit,
      } as never;
    });

  jest
    .spyOn(AdminModelAPI, "deleteItem")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const id: string = String((data as { id: unknown }).id);
      deleteRequests.push(id);

      if (refusedDeletes[id]) {
        throw new Error(refusedDeletes[id]);
      }

      rows = rows.filter((row: LicenseRow): boolean => {
        return row._id !== id;
      });

      return undefined as never;
    });

  jest
    .spyOn(AdminModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: { id: unknown; data: Record<string, unknown> } = data as {
        id: unknown;
        data: Record<string, unknown>;
      };
      const id: string = String(request.id);

      updateRequests.push({ id, data: request.data });

      if (refusedUpdates[id]) {
        throw new Error(refusedUpdates[id]);
      }

      rows = rows.map((row: LicenseRow): LicenseRow => {
        return row._id === id
          ? {
              ...row,
              expiresAt: new Date(
                `${String(request.data["expiresAt"])}T00:00:00.000Z`,
              ),
            }
          : row;
      });

      return {} as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a row's ⋯ menu", () => {
  test("offers Delete, after Show ID", async () => {
    await renderPage();
    openRowMenu("da74••••7c7a");

    const names: Array<string> = screen
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(names).toEqual(["Show ID", "Delete"]);
  });

  test("Delete asks about that license by company and masked key, and says what deleting it does", async () => {
    await renderPage();
    openRowMenu("e639••••e1f4");
    fireEvent.click(menuItem("Delete"));

    const message: HTMLElement = await screen.findByTestId(
      "delete-confirmation-message",
    );

    expect(message).toHaveTextContent(
      `Are you sure you want to delete ${NAME_B}?`,
    );
    expect(message).not.toHaveTextContent(NAME_A);
    expect(
      screen.getByTestId("delete-confirmation-consequence"),
    ).toHaveTextContent(
      "Deleting a license also deletes its instances. Installations that use its key keep the license they already hold until it expires, but can no longer refresh or reactivate it, and their seat reports are refused.",
    );
    expect(getDeleteConsequence("EnterpriseLicense")).toContain(
      "their seat reports are refused",
    );
    expect(message).toHaveTextContent("This action cannot be undone.");
  });

  test("Cancel deletes nothing; Delete deletes that license only, and the list loses it", async () => {
    await renderPage();
    openRowMenu("e639••••e1f4");
    fireEvent.click(menuItem("Delete"));
    await screen.findByTestId("delete-confirmation-message");

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("delete-confirmation-message")).toBeNull();
    });
    expect(deleteRequests).toEqual([]);

    openRowMenu("e639••••e1f4");
    fireEvent.click(menuItem("Delete"));
    await screen.findByTestId("delete-confirmation-message");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(deleteRequests).toEqual([NETLOCK_B._id]);
    });
    await waitFor(() => {
      expect(screen.queryAllByText("e639••••e1f4")).toHaveLength(0);
    });
    expect(screen.getAllByText("da74••••7c7a").length).toBeGreaterThan(0);
  });

  test("a refused delete says why, in the row's own dialog, and the license stays", async () => {
    refusedDeletes = {
      [NETLOCK_A._id]:
        "You do not have permissions to delete Enterprise License.",
    };

    await renderPage();
    openRowMenu("da74••••7c7a");
    fireEvent.click(menuItem("Delete"));
    await screen.findByTestId("delete-confirmation-message");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText(
        "You do not have permissions to delete Enterprise License.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("da74••••7c7a").length).toBeGreaterThan(0);
  });
});

describe("Bulk Actions", () => {
  test("offer Change Expiry Date and Export CSV, then Delete below the divider", async () => {
    await renderPage();
    select(NAME_A);
    openBulkActions();

    const names: Array<string> = screen
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(names).toEqual(["Change Expiry Date", "Export CSV", "Delete"]);
  });

  test("Delete names the licenses, says what goes, deletes each, and says how many", async () => {
    await renderPage();
    select(NAME_A);
    select(NAME_B);
    openBulkActions();
    fireEvent.click(menuItem("Delete"));

    expect(
      within(dialog()).getByText("Delete 2 Enterprise Licenses"),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(
        "Are you sure you want to delete 2 enterprise licenses? This action cannot be undone.",
      ),
    ).toBeVisible();
    expect(
      within(dialog())
        .getAllByTestId("delete-confirmation-item")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([NAME_A, NAME_B]);
    expect(
      within(dialog()).getByTestId("bulk-delete-consequence"),
    ).toHaveTextContent(
      "Installations that use its key keep the license they already hold until it expires",
    );

    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete" }));

    await screen.findByText("Completed");

    expect(deleteRequests).toEqual([NETLOCK_A._id, NETLOCK_B._id]);
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Enterprise Licenses deleted",
    );
  });

  test("a bulk Delete the server refuses part of deletes the rest, and says which and why", async () => {
    refusedDeletes = {
      [NETLOCK_B._id]: "Enterprise License not found.",
    };

    await renderPage();
    select(NAME_A);
    select(NAME_B);
    select(NAME_GOVTECH);
    openBulkActions();
    fireEvent.click(menuItem("Delete"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete" }));

    await screen.findByText("Completed");

    expect(deleteRequests).toEqual([NETLOCK_A._id, NETLOCK_B._id, GOVTECH._id]);
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Enterprise Licenses deleted",
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Enterprise License not deleted",
    );

    const failed: HTMLElement = screen.getByTestId("bulk-action-failed-items");

    expect(within(failed).getByText(listed(NAME_B))).toBeVisible();
    expect(
      within(failed).getByText("Enterprise License not found."),
    ).toBeVisible();
  });
});

describe("Change Expiry Date", () => {
  const openChangeExpiry: (
    names: Array<string>,
  ) => Promise<HTMLElement> = async (
    names: Array<string>,
  ): Promise<HTMLElement> => {
    await renderPage();

    for (const name of names) {
      select(name);
    }

    openBulkActions();
    fireEvent.click(menuItem("Change Expiry Date"));

    return await screen.findByRole("dialog");
  };

  const dateInput: (modal: HTMLElement) => HTMLInputElement = (
    modal: HTMLElement,
  ): HTMLInputElement => {
    const input: HTMLInputElement | null =
      modal.querySelector('input[type="date"]');

    if (!input) {
      throw new Error("No date field");
    }

    return input;
  };

  test("asks for the new date, counting the licenses it changes", async () => {
    const modal: HTMLElement = await openChangeExpiry([NAME_A, NAME_B]);

    // The dialog's title, and its button.
    expect(within(modal).getAllByText("Change Expiry Date")).toHaveLength(2);
    expect(
      within(modal).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Change Expiry Date");
    expect(
      within(modal).getByText(
        "The 2 selected licenses will expire on the date you pick.",
      ),
    ).toBeVisible();
    expect(within(modal).getByText("New Expiry Date")).toBeVisible();
    expect(
      within(modal).getByText(
        "A date after today. Installations get it with their daily report, or at once when their admin presses Refresh license.",
      ),
    ).toBeVisible();
  });

  test("one license reads in the singular", async () => {
    const modal: HTMLElement = await openChangeExpiry([NAME_A]);

    expect(
      within(modal).getByText(
        "The selected license will expire on the date you pick.",
      ),
    ).toBeVisible();
  });

  test("a date in the past is refused, and nothing is written", async () => {
    const modal: HTMLElement = await openChangeExpiry([NAME_A]);

    fireEvent.change(dateInput(modal), { target: { value: "2001-01-01" } });
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    expect(
      await within(modal).findByText(
        "New Expiry Date should be a future date.",
      ),
    ).toBeInTheDocument();
    expect(updateRequests).toEqual([]);
  });

  test("writes the day to each license with its own update, and says how many changed", async () => {
    const modal: HTMLElement = await openChangeExpiry([NAME_A, NAME_B]);

    fireEvent.change(dateInput(modal), { target: { value: "2099-12-31" } });
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await screen.findByText("Completed");

    expect(updateRequests).toEqual([
      { id: NETLOCK_A._id, data: { expiresAt: "2099-12-31" } },
      { id: NETLOCK_B._id, data: { expiresAt: "2099-12-31" } },
    ]);
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Enterprise Licenses updated",
    );
  });

  test("a license already expiring that day is left alone and listed, and a refused one says why", async () => {
    refusedUpdates = {
      [NETLOCK_B._id]:
        "You do not have permissions to update Enterprise License.",
    };

    const modal: HTMLElement = await openChangeExpiry([
      NAME_A,
      NAME_B,
      NAME_GOVTECH,
    ]);

    fireEvent.change(dateInput(modal), { target: { value: "2099-10-09" } });
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await screen.findByText("Completed");

    // GovTech already expires on 2099-10-09: not written.
    expect(
      updateRequests.map((request: { id: string }): string => {
        return request.id;
      }),
    ).toEqual([NETLOCK_A._id, NETLOCK_B._id]);
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "1 Enterprise License updated",
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Enterprise License not updated",
    );
    expect(
      within(screen.getByTestId("bulk-action-failed-items")).getByText(
        "You do not have permissions to update Enterprise License.",
      ),
    ).toBeVisible();

    const unchanged: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );

    expect(within(unchanged).getByText(listed(NAME_GOVTECH))).toBeVisible();
    expect(
      within(unchanged).getByText("Already expires on this date."),
    ).toBeVisible();
  });

  test("closing the dialog writes nothing", async () => {
    const modal: HTMLElement = await openChangeExpiry([NAME_A]);

    fireEvent.click(within(modal).getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(updateRequests).toEqual([]);
  });
});

/*
 * Export CSV, which Bulk Actions offers with the rest: the file reads like
 * the list. A license key is shown masked everywhere a list or an email
 * shows one, so a file of the selected licenses - handed around, attached
 * to a ticket - never carries a key an installation activates with; and the
 * Type, Status and Seats columns say what their cells say, not the raw
 * columns under them ("true", a timestamp, a bare count).
 */
describe("Export CSV", () => {
  // One CSV line's cells, quotes and doubled quotes undone (RFC 4180).
  const cellsOf: (line: string) => Array<string> = (
    line: string,
  ): Array<string> => {
    const cells: Array<string> = [];
    let cell: string = "";
    let isQuoted: boolean = false;

    for (let index: number = 0; index < line.length; index++) {
      const character: string = line[index]!;

      if (isQuoted) {
        if (character === '"' && line[index + 1] === '"') {
          cell += '"';
          index++;
        } else if (character === '"') {
          isQuoted = false;
        } else {
          cell += character;
        }
      } else if (character === '"') {
        isQuoted = true;
      } else if (character === ",") {
        cells.push(cell);
        cell = "";
      } else {
        cell += character;
      }
    }

    cells.push(cell);

    return cells;
  };

  const exportSelection: (
    names: Array<string>,
  ) => Promise<Array<Array<string>>> = async (
    names: Array<string>,
  ): Promise<Array<Array<string>>> => {
    const downloads: Array<{ csv: string; filename: string }> = [];

    jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((data: { csv: string; filename: string }): void => {
        downloads.push(data);
      });

    await renderPage();

    for (const name of names) {
      select(name);
    }

    openBulkActions();
    fireEvent.click(menuItem("Export CSV"));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });

    const csv: string = downloads[0]!.csv;

    // Never a whole key, whichever rows were exported.
    for (const row of [NETLOCK_A, NETLOCK_B, GOVTECH]) {
      expect(csv).not.toContain(row.licenseKey);
    }

    return csv.split("\r\n").map(cellsOf);
  };

  // A license's cell under a column, found by its company.
  const cellOf: (
    lines: Array<Array<string>>,
    company: string,
    title: string,
  ) => string = (
    lines: Array<Array<string>>,
    company: string,
    title: string,
  ): string => {
    const header: Array<string> = lines[0]!;
    const line: Array<string> | undefined = lines
      .slice(1)
      .find((candidate: Array<string>): boolean => {
        return candidate[header.indexOf("Company")] === company;
      });

    expect({ company, title, isThere: Boolean(line) }).toEqual({
      company,
      title,
      isThere: true,
    });
    expect(header).toContain(title);

    return line![header.indexOf(title)] || "";
  };

  test("writes each license's key masked, as the row shows it", async () => {
    const lines: Array<Array<string>> = await exportSelection([
      NAME_A,
      NAME_GOVTECH,
    ]);

    expect(lines).toHaveLength(3);
    expect(cellOf(lines, "Netlock.hu", "License Key")).toBe("da74••••7c7a");
    expect(cellOf(lines, "GovTech Singapore", "License Key")).toBe(
      "832c••••8915",
    );
  });

  test("writes the type, the status and the seats in the list's words", async () => {
    rows = [
      NETLOCK_A,
      {
        ...GOVTECH,
        canBeWhiteLabelled: true,
      },
    ];

    const lines: Array<Array<string>> = await exportSelection([
      NAME_A,
      NAME_GOVTECH,
    ]);

    expect(cellOf(lines, "Netlock.hu", "Type")).toBe("Evaluation");
    expect(cellOf(lines, "Netlock.hu", "Status")).toBe("Expired");
    expect(cellOf(lines, "Netlock.hu", "Seats")).toBe("0 / 50 users");
    expect(cellOf(lines, "GovTech Singapore", "Type")).toBe(
      "Production, White-label",
    );
    expect(cellOf(lines, "GovTech Singapore", "Status")).toBe("Active");
    expect(cellOf(lines, "GovTech Singapore", "Seats")).toBe("13 / 150 users");
  });
});

describe("a license's status and seats in words", () => {
  test("the status reads as its pill does", () => {
    expect(getLicenseStatusText(null)).toBe("");
    expect(
      getLicenseStatusText({ state: "expired", daysUntilExpiry: -3 }),
    ).toBe("Expired");
    expect(
      getLicenseStatusText({ state: "expiring-soon", daysUntilExpiry: 0 }),
    ).toBe("Expires today");
    expect(
      getLicenseStatusText({ state: "expiring-soon", daysUntilExpiry: 1 }),
    ).toBe("Expires in 1 day");
    expect(
      getLicenseStatusText({ state: "expiring-soon", daysUntilExpiry: 8 }),
    ).toBe("Expires in 8 days");
    expect(
      getLicenseStatusText({ state: "active", daysUntilExpiry: 300 }),
    ).toBe("Active");
  });

  test("the seats read as the meter's line does", () => {
    expect(
      getSeatUsageText({ currentUserCount: undefined, userLimit: undefined }),
    ).toBe("");
    expect(getSeatUsageText({ currentUserCount: 13, userLimit: 150 })).toBe(
      "13 / 150 users",
    );
    expect(
      getSeatUsageText({ currentUserCount: undefined, userLimit: 25 }),
    ).toBe("0 / 25 users");
    expect(getSeatUsageText({ currentUserCount: 4, userLimit: 0 })).toBe(
      "4 users, no limit",
    );
    expect(
      getSeatUsageText({ currentUserCount: 4, userLimit: undefined }),
    ).toBe("4 users, no limit");
  });
});
