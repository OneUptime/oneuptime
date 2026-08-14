import ComponentsModal, {
  getSearchScore,
  getSearchTokens,
  matchesSearch,
} from "../../../UI/Components/Workflow/ComponentsModal";
import { describe, expect, it } from "@jest/globals";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs. This suite is one
 * of only two that exercise SideOver, so it has to actually run.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../Types/Workflow/Component";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import Faker from "../../../Utils/Faker";

/// @dev we use different UUID for (id & title), description, and category to ensure that the component is unique

type GetComponentMetadataFunction = (category?: string) => ComponentMetadata;

const getComponentMetadata: GetComponentMetadataFunction = (
  category?: string,
): ComponentMetadata => {
  const id: string = Faker.generateRandomObjectID().toString();
  return {
    id,
    title: id,
    description: Faker.generateRandomObjectID().toString(),
    category: category || Faker.generateRandomObjectID().toString(),
    iconProp: IconProp.Activity,
    componentType: ComponentType.Component,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [],
  };
};

type GetComponentCategoryFunction = (name?: string) => ComponentCategory;

const getComponentCategory: GetComponentCategoryFunction = (
  name?: string,
): ComponentCategory => {
  return {
    name: name || Faker.generateRandomObjectID().toString(),
    description: `Description for ${name}`,
    icon: IconProp.Activity,
  };
};

type BuildDatabaseComponentFunction = (
  title: string,
  description: string,
  category: string,
) => ComponentMetadata;

/*
 * Only the three fields the search reads are meaningful here. The icon and the
 * ports the generator fills in play no part in matching or ranking.
 */
const buildDatabaseComponent: BuildDatabaseComponentFunction = (
  title: string,
  description: string,
  category: string,
): ComponentMetadata => {
  return {
    id: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    description,
    category,
    iconProp: IconProp.Database,
    componentType: ComponentType.Component,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [],
  };
};

/*
 * The database half of the palette is generated rather than written: one
 * component per operation per model, by
 * Common/Types/Workflow/Components/BaseModel.ts. These are that generator's
 * strings copied word for word, not approximated, because the whole regression
 * below lives in the gap between what it writes ("Create One Monitor") and what
 * somebody building a workflow types ("create monitor"). A fixture that merely
 * looked like the real thing would pin nothing.
 *
 * These eight are the components; the generator also emits three triggers per
 * model, which the modal keeps in a separate palette.
 */
type GetDatabaseComponentsFunction = (
  singularName: string,
  pluralName: string,
) => Array<ComponentMetadata>;

const getDatabaseComponents: GetDatabaseComponentsFunction = (
  singularName: string,
  pluralName: string,
): Array<ComponentMetadata> => {
  return [
    buildDatabaseComponent(
      `Find One ${singularName}`,
      `Database query to find one ${singularName}`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Find Many ${pluralName}`,
      `Database query to find many ${pluralName}`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Delete One ${singularName}`,
      `Database query to delete one ${singularName}`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Delete Many ${pluralName}`,
      `Delete many ${pluralName} that match a query.`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Create One ${singularName}`,
      `Database query to create one ${singularName}`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Create Many ${pluralName}`,
      `Database query to create many ${pluralName}`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Update One ${singularName}`,
      `Database query to update one ${singularName}`,
      `${singularName}`,
    ),
    buildDatabaseComponent(
      `Update Many ${pluralName}`,
      `Database query to update many ${pluralName}`,
      `${singularName}`,
    ),
  ];
};

/*
 * Two entries from the hand-written half of the palette, copied from
 * Common/Types/Workflow/Components/JavaScript.ts and Manual.ts. A generated
 * component always restates its own title inside its description, so it can
 * never show a word that lives in one field alone - these two can.
 */
const runCustomJavaScriptComponent: ComponentMetadata = {
  id: "run-custom-javascript",
  title: "Run Custom JavaScript",
  category: "Custom Code",
  description: "Run custom JavaScript in your workflow",
  iconProp: IconProp.Code,
  componentType: ComponentType.Component,
  arguments: [],
  returnValues: [],
  inPorts: [],
  outPorts: [],
};

const manualComponent: ComponentMetadata = {
  id: "manual",
  title: "Manual",
  category: "Utils",
  description: "Run this workflow manually",
  iconProp: IconProp.Play,
  componentType: ComponentType.Trigger,
  arguments: [],
  returnValues: [],
  inPorts: [],
  outPorts: [],
};

type GetComponentByTitleFunction = (
  components: Array<ComponentMetadata>,
  title: string,
) => ComponentMetadata;

const getComponentByTitle: GetComponentByTitleFunction = (
  components: Array<ComponentMetadata>,
  title: string,
): ComponentMetadata => {
  const componentMetadata: ComponentMetadata | undefined = components.find(
    (candidate: ComponentMetadata) => {
      return candidate.title === title;
    },
  );

  if (!componentMetadata) {
    /*
     * A mistyped fixture title would otherwise resolve to undefined and quietly
     * weaken every assertion that reads it.
     */
    throw new Error(`No component titled "${title}" in these fixtures.`);
  }

  return componentMetadata;
};

/*
 * The filter as it used to be: the whole typed string, as one substring,
 * against each field on its own. Kept here so the tests can show what each of
 * these searches used to return rather than only asserting that it works now.
 */
type MatchesWholeSearchStringFunction = (
  componentMetadata: ComponentMetadata,
  search: string,
) => boolean;

const matchesWholeSearchString: MatchesWholeSearchStringFunction = (
  componentMetadata: ComponentMetadata,
  search: string,
): boolean => {
  const normalizedSearch: string = search.trim().toLowerCase();

  return (
    componentMetadata.title.toLowerCase().includes(normalizedSearch) ||
    componentMetadata.description.toLowerCase().includes(normalizedSearch) ||
    componentMetadata.category.toLowerCase().includes(normalizedSearch)
  );
};

/*
 * The modal's own pipeline - keep what matches every word, then order by score
 * with the alphabetical tie-break - so the ranking assertions below describe
 * the list somebody actually sees rather than a number in isolation.
 */
type RankBySearchFunction = (
  components: Array<ComponentMetadata>,
  search: string,
) => Array<string>;

const rankBySearch: RankBySearchFunction = (
  components: Array<ComponentMetadata>,
  search: string,
): Array<string> => {
  const tokens: Array<string> = getSearchTokens(search);

  return components
    .filter((componentMetadata: ComponentMetadata) => {
      return matchesSearch(componentMetadata, tokens);
    })
    .sort((componentA: ComponentMetadata, componentB: ComponentMetadata) => {
      const scoreDifference: number =
        getSearchScore(componentB, tokens) - getSearchScore(componentA, tokens);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return componentA.title.localeCompare(componentB.title);
    })
    .map((componentMetadata: ComponentMetadata) => {
      return componentMetadata.title;
    });
};

describe("ComponentsModal", () => {
  const mockedCategories: ComponentCategory[] = [
    getComponentCategory(),
    getComponentCategory(),
    getComponentCategory(),
    getComponentCategory(),
  ];

  const mockedComponents: ComponentMetadata[] = [
    getComponentMetadata(mockedCategories[0]?.name),
    getComponentMetadata(mockedCategories[1]?.name),
    getComponentMetadata(mockedCategories[2]?.name),
    getComponentMetadata(mockedCategories[3]?.name),
  ];

  const mockOnCloseModal: MockFunction = getJestMockFunction();
  const mockOnComponentClick: MockFunction = getJestMockFunction();

  it("should render without crashing", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
  });

  it("should display search input", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    expect(
      screen.getByPlaceholderText(
        "Search components by name, description, or category",
      ),
    ).toBeInTheDocument();
  });

  it("should display categories and components", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    for (const cat of mockedCategories) {
      expect(screen.getAllByText(cat.name).length).toBeGreaterThanOrEqual(1);
    }
    for (const comp of mockedComponents) {
      expect(screen.getByText(comp.title)).toBeInTheDocument();
    }
  });

  it("should call onCloseModal when the close button is clicked", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    fireEvent.click(screen.getByText("Close panel"));
    expect(mockOnCloseModal).toHaveBeenCalled();
  });

  it("should call onComponentClick when a component is selected", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    for (const [idx, comp] of mockedComponents.entries()) {
      // simulate selecting a component
      fireEvent.click(screen.getByText(comp.title));
      expect(screen.getByText("Add to Workflow")).not.toBeDisabled();

      // simulate submitting
      fireEvent.click(screen.getByText("Add to Workflow"));

      // check if onComponentClick was called with the selected component's metadata
      expect(mockOnComponentClick).toHaveBeenNthCalledWith(idx + 1, comp);
    }
  });

  it("should display a message when no components are available", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={[]}
        categories={mockedCategories}
      />,
    );
    /*
     * An empty palette and an unproductive search are different situations and
     * no longer share a message. Nothing has been typed here, so there is no
     * advice to give about the words used.
     */
    expect(screen.getByText("No components to show.")).toBeInTheDocument();
  });

  it("should not display categories when there are no categories", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={[]}
      />,
    );
    mockedCategories.forEach((category: ComponentCategory) => {
      expect(screen.queryByText(category.name)).not.toBeInTheDocument();
    });
  });

  it("should display no components message when search yields no results", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Search components by name, description, or category",
      ),
      {
        target: { value: "Non-existent Ccmponent" },
      },
    );
    /*
     * Says what actually happened: a search now fails only when no component
     * holds every word typed, so the useful advice is to type fewer words. The
     * old wording concluded on the builder's behalf that the integration did
     * not exist, which is what sent people off to write it by hand.
     */
    expect(
      screen.getByText(
        "No components match every word you typed. Try fewer words. If what you need really does not exist, the Custom Code and API components can build anything you like.",
      ),
    ).toBeInTheDocument();
  });

  it("should disable submit button prop when no component is selected", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    const submitButton: HTMLElement = screen.getByText("Add to Workflow");
    expect(submitButton).toBeDisabled();
  });

  it("should change submitButtonDisabled to false when a component is selected", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    for (const comp of mockedComponents) {
      fireEvent.click(screen.getByText(comp.title));
      const submitButton: HTMLElement = screen.getByText("Add to Workflow");
      expect(submitButton).not.toBeDisabled();
    }
  });

  // search tests

  it("should filter components based on search input", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );

    mockedComponents.forEach((comp: ComponentMetadata) => {
      const partialTitle: string = comp.title.substring(
        0,
        comp.title.length - comp.title.length / 2,
      );
      fireEvent.change(
        screen.getByPlaceholderText(
          "Search components by name, description, or category",
        ),
        {
          target: { value: partialTitle },
        },
      );
      // title may be split across elements due to search highlighting
      expect(
        screen.getByText((_content: string | null, element: Element | null) => {
          return element?.textContent === comp.title;
        }),
      ).toBeInTheDocument();

      // check other components are not displayed
      mockedComponents
        .filter((c: ComponentMetadata) => {
          return c.title !== comp.title;
        })
        .forEach((c: ComponentMetadata) => {
          return expect(screen.queryByText(c.title)).not.toBeInTheDocument();
        });
    });
  });

  it("should filter components based on description when searching", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    mockedComponents.forEach((comp: ComponentMetadata) => {
      fireEvent.change(
        screen.getByPlaceholderText(
          "Search components by name, description, or category",
        ),
        {
          target: { value: comp.description },
        },
      );
      expect(screen.getByText(comp.title)).toBeInTheDocument();

      // check other components are not displayed
      mockedComponents
        .filter((c: ComponentMetadata) => {
          return c.title !== comp.title;
        })
        .forEach((c: ComponentMetadata) => {
          return expect(screen.queryByText(c.title)).not.toBeInTheDocument();
        });
    });
  });

  it("should filter components based on category when searching", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    mockedComponents.forEach((comp: ComponentMetadata) => {
      fireEvent.change(
        screen.getByPlaceholderText(
          "Search components by name, description, or category",
        ),
        {
          target: { value: comp.category },
        },
      );
      expect(screen.getByText(comp.title)).toBeInTheDocument();

      // check other components are not displayed
      mockedComponents
        .filter((c: ComponentMetadata) => {
          return c.category !== comp.category;
        })
        .forEach((c: ComponentMetadata) => {
          return expect(screen.queryByText(c.title)).not.toBeInTheDocument();
        });
    });
  });

  it("should show all components when search is cleared", () => {
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={mockedComponents}
        categories={mockedCategories}
      />,
    );
    mockedComponents.forEach((comp: ComponentMetadata) => {
      const searchInput: HTMLElement = screen.getByPlaceholderText(
        "Search components by name, description, or category",
      );
      fireEvent.change(searchInput, { target: { value: comp.title } });
      fireEvent.change(searchInput, { target: { value: "" } }); // clear search

      mockedComponents.forEach((c: ComponentMetadata) => {
        return expect(screen.getByText(c.title)).toBeInTheDocument();
      });
    });
  });

  it("should return multiple components when similar titles match", () => {
    // we add a new component where its title is a substring of another component's title
    const localComponents: ComponentMetadata[] = [...mockedComponents];
    const commonWord: string = localComponents[0]?.title.substring(0, 5) || "";
    const newComponent: ComponentMetadata = getComponentMetadata(
      mockedCategories[1]?.name,
    );
    newComponent.title += commonWord;
    localComponents.push(newComponent);
    const componentsWithCommonWord: ComponentMetadata[] =
      localComponents.filter((comp: ComponentMetadata) => {
        return comp.title.includes(commonWord);
      });

    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={localComponents}
        categories={mockedCategories}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search components by name, description, or category",
      ),
      {
        target: { value: commonWord },
      },
    );
    componentsWithCommonWord.forEach((comp: ComponentMetadata) => {
      // title may be split across elements due to search highlighting
      expect(
        screen.getByText((_content: string | null, element: Element | null) => {
          return element?.textContent === comp.title;
        }),
      ).toBeInTheDocument();
    });
  });

  it("should return return components with similar descriptions", () => {
    // we add a new component where its title is a substring of another component's description
    const localComponents: ComponentMetadata[] = [...mockedComponents];
    const partialDescription: string =
      localComponents[0]?.description.substring(0, 10) || "";
    const newComponent: ComponentMetadata = getComponentMetadata(
      mockedCategories[1]?.name,
    );
    newComponent.title = partialDescription || "";
    localComponents.push(newComponent);
    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={localComponents}
        categories={mockedCategories}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search components by name, description, or category",
      ),
      {
        target: { value: partialDescription },
      },
    );
    expect(
      screen.getAllByText(new RegExp(partialDescription, "i")),
    ).toHaveLength(2);
  });

  it("should return components with the same category", () => {
    // we add two components with the same category as the first component
    const localComponents: ComponentMetadata[] = [...mockedComponents];
    const commonCategory: string | undefined = localComponents[0]?.category;
    localComponents.push(getComponentMetadata(commonCategory));
    localComponents.push(getComponentMetadata(commonCategory));
    const componentsInCommonCategory: ComponentMetadata[] =
      localComponents.filter((comp: ComponentMetadata) => {
        return comp.category === commonCategory;
      });

    render(
      <ComponentsModal
        componentsType={ComponentType.Component}
        onCloseModal={mockOnCloseModal}
        onComponentClick={mockOnComponentClick}
        components={localComponents}
        categories={mockedCategories}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search components by name, description, or category",
      ),
      {
        target: { value: commonCategory },
      },
    );
    componentsInCommonCategory.forEach((comp: ComponentMetadata) => {
      expect(screen.getByText(comp.title)).toBeInTheDocument();
    });
  });

  /*
   * Everything above searches with a single word, which is the one shape the
   * old whole-string filter handled. These use the strings the palette is
   * really made of, where the words a builder types are separated in the
   * component by words they have no reason to guess.
   */
  describe("search across every word typed", () => {
    const monitorComponents: Array<ComponentMetadata> = getDatabaseComponents(
      "Monitor",
      "Monitors",
    );
    const teamComponents: Array<ComponentMetadata> = getDatabaseComponents(
      "Team",
      "Teams",
    );
    const palette: Array<ComponentMetadata> = [
      ...monitorComponents,
      ...teamComponents,
      runCustomJavaScriptComponent,
      manualComponent,
    ];

    const createOneMonitor: ComponentMetadata = getComponentByTitle(
      palette,
      "Create One Monitor",
    );
    const createManyMonitors: ComponentMetadata = getComponentByTitle(
      palette,
      "Create Many Monitors",
    );
    const findOneMonitor: ComponentMetadata = getComponentByTitle(
      palette,
      "Find One Monitor",
    );
    const updateOneMonitor: ComponentMetadata = getComponentByTitle(
      palette,
      "Update One Monitor",
    );
    const deleteManyMonitors: ComponentMetadata = getComponentByTitle(
      palette,
      "Delete Many Monitors",
    );
    const createOneTeam: ComponentMetadata = getComponentByTitle(
      palette,
      "Create One Team",
    );
    const findOneTeam: ComponentMetadata = getComponentByTitle(
      palette,
      "Find One Team",
    );

    it("should split a search into its words, lower cased, ignoring runs of whitespace", () => {
      expect(getSearchTokens("create monitor")).toEqual(["create", "monitor"]);

      /*
       * Leading, trailing and repeated whitespace all come from ordinary
       * typing - a trailing space while still thinking, a double space between
       * words - and none of them should narrow the results.
       */
      expect(getSearchTokens("  Create   ONE  Monitor  ")).toEqual([
        "create",
        "one",
        "monitor",
      ]);
      expect(getSearchTokens("create\tmonitor\nsecret")).toEqual([
        "create",
        "monitor",
        "secret",
      ]);

      // Nothing typed, and whitespace only, are the same thing: no words.
      expect(getSearchTokens("")).toEqual([]);
      expect(getSearchTokens("   ")).toEqual([]);
    });

    it("should match every component when nothing has been typed", () => {
      // No search means show the palette, not hide it.
      const noTokens: Array<string> = getSearchTokens("");

      palette.forEach((componentMetadata: ComponentMetadata) => {
        expect(matchesSearch(componentMetadata, noTokens)).toBe(true);
      });
    });

    it("should find a component when the words typed have other words between them", () => {
      /*
       * "create monitor" is the search this fix exists for. The generator
       * writes "Create One Monitor", so the typed string is not a substring of
       * any field, and the old filter - which tested exactly that - returned an
       * empty list for a component sitting right there in the palette.
       */
      expect(matchesWholeSearchString(createOneMonitor, "create monitor")).toBe(
        false,
      );
      expect(
        palette.filter((componentMetadata: ComponentMetadata) => {
          return matchesWholeSearchString(componentMetadata, "create monitor");
        }),
      ).toHaveLength(0);

      expect(
        matchesSearch(createOneMonitor, getSearchTokens("create monitor")),
      ).toBe(true);

      // The order the words are typed in is not part of the question.
      expect(
        matchesSearch(createOneMonitor, getSearchTokens("monitor create")),
      ).toBe(true);

      // The same shape of failure held for every other operation...
      expect(matchesWholeSearchString(updateOneMonitor, "update monitor")).toBe(
        false,
      );
      expect(
        matchesSearch(updateOneMonitor, getSearchTokens("update monitor")),
      ).toBe(true);

      // ...and every other model.
      expect(matchesWholeSearchString(findOneTeam, "find team")).toBe(false);
      expect(matchesSearch(findOneTeam, getSearchTokens("find team"))).toBe(
        true,
      );
    });

    it("should take its words from different fields", () => {
      /*
       * "code" appears only in the category ("Custom Code"), "javascript" only
       * in the title and description. No single field holds both, so the old
       * filter - title, then description, then category, each against the whole
       * string - could not have matched this in any word order.
       */
      expect(runCustomJavaScriptComponent.title.toLowerCase()).not.toContain(
        "code",
      );
      expect(
        runCustomJavaScriptComponent.description.toLowerCase(),
      ).not.toContain("code");
      expect(runCustomJavaScriptComponent.category.toLowerCase()).not.toContain(
        "javascript",
      );
      expect(
        matchesWholeSearchString(
          runCustomJavaScriptComponent,
          "javascript code",
        ),
      ).toBe(false);
      expect(
        matchesSearch(
          runCustomJavaScriptComponent,
          getSearchTokens("javascript code"),
        ),
      ).toBe(true);

      /*
       * The same across the generated components: "database" is only ever in
       * the description, while the model name is in the title and the category.
       */
      expect(createOneMonitor.title.toLowerCase()).not.toContain("database");
      expect(createOneMonitor.category.toLowerCase()).not.toContain("database");
      expect(
        matchesSearch(createOneMonitor, getSearchTokens("database monitor")),
      ).toBe(true);
    });

    it("should drop a component when one of the words matches nothing", () => {
      /*
       * Every word has to land somewhere. Otherwise the search would widen as
       * it was typed, and adding a word could never narrow the list.
       */
      expect(
        matchesSearch(
          createOneMonitor,
          getSearchTokens("create monitor banana"),
        ),
      ).toBe(false);
      expect(rankBySearch(palette, "create monitor banana")).toEqual([]);
    });

    it("should ignore case on both sides", () => {
      // The generator writes Title Case; almost nobody types it.
      expect(createOneMonitor.title).toBe("Create One Monitor");

      expect(
        matchesSearch(createOneMonitor, getSearchTokens("create monitor")),
      ).toBe(true);
      expect(
        matchesSearch(createOneMonitor, getSearchTokens("CREATE MONITOR")),
      ).toBe(true);
      expect(
        matchesSearch(createOneMonitor, getSearchTokens("CrEaTe MoNiToR")),
      ).toBe(true);
    });

    it("should still match part of a word", () => {
      /*
       * Matching inside a word is what makes a search useful while it is still
       * being typed, and it is what lets the singular a builder types reach the
       * plural the generator wrote. Both predate this fix and both still hold.
       */
      expect(matchesSearch(createOneMonitor, getSearchTokens("mon"))).toBe(
        true,
      );
      expect(
        matchesSearch(createOneMonitor, getSearchTokens("creat mon")),
      ).toBe(true);
      expect(
        matchesSearch(createManyMonitors, getSearchTokens("create monitor")),
      ).toBe(true);
    });

    it("should score a search of several words above zero", () => {
      /*
       * Every branch of the per-word score tests one whole token against one
       * field, so scoring the search as a single string gave a score of exactly
       * zero to the very component it was meant to find. With every score zero
       * the order fell through to the alphabetical tie-break, which is to say
       * there was no ranking at all for any search longer than one word.
       */
      expect(getSearchScore(createOneMonitor, ["create monitor"])).toBe(0);
      expect(
        getSearchScore(createOneMonitor, getSearchTokens("create monitor")),
      ).toBeGreaterThan(0);
    });

    it("should score a component matching both words above one matching a single word", () => {
      const tokens: Array<string> = getSearchTokens("create monitor");

      expect(getSearchScore(createOneMonitor, tokens)).toBeGreaterThan(
        getSearchScore(updateOneMonitor, tokens),
      );

      /*
       * "Update One Monitor" earns the "monitor" half and nothing for "create",
       * so its score for the two words is the score of one of them.
       */
      expect(getSearchScore(updateOneMonitor, tokens)).toBe(
        getSearchScore(updateOneMonitor, getSearchTokens("monitor")),
      );
    });

    it("should score a title the search starts above a match found only in the description", () => {
      const tokens: Array<string> = getSearchTokens("run");

      // "Manual" mentions the word only in "Run this workflow manually".
      expect(manualComponent.title.toLowerCase()).not.toContain("run");
      expect(manualComponent.category.toLowerCase()).not.toContain("run");

      expect(getSearchScore(manualComponent, tokens)).toBeGreaterThan(0);
      expect(
        getSearchScore(runCustomJavaScriptComponent, tokens),
      ).toBeGreaterThan(getSearchScore(manualComponent, tokens));
    });

    it("should score nothing when nothing has been typed", () => {
      // Nothing to rank by, so the modal falls back to sorting by title.
      expect(getSearchScore(createOneMonitor, getSearchTokens(""))).toBe(0);
      expect(getSearchScore(createOneMonitor, [])).toBe(0);
    });

    it("should rank the components that create Monitors first for 'create monitor'", () => {
      const tokens: Array<string> = getSearchTokens("create monitor");

      /*
       * Out of both operations of two models plus the hand-written components,
       * only the two that create Monitors survive: the other Monitor
       * components have no "create" anywhere, and the Team components have no
       * "monitor".
       */
      expect(rankBySearch(palette, "create monitor")).toEqual([
        "Create Many Monitors",
        "Create One Monitor",
      ]);

      /*
       * Those two score identically - nothing in the scoring can prefer "One"
       * over "Many" - so it is the alphabetical tie-break that puts Many first,
       * not the ranking. Typing the third word is what separates them.
       */
      expect(getSearchScore(createManyMonitors, tokens)).toBe(
        getSearchScore(createOneMonitor, tokens),
      );
      expect(rankBySearch(palette, "create one monitor")).toEqual([
        "Create One Monitor",
      ]);

      /*
       * The two survivors also outscore what the filter dropped, so the
       * ranking would hold them at the top even in a palette where the other
       * components still matched.
       */
      expect(getSearchScore(createOneMonitor, tokens)).toBeGreaterThan(
        getSearchScore(findOneMonitor, tokens),
      );
      expect(getSearchScore(createOneMonitor, tokens)).toBeGreaterThan(
        getSearchScore(deleteManyMonitors, tokens),
      );
      expect(getSearchScore(createOneMonitor, tokens)).toBeGreaterThan(
        getSearchScore(createOneTeam, tokens),
      );
    });

    it("should show the component in the modal when the builder types 'create monitor'", () => {
      /*
       * The same regression through the modal itself, since the empty state -
       * and the conclusion that the integration has to be built by hand - is
       * what a builder actually met.
       */
      render(
        <ComponentsModal
          componentsType={ComponentType.Component}
          onCloseModal={mockOnCloseModal}
          onComponentClick={mockOnComponentClick}
          components={[...monitorComponents, ...teamComponents]}
          categories={[
            getComponentCategory("Monitor"),
            getComponentCategory("Team"),
          ]}
        />,
      );

      fireEvent.change(
        screen.getByPlaceholderText(
          "Search components by name, description, or category",
        ),
        {
          target: { value: "create monitor" },
        },
      );

      expect(screen.getByText("Create One Monitor")).toBeInTheDocument();
      expect(screen.getByText("Create Many Monitors")).toBeInTheDocument();
      expect(screen.queryByText("Find One Monitor")).not.toBeInTheDocument();
      expect(screen.queryByText("Create One Team")).not.toBeInTheDocument();
    });
  });
});
