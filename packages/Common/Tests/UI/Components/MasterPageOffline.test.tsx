import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import MasterPage from "../../../UI/Components/MasterPage/MasterPage";
import {
  OFFLINE_SCREEN_MESSAGE,
  OFFLINE_SCREEN_TEST_ID,
  OFFLINE_SCREEN_TITLE,
  OFFLINE_SCREEN_TRY_AGAIN,
} from "../../../UI/Components/Offline/OfflineScreen";
import NewVersion, {
  NewVersionAudience,
} from "../../../UI/Utils/NewVersion/NewVersion";
import { FetchFunction } from "../../../UI/Utils/NewVersion/ServerBuildCheck";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * "The Dashboard's MasterPage replaces the whole page with an English-only
 * 'You are offline' empty state, so the new offline card #5254 built shows
 * only in Accounts and on public dashboards: give the Dashboard the same
 * card, in every locale." - the maintainer.
 *
 * The MasterPage of the Dashboard, the Admin Dashboard and status pages now
 * shows "You're offline" in the page's place - the card a page shows when
 * its code cannot download offline - in the reader's language, with the
 * header and the product bar still there. The page itself is only put away:
 * what was typed in it, and the page's own state, are there again the
 * moment the browser is back online. It used to be thrown away and drawn
 * anew, which lost everything typed on it to a moment's dropped Wi-Fi.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

const goOffline: () => void = (): void => {
  setOnline(false);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
};

const goOnline: () => void = (): void => {
  setOnline(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
};

const Page: () => ReactElement = (): ReactElement => {
  const [count, setCount] = React.useState<number>(0);

  return (
    <div>
      <h2>Monitors</h2>
      <label>
        Incident note
        <textarea data-testid="note" />
      </label>
      <button
        type="button"
        onClick={() => {
          setCount(count + 1);
        }}
      >
        Clicked {count} times
      </button>
    </div>
  );
};

const drawMasterPage: (props?: {
  isLoading?: boolean;
  error?: string;
}) => ReactElement = (props?: {
  isLoading?: boolean;
  error?: string;
}): ReactElement => {
  return (
    <MasterPage
      header={<div data-testid="header">Header</div>}
      navBar={<nav data-testid="product-bar">Home / Monitors</nav>}
      footer={<footer data-testid="footer">Footer</footer>}
      isLoading={Boolean(props?.isLoading)}
      error={props?.error || ""}
    >
      <Page />
    </MasterPage>
  );
};

const content: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("master-page-content");
};

beforeEach(() => {
  setOnline(true);
  NewVersion.reset();
  UnsavedChanges.reset();
  UnsavedChanges.install();
});

afterEach(() => {
  cleanup();
  setOnline(true);
  NewVersion.reset();
  UnsavedChanges.reset();
});

describe("MasterPage while the browser is offline", () => {
  test("online: the page, and no offline card", () => {
    render(drawMasterPage());

    expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();
    expect(content()).toBeVisible();
    expect(screen.getByText("Monitors")).toBeVisible();
  });

  test("going offline shows the card in the page's place, under the header and the product bar", () => {
    render(drawMasterPage());

    goOffline();

    const card: HTMLElement = screen.getByTestId(OFFLINE_SCREEN_TEST_ID);

    expect(card).toBeVisible();
    expect(
      screen.getByTestId(`${OFFLINE_SCREEN_TEST_ID}-title`),
    ).toHaveTextContent(OFFLINE_SCREEN_TITLE);
    expect(card).toHaveTextContent(OFFLINE_SCREEN_MESSAGE);
    expect(
      screen.getByTestId(`${OFFLINE_SCREEN_TEST_ID}-try-again`),
    ).toHaveTextContent(OFFLINE_SCREEN_TRY_AGAIN);

    expect(screen.getByTestId("header")).toBeVisible();
    expect(screen.getByTestId("product-bar")).toBeVisible();

    // The page and its footer are put away, not drawn under the card.
    expect(content()).not.toBeVisible();
    expect(screen.getByTestId("footer")).not.toBeVisible();

    // Nothing English-only and nothing of the old empty state is left.
    expect(screen.queryByText("You are offline")).toBeNull();
    expect(
      screen.queryByText("Please check your internet connection."),
    ).toBeNull();
  });

  test("the card comes before the page, so it is what the reader meets first", () => {
    render(drawMasterPage());

    goOffline();

    const card: HTMLElement = screen.getByTestId(OFFLINE_SCREEN_TEST_ID);

    expect(
      card.compareDocumentPosition(content()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the page is kept as it was: what was typed and its own state are there when the browser is back", async () => {
    render(drawMasterPage());

    const note: HTMLTextAreaElement = screen.getByTestId(
      "note",
    ) as HTMLTextAreaElement;

    fireEvent.input(note, { target: { value: "Rolled back the deploy" } });
    fireEvent.click(screen.getByRole("button", { name: "Clicked 0 times" }));

    goOffline();
    goOnline();

    await waitFor(() => {
      expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();
    });

    // The very same field, still holding what was typed.
    expect(screen.getByTestId("note")).toBe(note);
    expect(note.value).toBe("Rolled back the deploy");
    expect(
      screen.getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
    expect(content()).toBeVisible();
  });

  test("what was typed on the page still counts as unsaved while it is put away", () => {
    render(drawMasterPage());

    fireEvent.input(screen.getByTestId("note"), {
      target: { value: "Half a sentence" },
    });

    goOffline();

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("the skip link goes while the page it skips to is put away", () => {
    render(drawMasterPage());

    expect(screen.getByText("Skip to main content")).toBeInTheDocument();

    goOffline();

    expect(screen.queryByText("Skip to main content")).toBeNull();
  });

  test("a page drawn while the browser is already offline shows the card at once", () => {
    setOnline(false);

    render(drawMasterPage());

    expect(screen.getByTestId(OFFLINE_SCREEN_TEST_ID)).toBeVisible();
  });

  test.each<[string, { isLoading?: boolean; error?: string }]>([
    ["a page still loading", { isLoading: true }],
    ["a page that could not load", { error: "Something failed" }],
  ])(
    "%s says it is offline too",
    (_label: string, props: { isLoading?: boolean; error?: string }) => {
      render(drawMasterPage(props));

      goOffline();

      expect(screen.getByTestId(OFFLINE_SCREEN_TEST_ID)).toBeVisible();

      goOnline();

      expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();
    },
  );

  test("while it shows, the new version notice waits: a reload now would only reach the browser's own offline page", () => {
    render(drawMasterPage());

    expect(NewVersion.isNoticeHeld()).toBe(false);

    goOffline();
    expect(NewVersion.isNoticeHeld()).toBe(true);

    goOnline();
    expect(NewVersion.isNoticeHeld()).toBe(false);
  });

  describe("Try again", () => {
    let serverAnswers: boolean = false;
    let requests: number = 0;

    const fetchFunction: FetchFunction = (): Promise<Response> => {
      requests++;

      if (!serverAnswers) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }

      return Promise.resolve({
        status: 200,
        ok: true,
        text: (): Promise<string> => {
          return Promise.resolve(JSON.stringify({ buildId: "running" }));
        },
      } as unknown as Response);
    };

    beforeEach(() => {
      serverAnswers = false;
      requests = 0;
      NewVersion.start({
        audience: NewVersionAudience.Members,
        runningBuild: {
          buildId: "running",
          manifestUrl: "/dashboard/dist/build.json",
        },
        fetchFunction: fetchFunction,
        firstCheckDelayInMs: 24 * 60 * 60 * 1000,
      });
    });

    test("with no answer: it spins while it asks, then still says offline", async () => {
      render(drawMasterPage());
      goOffline();

      const button: HTMLElement = screen.getByTestId(
        `${OFFLINE_SCREEN_TEST_ID}-try-again`,
      );

      fireEvent.click(button);

      expect(button).toHaveAttribute("aria-busy", "true");

      await waitFor(
        () => {
          expect(button).not.toHaveAttribute("aria-busy");
        },
        { timeout: 3000 },
      );

      expect(requests).toBe(1);
      expect(screen.getByTestId(OFFLINE_SCREEN_TEST_ID)).toBeVisible();
    });

    test("the browser says offline but the server answers: the page comes back", async () => {
      render(drawMasterPage());
      goOffline();
      serverAnswers = true;

      fireEvent.click(
        screen.getByTestId(`${OFFLINE_SCREEN_TEST_ID}-try-again`),
      );

      await waitFor(
        () => {
          expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();
        },
        { timeout: 3000 },
      );

      expect(content()).toBeVisible();
    });

    test("a second press while it asks is not a second request", async () => {
      render(drawMasterPage());
      goOffline();

      const button: HTMLElement = screen.getByTestId(
        `${OFFLINE_SCREEN_TEST_ID}-try-again`,
      );

      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(
        () => {
          expect(button).not.toHaveAttribute("aria-busy");
        },
        { timeout: 3000 },
      );

      expect(requests).toBe(1);
    });
  });
});

/*
 * "This page will come back as soon as you're online again, just as you
 * left it." A page put away is not laid out, so the browser scrolls the
 * window to the top under the card and takes focus from the field being
 * typed in; both come back with the page (UseOfflinePlace). jsdom does
 * neither by itself, so the tests do what the browser does.
 */
describe("the reader's place, when the page comes back", () => {
  let scrollYForTest: number = 0;
  let scrolledTo: Array<[number, number]> = [];
  const originalScrollTo: typeof window.scrollTo = window.scrollTo;

  // What the browser does while the page is put away.
  const browserPutsThePageAway: () => void = (): void => {
    scrollYForTest = 0;
    (document.activeElement as HTMLElement | null)?.blur();
  };

  beforeEach(() => {
    scrollYForTest = 0;
    scrolledTo = [];
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: (): number => {
        return scrollYForTest;
      },
    });
    window.scrollTo = ((x: number, y: number): void => {
      scrolledTo.push([x, y]);
      scrollYForTest = y;
    }) as unknown as typeof window.scrollTo;
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
  });

  test("where it was scrolled, and the field being typed in with its caret, come back", () => {
    render(drawMasterPage());

    const note: HTMLTextAreaElement = screen.getByTestId(
      "note",
    ) as HTMLTextAreaElement;

    fireEvent.input(note, { target: { value: "Rolled back the deploy" } });
    note.focus();
    note.setSelectionRange(6, 6);
    scrollYForTest = 1200;

    goOffline();
    browserPutsThePageAway();

    expect(screen.getByTestId(OFFLINE_SCREEN_TEST_ID)).toBeVisible();

    goOnline();

    expect(scrolledTo).toEqual([[0, 1200]]);
    expect(document.activeElement).toBe(note);
    expect(note.selectionStart).toBe(6);
    expect(note.value).toBe("Rolled back the deploy");
  });

  test("Try again finding the server while the browser says offline brings the place back too", async () => {
    NewVersion.start({
      audience: NewVersionAudience.Members,
      runningBuild: {
        buildId: "running",
        manifestUrl: "/dashboard/dist/build.json",
      },
      fetchFunction: (): Promise<Response> => {
        return Promise.resolve({
          status: 200,
          ok: true,
          text: (): Promise<string> => {
            return Promise.resolve(JSON.stringify({ buildId: "running" }));
          },
        } as unknown as Response);
      },
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });

    render(drawMasterPage());

    const note: HTMLElement = screen.getByTestId("note");

    note.focus();
    scrollYForTest = 800;

    goOffline();
    browserPutsThePageAway();

    const tryAgain: HTMLElement = screen.getByTestId(
      `${OFFLINE_SCREEN_TEST_ID}-try-again`,
    );

    tryAgain.focus();
    fireEvent.click(tryAgain);

    await waitFor(
      () => {
        expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();
      },
      { timeout: 3000 },
    );

    expect(scrolledTo).toEqual([[0, 800]]);
    expect(document.activeElement).toBe(note);
  });

  test("a page opened while offline starts at its own place, at the top", () => {
    render(drawMasterPage());

    screen.getByTestId("note").focus();
    scrollYForTest = 1200;

    const address: string = window.location.href;

    goOffline();
    browserPutsThePageAway();
    window.history.pushState({}, "", "/dashboard/incidents");

    try {
      goOnline();

      expect(scrolledTo).toEqual([]);
      expect(document.activeElement).toBe(document.body);
    } finally {
      window.history.replaceState({}, "", address);
    }
  });
});

/*
 * In the reader's language: the Dashboard's, the Admin Dashboard's and the
 * Status Page's own locale files (each frontend reads only its own).
 */
describe("the offline card in the reader's language", () => {
  const FRONTENDS: Array<string> = [
    "Dashboard",
    "AdminDashboard",
    "StatusPage",
  ];

  const instances: Record<string, i18n> = {};

  const readLocale: (
    frontend: string,
    language: string,
  ) => Record<string, string> = (
    frontend: string,
    language: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(
        path.join(FEATURE_SETS, frontend, "src", "Locales", `${language}.json`),
        "utf8",
      ),
    ) as Record<string, string>;
  };

  beforeAll(async () => {
    for (const frontend of FRONTENDS) {
      for (const language of ["de", "fa", "ja"]) {
        const instance: i18n = createInstance();

        await instance.init({
          lng: language,
          resources: {
            [language]: { translation: readLocale(frontend, language) },
          },
          interpolation: { escapeValue: false },
          keySeparator: false,
          nsSeparator: false,
        });

        instances[`${frontend}:${language}`] = instance;
      }
    }
  });

  test.each(
    FRONTENDS.flatMap((frontend: string): Array<[string, string]> => {
      return [
        [frontend, "de"],
        [frontend, "fa"],
        [frontend, "ja"],
      ];
    }),
  )("the %s's, in %s", (frontend: string, language: string) => {
    const locale: Record<string, string> = readLocale(frontend, language);

    render(
      <I18nextProvider i18n={instances[`${frontend}:${language}`]!}>
        {drawMasterPage()}
      </I18nextProvider>,
    );

    goOffline();

    const card: HTMLElement = screen.getByTestId(OFFLINE_SCREEN_TEST_ID);

    expect(
      screen.getByTestId(`${OFFLINE_SCREEN_TEST_ID}-title`),
    ).toHaveTextContent(locale[OFFLINE_SCREEN_TITLE]!);
    expect(card).toHaveTextContent(locale[OFFLINE_SCREEN_MESSAGE]!);
    expect(
      screen.getByTestId(`${OFFLINE_SCREEN_TEST_ID}-try-again`),
    ).toHaveTextContent(locale[OFFLINE_SCREEN_TRY_AGAIN]!);

    // The card says which language it speaks, and reads its way.
    expect(card).toHaveAttribute("lang", language);
    expect(card).toHaveAttribute("dir", language === "fa" ? "rtl" : "ltr");
  });

  test("a language with no words for it falls back to English, and says so", () => {
    const instance: i18n = createInstance();

    void instance.init({
      lng: "fa",
      resources: { fa: { translation: {} } },
      keySeparator: false,
      nsSeparator: false,
    });

    render(
      <I18nextProvider i18n={instance}>{drawMasterPage()}</I18nextProvider>,
    );

    goOffline();

    const card: HTMLElement = screen.getByTestId(OFFLINE_SCREEN_TEST_ID);

    expect(card).toHaveTextContent(OFFLINE_SCREEN_TITLE);
    expect(card).toHaveAttribute("lang", "en");
    expect(card).toHaveAttribute("dir", "ltr");
  });
});
