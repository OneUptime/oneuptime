import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * Saving a view of the Traces, Metrics and Exceptions explorers, in every
 * language
 * ---------------------------------------------------------------------------
 *
 * The saved-view dialogs read "Save Trace View" and "Choose a name for this
 * saved traces view." in English in every language, because each sentence was
 * glued together from two words the explorer passed in. A sentence is now one
 * key with the words filled in, so a language can put them where it needs to,
 * and each word is a key of its own.
 *
 * Through the real control, ModelFormModal, ModelForm and BasicForm, with the
 * network stubbed and the saved views menu reduced to its Save and Edit
 * buttons (as in TelemetrySavedViewsControlDefaultView.test.tsx).
 */

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000a1";
const VIEW_ID_STRING: string = "00000000-0000-4000-8000-0000000000b2";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<Record<string, unknown>> => {
        return {};
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: async (data: unknown): Promise<unknown> => {
        return { data: (data as { model: unknown }).model };
      },
    },
  };
});

// Every column permission the form checks, so every field is drawn.
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: (): null => {
        return null;
      },
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

interface SavedViewsMenuProps {
  savedViews: Array<{ id: string }>;
  onCreate: () => void;
  onEdit: (viewId: string) => void;
  onDelete: (viewId: string) => void;
}

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown",
  () => {
    return {
      __esModule: true,
      default: (props: SavedViewsMenuProps): ReactElement => {
        return (
          <div>
            <button type="button" onClick={props.onCreate}>
              open-save
            </button>
            {props.savedViews.map((view: { id: string }) => {
              return (
                <div key={view.id}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onEdit(view.id);
                    }}
                  >
                    open-edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onDelete(view.id);
                    }}
                  >
                    open-delete
                  </button>
                </div>
              );
            })}
          </div>
        );
      },
    };
  },
);

import TelemetrySavedViewsControl from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import { translatableTerm } from "../../../UI/Utils/TranslateTemplate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  PSEUDO_LANGUAGE,
  createLanguageInstances,
  drawnTexts,
  hasOwnWording,
  inLanguage,
  sentence,
  setGlobalLanguage,
  textsThatSkippedTranslation,
  word,
} from "./TracesLanguageHarness";

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

// What each explorer calls itself, read off the explorers below.
const EXPLORERS: Array<[string, string, string]> = [
  ["Traces", "Trace", "traces"],
  ["Metrics", "Metric", "metrics"],
  ["Metric Explorer", "Metric Explorer", "metric explorer"],
  ["Exceptions", "Exception", "exceptions"],
];

const CALL_SITES: Array<string> = [
  "Components/Traces/TracesViewer.tsx",
  "Components/Metrics/MetricsViewer.tsx",
  "Components/Metrics/MetricExplorer.tsx",
  "Components/Exceptions/ExceptionsViewer.tsx",
];

const SAVE_TITLE: string = "Save {{noun}} View";
const EDIT_TITLE: string = "Edit {{noun}} View";
const SAVE_DESCRIPTION: string =
  "Save the current {{explorer}} explorer state as a reusable view.";
const NAME_DESCRIPTION: string =
  "Choose a name for this saved {{explorer}} view.";
const DEFAULT_DESCRIPTION: string =
  "Automatically apply this view when opening {{explorer}}.";

const SENTENCES: Array<string> = [
  SAVE_TITLE,
  EDIT_TITLE,
  SAVE_DESCRIPTION,
  NAME_DESCRIPTION,
  DEFAULT_DESCRIPTION,
];

const renderControl: (
  language: string,
  noun: string,
  label: string,
) => Promise<void> = async (
  language: string,
  noun: string,
  label: string,
): Promise<void> => {
  // Inside act: the control lists the project's saved views as it mounts.
  await act(async (): Promise<void> => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <TelemetrySavedViewsControl<MetricSavedView>
            modelType={MetricSavedView}
            savedViewNoun={noun}
            explorerLabel={label}
            hasInitialUrlState={false}
            captureCurrentState={(): TelemetrySavedViewState => {
              return { search: "checkout" };
            }}
            applyState={(): void => {
              // Not asserted on.
            }}
          />
        </MemoryRouter>,
      ),
    );
  });
};

const open: (button: string) => Promise<void> = async (
  button: string,
): Promise<void> => {
  const element: HTMLElement = await screen.findByRole("button", {
    name: button,
  });

  await act(async (): Promise<void> => {
    fireEvent.click(element);
  });
};

const savedView: () => MetricSavedView = (): MetricSavedView => {
  const view: MetricSavedView = new MetricSavedView();
  view.id = new ObjectID(VIEW_ID_STRING);
  view.name = "Errors in checkout";
  return view;
};

const nounOf: (noun: string) => ReturnType<typeof translatableTerm> = (
  noun: string,
): ReturnType<typeof translatableTerm> => {
  return translatableTerm(noun);
};

const explorerOf: (label: string) => ReturnType<typeof translatableTerm> = (
  label: string,
): ReturnType<typeof translatableTerm> => {
  return translatableTerm(label, { inSentence: true });
};

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  getListMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID_STRING));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words a saved view's sentences are made of", () => {
  test("each sentence is a key of the Dashboard's English", () => {
    for (const key of SENTENCES) {
      expect(ENGLISH[key]).toBe(key);
    }
  });

  test.each(EXPLORERS)(
    "%s's noun and label are keys of the Dashboard's English",
    (_name: string, noun: string, label: string) => {
      expect(ENGLISH[noun]).toBe(noun);
      expect(ENGLISH[label]).toBe(label);
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s has wording for every sentence and word",
    (language: string) => {
      const keys: Array<string> = [
        ...SENTENCES,
        ...EXPLORERS.flatMap((explorer: [string, string, string]) => {
          return [explorer[1], explorer[2]];
        }),
      ];

      expect(
        keys.filter((key: string): boolean => {
          return !hasOwnWording(language, key);
        }),
      ).toEqual([]);
    },
  );

  test.each(CALL_SITES)(
    "%s hands the control words the locales hold",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SOURCE, file),
        "utf8",
      );
      const noun: string | undefined = source.match(
        /savedViewNoun="([^"]+)"/,
      )?.[1];
      const label: string | undefined =
        source.match(/explorerLabel="([^"]+)"/)?.[1] ||
        source.match(/explorerLabel=\{translationKey\("([^"]+)"\)\}/)?.[1];

      expect(noun).toBeDefined();
      expect(label).toBeDefined();
      expect(ENGLISH[noun as string]).toBe(noun);
      expect(ENGLISH[label as string]).toBe(label);
    },
  );
});

describe.each(LANGUAGES)("saving a view in %s", (language: string) => {
  beforeEach(async () => {
    await setGlobalLanguage(language);
  });

  afterEach(async () => {
    await setGlobalLanguage("en");
  });

  test.each(EXPLORERS)(
    "%s's Save dialog says what is saved, in whole sentences",
    async (_name: string, noun: string, label: string) => {
      await renderControl(language, noun, label);
      await open("open-save");

      const texts: Array<string> = drawnTexts();

      expect(texts).toContain(
        sentence(language, SAVE_TITLE, { noun: nounOf(noun) }),
      );
      expect(texts).toContain(
        sentence(language, SAVE_DESCRIPTION, { explorer: explorerOf(label) }),
      );
      expect(texts).toContain(
        sentence(language, NAME_DESCRIPTION, { explorer: explorerOf(label) }),
      );
      expect(texts).toContain(
        sentence(language, DEFAULT_DESCRIPTION, {
          explorer: explorerOf(label),
        }),
      );
    },
  );

  test("the Edit dialog says what is edited", async () => {
    getListMock.mockImplementation(async () => {
      return { data: [savedView()], count: 1, skip: 0, limit: 0 };
    });

    await renderControl(language, "Trace", "traces");
    await open("open-edit");

    expect(drawnTexts()).toContain(
      sentence(language, EDIT_TITLE, { noun: nounOf("Trace") }),
    );
  });

  test("a saved view's own name stays as written", async () => {
    getListMock.mockImplementation(async () => {
      return { data: [savedView()], count: 1, skip: 0, limit: 0 };
    });

    await renderControl(language, "Trace", "traces");
    await open("open-delete");

    expect(document.body.textContent).toContain("Errors in checkout");
  });
});

describe("in a language that marks every key, every word a dialog draws is marked", () => {
  // The stand-in menu's own buttons, and a person's own view.
  const isData: (text: string) => boolean = (text: string): boolean => {
    return text.startsWith("open-") || text === "Errors in checkout";
  };

  beforeEach(async () => {
    await setGlobalLanguage(PSEUDO_LANGUAGE);

    getListMock.mockImplementation(async () => {
      return { data: [savedView()], count: 1, skip: 0, limit: 0 };
    });
  });

  afterEach(async () => {
    await setGlobalLanguage("en");
  });

  test.each([
    ["Save", "open-save"],
    ["Edit", "open-edit"],
    ["Delete", "open-delete"],
  ])("the %s dialog", async (_name: string, button: string) => {
    await renderControl(PSEUDO_LANGUAGE, "Trace", "traces");
    await open(button);

    expect(textsThatSkippedTranslation(isData)).toEqual([]);
  });
});

describe("REGRESSION: the dialogs were glued together in English", () => {
  test("German reads its own title, not English with the noun filled in", async () => {
    await setGlobalLanguage("de");
    await renderControl("de", "Trace", "traces");
    await open("open-save");

    expect(drawnTexts()).not.toContain("Save Trace View");
    expect(document.body.textContent).toContain(word("de", "Trace"));

    await setGlobalLanguage("en");
  });

  test("English reads as it always did", async () => {
    await renderControl("en", "Trace", "traces");
    await open("open-save");

    const texts: Array<string> = drawnTexts();

    expect(texts).toContain("Save Trace View");
    expect(texts).toContain(
      "Save the current traces explorer state as a reusable view.",
    );
    expect(texts).toContain("Choose a name for this saved traces view.");
    expect(texts).toContain(
      "Automatically apply this view when opening traces.",
    );
  });
});

describe("the form's own words", () => {
  test.each(LANGUAGES)(
    "the name field's example reads in %s",
    async (language: string) => {
      await setGlobalLanguage(language);
      await renderControl(language, "Trace", "traces");
      await open("open-save");

      expect(
        await screen.findByPlaceholderText(
          word(language, "Errors in checkout"),
        ),
      ).toBeInTheDocument();

      await setGlobalLanguage("en");
    },
  );
});
