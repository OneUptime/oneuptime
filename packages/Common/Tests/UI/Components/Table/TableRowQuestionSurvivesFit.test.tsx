import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { forgetRememberedTableFits } from "../../../../UI/Components/Table/useTableFit";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../../Types/Icon/IconProp";
import { ErrorFunction, VoidFunction } from "../../../../Types/FunctionTypes";

/*
 * A ROW'S QUESTION SURVIVES A CHANGE OF HOW ITS TABLE FITS (#9513).
 *
 * Open a row's question - Delete in Admin Dashboard > Feedback > What People
 * Said - then turn the phone sideways, or resize the window across 768px:
 * the question was gone without an answer, and nothing said why. The row's
 * actions (RowActions) kept it themselves, and a table that changes how it
 * fits (TableFit: rows, folded, cards) draws its rows through another
 * branch, so every row's actions were new ones, with nothing open. A whole
 * page's screenshot taken with the question open laid the table out again
 * and closed it too: that is how it was found, in the browser suite for
 * #7362.
 *
 * The table keeps what its rows' actions have open now (RowActionsStore),
 * by each row's key, and draws the dialogs itself, outside its rows
 * (RowActionDialogs). These turn the window from a wide screen (1280px:
 * rows) to a phone (390px: cards) and back with a row's question, its
 * answer on its way, an action's error and the ⋯ menu open, and move,
 * remove and reload the rows under them. jsdom lays nothing out, so the
 * window stands in for the table's box (TableFit).
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

interface Answer {
  _id: string;
  name: string;
}

const CHECKOUT: Answer = {
  _id: "73620000-0000-4000-8000-000000000001",
  name: "Checkout is slow",
};
const STOREFRONT: Answer = {
  _id: "73620000-0000-4000-8000-000000000002",
  name: "Storefront search finds nothing",
};
const LOGIN: Answer = {
  _id: "73620000-0000-4000-8000-000000000003",
  name: "Login loops back to the start",
};
const BILLING: Answer = {
  _id: "73620000-0000-4000-8000-000000000004",
  name: "Billing page shows the wrong plan",
};

const WIDE: number = 1280;
const PHONE: number = 390;

type OnClick = ActionButtonSchema<Answer>["onClick"];

const COLUMNS: Columns<Answer> = [
  { title: "Answer", type: FieldType.Text, key: "name" },
  { title: "Actions", type: FieldType.Actions },
];

// The question Delete asks, naming the row it is about.
const deleteQuestion: (answer: Answer) => RowActionConfirmation = (
  answer: Answer,
): RowActionConfirmation => {
  return {
    title: "Delete Answer",
    description: `Are you sure you want to delete ${answer.name}? This cannot be undone.`,
    submitButtonText: "Delete",
    submitButtonType: ButtonStyleType.DANGER,
  };
};

interface ActionMocks {
  onView: Mock<OnClick>;
  onDelete: Mock<OnClick>;
  onArchive: Mock<OnClick>;
  actions: Array<ActionButtonSchema<Answer>>;
}

/*
 * View as the row's button; Delete, which asks first, and Archive, which
 * runs at once, in its ⋯ menu.
 */
const makeActions: (data?: {
  onDelete?: OnClick | undefined;
  onArchive?: OnClick | undefined;
}) => ActionMocks = (data?: {
  onDelete?: OnClick | undefined;
  onArchive?: OnClick | undefined;
}): ActionMocks => {
  const onView: Mock<OnClick> = jest.fn<OnClick>();
  const onDelete: Mock<OnClick> = jest.fn<OnClick>(
    data?.onDelete ||
      ((_answer: Answer, onCompleteAction: VoidFunction): void => {
        onCompleteAction();
      }),
  );
  const onArchive: Mock<OnClick> = jest.fn<OnClick>(
    data?.onArchive || ((): void => {}),
  );

  return {
    onView,
    onDelete,
    onArchive,
    actions: [
      {
        title: "View",
        icon: IconProp.Eye,
        buttonStyleType: ButtonStyleType.NORMAL,
        placement: ActionButtonPlacement.Primary,
        onClick: onView,
      },
      {
        title: "Archive",
        icon: IconProp.Archive,
        buttonStyleType: ButtonStyleType.OUTLINE,
        placement: ActionButtonPlacement.MoreMenu,
        onClick: onArchive,
      },
      {
        title: "Delete",
        icon: IconProp.Trash,
        buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
        getConfirmation: deleteQuestion,
        onClick: onDelete,
      },
    ],
  };
};

/*
 * The Admin Dashboard's answers: Delete is a row's only action, so it is
 * the row's own button.
 */
const makeDeleteOnly: (
  onDelete: Mock<OnClick>,
) => Array<ActionButtonSchema<Answer>> = (
  onDelete: Mock<OnClick>,
): Array<ActionButtonSchema<Answer>> => {
  return [
    {
      title: "Delete",
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      getConfirmation: deleteQuestion,
      onClick: onDelete,
    },
  ];
};

interface TableUnderTestProps {
  data: Array<Answer>;
  actions: Array<ActionButtonSchema<Answer>>;
  id?: string | undefined;
  // Rows kept by their id, as every ModelTable's are; by their place otherwise.
  isKeyedById?: boolean | undefined;
  error?: string | undefined;
  onRowClick?: (() => void) | undefined;
}

const AnswersTable: (props: TableUnderTestProps) => ReactElement = (
  props: TableUnderTestProps,
): ReactElement => {
  return (
    <Table<Answer>
      id={props.id || "answers"}
      data={props.data}
      columns={COLUMNS}
      actionButtons={props.actions}
      dragDropIdField={props.isKeyedById === false ? undefined : "_id"}
      singularLabel="Answer"
      pluralLabel="Answers"
      currentPageNumber={1}
      totalItemsCount={props.data.length}
      itemsOnPage={10}
      error={props.error || ""}
      isLoading={false}
      onNavigateToPage={(): void => {}}
      onRefreshClick={(): void => {}}
      sortOrder={SortOrder.Descending}
      sortBy={null}
      onSortChanged={(): void => {}}
      getRowProps={
        props.onRowClick
          ? (): React.HTMLAttributes<HTMLElement> => {
              return { onClick: props.onRowClick };
            }
          : undefined
      }
    />
  );
};

const draw: (props: TableUnderTestProps) => RenderResult = (
  props: TableUnderTestProps,
): RenderResult => {
  return render(<AnswersTable {...props} />);
};

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

// The window resized - a phone turned, a window dragged across 768px.
const resizeWindow: (width: number) => Promise<void> = async (
  width: number,
): Promise<void> => {
  setWindowWidth(width);

  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
  });
};

// Whatever was let go in the last commit is let go of (RowActionsStore).
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

// A frame passes: a closed dialog gives the focus back on the next one.
const nextFrame: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      window.requestAnimationFrame((): void => {
        resolve();
      });
    });
  });
};

// The table's rows, as rows (a tbody) or as cards (a div).
const body: (tableId?: string) => HTMLElement = (
  tableId?: string,
): HTMLElement => {
  return document.getElementById(`${tableId || "answers"}-body`)!;
};

const isDrawnAsCards: (tableId?: string) => boolean = (
  tableId?: string,
): boolean => {
  return body(tableId).tagName === "DIV";
};

// The actions of the row (or the card) that names an answer.
const rowActionsOf: (answer: Answer, tableId?: string) => HTMLElement = (
  answer: Answer,
  tableId?: string,
): HTMLElement => {
  let element: HTMLElement | null = within(body(tableId)).getByText(
    answer.name,
  );

  while (element && !element.querySelector('[data-testid="row-actions"]')) {
    element = element.parentElement;
  }

  return within(element!).getByTestId("row-actions");
};

const moreButtonOf: (answer: Answer, tableId?: string) => HTMLElement = (
  answer: Answer,
  tableId?: string,
): HTMLElement => {
  return within(rowActionsOf(answer, tableId)).getByTestId(
    "row-actions-more-button",
  );
};

const openMenuOf: (answer: Answer, tableId?: string) => HTMLElement = (
  answer: Answer,
  tableId?: string,
): HTMLElement => {
  fireEvent.click(moreButtonOf(answer, tableId));

  return screen.getByRole("menu");
};

const choose: (answer: Answer, action: string, tableId?: string) => void = (
  answer: Answer,
  action: string,
  tableId?: string,
): void => {
  fireEvent.click(
    within(openMenuOf(answer, tableId)).getByRole("menuitem", {
      name: action,
    }),
  );
};

const submitButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal-footer-submit-button");
};

const cancelButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal-footer-close-button");
};

// The one question open, and what it says.
const expectOneQuestionAbout: (answer: Answer) => void = (
  answer: Answer,
): void => {
  expect(screen.getAllByTestId("modal")).toHaveLength(1);
  expect(screen.getByTestId("modal-title")).toHaveTextContent("Delete Answer");
  expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
    `Are you sure you want to delete ${answer.name}?`,
  );
};

beforeEach(() => {
  setWindowWidth(WIDE);
});

afterEach(() => {
  cleanup();
  forgetRememberedTableFits();
  setWindowWidth(1024);
});

describe("a row's question stays open as the table turns between rows and cards", () => {
  test("a phone turned sideways: Delete's question, opened on a row, stays open as the rows turn into cards, and deletes that row", async () => {
    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT, LOGIN], actions: mocks.actions });

    expect(isDrawnAsCards()).toBe(false);

    choose(STOREFRONT, "Delete");
    expectOneQuestionAbout(STOREFRONT);

    await resizeWindow(PHONE);

    expect(isDrawnAsCards()).toBe(true);
    expectOneQuestionAbout(STOREFRONT);
    expect(mocks.onDelete).not.toHaveBeenCalled();

    fireEvent.click(submitButton());

    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("turned back: opened on a card, it stays open as the cards turn back into rows, and Cancel closes it with nothing deleted", async () => {
    setWindowWidth(PHONE);

    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT, LOGIN], actions: mocks.actions });

    expect(isDrawnAsCards()).toBe(true);

    choose(CHECKOUT, "Delete");
    await resizeWindow(WIDE);

    expect(isDrawnAsCards()).toBe(false);
    expectOneQuestionAbout(CHECKOUT);

    fireEvent.click(cancelButton());

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(mocks.onDelete).not.toHaveBeenCalled();
  });

  test("turned back and forth while it is open, it is still the one question about the same row", async () => {
    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT, LOGIN], actions: mocks.actions });

    choose(LOGIN, "Delete");

    for (const width of [PHONE, WIDE, PHONE, WIDE, PHONE]) {
      await resizeWindow(width);
      expectOneQuestionAbout(LOGIN);
    }

    fireEvent.click(submitButton());

    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(LOGIN);
  });

  test("a row whose only action is Delete - the Admin Dashboard's answers - asks from its own button, and the question stays open", async () => {
    const onDelete: Mock<OnClick> = jest.fn<OnClick>(
      (_answer: Answer, onCompleteAction: VoidFunction): void => {
        onCompleteAction();
      },
    );

    draw({ data: [CHECKOUT, STOREFRONT], actions: makeDeleteOnly(onDelete) });

    fireEvent.click(
      within(rowActionsOf(STOREFRONT)).getByRole("button", { name: "Delete" }),
    );
    await resizeWindow(PHONE);

    expectOneQuestionAbout(STOREFRONT);

    fireEvent.click(submitButton());

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
  });

  test("the table draws it, not the row: a click on its words never reaches the row's own click", async () => {
    const onRowClick: Mock<() => void> = jest.fn<() => void>();
    const mocks: ActionMocks = makeActions();

    draw({
      data: [CHECKOUT, STOREFRONT],
      actions: mocks.actions,
      onRowClick: onRowClick,
    });

    choose(STOREFRONT, "Delete");
    onRowClick.mockClear();

    fireEvent.click(screen.getByTestId("confirm-modal-description"));
    await resizeWindow(PHONE);
    fireEvent.click(screen.getByTestId("confirm-modal-description"));

    expect(onRowClick).not.toHaveBeenCalled();
    // Over the page, in its body, not in a row or a card.
    expect(body()).not.toContainElement(
      screen.getByTestId("row-actions-dialog"),
    );
    expect(document.body).toContainElement(
      screen.getByTestId("row-actions-dialog"),
    );
  });
});

describe("an answer on its way, and what it says, stay through a turn", () => {
  test("the action running: its button stays busy through the turn, and the dialog closes once the action is done", async () => {
    let complete: VoidFunction = (): void => {};
    const mocks: ActionMocks = makeActions({
      onDelete: (_answer: Answer, onCompleteAction: VoidFunction): void => {
        complete = onCompleteAction;
      },
    });

    draw({ data: [CHECKOUT, STOREFRONT], actions: mocks.actions });

    choose(STOREFRONT, "Delete");
    fireEvent.click(submitButton());

    expect(submitButton()).toBeDisabled();

    await resizeWindow(PHONE);

    expectOneQuestionAbout(STOREFRONT);
    expect(submitButton()).toBeDisabled();

    // Neither a second press nor Cancel does anything while it runs.
    fireEvent.click(submitButton());
    fireEvent.click(cancelButton());

    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("modal")).toBeInTheDocument();

    act(() => {
      complete();
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("the action failed: why it could not is still said in place after the turn, and trying again acts on the same row", async () => {
    let fail: ErrorFunction = (): void => {};
    const mocks: ActionMocks = makeActions({
      onDelete: (
        _answer: Answer,
        _complete: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        fail = onError;
      },
    });

    draw({ data: [CHECKOUT, STOREFRONT], actions: mocks.actions });

    choose(STOREFRONT, "Delete");
    fireEvent.click(submitButton());

    act(() => {
      fail(new Error("Only a server admin may delete answers."));
    });

    await resizeWindow(PHONE);

    expect(screen.getAllByTestId("modal")).toHaveLength(1);
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "Only a server admin may delete answers.",
    );
    expect(submitButton()).not.toBeDisabled();

    fireEvent.click(submitButton());

    expect(mocks.onDelete).toHaveBeenCalledTimes(2);
    expect(mocks.onDelete.mock.calls[1]?.[0]).toBe(STOREFRONT);
  });

  test("an action that ran at once and failed: its error stays open through the turn, until it is closed", async () => {
    let fail: ErrorFunction = (): void => {};
    const mocks: ActionMocks = makeActions({
      onArchive: (
        _answer: Answer,
        _complete: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        fail = onError;
      },
    });

    draw({ data: [CHECKOUT, STOREFRONT], actions: mocks.actions });

    choose(STOREFRONT, "Archive");

    expect(mocks.onArchive.mock.calls[0]?.[0]).toBe(STOREFRONT);

    act(() => {
      fail(new Error("This answer is archived already."));
    });

    await resizeWindow(PHONE);

    expect(screen.getAllByTestId("modal")).toHaveLength(1);
    expect(screen.getByTestId("row-actions-dialog")).toHaveTextContent(
      "This answer is archived already.",
    );

    fireEvent.click(submitButton());

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("an action still running when the table turns still shows on the row's button, drawn again", async () => {
    const onVerify: Mock<OnClick> = jest.fn<OnClick>();
    const actions: Array<ActionButtonSchema<Answer>> = [
      {
        title: "Verify",
        icon: IconProp.Check,
        buttonStyleType: ButtonStyleType.NORMAL,
        // Never says it is done while the test looks.
        onClick: onVerify,
      },
    ];

    draw({ data: [CHECKOUT, STOREFRONT], actions: actions });

    fireEvent.click(
      within(rowActionsOf(STOREFRONT)).getByRole("button", { name: "Verify" }),
    );

    expect(onVerify).toHaveBeenCalledTimes(1);

    await resizeWindow(PHONE);

    expect(
      within(rowActionsOf(STOREFRONT)).getByRole("button", { name: "Verify" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(rowActionsOf(CHECKOUT)).getByRole("button", { name: "Verify" }),
    ).toHaveAttribute("aria-disabled", "false");
  });
});

describe("a row's ⋯ menu stays open on its row", () => {
  test("opened on a row, it is open on that row's card after the turn, and what is picked acts on that row", async () => {
    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT, LOGIN], actions: mocks.actions });

    openMenuOf(STOREFRONT);
    await resizeWindow(PHONE);

    expect(isDrawnAsCards()).toBe(true);

    const menu: HTMLElement = screen.getByRole("menu");
    const trigger: HTMLElement = moreButtonOf(STOREFRONT);

    // The card's own ⋯ opened it, and says so.
    expect(menu).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menu")).toHaveLength(1);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Archive" }));

    expect(mocks.onArchive).toHaveBeenCalledTimes(1);
    expect(mocks.onArchive.mock.calls[0]?.[0]).toBe(STOREFRONT);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("closed before the turn, it stays closed after it", async () => {
    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT], actions: mocks.actions });

    const menu: HTMLElement = openMenuOf(STOREFRONT);

    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, {
      key: "Escape",
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await resizeWindow(PHONE);
    await resizeWindow(WIDE);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("a menu its row no longer draws - a phone's card leaves out an action marked hideOnMobile - is closed, and does not open by itself when the row draws it again", async () => {
    const actions: Array<ActionButtonSchema<Answer>> = [
      {
        title: "View",
        icon: IconProp.Eye,
        buttonStyleType: ButtonStyleType.NORMAL,
        placement: ActionButtonPlacement.Primary,
        onClick: (): void => {},
      },
      {
        title: "Show ID",
        icon: IconProp.Identification,
        buttonStyleType: ButtonStyleType.OUTLINE,
        placement: ActionButtonPlacement.MoreMenu,
        hideOnMobile: true,
        onClick: (): void => {},
      },
    ];

    draw({ data: [CHECKOUT, STOREFRONT], actions: actions });

    openMenuOf(STOREFRONT);
    await resizeWindow(PHONE);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      within(rowActionsOf(STOREFRONT)).queryByTestId("row-actions-more-button"),
    ).not.toBeInTheDocument();

    await resizeWindow(WIDE);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("the row leaves, or the rows move, while its question is open", () => {
  test("another user deleted the row: the question stays open, still about that row, and acts on it", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT, LOGIN],
      actions: mocks.actions,
    });

    choose(STOREFRONT, "Delete");

    // The list read again, without it.
    view.rerender(
      <AnswersTable data={[CHECKOUT, LOGIN]} actions={mocks.actions} />,
    );
    await settle();
    await resizeWindow(PHONE);

    expect(within(body()).queryByText(STOREFRONT.name)).not.toBeInTheDocument();
    expectOneQuestionAbout(STOREFRONT);

    fireEvent.click(submitButton());

    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
  });

  test("...or Cancel closes it, and nothing is deleted", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT, LOGIN],
      actions: mocks.actions,
    });

    choose(STOREFRONT, "Delete");
    view.rerender(
      <AnswersTable data={[CHECKOUT, LOGIN]} actions={mocks.actions} />,
    );
    await settle();

    fireEvent.click(cancelButton());

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(mocks.onDelete).not.toHaveBeenCalled();
  });

  test("rows kept by their place, a new one read in above, then a turn: the answer acts on the row the question named, never the one that took its place", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT],
      actions: mocks.actions,
      isKeyedById: false,
    });

    choose(STOREFRONT, "Delete");

    // A live list reads a new answer in at the top: Checkout is second now.
    view.rerender(
      <AnswersTable
        data={[LOGIN, CHECKOUT, STOREFRONT]}
        actions={mocks.actions}
        isKeyedById={false}
      />,
    );
    await resizeWindow(PHONE);

    expectOneQuestionAbout(STOREFRONT);

    fireEvent.click(submitButton());

    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
  });

  test("sorted the other way while it is open, then turned: it still acts on its row", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT, LOGIN],
      actions: mocks.actions,
    });

    choose(CHECKOUT, "Delete");
    view.rerender(
      <AnswersTable
        data={[LOGIN, STOREFRONT, CHECKOUT]}
        actions={mocks.actions}
      />,
    );
    await resizeWindow(PHONE);

    expectOneQuestionAbout(CHECKOUT);

    fireEvent.click(submitButton());

    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(CHECKOUT);
  });

  test("another page of rows, or a filter that leaves it out, while it is open: it still acts on its own row", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT],
      actions: mocks.actions,
      isKeyedById: false,
    });

    choose(STOREFRONT, "Delete");
    view.rerender(
      <AnswersTable
        data={[LOGIN, BILLING]}
        actions={mocks.actions}
        isKeyedById={false}
      />,
    );
    await settle();
    await resizeWindow(PHONE);

    expectOneQuestionAbout(STOREFRONT);

    fireEvent.click(submitButton());

    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
  });

  test("a ⋯ menu open on a row that leaves does not open by itself when the row comes back", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT],
      actions: mocks.actions,
    });

    openMenuOf(STOREFRONT);

    // The next page, then back.
    view.rerender(
      <AnswersTable data={[LOGIN, BILLING]} actions={mocks.actions} />,
    );
    await settle();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    view.rerender(
      <AnswersTable data={[CHECKOUT, STOREFRONT]} actions={mocks.actions} />,
    );
    await settle();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(moreButtonOf(STOREFRONT)).toHaveAttribute("aria-expanded", "false");
  });

  test("the rows fail to load again, then load: the question stays open through it, and acts on its row", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT],
      actions: mocks.actions,
    });

    choose(STOREFRONT, "Delete");

    view.rerender(
      <AnswersTable
        data={[CHECKOUT, STOREFRONT]}
        actions={mocks.actions}
        error="Could not reach the server."
      />,
    );
    await settle();

    expect(screen.getByTestId("answers-load-error")).toBeInTheDocument();
    expect(document.getElementById("answers-body")).toBeNull();
    expectOneQuestionAbout(STOREFRONT);

    view.rerender(
      <AnswersTable data={[CHECKOUT, STOREFRONT]} actions={mocks.actions} />,
    );
    await resizeWindow(PHONE);

    expectOneQuestionAbout(STOREFRONT);

    fireEvent.click(submitButton());

    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
  });
});

describe("two tables on one page", () => {
  test("each keeps its own rows' questions: one opened in the second stays open through the turn, the first opens none, and the answer runs the second's action on its row", async () => {
    const first: ActionMocks = makeActions();
    const second: ActionMocks = makeActions();
    // The same ids in both: rows of two lists of one kind.
    const secondRows: Array<Answer> = [
      { ...CHECKOUT, name: "Checkout times out" },
      { ...STOREFRONT, name: "Storefront images are blurry" },
    ];

    render(
      <>
        <AnswersTable
          id="first"
          data={[CHECKOUT, STOREFRONT]}
          actions={first.actions}
        />
        <AnswersTable id="second" data={secondRows} actions={second.actions} />
      </>,
    );

    choose(secondRows[1]!, "Delete", "second");
    await resizeWindow(PHONE);

    expect(isDrawnAsCards("first")).toBe(true);
    expect(isDrawnAsCards("second")).toBe(true);
    expectOneQuestionAbout(secondRows[1]!);

    fireEvent.click(submitButton());

    expect(second.onDelete).toHaveBeenCalledTimes(1);
    expect(second.onDelete.mock.calls[0]?.[0]).toBe(secondRows[1]);
    expect(first.onDelete).not.toHaveBeenCalled();
  });

  test("a ⋯ menu open in one opens again in that one only", async () => {
    const first: ActionMocks = makeActions();
    const second: ActionMocks = makeActions();

    render(
      <>
        <AnswersTable
          id="first"
          data={[CHECKOUT, STOREFRONT]}
          actions={first.actions}
        />
        <AnswersTable
          id="second"
          data={[CHECKOUT, STOREFRONT]}
          actions={second.actions}
        />
      </>,
    );

    openMenuOf(CHECKOUT, "first");
    await resizeWindow(PHONE);

    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(moreButtonOf(CHECKOUT, "first")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(moreButtonOf(CHECKOUT, "second")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("the focus, once the question is closed", () => {
  test("after a turn it goes back to the row's ⋯ the question was opened from, where the card draws it now", async () => {
    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT], actions: mocks.actions });

    choose(STOREFRONT, "Delete");
    await resizeWindow(PHONE);

    fireEvent.click(cancelButton());
    await nextFrame();

    expect(document.activeElement).toBe(moreButtonOf(STOREFRONT));
  });

  test("...and to the row's own button, when the question was opened from it", async () => {
    const onDelete: Mock<OnClick> = jest.fn<OnClick>();

    draw({ data: [CHECKOUT, STOREFRONT], actions: makeDeleteOnly(onDelete) });

    fireEvent.click(
      within(rowActionsOf(STOREFRONT)).getByRole("button", { name: "Delete" }),
    );
    await resizeWindow(PHONE);

    fireEvent.click(cancelButton());
    await nextFrame();

    expect(document.activeElement).toBe(
      within(rowActionsOf(STOREFRONT)).getByRole("button", { name: "Delete" }),
    );
  });

  test("closed with no turn, it goes back to the ⋯ as it always did", async () => {
    const mocks: ActionMocks = makeActions();

    draw({ data: [CHECKOUT, STOREFRONT], actions: mocks.actions });

    const trigger: HTMLElement = moreButtonOf(STOREFRONT);

    choose(STOREFRONT, "Delete");
    fireEvent.click(cancelButton());
    await nextFrame();

    expect(document.activeElement).toBe(trigger);
  });

  test("the row's action done and the row gone, nothing takes the focus", async () => {
    const mocks: ActionMocks = makeActions();
    const view: RenderResult = draw({
      data: [CHECKOUT, STOREFRONT],
      actions: mocks.actions,
    });

    choose(STOREFRONT, "Delete");
    await resizeWindow(PHONE);
    view.rerender(<AnswersTable data={[CHECKOUT]} actions={mocks.actions} />);
    await settle();

    fireEvent.click(submitButton());
    await nextFrame();

    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(STOREFRONT);
    expect(document.activeElement).toBe(document.body);
  });
});
