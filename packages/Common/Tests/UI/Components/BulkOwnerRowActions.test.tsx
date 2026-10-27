import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Owners from a row, and Assign to Me (useBulkOwnerActions' rowActions and
 * offerAssignToMeInBulk). On the lists of work someone picks up - incidents,
 * alerts, episodes, scheduled maintenance - a record's owners are who has
 * it, so each row's ⋯ menu offers:
 *
 *   - Assign to Me: the viewer becomes an owner, at once; a row the list
 *     knows they own already (isOwnedByMe) does not offer it;
 *   - Add Owner: "assign to someone else" - the same people and teams
 *     picker as the bulk Add Owner, for that row, naming it; its existing
 *     owners are kept;
 *
 * and Bulk Actions offers Assign to Me ahead of Add Owner, leaving a row the
 * viewer owns already alone, with why. The list reads its rows again once
 * an owner is added (the RowActionContext the table hands an action).
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

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
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

import useBulkOwnerActions, {
  ADD_OWNER_TO_ROW_DESCRIPTION,
  ALREADY_OWNED_BY_YOU,
  ASSIGN_TO_ME_TITLE,
  BulkOwnerActionsConfig,
  BulkOwnerActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkOwnerActions";
import {
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ActionMenuGroup } from "../../../UI/Components/ActionButton/ActionMenuGroup";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import User from "../../../UI/Utils/User";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import UserModel from "../../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

// The real modal, Formik and people picker mount slowly on a loaded box.
const WAIT_TIMEOUT: number = 20000;
jest.setTimeout(30000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const INCIDENT_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const VIEWER_ID: string = "33333333-3333-4333-8333-333333333330";
const ALICE_ID: string = "33333333-3333-4333-8333-333333333331";

const incident: (id: string, title: string) => Incident = (
  id: string,
  title: string,
): Incident => {
  const row: Incident = new Incident();
  row._id = id;
  row.title = title;

  return row;
};

const INCIDENT_OWNERS: BulkOwnerActionsConfig<Incident> = {
  ownerUserModelType: IncidentOwnerUser,
  ownerTeamModelType: IncidentOwnerTeam,
  resourceIdField: "incidentId",
};

// The incidents each person owns already, as the owner rows say.
let ownedForTest: Record<string, Array<string>> = {};

const mockLists: () => void = (): void => {
  getListMock.mockImplementation(async (listData: any): Promise<any> => {
    let rows: Array<any> = [];

    if (listData.modelType === IncidentOwnerUser) {
      /*
       * One row's read names its incident; a bulk run's names every incident
       * of its window (Includes), and its rows say which incident each is of.
       */
      const askedFor: unknown = listData.query.incidentId;
      const incidentIds: Array<string> =
        askedFor instanceof Includes
          ? (askedFor.values as Array<ObjectID>).map((id: ObjectID) => {
              return id.toString();
            })
          : [String(askedFor)];

      for (const incidentId of incidentIds) {
        for (const userId of ownedForTest[incidentId] || []) {
          const owner: IncidentOwnerUser = new IncidentOwnerUser();
          owner._id = ObjectID.generate().toString();
          owner.userId = new ObjectID(userId);
          owner.incidentId = new ObjectID(incidentId);
          rows.push(owner);
        }
      }
    } else if (listData.modelType === TeamMember) {
      const user: UserModel = new UserModel();
      user._id = ALICE_ID;
      user.name = new Name("Alice");

      const member: TeamMember = new TeamMember();
      member.user = user;

      rows = [member];
    } else if (listData.modelType === Team) {
      rows = [];
    }

    return {
      data: rows,
      count: rows.length,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    };
  });
};

// The owner rows created, as { who, incident } pairs.
const createdOwners: () => Array<{
  userId: string;
  incidentId: string;
}> = (): Array<{ userId: string; incidentId: string }> => {
  return (createMock.mock.calls as Array<Array<any>>).map(
    (call: Array<any>) => {
      const model: any = call[0].model;

      return {
        userId: model.userId?.toString() || "",
        incidentId: model.incidentId?.toString() || "",
      };
    },
  );
};

let refreshCount: number = 0;

interface RowHarnessProps {
  item: Incident;
  config: BulkOwnerActionsConfig<Incident>;
}

// One row of the incidents list, as ModelTable draws it.
function RowHarness(props: RowHarnessProps): ReactElement {
  const { rowActions, modals }: BulkOwnerActionsResult<Incident> =
    useBulkOwnerActions<Incident>(props.config);

  const view: ActionButtonSchema<Incident> = {
    title: "View",
    icon: IconProp.ChevronRight,
    buttonStyleType: ButtonStyleType.OUTLINE,
    onClick: (): void => {},
  };

  return (
    <>
      <RowActions<Incident>
        item={props.item}
        actionButtons={withRowActionContext<Incident>([view, ...rowActions], {
          refresh: () => {
            refreshCount++;
          },
        })}
      />
      {modals}
    </>
  );
}

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const menuItemNames: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  User.setUserId(new ObjectID(VIEWER_ID));
  ownedForTest = {};
  refreshCount = 0;
  mockLists();
  createMock.mockResolvedValue({});
  deleteItemMock.mockResolvedValue({});
});

describe("the row's owner actions", () => {
  test("are Assign to Me and Add Owner, in the ⋯ menu: View stays the row's button", async () => {
    const { result } = renderHook(() => {
      return useBulkOwnerActions<Incident>(INCIDENT_OWNERS);
    });

    expect(
      result.current.rowActions.map((action: ActionButtonSchema<Incident>) => {
        return [action.title, action.icon, action.placement];
      }),
    ).toEqual([
      [ASSIGN_TO_ME_TITLE, IconProp.User, ActionButtonPlacement.MoreMenu],
      ["Add Owner", IconProp.UserPlus, ActionButtonPlacement.MoreMenu],
    ]);
  });

  test("sit in their menus' run of a record's people, in the row and in bulk", () => {
    const { result } = renderHook(() => {
      return useBulkOwnerActions<Incident>({
        ...INCIDENT_OWNERS,
        offerAssignToMeInBulk: true,
      });
    });

    expect(
      [...result.current.rowActions, ...result.current.bulkActions].map(
        (action: { title: string; menuGroup?: string | undefined }) => {
          return [action.title, action.menuGroup];
        },
      ),
    ).toEqual([
      [ASSIGN_TO_ME_TITLE, ActionMenuGroup.People],
      ["Add Owner", ActionMenuGroup.People],
      [ASSIGN_TO_ME_TITLE, ActionMenuGroup.People],
      ["Add Owner", ActionMenuGroup.People],
      ["Remove Owner", ActionMenuGroup.People],
    ]);
  });

  test("Assign to Me makes the viewer an owner of that row, at once, and the list is read again", async () => {
    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down")}
        config={INCIDENT_OWNERS}
      />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: ASSIGN_TO_ME_TITLE }),
    );

    // No dialog: there is nothing to pick.
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
    expect(createdOwners()).toEqual([
      { userId: VIEWER_ID, incidentId: INCIDENT_ONE_ID },
    ]);
    expect(
      (createMock.mock.calls[0] as Array<any>)[0].model.projectId.toString(),
    ).toBe(PROJECT_ID);
  });

  test("on a row the viewer owns already, Assign to Me adds nothing twice", async () => {
    ownedForTest[INCIDENT_ONE_ID] = [VIEWER_ID];

    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down")}
        config={INCIDENT_OWNERS}
      />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: ASSIGN_TO_ME_TITLE }),
    );

    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  test("a row the list knows the viewer owns does not offer Assign to Me; one it does not know yet does", () => {
    const owned: Record<string, boolean | undefined> = {
      [INCIDENT_ONE_ID]: true,
      [INCIDENT_TWO_ID]: undefined,
    };
    const config: BulkOwnerActionsConfig<Incident> = {
      ...INCIDENT_OWNERS,
      isOwnedByMe: (item: Incident): boolean | undefined => {
        return owned[item._id || ""];
      },
    };

    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down")}
        config={config}
      />,
    );

    expect(menuItemNames(openMenu())).toEqual(["Add Owner"]);

    cleanup();

    render(
      <RowHarness
        item={incident(INCIDENT_TWO_ID, "Payments slow")}
        config={config}
      />,
    );

    expect(menuItemNames(openMenu())).toEqual([
      ASSIGN_TO_ME_TITLE,
      "Add Owner",
    ]);
  });

  test("Assign to Me says why it could not, when nobody is signed in", async () => {
    window.localStorage.clear();

    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down")}
        config={INCIDENT_OWNERS}
      />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: ASSIGN_TO_ME_TITLE }),
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "You are not signed in.",
      );
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(refreshCount).toBe(0);
  });

  test("Add Owner opens the picker for that row, naming it, and adds who is picked", async () => {
    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down")}
        config={INCIDENT_OWNERS}
      />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Add Owner" }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          "Add Owner",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      ADD_OWNER_TO_ROW_DESCRIPTION.replace("{{name}}", "Checkout API down"),
    );
    /*
     * Said once: the field draws no line of its own saying again whose
     * owners these become.
     */
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "are added as owners of",
    );

    fireEvent.click(screen.getByRole("button", { name: "Add owner" }));

    const list: HTMLElement = await screen.findByTestId(
      "people-search-popup",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const alice: HTMLElement | undefined = (
      await within(list).findAllByRole("option", {}, { timeout: WAIT_TIMEOUT })
    ).find((option: HTMLElement): boolean => {
      return (
        option.querySelector(".text-sm.font-medium")?.textContent === "Alice"
      );
    });

    fireEvent.click(alice!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(createdOwners()).toEqual([
      { userId: ALICE_ID, incidentId: INCIDENT_ONE_ID },
    ]);
    expect(refreshCount).toBe(1);
  });
});

describe("a row's Add Owner, on a slow connection", () => {
  test("keeps the dialog as filled in, its button busy, while the owner is added, and a second press adds nothing more", async () => {
    let release: () => void = (): void => {};
    createMock.mockImplementation(async (): Promise<any> => {
      await new Promise<void>((resolve: () => void) => {
        release = resolve;
      });

      return {};
    });

    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down")}
        config={INCIDENT_OWNERS}
      />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Add Owner" }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          "Add Owner",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(screen.getByRole("button", { name: "Add owner" }));

    const list: HTMLElement = await screen.findByTestId(
      "people-search-popup",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const alice: HTMLElement | undefined = (
      await within(list).findAllByRole("option", {}, { timeout: WAIT_TIMEOUT })
    ).find((option: HTMLElement): boolean => {
      return (
        option.querySelector(".text-sm.font-medium")?.textContent === "Alice"
      );
    });

    fireEvent.click(alice!);

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
      },
      { timeout: WAIT_TIMEOUT },
    );
    // Who was picked stays in view while they are added.
    expect(screen.getByTestId("modal")).toHaveTextContent("Alice");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await act(async () => {
      release();
    });

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(createdOwners()).toEqual([
      { userId: ALICE_ID, incidentId: INCIDENT_ONE_ID },
    ]);
    expect(refreshCount).toBe(1);
  });
});

describe("Assign to Me in Bulk Actions", () => {
  const progress: Array<ProgressInfo<Incident>> = [];

  const runBulk: (
    result: BulkOwnerActionsResult<Incident>,
    title: string,
    items: Array<Incident>,
  ) => Promise<void> = async (
    result: BulkOwnerActionsResult<Incident>,
    title: string,
    items: Array<Incident>,
  ): Promise<void> => {
    const action: any = result.bulkActions.find((candidate: any): boolean => {
      return candidate.title === title;
    });

    await act(async () => {
      await action.onClick({
        items: items,
        onProgressInfo: (info: ProgressInfo<Incident>): void => {
          progress.push(info);
        },
        onBulkActionStart: (): void => {},
        onBulkActionEnd: (): void => {},
      } as BulkActionOnClickProps<Incident>);
    });
  };

  beforeEach(() => {
    progress.length = 0;
  });

  test("is offered only where the list asks for it, ahead of Add Owner", () => {
    const plain: BulkOwnerActionsResult<Incident> = renderHook(() => {
      return useBulkOwnerActions<Incident>(INCIDENT_OWNERS);
    }).result.current;
    const work: BulkOwnerActionsResult<Incident> = renderHook(() => {
      return useBulkOwnerActions<Incident>({
        ...INCIDENT_OWNERS,
        offerAssignToMeInBulk: true,
      });
    }).result.current;

    expect(
      plain.bulkActions.map((action: { title: string }) => {
        return action.title;
      }),
    ).toEqual(["Add Owner", "Remove Owner"]);
    expect(
      work.bulkActions.map((action: { title: string }) => {
        return action.title;
      }),
    ).toEqual([ASSIGN_TO_ME_TITLE, "Add Owner", "Remove Owner"]);
  });

  test("makes the viewer an owner of each selected row, leaving one they own already alone, with why", async () => {
    ownedForTest[INCIDENT_TWO_ID] = [VIEWER_ID];

    const result: BulkOwnerActionsResult<Incident> = renderHook(() => {
      return useBulkOwnerActions<Incident>({
        ...INCIDENT_OWNERS,
        offerAssignToMeInBulk: true,
      });
    }).result.current;

    await runBulk(result, ASSIGN_TO_ME_TITLE, [
      incident(INCIDENT_ONE_ID, "Checkout API down"),
      incident(INCIDENT_TWO_ID, "Payments slow"),
    ]);

    const last: ProgressInfo<Incident> = progress[progress.length - 1]!;

    expect(createdOwners()).toEqual([
      { userId: VIEWER_ID, incidentId: INCIDENT_ONE_ID },
    ]);
    expect(
      last.successItems.map((item: Incident) => {
        return item._id;
      }),
    ).toEqual([INCIDENT_ONE_ID]);
    expect(
      (last.unchanged || []).map((entry: BulkActionUnchanged<Incident>) => {
        return [entry.item._id, entry.reason];
      }),
    ).toEqual([[INCIDENT_TWO_ID, ALREADY_OWNED_BY_YOU]]);
    expect(last.failed).toEqual([]);
  });
});
