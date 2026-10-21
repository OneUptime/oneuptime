import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import {
  MemoryRouter,
  Route as RouterRoute,
  Routes,
  matchRoutes,
  useLocation,
  useNavigate,
} from "react-router-dom";

/*
 * Every Security Events address, through the product's real route table
 * (Routes/SecurityEventsRoutes.tsx) and RouteMap: which page it opens, and
 * which list a page that shows several draws. The page components are
 * stubs that say what they were given, so this is about the routes alone.
 *
 * What it pins: every tab of before is a page at the address it had; the
 * case queue's old address opens Open Cases and its other pages sit one
 * level down, beside a case's own page, which still opens for a case id;
 * the runs page's old address opens Waiting for Approval and every run is
 * one level down; Monitors still opens Monitors.
 */

// The layout: its side menu and breadcrumbs are tested on their own.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Layout",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");
    const RouterModule: typeof import("react-router-dom") = jest.requireActual(
      "react-router-dom",
    ) as typeof import("react-router-dom");

    return {
      __esModule: true,
      default: () => {
        return ReactModule.createElement(
          "div",
          { "data-testid": "security-layout" },
          ReactModule.createElement(RouterModule.Outlet),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Index",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Index"] = (counts["Index"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Index",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Overview",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Overview"] = (counts["Overview"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Overview",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Cases",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Cases"] = (counts["Cases"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Cases",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["CaseView"] = (counts["CaseView"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseView",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Entities"] = (counts["Entities"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Entities",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Correlate",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Correlate"] = (counts["Correlate"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Correlate",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["DetectionRules"] = (counts["DetectionRules"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "DetectionRules",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["RuleLibrary"] = (counts["RuleLibrary"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "RuleLibrary",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/AttackCoverage",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["AttackCoverage"] = (counts["AttackCoverage"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "AttackCoverage",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/ThreatIntel",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["ThreatIntel"] = (counts["ThreatIntel"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "ThreatIntel",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Playbooks",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Playbooks"] = (counts["Playbooks"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Playbooks",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookView",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["PlaybookView"] = (counts["PlaybookView"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "PlaybookView",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookRuns",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["PlaybookRuns"] = (counts["PlaybookRuns"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "PlaybookRuns",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Connections",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Connections"] = (counts["Connections"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Connections",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Documentation",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        // Counted, so a test can tell a page drawn afresh from one kept.
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["Documentation"] = (counts["Documentation"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "Documentation",
          "data-view": props.view || "",
        });
      },
    };
  },
);

import SecurityEventsRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/SecurityEventsRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const CASE_ID: string = "20000000-0000-4000-8000-000000000142";
const PLAYBOOK_ID: string = "24000000-0000-4000-8000-000000000003";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PRODUCT),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

let navigateTo: ((path: string) => void) | null = null;

// Where the router ended up, and a way for a test to go somewhere else.
const WhereAmI: () => ReactElement = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();

  navigateTo = (path: string): void => {
    navigate(path);
  };

  return <div data-testid="location">{location.pathname}</div>;
};

function mountsOf(page: string): number {
  return (
    (
      globalThis as unknown as {
        securityPageMounts?: Record<string, number>;
      }
    ).securityPageMounts?.[page] || 0
  );
}

async function open(path: string): Promise<void> {
  goTo(path);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <RouterRoute
            path={RouteMap[PageMap.SECURITY_EVENTS_ROOT]!.toString()}
            element={<SecurityEventsRoutes {...PAGE_PROPS} />}
          />
          <RouterRoute path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <WhereAmI />
      </MemoryRouter>,
    );
  });
}

function drawn(): { page: string; view: string; inLayout: boolean } {
  const page: HTMLElement = screen.getByTestId("security-page");

  return {
    page: page.getAttribute("data-page") || "",
    view: page.getAttribute("data-view") || "",
    inLayout: Boolean(page.closest('[data-testid="security-layout"]')),
  };
}

afterEach(() => {
  cleanup();
});

// Each address, the page it draws, the list that page shows, and whether it sits in the layout.
const ADDRESSES: Array<[string, string, string, boolean]> = [
  ["", "Index", "", true],
  ["/overview", "Overview", "", true],
  ["/cases", "Cases", "open", true],
  ["/cases/assigned-to-me", "Cases", "mine", true],
  ["/cases/unassigned", "Cases", "unassigned", true],
  ["/cases/closed", "Cases", "closed", true],
  ["/cases/all", "Cases", "all", true],
  [`/cases/${CASE_ID}`, "CaseView", "", false],
  ["/entities", "Entities", "", true],
  ["/correlate", "Correlate", "", true],
  ["/detection-rules", "DetectionRules", "", true],
  ["/rule-library", "RuleLibrary", "", true],
  ["/threat-intel", "ThreatIntel", "", true],
  ["/attack-coverage", "AttackCoverage", "", true],
  ["/playbooks", "Playbooks", "", true],
  [`/playbooks/${PLAYBOOK_ID}`, "PlaybookView", "", false],
  ["/playbook-runs", "PlaybookRuns", "waiting", true],
  ["/playbook-runs/all", "PlaybookRuns", "all", true],
  ["/connections", "Connections", "", true],
  ["/documentation", "Documentation", "", true],
];

describe("every Security Events address", () => {
  test.each(ADDRESSES)(
    "%s opens %s (%s)",
    async (address: string, page: string, view: string, inLayout: boolean) => {
      await open(`${PRODUCT}${address}`);

      expect(drawn()).toEqual({ page, view, inLayout });
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${PRODUCT}${address}`,
      );
    },
  );

  test.each([
    ["Cases", "/cases", "/cases/closed", "closed"],
    ["PlaybookRuns", "/playbook-runs", "/playbook-runs/all", "all"],
  ])(
    "going from one %s page to the next draws the page afresh",
    async (page: string, from: string, to: string, view: string) => {
      await open(`${PRODUCT}${from}`);

      const before: number = mountsOf(page);

      await act(async () => {
        navigateTo!(`${PRODUCT}${to}`);
      });

      expect(drawn()).toEqual({ page, view, inLayout: true });
      // A new page, not the last one with new props: its list starts afresh.
      expect(mountsOf(page)).toBe(before + 1);
    },
  );

  test("the old Monitors address opens Monitors, where those monitors are listed", async () => {
    await open(`${PRODUCT}/monitors`);

    expect(screen.queryByTestId("security-page")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(
      routeFor(PageMap.MONITORS),
    );
  });

  test("a case id is never taken for one of the queue's pages, nor a page for a case", () => {
    const routes: Array<{ path: string }> = Object.values(RouteMap)
      .map((route: Route): { path: string } => {
        return { path: route.toString() };
      })
      .filter((route: { path: string }): boolean => {
        return !route.path.includes("*");
      });

    const pageAt: (path: string) => string | undefined = (
      path: string,
    ): string | undefined => {
      const pattern: string | undefined = matchRoutes(routes, path)?.[0]?.route
        .path;

      return Object.keys(RouteMap).find((key: string): boolean => {
        return (
          RouteMap[key]!.toString() === pattern &&
          key !== PageMap.SECURITY_EVENTS_ROOT
        );
      });
    };

    expect(pageAt(`${PRODUCT}/cases/all`)).toBe(PageMap.SECURITY_CASES_ALL);
    expect(pageAt(`${PRODUCT}/cases/closed`)).toBe(
      PageMap.SECURITY_CASES_CLOSED,
    );
    expect(pageAt(`${PRODUCT}/cases/unassigned`)).toBe(
      PageMap.SECURITY_CASES_UNASSIGNED,
    );
    expect(pageAt(`${PRODUCT}/cases/assigned-to-me`)).toBe(
      PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}`)).toBe(
      PageMap.SECURITY_CASE_VIEW,
    );
    expect(pageAt(`${PRODUCT}/playbook-runs/all`)).toBe(
      PageMap.SECURITY_PLAYBOOK_RUNS,
    );
    expect(pageAt(`${PRODUCT}/playbook-runs`)).toBe(
      PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
    );
  });
});
