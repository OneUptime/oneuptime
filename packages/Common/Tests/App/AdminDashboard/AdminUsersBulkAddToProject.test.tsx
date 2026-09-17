import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
/*
 * `act` from React itself rather than from @testing-library/react: on React
 * 18.3 the latter still forwards to the deprecated ReactDOMTestUtils.act, which
 * React asks you not to import.
 */
import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { Location, MemoryRouter } from "react-router-dom";

/*
 * "Add to Project" is the one bulk action on the Users table that cannot run
 * from the bulk bar alone - it needs a project and one of that project's teams
 * first. So the page splits the action in two: the click only opens a picker,
 * and the memberships are created after the picker is submitted.
 *
 * That split is the whole risk. The shared bulk machinery hands the click four
 * callbacks and then waits: the progress modal appears on `onBulkActionStart`,
 * its Close button stays disabled until `onBulkActionEnd`, and only closing it
 * clears the selection and refetches the table. Call them in the wrong order,
 * or miss one on a path, and the admin is left either staring at an empty
 * progress modal behind the picker or at a modal they can never close.
 *
 * None of that is visible from either component on its own - the creates live
 * in BulkAddUsersToProject and the picker only collects - so this file pins the
 * page's sequencing, with both of them stubbed.
 */

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

/*
 * The real ModelTable would drag in the pager, the URL state and a live fetch.
 * What this file is about is the props the page hands it - here the bulk action
 * declarations - so a stand-in that records them is both enough and more
 * precise.
 */
type CapturedTableProps = {
  bulkActions?: { buttons: Array<BulkActionButtonSchema<User>> } | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

/*
 * Every step the page takes, in the order it took it. The three bulk callbacks
 * are recorded here rather than only counted because "was called" is not the
 * property that matters - `onBulkActionEnd` firing before the creates finish
 * would re-enable the progress modal's Close button mid-run, and the selection
 * would clear while memberships were still being created.
 */
const recordedEvents: Array<string> = [];

const PICKER_TEST_ID: string = "bulk-add-users-to-project-picker";

type CapturedModalProps = {
  users: Array<User>;
  onClose: () => void;
  onSubmit: (selection: BulkAddUsersToProjectSelection) => void;
};

let capturedModalProps: CapturedModalProps | null = null;

/*
 * The picker stands in for the two-step project/team form. Stubbing it lets the
 * test submit a selection directly, and - because the stub renders a node and
 * records its own teardown - lets the test see exactly when the page took the
 * picker off the screen.
 */
jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProjectModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedModalProps) => {
        capturedModalProps = props;

        React.useEffect(() => {
          return () => {
            recordedEvents.push("picker-closed");
          };
        }, []);

        return React.createElement("div", { "data-testid": PICKER_TEST_ID });
      },
    };
  },
);

type BulkAddUsersToProjectFunction = (
  options: BulkAddUsersToProjectOptions,
) => Promise<BulkAddUsersToProjectResult>;

const bulkAddUsersToProjectMock: Mock<BulkAddUsersToProjectFunction> =
  jest.fn<BulkAddUsersToProjectFunction>();

/*
 * The creates themselves have their own tests. Stubbing them here leaves only
 * the page's half under test: what it passes down, how it renames the running
 * tally on the way back up, and what it does when the run blows up.
 */
jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProject",
  () => {
    return {
      __esModule: true,
      bulkAddUsersToProject: (options: BulkAddUsersToProjectOptions) => {
        recordedEvents.push("creates-started");
        return bulkAddUsersToProjectMock(options);
      },
    };
  },
);

import Users from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/Index";
import {
  BulkAddUsersToProjectOptions,
  BulkAddUsersToProjectResult,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProject";
import { BulkAddUsersToProjectSelection } from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProjectModal";
import {
  BulkActionButtonSchema,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../Models/DatabaseModels/User";

const ADD_TO_PROJECT_TITLE_KEY: string = "pages.users.bulkAddToProject";

/*
 * What the server throws when a selected user is already on the team. It is a
 * normal outcome of a bulk add - a few of the selected users being on the
 * project already must not stop the rest - so it travels as a per-user message
 * rather than as a failure of the run.
 */
const ALREADY_INVITED_MESSAGE: string =
  "This user has already been invited to this team";

/*
 * What the run itself failing looks like - the request never left, the session
 * expired. Distinct from ALREADY_INVITED_MESSAGE above, which is a per-user
 * outcome the creates report and carry on from.
 */
const RUN_BROKE_MESSAGE: string =
  "Error connecting to server. Please try again.";

const SELECTION: BulkAddUsersToProjectSelection = {
  projectId: ObjectID.generate(),
  teamId: ObjectID.generate(),
  hasAcceptedInvitation: true,
};

/*
 * The same pick with the auto-accept checkbox left alone, which is its default.
 * It exists so the flag is exercised in both positions: a page that ignored the
 * picker's answer and always sent `true` would be indistinguishable from a
 * correct one if every test submitted the same selection.
 */
const SELECTION_WITHOUT_AUTO_ACCEPT: BulkAddUsersToProjectSelection = {
  projectId: ObjectID.generate(),
  teamId: ObjectID.generate(),
  hasAcceptedInvitation: false,
};

type UserFactoryFunction = () => User;

const aUser: UserFactoryFunction = (): User => {
  const user: User = new User();
  user.id = ObjectID.generate();
  return user;
};

let userOne: User = aUser();
let userTwo: User = aUser();
let userThree: User = aUser();
let userFour: User = aUser();
let userFive: User = aUser();

type ResultFactoryFunction = (
  users: Array<User>,
) => BulkAddUsersToProjectResult;

const allSucceeded: ResultFactoryFunction = (
  users: Array<User>,
): BulkAddUsersToProjectResult => {
  return {
    totalUsers: users,
    inProgressUsers: [],
    succeededUsers: users,
    failedUsers: [],
  };
};

type BulkActionButtonsFunction = () => Array<BulkActionButtonSchema<User>>;

const bulkActionButtons: BulkActionButtonsFunction = (): Array<
  BulkActionButtonSchema<User>
> => {
  return capturedTableProps?.bulkActions?.buttons || [];
};

type BulkActionTitledFunction = (title: string) => BulkActionButtonSchema<User>;

const bulkActionTitled: BulkActionTitledFunction = (
  title: string,
): BulkActionButtonSchema<User> => {
  const button: BulkActionButtonSchema<User> | undefined =
    bulkActionButtons().find((candidate: BulkActionButtonSchema<User>) => {
      return candidate.title === title;
    });

  if (!button) {
    throw new Error(
      `No "${title}" bulk action. Bulk actions: ${bulkActionButtons()
        .map((candidate: BulkActionButtonSchema<User>) => {
          return candidate.title;
        })
        .join(", ")}`,
    );
  }

  return button;
};

/*
 * Stand-ins for the four things the bulk bar hands an action's onClick. Kept as
 * mocks rather than as a real BulkUpdateForm because what is being pinned is
 * which of them the page calls, and when.
 */
type BulkActionCallbackMocks = {
  items: Array<User>;
  onProgressInfo: Mock<(progressInfo: ProgressInfo<User>) => void>;
  onBulkActionStart: Mock<() => void>;
  onBulkActionEnd: Mock<() => void>;
};

type BulkActionCallbacksFactoryFunction = (
  items: Array<User>,
) => BulkActionCallbackMocks;

const bulkActionCallbacks: BulkActionCallbacksFactoryFunction = (
  items: Array<User>,
): BulkActionCallbackMocks => {
  return {
    items: items,
    onProgressInfo: jest.fn<(progressInfo: ProgressInfo<User>) => void>(),
    onBulkActionStart: jest.fn<() => void>((): void => {
      recordedEvents.push("bulk-action-start");
    }),
    onBulkActionEnd: jest.fn<() => void>((): void => {
      recordedEvents.push("bulk-action-end");
    }),
  };
};

type InActFunction = (work: () => Promise<void> | void) => Promise<void>;

/*
 * `await act(...)` with a hand-attached continuation.
 *
 * act() returns a bare thenable and then, two microtasks later, warns if
 * nothing has called its `then` yet. A plain `await` only attaches that handler
 * on the next microtask, and zone.js - loaded here through the page's
 * dependencies, and it patches Promise - lands the check first. The result is
 * an "act without await" warning on every call that IS awaited, which is
 * exactly the warning a reader of a sequencing test must be able to trust.
 * Calling `then` directly enters the scope's continuation there and then.
 */
const inAct: InActFunction = (
  work: () => Promise<void> | void,
): Promise<void> => {
  const actScope: Promise<void> = act(async () => {
    await work();
  });

  return new Promise<void>(
    (
      resolve: (value: void | PromiseLike<void>) => void,
      reject: (reason: unknown) => void,
    ): void => {
      actScope.then(resolve, reject);
    },
  );
};

type ClickAddToProjectFunction = (
  callbacks: BulkActionCallbackMocks,
) => Promise<void>;

const clickAddToProject: ClickAddToProjectFunction = async (
  callbacks: BulkActionCallbackMocks,
): Promise<void> => {
  await inAct(() => {
    return bulkActionTitled(ADD_TO_PROJECT_TITLE_KEY).onClick(callbacks);
  });
};

type SubmitPickerFunction = (
  selection?: BulkAddUsersToProjectSelection,
) => Promise<void>;

const submitPicker: SubmitPickerFunction = async (
  selection: BulkAddUsersToProjectSelection = SELECTION,
): Promise<void> => {
  const picker: CapturedModalProps | null = capturedModalProps;

  if (!picker) {
    throw new Error("The picker was never rendered.");
  }

  await inAct(() => {
    picker.onSubmit(selection);
  });
};

type ClosePickerFunction = () => Promise<void>;

const closePicker: ClosePickerFunction = async (): Promise<void> => {
  const picker: CapturedModalProps | null = capturedModalProps;

  if (!picker) {
    throw new Error("The picker was never rendered.");
  }

  await inAct(() => {
    picker.onClose();
  });
};

type CreateOptionsFunction = () => BulkAddUsersToProjectOptions;

const createOptions: CreateOptionsFunction =
  (): BulkAddUsersToProjectOptions => {
    const options: BulkAddUsersToProjectOptions | undefined =
      bulkAddUsersToProjectMock.mock.calls[0]?.[0];

    if (!options) {
      throw new Error("bulkAddUsersToProject was never called.");
    }

    return options;
  };

describe("Admin > Users > Add to Project bulk action", () => {
  beforeEach(async () => {
    capturedTableProps = null;
    capturedModalProps = null;
    recordedEvents.length = 0;

    userOne = aUser();
    userTwo = aUser();
    userThree = aUser();
    userFour = aUser();
    userFive = aUser();

    bulkAddUsersToProjectMock.mockReset();
    bulkAddUsersToProjectMock.mockImplementation(
      (
        options: BulkAddUsersToProjectOptions,
      ): Promise<BulkAddUsersToProjectResult> => {
        return Promise.resolve(allSucceeded(options.users));
      },
    );

    /*
     * The page reads the current route to build the row's view link. In the
     * app the router pushes this in; under test nothing does.
     */
    Navigation.setLocation({
      pathname: "/admin/users",
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(capturedTableProps).not.toBeNull();
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("how it is declared", () => {
    /*
     * The bulk menu puts the destructive actions last, behind a divider, so the
     * first entry is the one an admin's eye lands on. Adding users to a project
     * is the everyday reason to select rows here; blocking and deleting are
     * not.
     */
    test("is the first bulk action offered", () => {
      expect(bulkActionButtons()[0]?.title).toBe(ADD_TO_PROJECT_TITLE_KEY);
    });

    /*
     * The action was inserted at the head of an existing array. A stray edit
     * there would drop or reorder the actions the page already had, and the
     * bulk menu renders whatever it is given without complaint.
     */
    test("has not displaced Block, Unblock or Delete", () => {
      const legacyTitles: Array<string> = ["Block", "Unblock", "Delete"];

      expect(
        bulkActionButtons()
          .map((button: BulkActionButtonSchema<User>) => {
            return button.title;
          })
          .filter((title: string) => {
            return legacyTitles.includes(title);
          }),
      ).toEqual(legacyTitles);
    });

    /*
     * BulkUpdateForm shows a ConfirmModal *instead of* running the click when
     * `confirmMessage` is set, and only runs the click once it is submitted.
     * For this action the click is what opens the picker, so a confirm message
     * would put an "are you sure" dialog in front of a form the admin has not
     * even filled in yet - it has nothing to confirm.
     */
    test("declares no confirm dialog to stack in front of the picker", () => {
      expect(
        bulkActionTitled(ADD_TO_PROJECT_TITLE_KEY).confirmMessage,
      ).toBeUndefined();
    });

    /*
     * The title is a translation key, not an English string: this page is
     * rendered in every locale the admin dashboard ships, and a hardcoded label
     * would silently stay English. The icon is what tells the two "add"-ish
     * entries apart in the menu.
     */
    test("declares its icon and its translated title key", () => {
      expect(bulkActionTitled(ADD_TO_PROJECT_TITLE_KEY).title).toBe(
        "pages.users.bulkAddToProject",
      );
      expect(bulkActionTitled(ADD_TO_PROJECT_TITLE_KEY).icon).toBe(
        IconProp.FolderPlus,
      );
    });
  });

  describe("clicking it", () => {
    /*
     * The click is the only thing that opens the picker. The page renders it
     * off a piece of state that starts null, and a regression that rendered it
     * unconditionally would put a project/team form in front of an admin who
     * came only to read the table.
     *
     * Every other test in this file clicks first, so each of them would still
     * find a picker on screen if it had been there all along - which makes
     * "opens the picker" a claim none of them can actually support without
     * this one.
     */
    test("renders no picker before the action is clicked", () => {
      expect(screen.queryByTestId(PICKER_TEST_ID)).not.toBeInTheDocument();
      expect(capturedModalProps).toBeNull();
    });

    /*
     * `onBulkActionStart` is what puts the progress modal on screen and flips
     * the run to in-progress. Calling it here - before the admin has chosen a
     * project - would park an empty progress bar behind the picker, with a
     * Close button disabled for a run that has not started.
     */
    test("starts nothing", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);

      expect(callbacks.onBulkActionStart).not.toHaveBeenCalled();
      expect(bulkAddUsersToProjectMock).not.toHaveBeenCalled();
    });

    /*
     * The picker has to be handed the rows the click carried, not the page's
     * own idea of the selection - the page never sees the table's selection
     * state, it only ever gets it through the click. Handing it anything else
     * would create memberships for users the admin did not tick.
     */
    test("opens the picker over exactly the selected users", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      /*
       * Pinned here too, and not only in the test above, so that this test's
       * own "opens" is about the click rather than about a picker that was
       * already there.
       */
      expect(screen.queryByTestId(PICKER_TEST_ID)).not.toBeInTheDocument();

      await clickAddToProject(callbacks);

      expect(screen.getByTestId(PICKER_TEST_ID)).toBeInTheDocument();
      expect(capturedModalProps?.users).toBe(callbacks.items);
    });

    /*
     * The bulk bar hands a fresh set of props to every click, and the page has
     * to be looking at the latest one - both when it renders the picker and
     * when it finally runs the creates.
     *
     * An admin who opens the picker, backs out, changes their ticks and opens
     * it again is the ordinary way to get two clicks with different rows. If
     * the page held onto the first click - a stale closure over it, or a picker
     * React reuses across the two opens without re-reading the state - the
     * memberships would be created for rows that are no longer selected, and
     * the progress modal would report against the first click's callbacks while
     * the second click's are left waiting forever.
     */
    test("reopening after a cancel uses the second click's users, not the first's", async () => {
      const firstClick: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
      ]);

      await clickAddToProject(firstClick);

      expect(capturedModalProps?.users).toBe(firstClick.items);

      await closePicker();

      expect(screen.queryByTestId(PICKER_TEST_ID)).not.toBeInTheDocument();

      const secondClick: BulkActionCallbackMocks = bulkActionCallbacks([
        userTwo,
        userThree,
      ]);

      await clickAddToProject(secondClick);

      expect(screen.getByTestId(PICKER_TEST_ID)).toBeInTheDocument();
      expect(capturedModalProps?.users).toBe(secondClick.items);

      await submitPicker();

      expect(createOptions().users).toBe(secondClick.items);
      expect(secondClick.onBulkActionStart).toHaveBeenCalledTimes(1);
      expect(secondClick.onBulkActionEnd).toHaveBeenCalledTimes(1);

      /*
       * The abandoned click's run must stay unstarted and unended: ending it
       * would clear a selection the admin never submitted.
       */
      expect(firstClick.onBulkActionStart).not.toHaveBeenCalled();
      expect(firstClick.onBulkActionEnd).not.toHaveBeenCalled();
    });
  });

  describe("closing the picker without submitting", () => {
    /*
     * Backing out is not a run. Starting one would leave a progress modal the
     * admin never asked for, and - worse - ending one that never started makes
     * the table clear the selection, throwing away the rows they picked. The
     * selection has to survive so they can reopen the picker and try again.
     */
    test("leaves the run unstarted and unended", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);

      const picker: CapturedModalProps | null = capturedModalProps;

      await inAct(() => {
        picker?.onClose();
      });

      expect(screen.queryByTestId(PICKER_TEST_ID)).not.toBeInTheDocument();
      expect(bulkAddUsersToProjectMock).not.toHaveBeenCalled();
      expect(callbacks.onBulkActionStart).not.toHaveBeenCalled();
      expect(callbacks.onBulkActionEnd).not.toHaveBeenCalled();
    });
  });

  describe("submitting the picker", () => {
    /*
     * The order is the feature, but read the asserted list carefully: it is
     * NOT evidence that the picker leaves the screen before the creates begin,
     * and no test could be.
     *
     * Dismissing the picker and starting the run are two state updates made
     * from one handler, so React commits them together. "picker-closed" is the
     * stub's unmount effect, which runs when that single commit flushes - after
     * the handler has already called `onBulkActionStart` and reached the
     * creates synchronously. Hence start, creates, picker-closed. Both updates
     * landing in one commit is the actual guarantee: the admin never sees a
     * frame with the picker up and the run already going.
     *
     * What this pins is the part that does matter. `onBulkActionStart` runs
     * before the creates, and `onBulkActionEnd` only once they settle - the
     * mid-run assertions below hold the creates open to prove `end` has not
     * fired yet. Ending early re-enables the progress modal's Close button, and
     * closing it is what clears the selection and refetches the table, so an
     * early end throws away the selection while memberships are still being
     * created. And by the time the run is observably in flight the picker is
     * already off the screen, so the progress modal is not stacked behind it.
     */
    test("closes the picker, then runs start -> creates -> end in order", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);

      /*
       * Held open so the assertions can look at the page mid-run, which is the
       * only moment at which "the picker is gone but the run is not finished"
       * is a distinguishable state.
       */
      const run: { finish: () => void } = {
        finish: (): void => {
          throw new Error("The creates were never started.");
        },
      };

      bulkAddUsersToProjectMock.mockImplementation(
        (
          options: BulkAddUsersToProjectOptions,
        ): Promise<BulkAddUsersToProjectResult> => {
          return new Promise<BulkAddUsersToProjectResult>(
            (resolve: (result: BulkAddUsersToProjectResult) => void) => {
              run.finish = (): void => {
                resolve(allSucceeded(options.users));
              };
            },
          );
        },
      );

      await submitPicker();

      expect(screen.queryByTestId(PICKER_TEST_ID)).not.toBeInTheDocument();
      expect(callbacks.onBulkActionEnd).not.toHaveBeenCalled();

      await inAct(() => {
        run.finish();
      });

      expect(callbacks.onBulkActionEnd).toHaveBeenCalledTimes(1);
      expect(recordedEvents).toEqual([
        "bulk-action-start",
        "creates-started",
        "picker-closed",
        "bulk-action-end",
      ]);
    });

    /*
     * The selection the picker collected has to reach the creates intact, and
     * against the users the click carried. `hasAcceptedInvitation` in
     * particular is the difference between adding members outright and sending
     * invitations nobody asked for - only a master admin may do the former, so
     * dropping the flag silently downgrades the whole batch to pending.
     */
    test("hands the creates the clicked users and the picked project, team and auto-accept", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);
      await submitPicker();

      expect(createOptions().users).toBe(callbacks.items);
      expect(createOptions().projectId).toBe(SELECTION.projectId);
      expect(createOptions().teamId).toBe(SELECTION.teamId);
      expect(createOptions().hasAcceptedInvitation).toBe(true);
    });

    /*
     * The other half of that flag, and the reason it needs its own test: the
     * checkbox defaults to unticked, so `false` is what an ordinary submit
     * carries. A page that ignored `selection.hasAcceptedInvitation` and always
     * sent `true` would satisfy the test above and every other test in this
     * file, because they all submit the same auto-accept selection.
     *
     * Sending `true` there is a consent bug, not a cosmetic one. `true` makes
     * each user a member of the project outright - the invitation they were
     * meant to accept for themselves is never offered, and they are on a
     * project they never agreed to join. Unticked has to reach the creates as
     * unticked.
     */
    test("forwards an unticked auto-accept as false rather than assuming true", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);
      await submitPicker(SELECTION_WITHOUT_AUTO_ACCEPT);

      expect(createOptions().hasAcceptedInvitation).toBe(false);

      /*
       * The rest of the pick travels from the same selection object, so pin it
       * here too: reading the flag off one selection and the ids off another
       * would be a stranger bug, but a silent one.
       */
      expect(createOptions().projectId).toBe(
        SELECTION_WITHOUT_AUTO_ACCEPT.projectId,
      );
      expect(createOptions().teamId).toBe(SELECTION_WITHOUT_AUTO_ACCEPT.teamId);
    });

    /*
     * The two sides speak different dialects: the creates count users, the
     * shared progress modal counts items. The page is the only translator, and
     * every one of the four names differs. Get one wrong and the field arrives
     * `undefined` - the progress bar reads 0 of 0, or the per-user failure list
     * renders empty, which is exactly the list an admin came here to read.
     */
    test("renames the running tally into the shared progress modal's shape", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);
      await submitPicker();

      createOptions().onProgress?.({
        totalUsers: [userOne, userTwo],
        inProgressUsers: [userTwo],
        succeededUsers: [userOne],
        failedUsers: [
          {
            user: userTwo,
            failedMessage: ALREADY_INVITED_MESSAGE,
          },
        ],
      });

      expect(callbacks.onProgressInfo).toHaveBeenCalledTimes(1);
      expect(callbacks.onProgressInfo).toHaveBeenCalledWith({
        totalItems: [userOne, userTwo],
        inProgressItems: [userTwo],
        successItems: [userOne],
        failed: [
          {
            item: userTwo,
            failedMessage: ALREADY_INVITED_MESSAGE,
          },
        ],
      });
    });

    /*
     * A user who is already on the team comes back as a per-user failure, so
     * reaching the catch means the run itself broke - the request never left,
     * the session expired, something unforeseen. The progress modal's Close
     * button is disabled for as long as the action is in progress, and closing
     * it is the only thing that clears the selection and refetches the table.
     * So a missed `onBulkActionEnd` here is not a lost error message, it is a
     * modal the admin can never dismiss.
     *
     * This is the reject that happens before a single user was attempted, so
     * "nobody was added" is the truth and the whole selection is reported
     * failed. The test below covers the reject that lands part-way through,
     * where reporting the whole selection would be a lie.
     */
    test("still ends the run, and reports every user failed, when the creates reject before any user is attempted", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
      ]);

      await clickAddToProject(callbacks);

      bulkAddUsersToProjectMock.mockImplementation(
        (): Promise<BulkAddUsersToProjectResult> => {
          return Promise.reject(new Error(RUN_BROKE_MESSAGE));
        },
      );

      await submitPicker();

      expect(callbacks.onBulkActionEnd).toHaveBeenCalledTimes(1);
      expect(callbacks.onProgressInfo).toHaveBeenCalledWith({
        totalItems: callbacks.items,
        inProgressItems: [],
        successItems: [],
        failed: [
          {
            item: userOne,
            failedMessage: RUN_BROKE_MESSAGE,
          },
          {
            item: userTwo,
            failedMessage: RUN_BROKE_MESSAGE,
          },
        ],
      });
    });

    /*
     * The creates run one user at a time and report after each, so a run that
     * breaks half way has already created real memberships. Those users are on
     * the project whatever happens next.
     *
     * The final report is the only record the admin gets - the progress modal
     * is what they read, and closing it clears the selection and refetches. So
     * the recovery has to keep what the last report said: the users already
     * added stay added, the per-user failure already recorded (here: already on
     * the team) keeps its own message rather than being overwritten by the
     * run's, and only the users never attempted are added as failures. Blanket
     * "everything failed" would send the admin to re-add users who are already
     * members, and blanket "everything succeeded" would leave the not-attempted
     * ones off the project with nothing on screen saying so.
     *
     * `onBulkActionEnd` still has to run on this path too, for the same reason
     * as above - otherwise the Close button never unlocks.
     */
    test("keeps the already-added users and fails only the not-yet-attempted ones when the creates reject mid-run", async () => {
      const callbacks: BulkActionCallbackMocks = bulkActionCallbacks([
        userOne,
        userTwo,
        userThree,
        userFour,
        userFive,
      ]);

      await clickAddToProject(callbacks);

      bulkAddUsersToProjectMock.mockImplementation(
        (
          options: BulkAddUsersToProjectOptions,
        ): Promise<BulkAddUsersToProjectResult> => {
          /*
           * Three users dealt with - two added, one already on the team - and
           * then the run breaks with userFour and userFive never attempted.
           */
          options.onProgress?.({
            totalUsers: [userOne, userTwo, userThree, userFour, userFive],
            inProgressUsers: [userFour, userFive],
            succeededUsers: [userOne, userTwo],
            failedUsers: [
              {
                user: userThree,
                failedMessage: ALREADY_INVITED_MESSAGE,
              },
            ],
          });

          return Promise.reject(new Error(RUN_BROKE_MESSAGE));
        },
      );

      await submitPicker();

      expect(callbacks.onBulkActionEnd).toHaveBeenCalledTimes(1);

      /*
       * Once for the mid-run tally, once for the recovery. The recovery report
       * is what the admin is left looking at, so it is the last one that has to
       * be right.
       */
      expect(callbacks.onProgressInfo).toHaveBeenCalledTimes(2);
      expect(callbacks.onProgressInfo).toHaveBeenLastCalledWith({
        totalItems: [userOne, userTwo, userThree, userFour, userFive],
        inProgressItems: [],
        successItems: [userOne, userTwo],
        failed: [
          {
            item: userThree,
            failedMessage: ALREADY_INVITED_MESSAGE,
          },
          {
            item: userFour,
            failedMessage: RUN_BROKE_MESSAGE,
          },
          {
            item: userFive,
            failedMessage: RUN_BROKE_MESSAGE,
          },
        ],
      });
    });
  });
});
