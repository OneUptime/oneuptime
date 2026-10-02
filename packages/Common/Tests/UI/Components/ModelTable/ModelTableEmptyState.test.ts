import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../../Types/Icon/IconProp";
import { CardButtonSchema } from "../../../../UI/Components/Card/Card";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import EmptyStateOptions from "../../../../UI/Components/ModelTable/EmptyStateOptions";
import {
  CLEAR_FILTERS,
  CLEAR_SEARCH,
  CLEAR_SEARCH_AND_FILTERS,
  CREATE_NOT_ALLOWED_NOTE,
  EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
  EMPTY_TABLE_CREATE_BUTTON_TEST_ID,
  EMPTY_TABLE_DOCS_LINK_TEST_ID,
  EMPTY_TABLE_HELP_LINK_TEST_ID,
  ModelTableEmptyState,
  ModelTableEmptyStateInput,
  NO_ACCESS_DESCRIPTION,
  NO_ACCESS_TITLE,
  VIEW_DOCUMENTATION,
  buildModelTableEmptyState,
  buildNoAccessState,
} from "../../../../UI/Components/ModelTable/ModelTableEmptyState";
import {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "../../../../UI/Components/Table/TableEmptyState";
import { TranslateFunction } from "../../../../UI/Components/Table/EmptyTableMessage";

/*
 * What an empty model table shows, decided in one place.
 *
 * The maintainer's ask was a much better empty state for every table: what
 * is true, what the list is for, and the one obvious next step. These pin
 * each of the reasons a table can be empty to what it then shows - nothing
 * here yet, nothing matches, all clear - and what it offers in each.
 */

const IDENTITY: TranslateFunction = (value: string): string => {
  return value;
};

const CARD_DESCRIPTION: string =
  "A measurement is the time between two moments in an incident.";

interface Calls {
  creates: number;
  clears: number;
  pageClears: number;
  helps: number;
  docs: number;
}

let calls: Calls = { creates: 0, clears: 0, pageClears: 0, helps: 0, docs: 0 };

const createButton: (overrides?: Partial<CardButtonSchema>) => CardButtonSchema = (
  overrides?: Partial<CardButtonSchema>,
): CardButtonSchema => {
  return {
    title: "Create Incident Measurement",
    icon: IconProp.Add,
    buttonStyle: ButtonStyleType.NORMAL,
    onClick: () => {
      calls.creates++;
    },
    ...overrides,
  };
};

const build: (
  overrides?: Partial<ModelTableEmptyStateInput>,
) => ModelTableEmptyState = (
  overrides?: Partial<ModelTableEmptyStateInput>,
): ModelTableEmptyState => {
  return buildModelTableEmptyState({
    pluralLabel: "Incident Measurements",
    hasCustomElement: false,
    cardDescription: CARD_DESCRIPTION,
    modelIcon: IconProp.Clock,
    isSearchActive: false,
    isFilterActive: false,
    onClearSearchAndFilters: () => {
      calls.clears++;
    },
    createButton: createButton(),
    isCreateDeniedByPermission: false,
    translate: IDENTITY,
    ...overrides,
  });
};

const propsOf: (state: ModelTableEmptyState) => TableEmptyStateProps = (
  state: ModelTableEmptyState,
): TableEmptyStateProps => {
  expect(state.emptyStateProps).toBeDefined();
  return state.emptyStateProps!;
};

const actionTitles: (props: TableEmptyStateProps) => Array<string> = (
  props: TableEmptyStateProps,
): Array<string> => {
  return (props.actions || []).map((action: TableEmptyStateAction) => {
    return action.title;
  });
};

const findAction: (
  props: TableEmptyStateProps,
  testId: string,
) => TableEmptyStateAction | undefined = (
  props: TableEmptyStateProps,
  testId: string,
): TableEmptyStateAction | undefined => {
  return (props.actions || []).find((action: TableEmptyStateAction) => {
    return action.dataTestId === testId;
  });
};

const reset: () => void = (): void => {
  calls = { creates: 0, clears: 0, pageClears: 0, helps: 0, docs: 0 };
};

describe("nothing here yet: the table's own empty state", () => {
  test("says what is true, what the list is for, and offers to create one", () => {
    reset();
    const state: ModelTableEmptyState = build();
    const props: TableEmptyStateProps = propsOf(state);

    expect(props.kind).toBe(TableEmptyStateKind.Empty);
    expect(props.title).toBe("No incident measurements yet");
    expect(props.description).toBe(CARD_DESCRIPTION);
    expect(props.icon).toBe(IconProp.Clock);
    expect(actionTitles(props)).toEqual(["Create Incident Measurement"]);
    expect(props.note).toBeUndefined();
  });

  test("says it in the card's words, so the card leaves them out meanwhile", () => {
    expect(build().usesCardDescription).toBe(true);
  });

  test("a card without a description gives the state none, and keeps nothing out", () => {
    const state: ModelTableEmptyState = build({ cardDescription: undefined });

    expect(propsOf(state).description).toBeUndefined();
    expect(state.usesCardDescription).toBe(false);
  });

  test("a card description that is an element is said as given", () => {
    const element: string = "an element stands in here";
    const state: ModelTableEmptyState = build({
      cardDescription: element,
    });

    expect(propsOf(state).description).toBe(element);
  });

  test("the create button is the header's: same title, icon and handler", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(build());
    const create: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_CREATE_BUTTON_TEST_ID,
    )!;

    expect(create.title).toBe("Create Incident Measurement");
    expect(create.icon).toBe(IconProp.Add);
    // Drawn as a plain button, like the header's (PR #4177).
    expect(create.style).toBeUndefined();
    expect(create.disabled).toBeUndefined();

    create.onClick();
    expect(calls.creates).toBe(1);
  });

  test("a table that creates nothing offers no create button", () => {
    const props: TableEmptyStateProps = propsOf(
      build({ createButton: undefined }),
    );

    expect(findAction(props, EMPTY_TABLE_CREATE_BUTTON_TEST_ID)).toBeUndefined();
    expect(props.actions).toEqual([]);
  });

  test("the model's icon is drawn, unless the table names its own", () => {
    expect(propsOf(build()).icon).toBe(IconProp.Clock);
    expect(
      propsOf(build({ options: { icon: IconProp.Bolt } })).icon,
    ).toBe(IconProp.Bolt);
    // A model without an icon (analytics models) leaves it to the kind.
    expect(propsOf(build({ modelIcon: null })).icon).toBeUndefined();
  });

  test("a locale heads it with its own sentence", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        pluralLabel: "Monitors",
        translate: (value: string): string => {
          return value === "No monitors yet." ? "Noch keine Monitore." : value;
        },
      }),
    );

    expect(props.title).toBe("Noch keine Monitore");
  });
});

describe("a page's own words", () => {
  test("a sentence becomes the title, and the card still says what the list is for", () => {
    const state: ModelTableEmptyState = build({
      noItemsMessage: "No custom fields found.",
    });
    const props: TableEmptyStateProps = propsOf(state);

    expect(props.title).toBe("No custom fields found");
    expect(props.description).toBe(CARD_DESCRIPTION);
    expect(state.usesCardDescription).toBe(true);
  });

  test("more sentences describe it, and the card keeps its own description", () => {
    const state: ModelTableEmptyState = build({
      noItemsMessage:
        "No site types yet. Add one to start describing your site hierarchy.",
    });
    const props: TableEmptyStateProps = propsOf(state);

    expect(props.title).toBe("No site types yet");
    expect(props.description).toBe(
      "Add one to start describing your site hierarchy.",
    );
    expect(state.usesCardDescription).toBe(false);
  });

  /*
   * The old rule kept the create button away from any page's own sentence.
   * But most of those sentences say "Add one to..." - the button is the
   * answer. Lists where creating is the wrong answer say so with isAllClear
   * or hideCreateButton.
   */
  test("the create button is offered under a page's own sentence too", () => {
    const props: TableEmptyStateProps = propsOf(
      build({ noItemsMessage: "No site types yet. Add one." }),
    );

    expect(
      findAction(props, EMPTY_TABLE_CREATE_BUTTON_TEST_ID),
    ).toBeDefined();
  });

  test("an element the page drew is the whole empty state", () => {
    const state: ModelTableEmptyState = build({ hasCustomElement: true });

    expect(state.emptyStateProps).toBeUndefined();
    expect(state.usesCardDescription).toBe(false);
  });

  test("the table's own title and description win over its sentence", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        noItemsMessage: "No site types yet. Add one.",
        options: {
          title: "Nothing to show",
          description: "Site types describe your hierarchy.",
        },
      }),
    );

    expect(props.title).toBe("Nothing to show");
    expect(props.description).toBe("Site types describe your hierarchy.");
  });

  test("a title given with its own sentence keeps the sentence's description out", () => {
    const state: ModelTableEmptyState = build({
      noItemsMessage: "No site types yet. Add one.",
      options: { title: "Nothing to show" },
    });

    // The card's words, not the half of a sentence the title replaced.
    expect(propsOf(state).description).toBe(CARD_DESCRIPTION);
  });

  test("a title given as a translated sentence is headed without its stop", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        options: { title: "Nothing here yet." },
        translate: (value: string): string => {
          return value === "Nothing here yet." ? "Hier ist noch nichts." : value;
        },
      }),
    );

    expect(props.title).toBe("Hier ist noch nichts");
  });

  test("a description of its own keeps the card's in the header", () => {
    const state: ModelTableEmptyState = build({
      options: { description: "Measurements chart how fast you respond." },
    });

    expect(propsOf(state).description).toBe(
      "Measurements chart how fast you respond.",
    );
    expect(state.usesCardDescription).toBe(false);
  });

  test("more ways forward come after the create button", () => {
    let guides: number = 0;
    const props: TableEmptyStateProps = propsOf(
      build({
        options: {
          actions: [
            {
              title: "Read the setup guide",
              icon: IconProp.Book,
              style: TableEmptyStateActionStyle.Link,
              onClick: () => {
                guides++;
              },
            },
          ],
        },
      }),
    );

    expect(actionTitles(props)).toEqual([
      "Create Incident Measurement",
      "Read the setup guide",
    ]);
    props.actions![1]!.onClick();
    expect(guides).toBe(1);
  });
});

describe("all clear: an empty list that is good news", () => {
  const ALL_CLEAR: EmptyStateOptions = {
    isAllClear: true,
    title: "No active incidents",
    description: "Nice work! Every incident is resolved.",
  };

  test("is drawn as all clear, with its own words", () => {
    const props: TableEmptyStateProps = propsOf(build({ options: ALL_CLEAR }));

    expect(props.kind).toBe(TableEmptyStateKind.AllClear);
    expect(props.title).toBe("No active incidents");
    expect(props.description).toBe("Nice work! Every incident is resolved.");
  });

  test("offers no create button: creating one is not the answer to all clear", () => {
    const props: TableEmptyStateProps = propsOf(build({ options: ALL_CLEAR }));

    expect(findAction(props, EMPTY_TABLE_CREATE_BUTTON_TEST_ID)).toBeUndefined();
  });

  test("draws its own check, not the model's icon", () => {
    expect(propsOf(build({ options: ALL_CLEAR })).icon).toBeUndefined();
  });

  test("leaves the card's description in the header", () => {
    const state: ModelTableEmptyState = build({
      noItemsMessage: "No monitors are reporting a problem.",
      options: { isAllClear: true },
    });

    expect(propsOf(state).title).toBe("No monitors are reporting a problem");
    expect(propsOf(state).description).toBeUndefined();
    expect(state.usesCardDescription).toBe(false);
  });

  test("a page's sentence splits as usual", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        noItemsMessage: "No active episodes. All episodes are resolved.",
        options: { isAllClear: true },
      }),
    );

    expect(props.title).toBe("No active episodes");
    expect(props.description).toBe("All episodes are resolved.");
  });
});

describe("hideCreateButton", () => {
  test("keeps the create button out and everything else in", () => {
    const state: ModelTableEmptyState = build({
      options: { hideCreateButton: true },
    });

    expect(propsOf(state).kind).toBe(TableEmptyStateKind.Empty);
    expect(
      findAction(propsOf(state), EMPTY_TABLE_CREATE_BUTTON_TEST_ID),
    ).toBeUndefined();
    expect(propsOf(state).description).toBe(CARD_DESCRIPTION);
  });
});

describe("a create button the viewer may not use", () => {
  test("is offered locked, with its reason on hover and a note anyone can read", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(
      build({
        createButton: createButton({
          disabled: true,
          tooltip:
            "You do not have permission to create this Incident Measurement.",
        }),
        isCreateDeniedByPermission: true,
      }),
    );
    const create: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_CREATE_BUTTON_TEST_ID,
    )!;

    expect(create.disabled).toBe(true);
    expect(create.tooltip).toBe(
      "You do not have permission to create this Incident Measurement.",
    );
    expect(props.note).toBe(CREATE_NOT_ALLOWED_NOTE);

    create.onClick();
    expect(calls.creates).toBe(0);
  });

  test("locked for another reason, the note is the page's own reason", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        createButton: createButton({
          disabled: true,
          tooltip: "Upgrade to the Growth plan to create more.",
        }),
        isCreateDeniedByPermission: false,
      }),
    );

    expect(props.note).toBe("Upgrade to the Growth plan to create more.");
  });

  test("a live button needs no note", () => {
    expect(propsOf(build()).note).toBeUndefined();
  });
});

describe("a way to read more", () => {
  test("the table's help comes after the create button, as a link", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(
      build({
        help: {
          title: "How Incident Measurements Work",
          onClick: () => {
            calls.helps++;
          },
        },
      }),
    );
    const help: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_HELP_LINK_TEST_ID,
    )!;

    expect(actionTitles(props)).toEqual([
      "Create Incident Measurement",
      "How Incident Measurements Work",
    ]);
    expect(help.style).toBe(TableEmptyStateActionStyle.Link);
    expect(help.icon).toBe(IconProp.Help);

    help.onClick();
    expect(calls.helps).toBe(1);
  });

  test("without help, the documentation link", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(
      build({
        onDocumentationClick: () => {
          calls.docs++;
        },
      }),
    );
    const docs: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_DOCS_LINK_TEST_ID,
    )!;

    expect(docs.title).toBe(VIEW_DOCUMENTATION);
    expect(docs.style).toBe(TableEmptyStateActionStyle.Link);
    expect(docs.icon).toBe(IconProp.Book);

    docs.onClick();
    expect(calls.docs).toBe(1);
  });

  test("one link at most: help wins over documentation", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        help: { title: "How It Works", onClick: () => {} },
        onDocumentationClick: () => {},
      }),
    );

    expect(findAction(props, EMPTY_TABLE_HELP_LINK_TEST_ID)).toBeDefined();
    expect(findAction(props, EMPTY_TABLE_DOCS_LINK_TEST_ID)).toBeUndefined();
  });

  test("the page's own actions sit between create and read-more", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        help: { title: "How It Works", onClick: () => {} },
        options: {
          actions: [{ title: "Import", onClick: () => {} }],
        },
      }),
    );

    expect(actionTitles(props)).toEqual([
      "Create Incident Measurement",
      "Import",
      "How It Works",
    ]);
  });
});

describe("nothing matches: a search or filter hides every row", () => {
  test("a search: says so, and clears the search", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(build({ isSearchActive: true }));
    const clear: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
    )!;

    expect(props.kind).toBe(TableEmptyStateKind.Filtered);
    expect(props.title).toBe(
      "No incident measurements match your search or filters",
    );
    expect(clear.title).toBe(CLEAR_SEARCH);

    clear.onClick();
    expect(calls.clears).toBe(1);
  });

  test("a filter: Clear Filters", () => {
    expect(
      findAction(
        propsOf(build({ isFilterActive: true })),
        EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
      )!.title,
    ).toBe(CLEAR_FILTERS);
  });

  test("both: Clear Search and Filters", () => {
    expect(
      findAction(
        propsOf(build({ isFilterActive: true, isSearchActive: true })),
        EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
      )!.title,
    ).toBe(CLEAR_SEARCH_AND_FILTERS);
  });

  test("offers neither the create button nor a link to read more", () => {
    const props: TableEmptyStateProps = propsOf(
      build({
        isFilterActive: true,
        help: { title: "How It Works", onClick: () => {} },
      }),
    );

    expect(actionTitles(props)).toEqual([CLEAR_FILTERS]);
  });

  test("wins over a page's own sentence and over its element", () => {
    const fromSentence: TableEmptyStateProps = propsOf(
      build({
        isSearchActive: true,
        noItemsMessage: "Nice work! No Active Incidents so far.",
      }),
    );
    const fromElement: ModelTableEmptyState = build({
      isSearchActive: true,
      hasCustomElement: true,
    });

    expect(fromSentence.kind).toBe(TableEmptyStateKind.Filtered);
    expect(propsOf(fromElement).kind).toBe(TableEmptyStateKind.Filtered);
  });

  test("wins over all clear: a search that missed is not good news", () => {
    expect(
      propsOf(
        build({ isSearchActive: true, options: { isAllClear: true } }),
      ).kind,
    ).toBe(TableEmptyStateKind.Filtered);
  });

  test("never says it in the card's words", () => {
    expect(build({ isFilterActive: true }).usesCardDescription).toBe(false);
    expect(propsOf(build({ isFilterActive: true })).description).toBeUndefined();
  });

  test("a locale says its noun-free sentence", () => {
    expect(
      propsOf(
        build({
          isFilterActive: true,
          translate: (value: string): string => {
            return value === "Nothing matches your search or filters."
              ? "Nichts entspricht Ihrer Suche oder Ihren Filtern."
              : value;
          },
        }),
      ).title,
    ).toBe("Nichts entspricht Ihrer Suche oder Ihren Filtern");
  });
});

describe("filters the page applies itself (facet chips)", () => {
  test("say nothing matches and clear the chips", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(
      build({
        options: {
          isFiltered: true,
          onClearFilters: () => {
            calls.pageClears++;
          },
        },
      }),
    );
    const clear: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
    )!;

    expect(props.kind).toBe(TableEmptyStateKind.Filtered);
    expect(clear.title).toBe(CLEAR_FILTERS);
    expect(findAction(props, EMPTY_TABLE_CREATE_BUTTON_TEST_ID)).toBeUndefined();

    clear.onClick();
    expect(calls.pageClears).toBe(1);
    // The table's own search and filters were not on, so they are left be.
    expect(calls.clears).toBe(0);
  });

  test("a chip and a search together: one button clears both", () => {
    reset();
    const props: TableEmptyStateProps = propsOf(
      build({
        isSearchActive: true,
        options: {
          isFiltered: true,
          onClearFilters: () => {
            calls.pageClears++;
          },
        },
      }),
    );
    const clear: TableEmptyStateAction = findAction(
      props,
      EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
    )!;

    expect(clear.title).toBe(CLEAR_SEARCH_AND_FILTERS);

    clear.onClick();
    expect(calls.pageClears).toBe(1);
    expect(calls.clears).toBe(1);
  });

  test("without a way to clear them, there is no button", () => {
    const props: TableEmptyStateProps = propsOf(
      build({ options: { isFiltered: true } }),
    );

    expect(props.kind).toBe(TableEmptyStateKind.Filtered);
    expect(props.actions).toEqual([]);
  });

  test("chips that are off change nothing", () => {
    const props: TableEmptyStateProps = propsOf(
      build({ options: { isFiltered: false, onClearFilters: () => {} } }),
    );

    expect(props.kind).toBe(TableEmptyStateKind.Empty);
    expect(
      findAction(props, EMPTY_TABLE_CREATE_BUTTON_TEST_ID),
    ).toBeDefined();
  });
});

describe("buildNoAccessState", () => {
  test("says the viewer has no access and which permissions would give it", () => {
    const props: TableEmptyStateProps = buildNoAccessState({
      permissionTitles: ["Project Owner", "Read Monitor"],
      translate: IDENTITY,
    });

    expect(props.kind).toBe(TableEmptyStateKind.NoAccess);
    expect(props.title).toBe(NO_ACCESS_TITLE);
    expect(props.description).toBe(
      `${NO_ACCESS_DESCRIPTION} Project Owner, Read Monitor`,
    );
    expect(props.actions).toBeUndefined();
  });

  test("names no permissions it does not know", () => {
    expect(
      buildNoAccessState({ permissionTitles: [], translate: IDENTITY })
        .description,
    ).toBeUndefined();
  });

  test("is said in the reader's language, the permission names as given", () => {
    const props: TableEmptyStateProps = buildNoAccessState({
      permissionTitles: ["Project Owner"],
      translate: (value: string): string => {
        const dictionary: Record<string, string> = {
          [NO_ACCESS_TITLE]: "Sie haben keinen Zugriff auf diese Liste",
          [NO_ACCESS_DESCRIPTION]:
            "Bitten Sie einen Projektadministrator um eine dieser Berechtigungen:",
        };
        return dictionary[value] ?? value;
      },
    });

    expect(props.title).toBe("Sie haben keinen Zugriff auf diese Liste");
    expect(props.description).toBe(
      "Bitten Sie einen Projektadministrator um eine dieser Berechtigungen: Project Owner",
    );
  });
});
