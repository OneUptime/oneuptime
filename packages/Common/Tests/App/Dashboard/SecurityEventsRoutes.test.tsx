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
 *
 * A case's pages: its address still opens the case - its Overview, now
 * inside the case's own layout and side menu - and each of its other pages
 * sits one level under it, in the same layout, outside the product's; going
 * from page to page of one case keeps that layout (and the case it read).
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

/*
 * A case's layout: its side menu, header and breadcrumbs are tested on their
 * own (SecurityCaseViewLayout.test.tsx). Counted, so a test can tell the
 * layout kept from page to page of one case.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Layout",
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
        ReactModule.useEffect(() => {
          const counts: Record<string, number> = ((
            globalThis as unknown as {
              securityPageMounts?: Record<string, number>;
            }
          ).securityPageMounts ||= {});
          counts["CaseLayout"] = (counts["CaseLayout"] || 0) + 1;
        }, []);

        return ReactModule.createElement(
          "div",
          { "data-testid": "security-case-layout" },
          ReactModule.createElement(RouterModule.Outlet),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Index",
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
          counts["CaseOverview"] = (counts["CaseOverview"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseOverview",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Timeline",
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
          counts["CaseTimeline"] = (counts["CaseTimeline"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseTimeline",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Detections",
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
          counts["CaseDetections"] = (counts["CaseDetections"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseDetections",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Entities",
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
          counts["CaseEntities"] = (counts["CaseEntities"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseEntities",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/PlaybookRuns",
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
          counts["CasePlaybookRuns"] = (counts["CasePlaybookRuns"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CasePlaybookRuns",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Notes",
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
          counts["CaseNotes"] = (counts["CaseNotes"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseNotes",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/AuditLogs",
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
          counts["CaseAuditLogs"] = (counts["CaseAuditLogs"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseAuditLogs",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Delete",
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
          counts["CaseDelete"] = (counts["CaseDelete"] || 0) + 1;
        }, []);

        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "CaseDelete",
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

/*
 * The Workspace section's pages: the security cases' Slack and Microsoft
 * Teams rules, and the page that connects either (every product's).
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WorkspaceConnectionSlack",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "WorkspaceConnectionSlack",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WorkspaceConnectionMicrosoftTeams",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: { view?: string | undefined }) => {
        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "WorkspaceConnectionMicrosoftTeams",
          "data-view": props.view || "",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionsOverview",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      // The pages each tile's next step opens, so a test can say which they are.
      default: (props: { slackPage: string; microsoftTeamsPage: string }) => {
        return ReactModule.createElement("div", {
          "data-testid": "security-page",
          "data-page": "WorkspaceConnections",
          "data-view": `${props.slackPage} ${props.microsoftTeamsPage}`,
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

// Whether the page is drawn inside a case's own layout.
function isInCaseLayout(): boolean {
  return Boolean(
    screen
      .getByTestId("security-page")
      .closest('[data-testid="security-case-layout"]'),
  );
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
  [`/cases/${CASE_ID}`, "CaseOverview", "", false],
  [`/cases/${CASE_ID}/timeline`, "CaseTimeline", "", false],
  [`/cases/${CASE_ID}/detections`, "CaseDetections", "", false],
  [`/cases/${CASE_ID}/entities`, "CaseEntities", "", false],
  [`/cases/${CASE_ID}/playbook-runs`, "CasePlaybookRuns", "", false],
  [`/cases/${CASE_ID}/notes`, "CaseNotes", "", false],
  [`/cases/${CASE_ID}/audit-logs`, "CaseAuditLogs", "", false],
  [`/cases/${CASE_ID}/delete`, "CaseDelete", "", false],
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
  ["/workspace-connection-slack", "WorkspaceConnectionSlack", "", true],
  [
    "/workspace-connection-microsoft-teams",
    "WorkspaceConnectionMicrosoftTeams",
    "",
    true,
  ],
  [
    "/workspace-connections",
    "WorkspaceConnections",
    "SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
    true,
  ],
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

  test.each(
    ADDRESSES.filter(
      ([address]: [string, string, string, boolean]): boolean => {
        return address.startsWith(`/cases/${CASE_ID}`);
      },
    ),
  )(
    "%s is a page of the case, inside the case's own layout",
    async (address: string, page: string) => {
      await open(`${PRODUCT}${address}`);

      expect(drawn().page).toBe(page);
      expect(isInCaseLayout()).toBe(true);
      expect(screen.queryByTestId("security-layout")).toBeNull();
    },
  );

  test("the case queue's pages and the product's are never drawn in a case's layout", async () => {
    for (const address of ["/cases", "/cases/closed", "/overview"]) {
      cleanup();
      await open(`${PRODUCT}${address}`);

      expect(isInCaseLayout()).toBe(false);
      expect(drawn().inLayout).toBe(true);
    }
  });

  test("a case's address opens its Overview, where every link to a case has always landed", async () => {
    await open(`${PRODUCT}/cases/${CASE_ID}`);

    expect(drawn()).toEqual({
      page: "CaseOverview",
      view: "",
      inLayout: false,
    });
    expect(isInCaseLayout()).toBe(true);
  });

  test("going from page to page of one case keeps its layout, and draws each page", async () => {
    await open(`${PRODUCT}/cases/${CASE_ID}`);

    const layoutsBefore: number = mountsOf("CaseLayout");

    for (const [segment, page] of [
      ["detections", "CaseDetections"],
      ["entities", "CaseEntities"],
      ["playbook-runs", "CasePlaybookRuns"],
      ["timeline", "CaseTimeline"],
      ["notes", "CaseNotes"],
      ["audit-logs", "CaseAuditLogs"],
      ["delete", "CaseDelete"],
    ] as Array<[string, string]>) {
      await act(async () => {
        navigateTo!(`${PRODUCT}/cases/${CASE_ID}/${segment}`);
      });

      expect(drawn().page).toBe(page);
      expect(isInCaseLayout()).toBe(true);
    }

    await act(async () => {
      navigateTo!(`${PRODUCT}/cases/${CASE_ID}`);
    });

    expect(drawn().page).toBe("CaseOverview");
    // The same layout all along: the case is read once, not once per page.
    expect(mountsOf("CaseLayout")).toBe(layoutsBefore);
  });

  test("an address under a case that is not one of its pages opens nothing", async () => {
    await open(`${PRODUCT}/cases/${CASE_ID}/not-a-page`);

    expect(screen.queryByTestId("security-page")).toBeNull();
  });

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
    // A case's own pages, one level under it, each by its own key.
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/timeline`)).toBe(
      PageMap.SECURITY_CASE_VIEW_TIMELINE,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/detections`)).toBe(
      PageMap.SECURITY_CASE_VIEW_DETECTIONS,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/entities`)).toBe(
      PageMap.SECURITY_CASE_VIEW_ENTITIES,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/playbook-runs`)).toBe(
      PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/notes`)).toBe(
      PageMap.SECURITY_CASE_VIEW_NOTES,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/audit-logs`)).toBe(
      PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS,
    );
    expect(pageAt(`${PRODUCT}/cases/${CASE_ID}/delete`)).toBe(
      PageMap.SECURITY_CASE_VIEW_DELETE,
    );
    expect(pageAt(`${PRODUCT}/playbook-runs/all`)).toBe(
      PageMap.SECURITY_PLAYBOOK_RUNS,
    );
    expect(pageAt(`${PRODUCT}/playbook-runs`)).toBe(
      PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
    );
  });
});
