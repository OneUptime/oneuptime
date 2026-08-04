import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { act, FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * useBulkLabelActions is the single mutator behind "Add Labels" and "Remove
 * Labels" on every resource list in the product, and it had no test coverage at
 * all before this change. Most of what follows is therefore baseline coverage
 * of a previously untested shared hook - the merge/subtract arithmetic, the
 * per-item failure isolation, and the progress accounting the bulk progress bar
 * is drawn from - not coverage of the SLO tables that prompted the work. Its
 * failure mode is silent: each write is a read-modify-write of the item's own
 * label array, so anything that goes wrong in the middle overwrites labels the
 * user never selected and still reports the item as a success.
 *
 * The tests that pin the fixes actually made in this change are:
 *   - "does not fetch labels at all when there is no current project"
 *     (projectId: null went out as a filter matching nothing)
 *   - "drops a dropdown option that came back without an id before merging"
 *     (a blank id in the labels array failed the whole item)
 *   - "reads the item's current label ids before merging" (the select now asks
 *     for _id, which the guard below depends on)
 *   - "fails an item whose current read carries no id ..." and
 *     "... comes back as null ..." (a deleted or filtered row answers 200 with
 *     {}, which hydrates truthy, so add mode used to clobber its whole label
 *     set)
 *   - "starts nothing and reports nothing when every submitted label id is
 *     blank" (that path used to report every item as a success)
 *   - "keeps the newest selection's remove options when an older fetch settles
 *     last" (the stale response used to win)
 *   - the two "opening X closes an open Y modal" tests (stacked modals share
 *     one bulkActionProps and the loser goes silently inert)
 */

/*
 * react-i18next is not initialized in the test environment. Mock the hook so
 * translate helpers echo their input and the component renders synchronously.
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
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import useBulkLabelActions, {
  BulkLabelActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkLabelActions";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import API from "../../../UI/Utils/API/API";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import { Red } from "../../../Types/BrandColors";

/*
 * These tests drive real Formik + react-select trees behind a modal, so the
 * testing-library default of 1s flakes on a loaded box.
 */
const WAIT_TIMEOUT: number = 20000;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ITEM_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const ITEM_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const ITEM_THREE_ID: string = "22222222-2222-4222-8222-222222222223";
const LABEL_ALPHA_ID: string = "33333333-3333-4333-8333-333333333331";
const LABEL_BETA_ID: string = "33333333-3333-4333-8333-333333333332";
const LABEL_GAMMA_ID: string = "33333333-3333-4333-8333-333333333333";

type MakeLabelFunction = (id: string, name: string) => Label;

const makeLabel: MakeLabelFunction = (id: string, name: string): Label => {
  const label: Label = new Label();
  label._id = id;
  label.name = name;
  return label;
};

type MakeItemFunction = (id: string) => Monitor;

const makeItem: MakeItemFunction = (id: string): Monitor => {
  const item: Monitor = new Monitor();
  item._id = id;
  return item;
};

type MakeItemWithLabelsFunction = (id: string, labels: Array<Label>) => Monitor;

const makeItemWithLabels: MakeItemWithLabelsFunction = (
  id: string,
  labels: Array<Label>,
): Monitor => {
  const item: Monitor = makeItem(id);
  item.labels = labels;
  return item;
};

interface ProgressSnapshot {
  totalIds: Array<string>;
  inProgressIds: Array<string>;
  successIds: Array<string>;
  failedIds: Array<string>;
  failedMessages: Array<string>;
}

type IdsOfFunction = (items: Array<Monitor>) => Array<string>;

const idsOf: IdsOfFunction = (items: Array<Monitor>): Array<string> => {
  return items.map((item: Monitor) => {
    return item._id || "";
  });
};

type SnapshotProgressFunction = (
  progressInfo: ProgressInfo<Monitor>,
) => ProgressSnapshot;

/*
 * The hook allocates the four progress arrays once and hands the same
 * references to every onProgressInfo call, so anything held by reference
 * mutates retroactively into the final state. Copy out of them on arrival or
 * the per-step assertions below are meaningless.
 */
const snapshotProgress: SnapshotProgressFunction = (
  progressInfo: ProgressInfo<Monitor>,
): ProgressSnapshot => {
  return {
    totalIds: idsOf(progressInfo.totalItems),
    inProgressIds: idsOf(progressInfo.inProgressItems),
    successIds: idsOf(progressInfo.successItems),
    failedIds: idsOf(
      progressInfo.failed.map((failure: BulkActionFailed<Monitor>) => {
        return failure.item;
      }),
    ),
    failedMessages: progressInfo.failed.map(
      (failure: BulkActionFailed<Monitor>) => {
        return String(failure.failedMessage);
      },
    ),
  };
};

const onProgressInfoMock: MockFunction = getJestMockFunction();
const onBulkActionStartMock: MockFunction = getJestMockFunction();
const onBulkActionEndMock: MockFunction = getJestMockFunction();

let progressSnapshots: Array<ProgressSnapshot> = [];
let callOrder: Array<string> = [];
let capturedActions: Array<BulkActionButtonSchema<Monitor>> = [];
let capturedModals: ReactElement | null = null;

type MakeActionPropsFunction = (
  items: Array<Monitor>,
) => BulkActionOnClickProps<Monitor>;

const makeActionProps: MakeActionPropsFunction = (
  items: Array<Monitor>,
): BulkActionOnClickProps<Monitor> => {
  return {
    items: items,
    onProgressInfo:
      onProgressInfoMock as unknown as BulkActionOnClickProps<Monitor>["onProgressInfo"],
    onBulkActionStart: onBulkActionStartMock as unknown as () => void,
    onBulkActionEnd: onBulkActionEndMock as unknown as () => void,
  };
};

interface HarnessProps {
  items: Array<Monitor>;
}

/*
 * `modals` has to be mounted for any of the modal behavior to exist, which
 * renderHook cannot do, so the hook is driven through a component that renders
 * a plain trigger per action.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const { bulkActions, modals }: BulkLabelActionsResult<Monitor> =
    useBulkLabelActions<Monitor>({ modelType: Monitor });

  capturedActions = bulkActions;
  capturedModals = modals;

  return (
    <div>
      {bulkActions.map((action: BulkActionButtonSchema<Monitor>) => {
        return (
          <button
            key={action.title}
            type="button"
            onClick={() => {
              void action.onClick(makeActionProps(props.items));
            }}
          >
            {`Trigger ${action.title}`}
          </button>
        );
      })}
      {modals}
    </div>
  );
};

type ClickTriggerFunction = (title: string) => void;

const clickTrigger: ClickTriggerFunction = (title: string): void => {
  fireEvent.click(screen.getByText(`Trigger ${title}`));
};

type WaitForModalTitleFunction = (title: string) => Promise<void>;

const waitForModalTitle: WaitForModalTitleFunction = async (
  title: string,
): Promise<void> => {
  await waitFor(
    () => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(title);
    },
    { timeout: WAIT_TIMEOUT },
  );
};

type WaitForMountedLabelFetchFunction = () => Promise<void>;

/*
 * The mount effect writes state after its fetch settles; waiting for the call
 * keeps that write inside act() instead of leaking into the next test.
 */
const waitForMountedLabelFetch: WaitForMountedLabelFetchFunction =
  async (): Promise<void> => {
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
  };

type OpenMenuFunction = () => Promise<Array<HTMLElement>>;

/*
 * react-select renders its menu lazily; ArrowDown on the combobox is the only
 * interaction that mounts the option list.
 */
const openMenu: OpenMenuFunction = async (): Promise<Array<HTMLElement>> => {
  const combobox: HTMLElement = await screen.findByRole("combobox", undefined, {
    timeout: WAIT_TIMEOUT,
  });
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  return screen.queryAllByRole("option");
};

type OptionTextsFunction = (options: Array<HTMLElement>) => Array<string>;

const optionTexts: OptionTextsFunction = (
  options: Array<HTMLElement>,
): Array<string> => {
  return options.map((option: HTMLElement) => {
    return option.textContent || "";
  });
};

type SelectLabelFunction = (name: string) => Promise<void>;

const selectLabel: SelectLabelFunction = async (
  name: string,
): Promise<void> => {
  const combobox: HTMLElement = await screen.findByRole("combobox", undefined, {
    timeout: WAIT_TIMEOUT,
  });
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(
    await screen.findByText(name, undefined, { timeout: WAIT_TIMEOUT }),
  );
};

type SubmitModalFunction = () => void;

const submitModal: SubmitModalFunction = (): void => {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
};

interface LabelFormData {
  labelIds: Array<string>;
}

type ModalSubmitFunction = (formData: LabelFormData) => Promise<void>;

type GetModalSubmitFunction = (title: string) => ModalSubmitFunction;

/*
 * react-select cannot deliver an all-blank selection through the UI: the form's
 * required check rejects a lone blank-valued option (`[""].toString()` is "")
 * and hideSelectedOptions hides every other option sharing that same blank
 * value the moment one is picked. The hook's contract with BasicFormModal is
 * the onSubmit prop, so that boundary is driven directly instead.
 */
const getModalSubmit: GetModalSubmitFunction = (
  title: string,
): ModalSubmitFunction => {
  const modal: any = React.Children.toArray(
    (capturedModals as any).props.children,
  ).find((child: any) => {
    return child?.props?.title === title;
  });

  if (!modal) {
    throw new Error(`No "${title}" modal is mounted.`);
  }

  return modal.props.onSubmit as ModalSubmitFunction;
};

interface DeferredListResult {
  promise: Promise<any>;
  resolve: (value: any) => void;
}

type CreateDeferredListResultFunction = () => DeferredListResult;

const createDeferredListResult: CreateDeferredListResultFunction =
  (): DeferredListResult => {
    let settle: (value: any) => void = (): void => {};

    const promise: Promise<any> = new Promise<any>(
      (resolve: (value: any) => void): void => {
        settle = resolve;
      },
    );

    return {
      promise: promise,
      resolve: (value: any): void => {
        settle(value);
      },
    };
  };

type ActAsyncFunction = (body: () => Promise<void>) => Promise<void>;

/*
 * zone.js reschedules the microtask React's act() uses to check that its
 * thenable was awaited, so it runs before `await` gets round to attaching a
 * handler and every plain `await act(...)` is reported as un-awaited. Hooking
 * then() up synchronously answers that check in time; the scope still exits
 * exactly when act says it does.
 */
const actAsync: ActAsyncFunction = (
  body: () => Promise<void>,
): Promise<void> => {
  const scope: PromiseLike<void> = act(body) as unknown as PromiseLike<void>;

  return new Promise<void>(
    (resolve: () => void, reject: (reason: unknown) => void): void => {
      scope.then(resolve, reject);
    },
  );
};

type GetUpdatedLabelIdsFunction = (callIndex: number) => Array<string>;

const getUpdatedLabelIds: GetUpdatedLabelIdsFunction = (
  callIndex: number,
): Array<string> => {
  const call: Array<any> = updateByIdMock.mock.calls[callIndex] as Array<any>;
  return (call[0] as any).data.labels as Array<string>;
};

type GetListCallFunction = (callIndex: number) => any;

const getListCall: GetListCallFunction = (callIndex: number): any => {
  const call: Array<any> = getListMock.mock.calls[callIndex] as Array<any>;
  return call[0];
};

type WaitForBulkRunToEndFunction = () => Promise<void>;

const waitForBulkRunToEnd: WaitForBulkRunToEndFunction =
  async (): Promise<void> => {
    await waitFor(
      () => {
        expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
  };

type AddAlphaOverCurrentReadFunction = (
  currentRead: Monitor | null,
) => Promise<void>;

/*
 * Shared driver for the two "the current read is unusable" cases: one item,
 * one project label, add mode, with getItem answering whatever the caller
 * wants. Assertions stay in the tests so a failure points at the real case.
 */
const addAlphaOverCurrentRead: AddAlphaOverCurrentReadFunction = async (
  currentRead: Monitor | null,
): Promise<void> => {
  getListMock.mockResolvedValue({
    data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
    count: 1,
  });
  getItemMock.mockImplementation((): Promise<Monitor | null> => {
    return Promise.resolve(currentRead);
  });

  render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

  await waitForMountedLabelFetch();

  clickTrigger("Add Labels");
  await waitForModalTitle("Add Labels");
  await selectLabel("Alpha");
  submitModal();

  await waitForBulkRunToEnd();
};

/*
 * These mount the real Modal, Formik and react-select trees, so a cold
 * ts-jest transform of that import graph can push individual tests past
 * jest's 5s default - which CI, always starting cold, would report as a
 * red build with no assertion having failed. The slowest test here runs
 * in ~1.3s warm; 30s is the same ceiling App/jest.config.json already
 * sets for its whole suite.
 */
jest.setTimeout(30000);

describe("useBulkLabelActions", () => {
  beforeEach(() => {
    /*
     * resetAllMocks rather than clearAllMocks: implementations set by one test
     * would otherwise silently answer another test's requests.
     */
    jest.resetAllMocks();

    progressSnapshots = [];
    callOrder = [];
    capturedActions = [];
    capturedModals = null;

    onProgressInfoMock.mockImplementation((progressInfo: any) => {
      callOrder.push("progress");
      progressSnapshots.push(
        snapshotProgress(progressInfo as ProgressInfo<Monitor>),
      );
    });
    onBulkActionStartMock.mockImplementation(() => {
      callOrder.push("start");
    });
    onBulkActionEndMock.mockImplementation(() => {
      callOrder.push("end");
    });

    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
    updateByIdMock.mockResolvedValue({});

    window.localStorage.clear();
    window.sessionStorage.clear();
    // ProjectUtil.getCurrentProjectId() reads pathname.split("/")[2].
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/monitors`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("exposes Add Labels then Remove Labels, in that order", async () => {
    render(<Harness items={[]} />);

    await waitForMountedLabelFetch();

    /*
     * Consumers spread these into ModelTable's button list and BulkUpdateForm
     * renders them in array order, so the order is part of the contract.
     */
    expect(capturedActions).toHaveLength(2);
    expect(capturedActions[0]!.title).toBe("Add Labels");
    expect(capturedActions[1]!.title).toBe("Remove Labels");
  });

  test("keeps both actions in the non-destructive button group", async () => {
    render(<Harness items={[]} />);

    await waitForMountedLabelFetch();

    expect(capturedActions[0]!.icon).toBe(IconProp.Label);
    expect(capturedActions[0]!.buttonStyleType).toBe(ButtonStyleType.NORMAL);
    expect(capturedActions[1]!.icon).toBe(IconProp.Close);

    /*
     * Remove Labels borrows the Close icon but must not borrow a danger style:
     * BulkUpdateForm splits danger buttons into a separate red menu group
     * behind a divider, which is for irreversible actions.
     */
    expect(capturedActions[1]!.buttonStyleType).toBe(ButtonStyleType.NORMAL);
  });

  test("leaves the click contract unconditional on both actions", async () => {
    render(<Harness items={[]} />);

    await waitForMountedLabelFetch();

    expect(capturedActions).toHaveLength(2);

    for (const action of capturedActions) {
      /*
       * A confirmMessage would make BulkUpdateForm open a ConfirmModal instead
       * of calling onClick, and isVisible/disabled can drop the click entirely
       * - each of those quietly changes how the modal gets opened.
       */
      expect(action.confirmMessage).toBeUndefined();
      expect(action.confirmTitle).toBeUndefined();
      expect(action.isVisible).toBeUndefined();
      expect(action.disabled).toBeUndefined();
    }
  });

  test("renders no modal until an action is clicked", async () => {
    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("fetches the project's labels once on mount with the full query", async () => {
    render(<Harness items={[]} />);

    await waitForMountedLabelFetch();

    const call: any = getListCall(0);

    expect(call.modelType).toBe(Label);
    expect(call.query.projectId.toString()).toBe(PROJECT_ID);
    expect(call.limit).toBe(LIMIT_PER_PROJECT);
    expect(call.skip).toBe(0);
    /*
     * `color` has to be selected or the add dropdown loses the colour swatch;
     * `labels` must not be, since Label has no labels of its own.
     */
    expect(call.select).toEqual({ _id: true, name: true, color: true });
    expect(call.sort).toEqual({ name: SortOrder.Ascending });
  });

  test("does not fetch labels at all when there is no current project", async () => {
    window.history.replaceState({}, "", "/dashboard");

    render(<Harness items={[]} />);

    await waitFor(() => {
      expect(screen.getByText("Trigger Add Labels")).toBeInTheDocument();
    });

    /*
     * The query used to go out as projectId: null, which matches nothing, so
     * the user got an empty dropdown after a pointless round trip.
     */
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("leaves the add dropdown empty when the label fetch fails", async () => {
    /*
     * Throwing from inside the call rather than handing back a promise that is
     * already rejected (mockRejectedValue, or an equivalent Promise.reject):
     * zone.js sees the rejection before the hook's catch is attached and
     * prints the whole stack as a console error on every run.
     */
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new Error("network down");
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");

    const options: Array<HTMLElement> = await openMenu();

    expect(options).toHaveLength(0);
  });

  test("keeps Remove Labels working when the project label fetch failed", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        throw new Error("network down");
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_BETA_ID, "Beta")]),
        ],
        count: 1,
      };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    /*
     * Remove reads only from the per-item fetch, so the mount failure that
     * empties the add dropdown must not degrade it.
     */
    const options: Array<HTMLElement> = await openMenu();

    expect(options).toHaveLength(1);
    expect(options[0]!).toHaveTextContent("Beta");
  });

  test("adds the picked label without clobbering labels the user did not pick", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockResolvedValue(
      makeItemWithLabels(ITEM_ONE_ID, [
        makeLabel(LABEL_BETA_ID, "Beta"),
        makeLabel(LABEL_GAMMA_ID, "Gamma"),
      ]),
    );

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    expect(getUpdatedLabelIds(0)).toEqual([
      LABEL_BETA_ID,
      LABEL_GAMMA_ID,
      LABEL_ALPHA_ID,
    ]);
  });

  test("de-dupes a picked label the item already carries", async () => {
    getListMock.mockResolvedValue({
      data: [
        makeLabel(LABEL_ALPHA_ID, "Alpha"),
        makeLabel(LABEL_BETA_ID, "Beta"),
      ],
      count: 2,
    });
    getItemMock.mockResolvedValue(
      makeItemWithLabels(ITEM_ONE_ID, [
        makeLabel(LABEL_ALPHA_ID, "Alpha"),
        makeLabel(LABEL_GAMMA_ID, "Gamma"),
      ]),
    );

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    await selectLabel("Beta");
    submitModal();

    await waitForBulkRunToEnd();

    // Alpha was on the item and was picked again; it must land once.
    expect(getUpdatedLabelIds(0)).toEqual([
      LABEL_ALPHA_ID,
      LABEL_GAMMA_ID,
      LABEL_BETA_ID,
    ]);
  });

  test("reads the item's current label ids before merging", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockResolvedValue(makeItemWithLabels(ITEM_ONE_ID, []));

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    const call: any = (getItemMock.mock.calls[0] as Array<any>)[0];

    expect(call.modelType).toBe(Monitor);
    expect(call.id.toString()).toBe(ITEM_ONE_ID);
    /*
     * `_id` is not cosmetic here: it is the only field that separates a real
     * read of an unlabelled item from the empty body a deleted or filtered row
     * answers with, and the guard below leans on it entirely.
     */
    expect(call.select).toEqual({ _id: true, labels: { _id: true } });
    expect(getUpdatedLabelIds(0)).toEqual([LABEL_ALPHA_ID]);
  });

  test("drops a dropdown option that came back without an id before merging", async () => {
    const orphan: Label = new Label();
    orphan.name = "Orphan";

    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha"), orphan],
      count: 2,
    });
    getItemMock.mockResolvedValue(
      makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_GAMMA_ID, "Gamma")]),
    );

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Orphan");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    /*
     * An id-less label renders as an option with an empty value; sending ""
     * inside the labels array makes the API reject the whole item, so one
     * unusable option would fail the entire bulk run.
     */
    expect(getUpdatedLabelIds(0)).toEqual([LABEL_GAMMA_ID, LABEL_ALPHA_ID]);
  });

  test("starts nothing and reports nothing when every submitted label id is blank", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID), makeItem(ITEM_TWO_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");

    await actAsync(async (): Promise<void> => {
      await getModalSubmit("Add Labels")({ labelIds: ["", ""] });
    });

    /*
     * Nothing survives the blank-id filter, so there is nothing to apply. The
     * loop used to run anyway: every item matched the no-op short-circuit and
     * was pushed onto successItems, so the user was told a bulk edit landed on
     * their whole selection when not one label had been asked for.
     */
    expect(onBulkActionStartMock).not.toHaveBeenCalled();
    expect(onProgressInfoMock).not.toHaveBeenCalled();
    expect(onBulkActionEndMock).not.toHaveBeenCalled();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    // The submit still dismisses the form rather than leaving it hanging open.
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("fails an item whose current read carries no id instead of overwriting its labels", async () => {
    /*
     * This is the reachable case. A row deleted or filtered out between the
     * table load and the action still answers HTTP 200, with an empty body
     * that BaseModel.fromJSONObject turns into a truthy model carrying neither
     * _id nor labels - so a plain null check never fires and add mode reads it
     * as "this item has no labels".
     */
    await addAlphaOverCurrentRead(BaseModel.fromJSONObject({}, Monitor));

    /*
     * Any update at all is the bug: the only thing the hook could have sent is
     * `labels: [LABEL_ALPHA_ID]`, which is the item's entire label set replaced
     * by the one label just picked.
     */
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(progressSnapshots[0]!.failedIds).toEqual([ITEM_ONE_ID]);
    expect(progressSnapshots[0]!.failedMessages[0]).toBe(
      "Could not read the current labels for this item.",
    );
    expect(progressSnapshots[0]!.successIds).toEqual([]);
  });

  test("fails an item whose current read comes back as null instead of overwriting its labels", async () => {
    await addAlphaOverCurrentRead(null);

    // ModelAPI.getItem is typed to allow null, so the guard has to cover it too.
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(progressSnapshots[0]!.failedIds).toEqual([ITEM_ONE_ID]);
    expect(progressSnapshots[0]!.failedMessages[0]).toBe(
      "Could not read the current labels for this item.",
    );
    expect(progressSnapshots[0]!.successIds).toEqual([]);
  });

  test("removes only the picked labels and keeps the rest", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [], count: 0 };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [
            makeLabel(LABEL_ALPHA_ID, "Alpha"),
            makeLabel(LABEL_BETA_ID, "Beta"),
            makeLabel(LABEL_GAMMA_ID, "Gamma"),
          ]),
        ],
        count: 1,
      };
    });
    getItemMock.mockResolvedValue(
      makeItemWithLabels(ITEM_ONE_ID, [
        makeLabel(LABEL_ALPHA_ID, "Alpha"),
        makeLabel(LABEL_BETA_ID, "Beta"),
        makeLabel(LABEL_GAMMA_ID, "Gamma"),
      ]),
    );

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");
    await selectLabel("Beta");
    submitModal();

    await waitForBulkRunToEnd();

    expect(getUpdatedLabelIds(0)).toEqual([LABEL_ALPHA_ID, LABEL_GAMMA_ID]);
  });

  test("skips the update but still counts the item as processed when nothing changes", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockResolvedValue(
      makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_ALPHA_ID, "Alpha")]),
    );

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    /*
     * A skipped write still has to advance the progress bar, otherwise a
     * selection of already-labelled items looks like a stalled run.
     */
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(progressSnapshots[0]!.successIds).toEqual([ITEM_ONE_ID]);
    expect(progressSnapshots[0]!.failedIds).toEqual([]);
  });

  test("keeps going after one item fails and reports only that item as failed", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.id.toString() === ITEM_TWO_ID) {
        throw new Error("item two is gone");
      }

      return makeItemWithLabels(data.id.toString(), []);
    });

    render(
      <Harness
        items={[
          makeItem(ITEM_ONE_ID),
          makeItem(ITEM_TWO_ID),
          makeItem(ITEM_THREE_ID),
        ]}
      />,
    );

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    expect(getItemMock).toHaveBeenCalledTimes(3);
    expect(updateByIdMock).toHaveBeenCalledTimes(2);

    const finalSnapshot: ProgressSnapshot = progressSnapshots[2]!;

    expect(finalSnapshot.successIds).toEqual([ITEM_ONE_ID, ITEM_THREE_ID]);
    expect(finalSnapshot.failedIds).toEqual([ITEM_TWO_ID]);
    expect(finalSnapshot.failedMessages).toEqual(["item two is gone"]);
  });

  test("takes the failure message from API.getFriendlyMessage", async () => {
    const friendlyMessage: MockFunction = jest.spyOn(
      API,
      "getFriendlyMessage",
    ) as unknown as MockFunction;
    friendlyMessage.mockReturnValue("Something went wrong. Try again.");

    const sentinel: Error = new Error("raw upstream text");

    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    /*
     * mockRejectedValue hands zone.js a rejected promise it sees before the
     * hook attaches its catch, and it prints the whole stack as a console
     * error on every run. Throwing from inside the call keeps CI readable.
     */
    getItemMock.mockImplementation(async (): Promise<never> => {
      throw sentinel;
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    // The raw error must go through the formatter, not into the UI verbatim.
    expect(friendlyMessage).toHaveBeenCalledWith(sentinel);
    expect(progressSnapshots[0]!.failedMessages).toEqual([
      "Something went wrong. Try again.",
    ]);
  });

  test("fails an item that has no id without calling the API for it", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockResolvedValue(makeItemWithLabels(ITEM_ONE_ID, []));

    render(<Harness items={[new Monitor(), makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    expect(progressSnapshots[0]!.failedMessages).toEqual(["Item ID not found"]);
    // Only the second item is addressable, so only it may reach the API.
    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(progressSnapshots[1]!.successIds).toEqual([ITEM_ONE_ID]);
  });

  test("brackets the run with one start and one end around a progress call per item", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockImplementation(async (data: any): Promise<any> => {
      return makeItemWithLabels(data.id.toString(), []);
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID), makeItem(ITEM_TWO_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    expect(callOrder).toEqual(["start", "progress", "progress", "end"]);
    expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
    expect(onProgressInfoMock).toHaveBeenCalledTimes(2);
  });

  test("reports the running success and failure split after each item", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });
    getItemMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.id.toString() === ITEM_TWO_ID) {
        throw new Error("boom");
      }

      return makeItemWithLabels(data.id.toString(), []);
    });

    render(
      <Harness
        items={[
          makeItem(ITEM_ONE_ID),
          makeItem(ITEM_TWO_ID),
          makeItem(ITEM_THREE_ID),
        ]}
      />,
    );

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");
    await selectLabel("Alpha");
    submitModal();

    await waitForBulkRunToEnd();

    expect(progressSnapshots).toHaveLength(3);

    /*
     * The item being worked on is spliced out of inProgressItems before its own
     * callback fires, so the remaining count is the work still queued.
     */
    expect(progressSnapshots[0]).toEqual({
      totalIds: [ITEM_ONE_ID, ITEM_TWO_ID, ITEM_THREE_ID],
      inProgressIds: [ITEM_TWO_ID, ITEM_THREE_ID],
      successIds: [ITEM_ONE_ID],
      failedIds: [],
      failedMessages: [],
    });
    expect(progressSnapshots[1]).toEqual({
      totalIds: [ITEM_ONE_ID, ITEM_TWO_ID, ITEM_THREE_ID],
      inProgressIds: [ITEM_THREE_ID],
      successIds: [ITEM_ONE_ID],
      failedIds: [ITEM_TWO_ID],
      failedMessages: ["boom"],
    });
    expect(progressSnapshots[2]).toEqual({
      totalIds: [ITEM_ONE_ID, ITEM_TWO_ID, ITEM_THREE_ID],
      inProgressIds: [],
      successIds: [ITEM_ONE_ID, ITEM_THREE_ID],
      failedIds: [ITEM_TWO_ID],
      failedMessages: ["boom"],
    });
  });

  test("offers the de-duplicated union of the selection's labels, sorted by name", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [], count: 0 };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [
            makeLabel(LABEL_ALPHA_ID, "Zulu"),
            makeLabel(LABEL_BETA_ID, "apple"),
          ]),
          makeItemWithLabels(ITEM_TWO_ID, [
            makeLabel(LABEL_BETA_ID, "apple"),
            makeLabel(LABEL_GAMMA_ID, "Mike"),
          ]),
        ],
        count: 2,
      };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID), makeItem(ITEM_TWO_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    const options: Array<HTMLElement> = await openMenu();

    expect(options).toHaveLength(3);

    /*
     * localeCompare, not codepoint order - a lowercase name would otherwise
     * sort below every capitalised one and look like a broken list.
     */
    expect(optionTexts(options)).toEqual(["apple", "Mike", "Zulu"]);
  });

  test("scopes the option fetch to the selected ids", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [], count: 0 };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_ALPHA_ID, "Alpha")]),
        ],
        count: 1,
      };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID), makeItem(ITEM_TWO_ID)]} />);

    clickTrigger("Remove Labels");

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    const call: any = getListCall(1);

    expect(call.modelType).toBe(Monitor);
    expect(call.query._id).toBeInstanceOf(Includes);
    expect(call.query._id.values).toEqual([ITEM_ONE_ID, ITEM_TWO_ID]);
    expect(call.select).toEqual({
      labels: { _id: true, name: true, color: true },
    });
  });

  test("carries a label's colour into its remove option", async () => {
    const coloured: Label = makeLabel(LABEL_ALPHA_ID, "Alpha");
    coloured.color = Red;

    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [], count: 0 };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [
            coloured,
            makeLabel(LABEL_BETA_ID, "Beta"),
          ]),
        ],
        count: 1,
      };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    const options: Array<HTMLElement> = await openMenu();
    const alphaSwatch: Element | null =
      options[0]!.querySelector("span[title]");

    expect(alphaSwatch).not.toBeNull();
    expect(alphaSwatch!.getAttribute("title")).toBe(Red.toString());
    // A colourless label must not inherit a swatch from anywhere.
    expect(options[1]!.querySelector("span[title]")).toBeNull();
  });

  test("offers nothing to remove for an empty selection", async () => {
    render(<Harness items={[]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Remove Labels");
    await waitForModalTitle("No Labels to Remove");

    // No addressable ids means there is nothing to ask the server about.
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("offers nothing to remove when the option fetch fails, rather than the whole project's labels", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return {
          data: [
            makeLabel(LABEL_ALPHA_ID, "Alpha"),
            makeLabel(LABEL_BETA_ID, "Beta"),
          ],
          count: 2,
        };
      }

      throw new Error("selection fetch failed");
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("No Labels to Remove");

    /*
     * Falling back to the project label list here would offer labels the items
     * do not have, and removing one would look like it silently did nothing.
     */
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("the No Labels to Remove modal is a dead end with only a way out", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [], count: 0 };
      }

      return { data: [makeItemWithLabels(ITEM_ONE_ID, [])], count: 1 };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("No Labels to Remove");

    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
    // There is nothing to submit, so offering a submit button would be a trap.
    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
  });

  test("opening Remove Labels closes an open Add Labels modal", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [makeLabel(LABEL_ALPHA_ID, "Alpha")], count: 1 };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_BETA_ID, "Beta")]),
        ],
        count: 1,
      };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    /*
     * The two modals are independent siblings sharing one set of action props;
     * stacked, whichever submits first leaves the other silently inert.
     */
    expect(screen.getAllByTestId("modal-title")).toHaveLength(1);
  });

  test("opening Add Labels closes an open Remove Labels modal", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [makeLabel(LABEL_ALPHA_ID, "Alpha")], count: 1 };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_BETA_ID, "Beta")]),
        ],
        count: 1,
      };
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");

    expect(screen.getAllByTestId("modal-title")).toHaveLength(1);
  });

  test("re-opening the remove modal re-reads the new selection instead of reusing the old options", async () => {
    getListMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.modelType === Label) {
        return { data: [], count: 0 };
      }

      const ids: Array<string> = data.query._id.values as Array<string>;

      if (ids.includes(ITEM_ONE_ID)) {
        return {
          data: [
            makeItemWithLabels(ITEM_ONE_ID, [
              makeLabel(LABEL_ALPHA_ID, "Alpha"),
            ]),
          ],
          count: 1,
        };
      }

      return {
        data: [
          makeItemWithLabels(ITEM_TWO_ID, [makeLabel(LABEL_BETA_ID, "Beta")]),
        ],
        count: 1,
      };
    });

    const { rerender } = render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    const firstOptions: Array<HTMLElement> = await openMenu();

    expect(firstOptions[0]!).toHaveTextContent("Alpha");

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    rerender(<Harness items={[makeItem(ITEM_TWO_ID)]} />);

    clickTrigger("Remove Labels");
    await waitForModalTitle("Remove Labels");

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });

    const secondOptions: Array<HTMLElement> = await openMenu();

    /*
     * The options are keyed to the selection, so a cached list from the last
     * open would offer labels the newly selected item does not have.
     */
    expect(secondOptions).toHaveLength(1);
    expect(secondOptions[0]!).toHaveTextContent("Beta");
  });

  test("keeps the newest selection's remove options when an older fetch settles last", async () => {
    const firstSelectionFetch: DeferredListResult = createDeferredListResult();
    const secondSelectionFetch: DeferredListResult = createDeferredListResult();

    getListMock.mockImplementation((data: any): Promise<any> => {
      if (data.modelType === Label) {
        return Promise.resolve({ data: [], count: 0 });
      }

      const ids: Array<string> = data.query._id.values as Array<string>;

      return ids.includes(ITEM_ONE_ID)
        ? firstSelectionFetch.promise
        : secondSelectionFetch.promise;
    });

    render(<Harness items={[]} />);

    await waitForMountedLabelFetch();

    /*
     * Driven through onClick rather than the trigger button because the two
     * opens have to carry different selections while both fetches are still
     * in flight, which one mounted Harness cannot express.
     */
    const runs: Array<Promise<void>> = [];

    await actAsync(async (): Promise<void> => {
      runs.push(
        capturedActions[1]!.onClick(makeActionProps([makeItem(ITEM_ONE_ID)])),
      );
    });

    await actAsync(async (): Promise<void> => {
      runs.push(
        capturedActions[1]!.onClick(makeActionProps([makeItem(ITEM_TWO_ID)])),
      );
    });

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });

    // The newest selection answers first...
    await actAsync(async (): Promise<void> => {
      secondSelectionFetch.resolve({
        data: [
          makeItemWithLabels(ITEM_TWO_ID, [makeLabel(LABEL_BETA_ID, "Beta")]),
        ],
        count: 1,
      });
      await runs[1]!;
    });

    // ...and the abandoned first selection lands afterwards.
    await actAsync(async (): Promise<void> => {
      firstSelectionFetch.resolve({
        data: [
          makeItemWithLabels(ITEM_ONE_ID, [makeLabel(LABEL_ALPHA_ID, "Alpha")]),
        ],
        count: 1,
      });
      await runs[0]!;
    });

    await waitForModalTitle("Remove Labels");

    const options: Array<HTMLElement> = await openMenu();

    /*
     * Last writer wins without the request stamp, and the slow first fetch is
     * the last writer here: the user would be offered Alpha, a label the item
     * they actually selected does not carry, and removing it would appear to
     * do nothing.
     */
    expect(optionTexts(options)).toEqual(["Beta"]);
  });

  test("blocks a submit with nothing picked and touches no API", async () => {
    getListMock.mockResolvedValue({
      data: [makeLabel(LABEL_ALPHA_ID, "Alpha")],
      count: 1,
    });

    render(<Harness items={[makeItem(ITEM_ONE_ID)]} />);

    await waitForMountedLabelFetch();

    clickTrigger("Add Labels");
    await waitForModalTitle("Add Labels");

    submitModal();

    expect(
      await screen.findByText("Select Labels is required.", undefined, {
        timeout: WAIT_TIMEOUT,
      }),
    ).toBeInTheDocument();

    /*
     * An empty submit would otherwise start a bulk run that reads and rewrites
     * every selected item to no effect.
     */
    expect(onBulkActionStartMock).not.toHaveBeenCalled();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
