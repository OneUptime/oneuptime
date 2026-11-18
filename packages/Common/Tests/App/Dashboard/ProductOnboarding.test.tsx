import "@testing-library/jest-dom";
import fs from "fs";
import path from "path";
import {
  afterEach,
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
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.setTimeout(120000);

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

/*
 * Whose permissions the page reads: a project owner, who may set up and
 * create everything here, unless a test makes them a project Viewer, who
 * reads everything and creates nothing.
 */
let mockPermissions: Array<unknown> = ["ProjectOwner"];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ProjectMilestone from "../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import { PRODUCT_USAGE_MILESTONES } from "../../../Types/Product/ProductUsage";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Page, {
  PAGE_TITLE_ROW_CLASS_NAME,
  PAGE_TITLE_ROW_TEST_ID,
} from "../../../UI/Components/Page/Page";
import { EMPTY_TABLE_CREATE_BUTTON_TEST_ID } from "../../../UI/Components/ModelTable/ModelTableEmptyState";
import type EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ResourceShowcaseCard, {
  RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
  RESOURCE_SHOWCASE_BADGE_TEST_ID,
  RESOURCE_SHOWCASE_EYEBROW_TEST_ID,
  RESOURCE_SHOWCASE_DESCRIPTION_TEST_ID,
  RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID,
  RESOURCE_SHOWCASE_FEATURES_TITLE,
  RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID,
  RESOURCE_SHOWCASE_GUIDE_TEXT,
  RESOURCE_SHOWCASE_HIGHLIGHTS_TEST_ID,
  RESOURCE_SHOWCASE_PREVIEW_TEST_ID,
  RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
  RESOURCE_SHOWCASE_STAT_VALUE_TEST_ID,
  RESOURCE_SHOWCASE_STEPS_TEST_ID,
  RESOURCE_SHOWCASE_TEST_ID,
  SHOWCASE_BARE_CLASS_NAME,
  ShowcaseAddButton,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";
import { ResourceShowcase } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import {
  OnboardedProductKey,
  PRODUCT_EXAMPLE_DESCRIPTION,
  ProductKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboarding";
import { PRODUCT_ONBOARDINGS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboardings";
import ProductAboutButton, {
  PRODUCT_ABOUT_BUTTON_TEST_ID,
  PRODUCT_ABOUT_DIALOG_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductAboutButton";
import ProductShowcase, {
  PRODUCT_SHOWCASE_TEST_ID,
  getProductStartButton,
  getUnlockedButton,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductShowcase";
import useCreatePageFirstRun, {
  CreatePageFirstRun,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/UseCreatePageFirstRun";
import useProductFirstRun, {
  getProductFirstRunEmptyState,
  ProductFirstRun,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/UseProductFirstRun";
import TelemetryFirstRunShowcase, {
  TELEMETRY_FIRST_RUNS,
  TELEMETRY_SETUP_DIALOG_TEST_ID,
  TelemetryProductKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/TelemetryFirstRunShowcase";
import TelemetryFirstStepsEmptyState from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstStepsEmptyState";
import { TelemetryFirstStepsSignal } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstSteps";
import { useReportTelemetryDataShown } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstRunHost";
import HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostShowcase";
import StatusPagesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";

/*
 * A product's explanation (Components/ProductOnboarding), drawn: on the
 * first page of a product with nothing in it yet, and behind About beside
 * every product page's title. Mounted with the app's own components and
 * read the way a person reads them:
 *
 *   - the showcase says what the product does, numbers its first steps,
 *     offers the first as a button, shows an example, and links the docs;
 *   - About opens the same explanation in a dialog, without a button;
 *   - a list shows it under its empty table until the first record, and
 *     only then - a busy project, or a count that fails, sees its list;
 *   - someone who may not take the first step reads it without the button;
 *   - a telemetry product shows it until the project's first data of its
 *     own signal arrives - its first-data mark (#6534, #6897) - and its
 *     button is the setup guide, which waits for that data and says so -
 *     for data that names no service, the guide key's first data, or the
 *     project's first data of the signal, whichever key sent it (#7888).
 *     Data that arrives while the page is open reads the explorer again,
 *     with no reload (#7755).
 */

const MONITORS_SHOWCASE: ResourceShowcase =
  PRODUCT_ONBOARDINGS[ProductKey.Monitors].showcase;
const LOGS_SHOWCASE: ResourceShowcase =
  PRODUCT_ONBOARDINGS[ProductKey.Logs].showcase;

let counts: Map<{ new (): BaseModel }, number | Error>;
let newServices: Array<Service>;
/*
 * The project's first-data marks (ProjectMilestone rows): the activation
 * milestones a telemetry page reads, kept by the server once ClickHouse
 * took the project's first data of each kind. An Error fails every read.
 */
let firstData: Set<string> | Error;
// The project's ingestion keys: the setup guide's picker and its last step read them.
let keys: Array<TelemetryIngestionKey>;
let navigateSpy: ReturnType<typeof jest.spyOn>;

function setCount(
  modelType: { new (): BaseModel },
  count: number | Error,
): void {
  counts.set(modelType, count);
}

// The project's first data of these kinds has arrived.
function receiveFirstData(...milestones: Array<ActivationMilestone>): void {
  if (firstData instanceof Error) {
    firstData = new Set<string>();
  }

  for (const milestone of milestones) {
    firstData.add(milestone);
  }
}

// What the page asked of the project's first data: each count's query.
function firstDataCounts(): Array<Record<string, unknown>> {
  return (
    ModelAPI.count as unknown as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls
    .filter((call: Array<unknown>): boolean => {
      return (call[0] as { modelType: unknown }).modelType === ProjectMilestone;
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { query: Record<string, unknown> }).query;
    });
}

beforeEach(() => {
  mockPermissions = [Permission.ProjectOwner];
  counts = new Map();
  newServices = [];
  firstData = new Set<string>();
  keys = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/home`);

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query?: Record<string, unknown>;
      }): Promise<number> => {
        if (options.modelType === ProjectMilestone) {
          if (firstData instanceof Error) {
            throw firstData;
          }

          return firstData.has(String(options.query?.["milestone"])) ? 1 : 0;
        }

        const count: number | Error | undefined = counts.get(options.modelType);
        if (count instanceof Error) {
          throw count;
        }
        return count || 0;
      },
    );
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query?: Record<string, unknown>;
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        if (options.modelType === ProjectMilestone) {
          if (firstData instanceof Error) {
            throw firstData;
          }

          // The marks of the kinds asked for that the project has.
          const asked: unknown = options.query?.["milestone"];
          const wanted: Array<string> =
            asked instanceof Includes
              ? asked.values.map((value: unknown): string => {
                  return String(value);
                })
              : [String(asked)];
          const reached: Set<string> = firstData;
          const marks: Array<BaseModel> = wanted
            .filter((milestone: string): boolean => {
              return reached.has(milestone);
            })
            .map((milestone: string): BaseModel => {
              const mark: ProjectMilestone = new ProjectMilestone();
              mark._id = ObjectID.generate().toString();
              mark.milestone = milestone as ActivationMilestone;
              return mark;
            });

          return {
            data: marks,
            count: marks.length,
            skip: 0,
            limit: options.limit || 10,
          } as ListResult<BaseModel>;
        }

        const data: Array<BaseModel> =
          options.modelType === Service
            ? newServices
            : options.modelType === TelemetryIngestionKey
              ? keys
              : [];
        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      return undefined;
    });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderInRouter(element: ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
  await settle();
}

// A project Viewer: reads every product, may create nothing in one.
function asViewer(): void {
  mockPermissions = [Permission.Viewer];
  PermissionGate.clearPermissionPropsCache();
}

describe("the showcase, as a product draws it", () => {
  const startButton: ShowcaseAddButton = {
    title: "Create Monitor",
    onClick: jest.fn() as unknown as () => void,
  };

  test("numbers the product's first steps, in order, under the pitch", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={MONITORS_SHOWCASE}
        addButton={startButton}
        docsRoute={new Route("/docs/monitor/create-monitor")}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Know something is down before your users do",
      }),
    ).toBeInTheDocument();

    const steps: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_STEPS_TEST_ID,
    );
    expect(steps.tagName).toBe("OL");
    const items: Array<HTMLElement> = within(steps).getAllByRole("listitem");
    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "1Create a monitor",
      "2Choose what it checks and how often",
      "3Get an incident or an alert when a check fails",
    ]);
    // A product's steps take the place of a resource's facts about setup.
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_HIGHLIGHTS_TEST_ID),
    ).toBeNull();
  });

  test("offers the first step as its one primary button, and the documentation beside it", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={MONITORS_SHOWCASE}
        addButton={startButton}
        docsRoute={new Route("/docs/monitor/create-monitor")}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );
    expect(button).toHaveTextContent("Create Monitor");
    fireEvent.click(button);
    expect(startButton.onClick).toHaveBeenCalledTimes(1);

    const docs: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID,
    );
    expect(docs).toHaveTextContent("Documentation");
    expect(docs).toHaveAttribute("href", "/docs/monitor/create-monitor");
    // The docs open beside the dashboard, not in its place.
    expect(docs).toHaveAttribute("target", "_blank");
    // A product with no guide (#6821) draws no link to one.
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID),
    ).toBeNull();
  });

  test("links the job's step-by-step guide before the documentation, when the product has one", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={MONITORS_SHOWCASE}
        addButton={startButton}
        docsRoute={new Route("/docs/on-call/index")}
        guideRoute={new Route("/docs/guides/paging")}
      />,
    );

    const guide: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID,
    );
    const docs: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID,
    );

    expect(RESOURCE_SHOWCASE_GUIDE_TEXT).toBe("Step-by-step guide");
    expect(guide).toHaveTextContent(RESOURCE_SHOWCASE_GUIDE_TEXT);
    expect(guide).toHaveAttribute("href", "/docs/guides/paging");
    expect(guide).toHaveAttribute("target", "_blank");
    // The guide first: someone new starts there; the reference follows.
    expect(
      guide.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // On the button's row, beside the documentation.
    expect(guide.parentElement).toContainElement(docs);
  });

  test("a guide alone still draws the row of links", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={MONITORS_SHOWCASE}
        guideRoute={new Route("/docs/guides/status-page")}
      />,
    );

    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID),
    ).toHaveAttribute("href", "/docs/guides/status-page");
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
    ).toBeNull();
  });

  test("its example is labelled as one, with the product's own state and sentence", async () => {
    await renderInRouter(<ResourceShowcaseCard showcase={MONITORS_SHOWCASE} />);

    const preview: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_PREVIEW_TEST_ID,
    );
    expect(preview).toHaveAttribute("role", "img");
    expect(preview).toHaveAttribute("aria-label", PRODUCT_EXAMPLE_DESCRIPTION);
    // A monitor is Operational, not Connected.
    expect(within(preview).getAllByText("Operational").length).toBeGreaterThan(
      0,
    );
    expect(within(preview).queryByText("Connected")).toBeNull();
    expect(within(preview).getByText("shop.example.com")).toBeInTheDocument();
  });

  /*
   * An example's numbers are figures, written the reader's way (#6535): the
   * English this suite reads is the English they always read. German,
   * Persian and Arabic are ShowcaseFiguresInLocale.test.tsx's, from the
   * shipped locale files.
   */
  test("its example's numbers read as English writes them", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={PRODUCT_ONBOARDINGS[ProductKey.StatusPages].showcase}
      />,
    );

    expect(
      screen
        .getAllByTestId(RESOURCE_SHOWCASE_STAT_VALUE_TEST_ID)
        .map((value: HTMLElement): string => {
          return value.textContent || "";
        }),
    ).toEqual(["99.95%", "6", "1,284", "1"]);
  });

  test("a product with no feature grid draws no What you get heading", async () => {
    await renderInRouter(<ResourceShowcaseCard showcase={MONITORS_SHOWCASE} />);

    expect(screen.queryByText(RESOURCE_SHOWCASE_FEATURES_TITLE)).toBeNull();
    expect(screen.queryByTestId("resource-showcase-feature")).toBeNull();
  });

  test("leaves its steps to a page that walks through its own", async () => {
    await renderInRouter(
      <ResourceShowcaseCard showcase={MONITORS_SHOWCASE} hidesSteps={true} />,
    );

    expect(screen.queryByTestId(RESOURCE_SHOWCASE_STEPS_TEST_ID)).toBeNull();
    // The pitch and the example stay.
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_PREVIEW_TEST_ID),
    ).toBeInTheDocument();
  });

  test("says what the product is for under its title", async () => {
    await renderInRouter(<ResourceShowcaseCard showcase={MONITORS_SHOWCASE} />);

    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_DESCRIPTION_TEST_ID),
    ).toHaveTextContent(MONITORS_SHOWCASE.description);
  });

  test("leaves that to a page that already says it, and keeps the rest", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={MONITORS_SHOWCASE}
        hidesDescription={true}
      />,
    );

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_DESCRIPTION_TEST_ID),
    ).toBeNull();
    expect(screen.queryByText(MONITORS_SHOWCASE.description)).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: MONITORS_SHOWCASE.title,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_STEPS_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_PREVIEW_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a button that opens something other than a form says so with its icon", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={LOGS_SHOWCASE}
        addButton={{
          title: "Send your first logs",
          onClick: () => {
            return undefined;
          },
          icon: undefined,
        }}
      />,
    );

    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveTextContent("Send your first logs");
  });

  test("a resource's showcase is drawn as before: its highlights, no steps, Connected", async () => {
    await renderInRouter(<ResourceShowcaseCard showcase={HOST_SHOWCASE} />);

    expect(screen.queryByTestId(RESOURCE_SHOWCASE_STEPS_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
    ).toBeNull();
    const highlights: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_HIGHLIGHTS_TEST_ID,
    );
    expect(
      within(highlights)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(HOST_SHOWCASE.highlights);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.getByText(RESOURCE_SHOWCASE_FEATURES_TITLE),
    ).toBeInTheDocument();
  });

  test("in a dialog it is drawn without a frame of its own", async () => {
    await renderInRouter(
      <ResourceShowcaseCard showcase={MONITORS_SHOWCASE} isBare={true} />,
    );

    expect(screen.getByTestId(RESOURCE_SHOWCASE_TEST_ID).className).toBe(
      SHOWCASE_BARE_CLASS_NAME,
    );
    // The dialog's title names the product: no second name over the pitch.
    expect(screen.queryByTestId(RESOURCE_SHOWCASE_EYEBROW_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Know something is down before your users do",
      }),
    ).toBeInTheDocument();
  });

  test("on a page it names its product over the pitch", async () => {
    await renderInRouter(<ResourceShowcaseCard showcase={MONITORS_SHOWCASE} />);

    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_EYEBROW_TEST_ID),
    ).toHaveTextContent("Monitors");
  });

  test("the example's header pill takes its state's colour: an acknowledged alert is amber, as in its row", async () => {
    await renderInRouter(
      <ResourceShowcaseCard
        showcase={PRODUCT_ONBOARDINGS[ProductKey.Alerts].showcase}
      />,
    );

    const badge: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_BADGE_TEST_ID,
    );
    expect(badge).toHaveTextContent("Acknowledged");
    expect(badge.className).toContain("bg-amber-50");
    expect(badge.className).not.toContain("emerald");
    cleanup();

    // A healthy one is green, as before.
    await renderInRouter(<ResourceShowcaseCard showcase={MONITORS_SHOWCASE} />);
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_BADGE_TEST_ID),
    ).toHaveTextContent("Operational");
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_BADGE_TEST_ID).className,
    ).toContain("bg-emerald-50");
  });
});

describe("About, beside a product page's title", () => {
  test("Page draws what it is given on the title's own line", async () => {
    await renderInRouter(
      <Page
        title="Monitors"
        titleRight={<ProductAboutButton product={ProductKey.Monitors} />}
      >
        <div />
      </Page>,
    );

    const row: HTMLElement = screen.getByTestId(PAGE_TITLE_ROW_TEST_ID);
    expect(row.className).toBe(PAGE_TITLE_ROW_CLASS_NAME);
    expect(
      within(row).getByRole("heading", { level: 1, name: "Monitors" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByTestId(PRODUCT_ABOUT_BUTTON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("How it works is a subtle ? icon, and there is no Pin beside the title (#8138)", async () => {
    await renderInRouter(
      <Page
        title="Monitors"
        titleRight={<ProductAboutButton product={ProductKey.Monitors} />}
      >
        <div />
      </Page>,
    );

    const row: HTMLElement = screen.getByTestId(PAGE_TITLE_ROW_TEST_ID);
    const about: HTMLElement = within(row).getByTestId(
      PRODUCT_ABOUT_BUTTON_TEST_ID,
    );
    expect(about).toHaveTextContent("");
    expect(about).toHaveAttribute("aria-label", "How it works");
    expect(about).toHaveAttribute("title", "How it works");
    expect(within(row).queryByText("How it works")).toBeNull();
    expect(within(row).queryByText("Pin")).toBeNull();
    expect(within(row).getAllByRole("button")).toHaveLength(1);
  });

  test("a page with nothing beside its title is drawn as before", async () => {
    await renderInRouter(
      <Page title="Monitors">
        <div />
      </Page>,
    );

    expect(screen.queryByTestId(PAGE_TITLE_ROW_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Monitors" }),
    ).toBeInTheDocument();
  });

  test("opens the product's explanation in a dialog, and closes it", async () => {
    await renderInRouter(<ProductAboutButton product={ProductKey.Monitors} />);

    /*
     * "How it works", not "About": most of the Dashboard's languages read
     * that key as "Regarding" (German "Betrifft").
     */
    const about: HTMLElement = screen.getByRole("button", {
      name: "How it works",
    });
    expect(about).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID)).toBeNull();

    await act(async () => {
      fireEvent.click(about);
    });

    const dialog: HTMLElement = screen.getByTestId(
      PRODUCT_ABOUT_DIALOG_TEST_ID,
    );
    expect(
      within(dialog).getByText("Know something is down before your users do"),
    ).toBeInTheDocument();
    // With no list above it, the dialog says what the product is for.
    expect(
      within(dialog).getByTestId(RESOURCE_SHOWCASE_DESCRIPTION_TEST_ID),
    ).toHaveTextContent(MONITORS_SHOWCASE.description);
    expect(within(dialog).getByText("Create a monitor")).toBeInTheDocument();
    expect(
      within(dialog).getByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
    ).toHaveAttribute("href", "/docs/monitor/create-monitor");
    // An explanation, not a second way to create one.
    expect(
      within(dialog).queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
    // Titled with the product's name.
    expect(screen.getByTestId("modal-title")).toHaveTextContent("Monitors");
    expect(screen.getByRole("dialog")).toContainElement(dialog);

    await act(async () => {
      fireEvent.click(screen.getByTestId("close-button"));
    });
    expect(screen.queryByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID)).toBeNull();
  });

  test("a resource's About shows the showcase its empty list draws", async () => {
    await renderInRouter(<ProductAboutButton product={ProductKey.Hosts} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    const dialog: HTMLElement = screen.getByTestId(
      PRODUCT_ABOUT_DIALOG_TEST_ID,
    );
    expect(within(dialog).getByText(HOST_SHOWCASE.title)).toBeInTheDocument();
    expect(
      within(dialog).getByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
    ).toHaveAttribute("href", "/docs/telemetry/hosts");
  });

  /*
   * Monitors', On-Call's and Status Pages' jobs have a guide in the docs
   * (#6821): their About links it first, as their empty lists do.
   */
  const GUIDED_PRODUCTS: Array<[OnboardedProductKey, string, string]> = [
    [
      ProductKey.Monitors,
      "/docs/guides/website-down",
      "/docs/monitor/create-monitor",
    ],
    [ProductKey.OnCall, "/docs/guides/paging", "/docs/on-call/index"],
    [
      ProductKey.StatusPages,
      "/docs/guides/status-page",
      "/docs/status-pages/index",
    ],
  ];

  test.each(GUIDED_PRODUCTS)(
    "%s's About links its step-by-step guide, then its documentation",
    async (
      product: OnboardedProductKey,
      guidePath: string,
      docsPath: string,
    ) => {
      await renderInRouter(<ProductAboutButton product={product} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "How it works" }));
      });

      const dialog: HTMLElement = screen.getByTestId(
        PRODUCT_ABOUT_DIALOG_TEST_ID,
      );
      const guide: HTMLElement = within(dialog).getByTestId(
        RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID,
      );

      expect(guide).toHaveAttribute("href", guidePath);
      expect(guide).toHaveTextContent("Step-by-step guide");
      expect(
        within(dialog).getByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
      ).toHaveAttribute("href", docsPath);
    },
  );

  test("the empty Status Pages list's showcase links the guide too", async () => {
    await renderInRouter(<ProductShowcase product={ProductKey.StatusPages} />);

    expect(
      within(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).getByTestId(
        RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID,
      ),
    ).toHaveAttribute("href", "/docs/guides/status-page");
  });
});

/*
 * ISSUE #7148: On-Call's own pages never mentioned its guided setup, "Page
 * the right person when something breaks": the policies list offered only
 * Create On-Call Policy (and the importer), and a newcomer who came to be
 * paged made a policy by hand. The explanation - under the empty list, and
 * behind How it works - offers the setup first, as its one primary button,
 * with Create beside it, plain.
 */
describe("a product's guided setup (#7148)", () => {
  const createPolicy: ShowcaseAddButton = {
    title: "Create On-Call Policy",
    onClick: jest.fn() as unknown as () => void,
  };

  test("On-Call names its guided setup, for whoever may create a policy", () => {
    expect(PRODUCT_ONBOARDINGS[ProductKey.OnCall].guidedSetup).toEqual({
      page: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
      buttonTitle: "Guided setup",
      modelType: OnCallDutyPolicy,
    });
  });

  test("the empty list's explanation offers it first, as the one primary button, with Create beside it, plain", async () => {
    await renderInRouter(
      <ProductShowcase
        product={ProductKey.OnCall}
        startButton={createPolicy}
      />,
    );

    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    const setup: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
    );
    const create: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );

    expect(setup).toHaveTextContent("Guided setup");
    expect(create).toHaveTextContent("Create On-Call Policy");
    // One primary button: the setup's.
    expect(setup).toHaveClass("bg-indigo-600");
    expect(create).not.toHaveClass("bg-indigo-600");
    // The setup first, then Create.
    expect(
      setup.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(setup);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    // Saying where it was opened from (guided_setup/started's from, #7054).
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/setup?from=empty_list`,
    );
  });

  test("How it works offers it too, and closes as it opens it", async () => {
    await renderInRouter(<ProductAboutButton product={ProductKey.OnCall} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    const dialog: HTMLElement = screen.getByTestId(
      PRODUCT_ABOUT_DIALOG_TEST_ID,
    );
    const setup: HTMLElement = within(dialog).getByTestId(
      RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
    );

    expect(setup).toHaveTextContent("Guided setup");
    // Still an explanation: no second way to create a policy.
    expect(
      within(dialog).queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(setup);
    });

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/setup?from=how_it_works`,
    );
    expect(screen.queryByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID)).toBeNull();
  });

  test("a read-only member is not offered it, on the list or in How it works", async () => {
    asViewer();

    await renderInRouter(<ProductShowcase product={ProductKey.OnCall} />);

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
    cleanup();

    await renderInRouter(<ProductAboutButton product={ProductKey.OnCall} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
  });

  /*
   * The button names the page it opens, as that page's breadcrumb does:
   * "Guided setup", in every language. It first said "Set up paging", the
   * words of the AI activity's done action beside "Published a status page"
   * (InvestigationEvidenceFormat), which every language words as something
   * that already happened: "Alarmierung eingerichtet", "Configuró los
   * avisos".
   */
  test("its words name the page it opens, as the page's breadcrumb does, in every language", () => {
    const title: string =
      PRODUCT_ONBOARDINGS[ProductKey.OnCall].guidedSetup!.buttonTitle;
    const dashboard: string = path.join(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src",
    );
    const breadcrumbs: string = fs.readFileSync(
      path.join(dashboard, "Utils/Breadcrumbs/OnCallDutyBreadcrumbs.ts"),
      "utf8",
    );
    const setupCrumbs: string = breadcrumbs.slice(
      breadcrumbs.indexOf("PageMap.ON_CALL_DUTY_GUIDED_SETUP"),
    );

    expect(setupCrumbs.slice(0, setupCrumbs.indexOf("]"))).toContain(
      `"${title}"`,
    );

    const locales: string = path.join(dashboard, "Locales");

    for (const file of fs.readdirSync(locales)) {
      if (!file.endsWith(".json") || file === "en.json") {
        continue;
      }

      const table: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(locales, file), "utf8"),
      ) as Record<string, string>;

      expect({
        file,
        translated: Boolean(table[title]) && table[title] !== title,
        asTheDoneAction: table[title] === table["Set up paging"],
      }).toEqual({ file, translated: true, asTheDoneAction: false });
    }
  });

  test("a product with no guided setup keeps Create as its one primary button", async () => {
    await renderInRouter(
      <ProductShowcase
        product={ProductKey.Incidents}
        startButton={{
          title: "Declare Incident",
          onClick: jest.fn() as unknown as () => void,
        }}
      />,
    );

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveClass("bg-indigo-600");
  });
});

/*
 * ISSUE #7054: the guided setup "Know when my website or API is down" was
 * opened from Home's button, its checklist and Search, and never from
 * Monitors itself: the empty list and How it works offered only Create
 * Monitor, beside the importer's quiet link. Monitors names its setup as
 * On-Call names its own (#7148), to whoever may create a monitor.
 */
describe("Monitors' guided setup (#7054)", () => {
  const createMonitor: ShowcaseAddButton = {
    title: "Create Monitor",
    onClick: jest.fn() as unknown as () => void,
  };

  test("Monitors names its guided setup, for whoever may create a monitor", () => {
    expect(PRODUCT_ONBOARDINGS[ProductKey.Monitors].guidedSetup).toEqual({
      page: PageMap.MONITOR_GUIDED_SETUP,
      buttonTitle: "Guided setup",
      modelType: Monitor,
    });
  });

  test("the empty Monitors list offers it first, with Create Monitor beside it, plain, saying where it was opened from", async () => {
    await renderInRouter(
      <ProductShowcase
        product={ProductKey.Monitors}
        startButton={createMonitor}
      />,
    );

    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    const setup: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
    );
    const create: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );

    expect(setup).toHaveTextContent("Guided setup");
    expect(create).toHaveTextContent("Create Monitor");
    expect(setup).toHaveClass("bg-indigo-600");
    expect(create).not.toHaveClass("bg-indigo-600");

    fireEvent.click(setup);

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/monitors/setup?from=empty_list`,
    );
  });

  test("How it works on Monitors offers it too", async () => {
    await renderInRouter(<ProductAboutButton product={ProductKey.Monitors} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    const setup: HTMLElement = within(
      screen.getByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID),
    ).getByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID);

    expect(setup).toHaveTextContent("Guided setup");

    await act(async () => {
      fireEvent.click(setup);
    });

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/monitors/setup?from=how_it_works`,
    );
    expect(screen.queryByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID)).toBeNull();
  });

  test("someone who may not create a monitor is offered it nowhere", async () => {
    asViewer();

    await renderInRouter(<ProductShowcase product={ProductKey.Monitors} />);

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
    cleanup();

    await renderInRouter(<ProductAboutButton product={ProductKey.Monitors} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("its words name the page it opens, as the page's breadcrumb does", () => {
    const title: string =
      PRODUCT_ONBOARDINGS[ProductKey.Monitors].guidedSetup!.buttonTitle;
    const breadcrumbs: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs.ts",
      ),
      "utf8",
    );
    const setupCrumbs: string = breadcrumbs.slice(
      breadcrumbs.indexOf("PageMap.MONITOR_GUIDED_SETUP"),
    );

    expect(setupCrumbs.slice(0, setupCrumbs.indexOf("]"))).toContain(
      `"${title}"`,
    );
  });
});

/*
 * ISSUE #7142: the status page and telemetry guided setups were opened
 * from Home's checklist and Search, and never from the products themselves.
 * Walk after walk, a newcomer who opened Status Pages or Logs from the
 * products menu met only the manual way - Create Status Page, the setup
 * guide's dialog - and found the guided setups by typing their names into
 * Search. Each product now names its setup as On-Call (#7148) and Monitors
 * (#7054) do: the one primary button of its explanation, on the empty list
 * and in How it works, with the manual way beside it, plain. Only someone
 * who may make every record the setup makes is offered it.
 */
describe("the status page and telemetry guided setups, from their products (#7142)", () => {
  const createStatusPage: ShowcaseAddButton = {
    title: "Create Status Page",
    onClick: jest.fn() as unknown as () => void,
  };

  // A member of a custom role holding exactly these.
  const holding: (permissions: Array<Permission>) => void = (
    permissions: Array<Permission>,
  ): void => {
    mockPermissions = permissions;
    PermissionGate.clearPermissionPropsCache();
  };

  test("Status Pages names its guided setup, for whoever may make a page and put monitors on it", () => {
    expect(PRODUCT_ONBOARDINGS[ProductKey.StatusPages].guidedSetup).toEqual({
      page: PageMap.STATUS_PAGES_GUIDED_SETUP,
      buttonTitle: "Guided setup",
      modelType: StatusPage,
      alsoCreates: [StatusPageResource],
    });
  });

  test("Logs, Traces and Metrics name the telemetry setup - the three its guide sets up - and nothing else does", () => {
    const telemetry: Array<OnboardedProductKey> = [
      ProductKey.Logs,
      ProductKey.Traces,
      ProductKey.Metrics,
    ];

    for (const product of telemetry) {
      expect({
        product,
        guidedSetup: PRODUCT_ONBOARDINGS[product].guidedSetup,
      }).toEqual({
        product,
        guidedSetup: {
          page: PageMap.SERVICES_GUIDED_SETUP,
          buttonTitle: "Guided setup",
          modelType: TelemetryIngestionKey,
          alsoCreates: [Monitor],
        },
      });
    }

    const others: Array<OnboardedProductKey> = [
      ProductKey.Exceptions,
      ProductKey.Profiles,
      ProductKey.Topology,
      ProductKey.Services,
    ];

    for (const product of others) {
      expect({
        product,
        guidedSetup: PRODUCT_ONBOARDINGS[product].guidedSetup,
      }).toEqual({ product, guidedSetup: undefined });
    }
  });

  test("its words name the page it opens, as each setup's breadcrumb does", () => {
    const dashboard: string = path.join(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src",
    );

    for (const [product, file, page] of [
      [
        ProductKey.StatusPages,
        "StatusPagesBreadcrumbs.ts",
        "PageMap.STATUS_PAGES_GUIDED_SETUP",
      ],
      [
        ProductKey.Logs,
        "ServiceBreadcrumbs.ts",
        "PageMap.SERVICES_GUIDED_SETUP",
      ],
    ] as Array<[OnboardedProductKey, string, string]>) {
      const breadcrumbs: string = fs.readFileSync(
        path.join(dashboard, "Utils/Breadcrumbs", file),
        "utf8",
      );
      const setupCrumbs: string = breadcrumbs.slice(breadcrumbs.indexOf(page));

      expect({
        product,
        named: setupCrumbs
          .slice(0, setupCrumbs.indexOf("]"))
          .includes(
            `"${PRODUCT_ONBOARDINGS[product].guidedSetup!.buttonTitle}"`,
          ),
      }).toEqual({ product, named: true });
    }
  });

  test("the empty Status Pages list offers it first, with Create Status Page beside it, plain, saying where it was opened from", async () => {
    await renderInRouter(
      <ProductShowcase
        product={ProductKey.StatusPages}
        startButton={createStatusPage}
      />,
    );

    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    const setup: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
    );
    const create: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );

    expect(setup).toHaveTextContent("Guided setup");
    expect(create).toHaveTextContent("Create Status Page");
    expect(setup).toHaveClass("bg-indigo-600");
    expect(create).not.toHaveClass("bg-indigo-600");
    expect(
      setup.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(setup);

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/setup?from=empty_list`,
    );
  });

  test("the empty Status Pages page itself: one click to the setup, one button for each job", async () => {
    setCount(StatusPage, 0);
    goTo(`/dashboard/${PROJECT_ID}/status-pages`);
    await renderInRouter(
      <StatusPagesPage
        {...({
          pageRoute: new Route(`/dashboard/${PROJECT_ID}/status-pages`),
          currentProject: null,
          hasPaymentMethod: true,
        } as unknown as PageComponentProps)}
      />,
    );

    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    expect(
      within(showcase).getAllByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toHaveLength(1);
    // Create once, beside the setup: the empty table leaves its own to it.
    expect(
      within(showcase).getAllByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveLength(1);
    expect(screen.queryByTestId(EMPTY_TABLE_CREATE_BUTTON_TEST_ID)).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(showcase).getByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
      );
    });

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/setup?from=empty_list`,
    );
  });

  test("How it works on Status Pages offers it too, and closes as it opens it", async () => {
    await renderInRouter(
      <ProductAboutButton product={ProductKey.StatusPages} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    const setup: HTMLElement = within(
      screen.getByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID),
    ).getByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID);

    await act(async () => {
      fireEvent.click(setup);
    });

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/setup?from=how_it_works`,
    );
    expect(screen.queryByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID)).toBeNull();
  });

  test("someone who may make a status page but not put monitors on it is not offered it: the page would stay empty", async () => {
    holding([
      Permission.ReadProjectStatusPage,
      Permission.CreateProjectStatusPage,
    ]);

    await renderInRouter(
      <ProductShowcase
        product={ProductKey.StatusPages}
        startButton={createStatusPage}
      />,
    );

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
    // Create stays, as the one primary button.
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveClass("bg-indigo-600");
  });

  test("a read-only member is offered neither setup, on the list or in How it works", async () => {
    asViewer();

    const products: Array<OnboardedProductKey> = [
      ProductKey.StatusPages,
      ProductKey.Logs,
    ];

    for (const product of products) {
      await renderInRouter(<ProductShowcase product={product} />);
      expect({
        product,
        offered: screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
      }).toEqual({ product, offered: null });
      cleanup();

      await renderInRouter(<ProductAboutButton product={product} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "How it works" }));
      });
      expect({
        product,
        offered: screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
      }).toEqual({ product, offered: null });
      cleanup();
    }
  });

  test("a new project's Logs, Traces and Metrics open the telemetry setup in one click, the setup guide's dialog beside it, plain", async () => {
    for (const [product, start] of [
      [ProductKey.Logs, "Send your first logs"],
      [ProductKey.Traces, "Send your first traces"],
      [ProductKey.Metrics, "Send your first metrics"],
    ] as Array<
      [ProductKey.Logs | ProductKey.Traces | ProductKey.Metrics, string]
    >) {
      navigateSpy.mockClear();
      await renderInRouter(<TelemetryFirstRunShowcase product={product} />);

      const showcase: HTMLElement = screen.getByTestId(
        PRODUCT_SHOWCASE_TEST_ID,
      );
      const setup: HTMLElement = within(showcase).getByTestId(
        RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
      );
      const dialog: HTMLElement = within(showcase).getByTestId(
        RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
      );

      expect({ product, setup: setup.textContent }).toEqual({
        product,
        setup: "Guided setup",
      });
      expect(dialog).toHaveTextContent(start);
      expect(setup).toHaveClass("bg-indigo-600");
      expect(dialog).not.toHaveClass("bg-indigo-600");

      await act(async () => {
        fireEvent.click(setup);
      });

      expect(String(navigateSpy.mock.calls[0]![0])).toBe(
        `/dashboard/${PROJECT_ID}/service/setup?from=empty_list`,
      );
      // The setup opens on its own page: the dialog is not opened too.
      expect(screen.queryByTestId(TELEMETRY_SETUP_DIALOG_TEST_ID)).toBeNull();
      cleanup();
    }
  });

  test("the dialog is still one click away beside it, and opens as before", async () => {
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    });
    await settle();

    expect(screen.getByTestId(TELEMETRY_SETUP_DIALOG_TEST_ID)).toBeVisible();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("someone who may make an ingestion key but not a monitor gets the dialog alone: the setup ends with monitors", async () => {
    holding([
      Permission.ReadTelemetryIngestionKey,
      Permission.CreateTelemetryIngestionKey,
      Permission.ReadService,
    ]);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveTextContent("Send your first logs");
  });

  test("How it works on Logs offers the telemetry setup once there is data", async () => {
    await renderInRouter(<ProductAboutButton product={ProductKey.Logs} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    });

    const dialog: HTMLElement = screen.getByTestId(
      PRODUCT_ABOUT_DIALOG_TEST_ID,
    );

    await act(async () => {
      fireEvent.click(
        within(dialog).getByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
      );
    });

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/service/setup?from=how_it_works`,
    );
  });

  test("Profiles, which the telemetry setup's guide does not set up, keeps its dialog as its one primary button", async () => {
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Profiles} />,
    );

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toBeNull();
    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveClass("bg-indigo-600");
  });
});

describe("who is offered the first step", () => {
  const button: ShowcaseAddButton = {
    title: "Create Monitor",
    onClick: () => {
      return undefined;
    },
  };

  test("someone who may create one is", () => {
    expect(getProductStartButton({ modelType: Monitor, button })).toBe(button);
  });

  test("a read-only member is not: the explanation is drawn without it", async () => {
    asViewer();

    expect(
      getProductStartButton({ modelType: Monitor, button }),
    ).toBeUndefined();

    await renderInRouter(
      <ProductShowcase
        product={ProductKey.Monitors}
        startButton={getProductStartButton({ modelType: Monitor, button })}
      />,
    );

    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toHaveAttribute(
      "data-product",
      ProductKey.Monitors,
    );
    expect(screen.getByText("Create a monitor")).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a create form's locked button is left out, an open one kept", () => {
    expect(getUnlockedButton({ ...button, disabled: true })).toBeUndefined();
    expect(getUnlockedButton({ ...button, disabled: false })).toEqual({
      ...button,
      disabled: false,
    });
    expect(getUnlockedButton(undefined)).toBeUndefined();
  });
});

// The four lists whose first step is a page of its own (Monitors ...).
const CreatePageHarness: React.FunctionComponent = (): ReactElement => {
  const firstRun: CreatePageFirstRun = useCreatePageFirstRun<Monitor>({
    modelType: Monitor,
    product: ProductKey.Monitors,
    startTitle: "Create Monitor",
    createPage: PageMap.MONITOR_CREATE,
  });

  return (
    <div>
      <div data-testid="empty-state">
        {JSON.stringify(firstRun.emptyState as EmptyStateOptions)}
      </div>
      {firstRun.showcase}
    </div>
  );
};

describe("a list whose first step is a page of its own", () => {
  test("with nothing yet, it explains the product under the table and drops the table's own Create", async () => {
    setCount(Monitor, 0);
    goTo(`/dashboard/${PROJECT_ID}/monitors`);
    await renderInRouter(<CreatePageHarness />);

    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      '"hideCreateButton":true',
    );
    // The table says what the list is for; the showcase does not repeat it.
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_DESCRIPTION_TEST_ID),
    ).toBeNull();

    fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]?.[0])).toBe(
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );
  });

  test("a project with monitors sees its list alone", async () => {
    setCount(Monitor, 7);
    await renderInRouter(<CreatePageHarness />);

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("empty-state")).not.toHaveTextContent(
      "hideCreateButton",
    );
  });

  test("a count that fails leaves the list as it was", async () => {
    setCount(Monitor, new Error("The count failed."));
    await renderInRouter(<CreatePageHarness />);

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("empty-state")).not.toHaveTextContent(
      "hideCreateButton",
    );
  });

  test("a read-only member reads the explanation, without the button, under the table's own locked Create", async () => {
    setCount(Monitor, 0);
    asViewer();
    await renderInRouter(<CreatePageHarness />);

    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
    // The table keeps its button, locked, and the note that says why.
    expect(screen.getByTestId("empty-state")).not.toHaveTextContent(
      "hideCreateButton",
    );
  });
});

describe("the empty table's Create under a product's explanation", () => {
  test("is left to the explanation while the project has none and the explanation offers it", () => {
    expect(
      getProductFirstRunEmptyState({
        emptyState: { title: "x" },
        count: 0,
        hasStartButton: true,
      }),
    ).toEqual({ title: "x", hideCreateButton: true });
  });

  test("is the table's own when the explanation has none to offer: a read-only member's locked one, with its note", () => {
    expect(
      getProductFirstRunEmptyState({
        emptyState: { title: "x" },
        count: 0,
        hasStartButton: false,
      }),
    ).toEqual({ title: "x" });
    expect(
      getProductFirstRunEmptyState({
        emptyState: undefined,
        count: 0,
        hasStartButton: false,
      }),
    ).toEqual({});
  });

  test("is the table's own once there is one, or while the count is not known", () => {
    for (const count of [1, 12, null]) {
      expect(
        getProductFirstRunEmptyState({
          emptyState: { title: "x" },
          count: count,
          hasStartButton: true,
        }),
      ).toEqual({ title: "x" });
    }
  });
});

// The lists whose first step is their table's create form (Status Pages ...).
let lastFirstRun: ProductFirstRun | null = null;

const CreateFormHarness: React.FunctionComponent = (): ReactElement => {
  const firstRun: ProductFirstRun = useProductFirstRun<StatusPage>({
    modelType: StatusPage,
    query: { isArchived: false },
  });
  lastFirstRun = firstRun;

  return (
    <div>
      <div data-testid="show-create-form">
        {String(firstRun.showCreateForm)}
      </div>
      <div data-testid="top-content">
        {firstRun.getTopContent("chips") || "none"}
      </div>
      {firstRun.isFirstRun && (
        <ProductShowcase
          product={ProductKey.StatusPages}
          startButton={firstRun.startButton}
        />
      )}
    </div>
  );
};

describe("a list whose first step is its table's create form", () => {
  test("with nothing yet: no chips, no second Create, and the showcase's button opens the table's form", async () => {
    jest.useFakeTimers();
    setCount(StatusPage, 0);
    await renderInRouter(<CreateFormHarness />);

    expect(lastFirstRun?.isFirstRun).toBe(true);
    expect(screen.getByTestId("top-content")).toHaveTextContent("none");
    expect(lastFirstRun?.getEmptyState({ title: "x" })).toEqual({
      title: "x",
      hideCreateButton: true,
    });

    const button: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );
    // The table's own words for its button.
    expect(button).toHaveTextContent("Create Status Page");
    expect(screen.getByTestId("show-create-form")).toHaveTextContent("false");

    await act(async () => {
      fireEvent.click(button);
      jest.advanceTimersByTime(10);
    });
    expect(screen.getByTestId("show-create-form")).toHaveTextContent("true");
  });

  test("the first one created gives way at once", async () => {
    setCount(StatusPage, 0);
    await renderInRouter(<CreateFormHarness />);
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();

    await act(async () => {
      lastFirstRun?.onRecordCreated();
    });
    await settle();

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("top-content")).toHaveTextContent("chips");
  });

  test("a project with status pages sees its list, chips and all", async () => {
    setCount(StatusPage, 3);
    await renderInRouter(<CreateFormHarness />);

    expect(lastFirstRun?.isFirstRun).toBe(false);
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("top-content")).toHaveTextContent("chips");
    expect(lastFirstRun?.getEmptyState({ title: "x" })).toEqual({ title: "x" });
  });

  test("a read-only member is not handed the locked button: the table keeps its own", async () => {
    setCount(StatusPage, 0);
    asViewer();
    await renderInRouter(<CreateFormHarness />);

    expect(lastFirstRun?.startButton).toBeUndefined();
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
    // Locked, with the note that says why: the table draws it as before.
    expect(lastFirstRun?.getEmptyState({ title: "x" })).toEqual({ title: "x" });
  });
});

describe("Status Pages, drawn whole", () => {
  const PAGE_PROPS: PageComponentProps = {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/status-pages`),
    currentProject: null,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;

  test("an empty project: the table's empty state without its Create, and the explanation under it", async () => {
    setCount(StatusPage, 0);
    goTo(`/dashboard/${PROJECT_ID}/status-pages`);
    await renderInRouter(<StatusPagesPage {...PAGE_PROPS} />);

    expect(
      document.querySelector('[data-empty-state-kind="empty"]'),
    ).not.toBeNull();
    expect(screen.queryByTestId(EMPTY_TABLE_CREATE_BUTTON_TEST_ID)).toBeNull();
    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    expect(showcase).toHaveAttribute("data-product", ProductKey.StatusPages);
    expect(
      within(showcase).getByText("Tell your customers what is going on"),
    ).toBeInTheDocument();
    // What the list is for is said once: by the empty table, not again under it.
    expect(
      within(showcase).queryByTestId(RESOURCE_SHOWCASE_DESCRIPTION_TEST_ID),
    ).toBeNull();
    expect(
      within(showcase).getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveTextContent("Create Status Page");
    // The guided setup first, as the one primary button (#7142).
    expect(
      within(showcase).getByTestId(RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID),
    ).toHaveTextContent("Guided setup");

    // The showcase's Create opens the table's own create form.
    expect(screen.queryByTestId("modal")).toBeNull();
    await act(async () => {
      fireEvent.click(
        within(showcase).getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
      );
    });
    expect(
      await screen.findByTestId("modal", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    // The same form the card header's Create opens.
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Create New Status Page",
    );
  });

  test("a project with status pages: no explanation, the table as it was", async () => {
    setCount(StatusPage, 2);
    goTo(`/dashboard/${PROJECT_ID}/status-pages`);
    await renderInRouter(<StatusPagesPage {...PAGE_PROPS} />);

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });
});

describe("a telemetry product before its first telemetry", () => {
  test("no logs have arrived: the explanation, with the setup guide as its button", async () => {
    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    expect(
      within(showcase).getByText("Search every log line in one place"),
    ).toBeInTheDocument();
    const button: HTMLElement = within(showcase).getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );
    expect(button).toHaveTextContent("Send your first logs");
    expect(
      within(showcase).getByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
    ).toHaveAttribute("href", "/docs/telemetry/logs-explorer");

    /*
     * It asks for the project's first logs - its mark - not for services
     * that have reported (#6534, #6897), and counts no service at all.
     */
    const [query] = firstDataCounts();
    expect(query!["milestone"]).toBe(ActivationMilestone.FirstLogsReceived);
    expect(String(query!["projectId"])).toBe(PROJECT_ID);
    expect(
      (
        ModelAPI.count as unknown as { mock: { calls: Array<Array<unknown>> } }
      ).mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === Service;
      }),
    ).toBe(false);
  });

  test.each(
    Object.keys(TELEMETRY_FIRST_RUNS).map((product: string) => {
      return [product];
    }),
  )(
    "%s reads its own signal's first-data mark, the one the products menu reads",
    async (product: string) => {
      await renderInRouter(
        <TelemetryFirstRunShowcase product={product as TelemetryProductKey} />,
      );

      const expected: ActivationMilestone =
        PRODUCT_USAGE_MILESTONES[product as TelemetryProductKey]![0]!;

      expect(
        TELEMETRY_FIRST_RUNS[product as TelemetryProductKey].firstDataMilestone,
      ).toBe(expected);
      expect(
        firstDataCounts().map((query: Record<string, unknown>): unknown => {
          return query["milestone"];
        }),
      ).toEqual([expected]);
    },
  );

  test("a project that sends traces and no logs still meets the Logs explanation, and not the Traces one", async () => {
    receiveFirstData(ActivationMilestone.FirstTracesReceived);

    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toHaveTextContent(
      "Search every log line in one place",
    );
    cleanup();

    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Traces} />,
    );
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("Topology follows the first traces, the data its map is drawn from", async () => {
    receiveFirstData(
      ActivationMilestone.FirstLogsReceived,
      ActivationMilestone.FirstMetricsReceived,
    );

    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Topology} />,
    );
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
    cleanup();

    receiveFirstData(ActivationMilestone.FirstTracesReceived);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Topology} />,
    );
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  /*
   * #7755: the first logs arrive while the page is open, sent from a
   * terminal or by a shipper set up elsewhere - no dialog open. The page
   * asks again every few seconds while the mark is missing, and gives way.
   */
  test("the first logs arriving while the page is open take the explanation away, with no reload", async () => {
    jest.useFakeTimers();
    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();

    receiveFirstData(ActivationMilestone.FirstLogsReceived);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await settle();

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("its button opens the setup guide, which waits for the first data", async () => {
    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    });
    await settle();

    const dialog: HTMLElement = screen.getByTestId(
      TELEMETRY_SETUP_DIALOG_TEST_ID,
    );
    // Said up front: the step that waits is at the end of a long guide.
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Follow the steps below. The last one waits for the first data to arrive.",
    );
    expect(
      within(dialog).getByText("Wait for it to connect"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Waiting for the first data. This step updates by itself.",
      ),
    ).toBeInTheDocument();
  });

  test("the first service to report is named, with a link to its logs, and the explanation gives way", async () => {
    jest.useFakeTimers();
    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    });
    await settle();

    // The first look notes what the project had: nothing.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await settle();

    const service: Service = new Service();
    service._id = "7c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    service.name = "checkout-api";
    service.createdAt = new Date();
    service.lastSeenAt = new Date();
    newServices = [service];

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await settle();

    const dialog: HTMLElement = screen.getByTestId(
      TELEMETRY_SETUP_DIALOG_TEST_ID,
    );
    expect(dialog).toHaveTextContent(
      "checkout-api is connected. Its data arrives within a minute or two.",
    );
    expect(
      within(dialog).getByRole("link", { name: /View logs/ }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/7c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/logs`,
    );
    // Behind the dialog, the page is the explorer alone now.
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("a project whose logs have arrived never sees it, however many services reported", async () => {
    receiveFirstData(ActivationMilestone.FirstLogsReceived);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  /*
   * Logs that name no service register none: the old count of services
   * that reported said "nothing yet" while they arrived. The mark is the
   * project's first logs, whatever names them.
   */
  test("logs that name no service keep the explanation away, though no service has reported", async () => {
    setCount(Service, 0);
    receiveFirstData(ActivationMilestone.FirstLogsReceived);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("a check that fails shows nothing, rather than an explanation the project may not need", async () => {
    firstData = new Error("The count failed.");
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs} />,
    );

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("a read-only member reads it without the setup button", async () => {
    asViewer();
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Traces} />,
    );

    expect(
      screen.getByText("Follow one request through every service"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
  });
});

/*
 * The Logs page's explorer, as far as its explanation sees it: its first
 * steps while it is empty, data once it has some, nothing while it loads.
 */
type ExplorerState = "loading" | "empty" | "data";

const Explorer: React.FunctionComponent<{ state: ExplorerState }> = (props: {
  state: ExplorerState;
}): ReactElement => {
  useReportTelemetryDataShown(props.state === "data");

  if (props.state === "empty") {
    return (
      <TelemetryFirstStepsEmptyState signal={TelemetryFirstStepsSignal.Logs} />
    );
  }

  return (
    <div data-testid="explorer-rows">
      {props.state === "data" ? "web-01 sshd: session opened" : "Loading"}
    </div>
  );
};

describe("a telemetry product's explanation over its explorer", () => {
  async function renderLogsPage(
    state: ExplorerState,
  ): Promise<(next: ExplorerState) => Promise<void>> {
    goTo(`/dashboard/${PROJECT_ID}/logs`);
    const page: (explorerState: ExplorerState) => ReactElement = (
      explorerState: ExplorerState,
    ): ReactElement => {
      return (
        <MemoryRouter>
          <TelemetryFirstRunShowcase product={ProductKey.Logs}>
            <Explorer state={explorerState} />
          </TelemetryFirstRunShowcase>
        </MemoryRouter>
      );
    };
    let rerender: (element: ReactElement) => void = (): void => {
      return undefined;
    };
    await act(async () => {
      rerender = render(page(state)).rerender;
    });
    await settle();

    return async (next: ExplorerState): Promise<void> => {
      await act(async () => {
        rerender(page(next));
      });
      await settle();
    };
  }

  test("an empty explorer of a project with no logs yet: the explanation over it, and one way to set up - its button", async () => {
    await renderLogsPage("empty");

    const showcase: HTMLElement = screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID);
    expect(
      within(showcase).getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toHaveTextContent("Send your first logs");
    // The explorer still says it is empty, without a second setup button.
    expect(screen.getByText("No logs here yet")).toBeInTheDocument();
    expect(screen.queryByTestId("logs-first-steps-setup")).toBeNull();
    expect(screen.queryByText("Set up logs")).toBeNull();
  });

  test("logs the project's mark does not know of yet: the explorer has data, so there is nothing to explain", async () => {
    await renderLogsPage("data");

    expect(screen.getByTestId("explorer-rows")).toHaveTextContent(
      "web-01 sshd: session opened",
    );
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("an explorer that loads again keeps the explanation, and data gives it way", async () => {
    const show: (next: ExplorerState) => Promise<void> =
      await renderLogsPage("empty");
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();

    // A longer range: the list loads, and the explanation stays put.
    await show("loading");
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();

    // Older logs of a host that names no service.
    await show("data");
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("a read-only member's explanation has no button, so the explorer keeps its own way to the setup guide", async () => {
    asViewer();
    await renderLogsPage("empty");

    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
    expect(screen.getByTestId("logs-first-steps-setup")).toHaveTextContent(
      "Set up logs",
    );
  });

  /*
   * FluentBit's logs name no service, so no service registers (#7754). The
   * dialog's last step watches the key the guide's snippets carry: its
   * first data finishes the step, the explanation gives way, and View logs
   * - this very page - closes the dialog over the explorer, which reads
   * again, so the logs are there without a reload.
   */
  test("logs that name no service: the key's first data finishes the dialog's wait, and View logs shows the explorer read again", async () => {
    jest.useFakeTimers();
    // The key the newcomer made in the guide: nothing has been sent with it.
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key._id = "90000000-0000-4000-8000-000000000001";
    key.name = "Logs key";
    key.secretKey = new ObjectID("90000000-0000-4000-8000-0000000000aa");
    key.keyType = TelemetryIngestionKeyType.Server;
    keys = [key];

    let explorerMounts: number = 0;
    const CountingExplorer: React.FunctionComponent = (): ReactElement => {
      React.useEffect(() => {
        explorerMounts++;
      }, []);
      return (
        <TelemetryFirstStepsEmptyState
          signal={TelemetryFirstStepsSignal.Logs}
        />
      );
    };

    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs}>
        <CountingExplorer />
      </TelemetryFirstRunShowcase>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    });
    await settle();

    const dialog: HTMLElement = screen.getByTestId(
      TELEMETRY_SETUP_DIALOG_TEST_ID,
    );
    expect(dialog).toHaveTextContent(
      "Waiting for the first data. This step updates by itself.",
    );

    // FluentBit's first batch: ingest stamps the key, and no service registers.
    key.lastUsedAt = new Date();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await settle();

    expect(dialog).toHaveTextContent(
      "The first data arrived with the key Logs key. It shows up within a minute or two.",
    );
    const viewLogs: HTMLElement = within(dialog).getByRole("link", {
      name: "View logs",
    });
    expect(viewLogs).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/logs`);
    // Behind the dialog, the page is the explorer alone now.
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(explorerMounts).toBe(1);

    await act(async () => {
      fireEvent.click(viewLogs);
    });
    await settle();

    expect(screen.queryByTestId(TELEMETRY_SETUP_DIALOG_TEST_ID)).toBeNull();
    expect(explorerMounts).toBe(2);
  });

  test("a dialog closed before any data arrived leaves the explorer as it was", async () => {
    let explorerMounts: number = 0;
    const CountingExplorer: React.FunctionComponent = (): ReactElement => {
      React.useEffect(() => {
        explorerMounts++;
      }, []);
      return (
        <TelemetryFirstStepsEmptyState
          signal={TelemetryFirstStepsSignal.Logs}
        />
      );
    };

    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs}>
        <CountingExplorer />
      </TelemetryFirstRunShowcase>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });
    await settle();

    expect(screen.queryByTestId(TELEMETRY_SETUP_DIALOG_TEST_ID)).toBeNull();
    expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
    expect(explorerMounts).toBe(1);
  });

  /*
   * #7755: the walker's page said "No logs here yet" until a reload, while
   * FluentBit's first lines were stored. The page asks for the first logs'
   * mark every few seconds while it is missing; when it arrives, the
   * explanation goes and the explorer reads the project again.
   */
  describe("the first logs arriving while the page is open (#7755)", () => {
    let explorerMounts: number = 0;
    let explorerState: ExplorerState = "empty";

    const CountingExplorer: React.FunctionComponent = (): ReactElement => {
      React.useEffect(() => {
        explorerMounts++;
      }, []);
      return <Explorer state={explorerState} />;
    };

    async function openLogsPage(): Promise<void> {
      goTo(`/dashboard/${PROJECT_ID}/logs`);
      await renderInRouter(
        <TelemetryFirstRunShowcase product={ProductKey.Logs}>
          <CountingExplorer />
        </TelemetryFirstRunShowcase>,
      );
    }

    async function waitForTheNextLook(): Promise<void> {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      await settle();
    }

    beforeEach(() => {
      jest.useFakeTimers();
      explorerMounts = 0;
      explorerState = "empty";
    });

    test("the empty explorer reads again, and the explanation gives way, with no reload", async () => {
      await openLogsPage();
      expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
      expect(explorerMounts).toBe(1);

      // Nothing yet: the page asks again, and changes nothing.
      await waitForTheNextLook();
      expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
      expect(explorerMounts).toBe(1);

      // FluentBit's first lines are stored: the server keeps the mark.
      receiveFirstData(ActivationMilestone.FirstLogsReceived);
      explorerState = "data";
      await waitForTheNextLook();

      expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
      expect(explorerMounts).toBe(2);
      expect(screen.getByTestId("explorer-rows")).toHaveTextContent(
        "web-01 sshd: session opened",
      );

      // The mark is in: the page asks no more.
      const asked: number = firstDataCounts().length;
      await waitForTheNextLook();
      expect(firstDataCounts()).toHaveLength(asked);
    });

    test("another signal's first data reads nothing again: traces are not the page's logs", async () => {
      await openLogsPage();

      receiveFirstData(ActivationMilestone.FirstTracesReceived);
      await waitForTheNextLook();

      expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
      expect(explorerMounts).toBe(1);
    });

    test("an explorer that drew data already is left as it is", async () => {
      explorerState = "data";
      await openLogsPage();

      receiveFirstData(ActivationMilestone.FirstLogsReceived);
      await waitForTheNextLook();

      expect(explorerMounts).toBe(1);
    });

    test("with the setup dialog open, the explorer reads again as it closes, once", async () => {
      await openLogsPage();
      await act(async () => {
        fireEvent.click(
          screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
        );
      });
      await settle();

      receiveFirstData(ActivationMilestone.FirstLogsReceived);
      await waitForTheNextLook();

      // Under the dialog, the explorer is left alone while it is open.
      expect(explorerMounts).toBe(1);

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-close-button"));
      });
      await settle();

      expect(screen.queryByTestId(TELEMETRY_SETUP_DIALOG_TEST_ID)).toBeNull();
      expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
      expect(explorerMounts).toBe(2);
    });
  });

  /*
   * #7888: a key something already sends with - traces, say - has a stamp
   * that moves whatever the new shipper does, so its first data cannot
   * finish the wait. The project's first logs can: whichever key sent them,
   * and whether or not they name a service.
   */
  test("a key that already sends: the project's first logs finish the dialog's wait, with the explorer's link", async () => {
    jest.useFakeTimers();
    receiveFirstData(ActivationMilestone.FirstTracesReceived);
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key._id = "90000000-0000-4000-8000-000000000002";
    key.name = "Production";
    key.secretKey = new ObjectID("90000000-0000-4000-8000-0000000000bb");
    key.keyType = TelemetryIngestionKeyType.Server;
    key.lastUsedAt = new Date();
    keys = [key];

    goTo(`/dashboard/${PROJECT_ID}/logs`);
    await renderInRouter(
      <TelemetryFirstRunShowcase product={ProductKey.Logs}>
        <TelemetryFirstStepsEmptyState
          signal={TelemetryFirstStepsSignal.Logs}
        />
      </TelemetryFirstRunShowcase>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID));
    });
    await settle();

    const dialog: HTMLElement = screen.getByTestId(
      TELEMETRY_SETUP_DIALOG_TEST_ID,
    );

    // The key is stamped again, for the traces: that is not the logs.
    key.lastUsedAt = new Date(Date.now() + 60_000);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await settle();
    expect(dialog).toHaveTextContent(
      "Waiting for the first data. This step updates by itself.",
    );

    // FluentBit's first logs are stored, with the key that sends traces.
    receiveFirstData(ActivationMilestone.FirstLogsReceived);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await settle();

    expect(
      within(dialog).getByTestId("resource-connection-data-arrived"),
    ).toHaveTextContent("The first data arrived.");
    expect(
      within(dialog).getByRole("link", { name: "View logs" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/logs`);
    // Behind the dialog, the page is the explorer alone now.
    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
  });

  test("a project whose logs arrived before: the explorer's own empty state, with its setup button", async () => {
    receiveFirstData(ActivationMilestone.FirstLogsReceived);
    await renderLogsPage("empty");

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("logs-first-steps-setup")).toHaveTextContent(
      "Set up logs",
    );
  });

  test("a check that fails: no explanation, and the explorer keeps its setup button", async () => {
    firstData = new Error("The count failed.");
    await renderLogsPage("empty");

    expect(screen.queryByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeNull();
    expect(screen.getByTestId("logs-first-steps-setup")).toBeInTheDocument();
  });
});
