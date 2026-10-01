import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";

/*
 * The archived banner sits at the top of every page of a workflow, a status
 * page, a dashboard and an on-call policy (the monitor's layout has its own
 * suite, MonitorViewLayout.test.tsx): its layout renders it above the page,
 * for the resource in the URL, in that resource's words. And an on-call
 * policy's new Settings page holds Export and the Archive card, worded for
 * on-call policies and sending the user back to the policy list after
 * archiving.
 *
 * The real layouts render; ModelPage, the side menus and the banner itself
 * (tested in ArchivedResourceBanner.test.tsx) are replaced by recorders.
 */

interface BannerProps {
  modelType: unknown;
  modelId: { toString: () => string };
  copy: { singularName: string };
}

const bannerRenders: Array<BannerProps> = [];

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: {
      children: ReactElement | Array<ReactElement>;
      modelType: unknown;
    }): ReactElement => {
      return <div data-testid="model-page">{props.children}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchivedResourceBanner",
  () => {
    return {
      __esModule: true,
      default: (props: BannerProps): ReactElement => {
        bannerRenders.push(props);
        return (
          <div data-testid="archived-banner">
            {`${props.copy.singularName} banner for ${props.modelId.toString()}`}
          </div>
        );
      },
    };
  },
);

function mockSideMenu(): { __esModule: boolean; default: () => null } {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/SideMenu",
  () => {
    return mockSideMenu();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu",
  () => {
    return mockSideMenu();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/SideMenu",
  () => {
    return mockSideMenu();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/SideMenu",
  () => {
    return mockSideMenu();
  },
);

interface ExportCardProps {
  modelId: { toString: () => string };
  modelType: unknown;
}

interface ArchiveCardProps {
  modelType: unknown;
  modelId: { toString: () => string };
  singularName?: string;
  listRoute?: { toString: () => string };
  archiveCardDescription?: string;
  unarchiveCardDescription?: string;
  archiveConfirmMessage?: string;
  unarchiveConfirmMessage?: string;
}

const exportCards: Array<ExportCardProps> = [];
const archiveCards: Array<ArchiveCardProps> = [];

jest.mock("../../../UI/Components/ImportExport/ExportModelCard", () => {
  return {
    __esModule: true,
    default: (props: ExportCardProps): ReactElement => {
      exportCards.push(props);
      return <div data-testid="export-card" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (props: ArchiveCardProps): ReactElement => {
        archiveCards.push(props);
        return <div data-testid="archive-card" />;
      },
    };
  },
);

import {
  DASHBOARD_ARCHIVE_COPY,
  ON_CALL_POLICY_ARCHIVE_COPY,
  ResourceArchiveCopy,
  STATUS_PAGE_ARCHIVE_COPY,
  WORKFLOW_ARCHIVE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import DashboardViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Layout";
import OnCallDutyPolicyViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Layout";
import OnCallDutyPolicySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPageViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Layout";
import WorkflowViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Layout";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const RESOURCE_ID: string = "3c2b1a0f-9e8d-4c7b-a6f5-e4d3c2b1a0f9";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

interface ViewLayout {
  name: string;
  modelType: unknown;
  copy: ResourceArchiveCopy;
  render: () => ReactElement;
}

const LAYOUTS: Array<ViewLayout> = [
  {
    name: "workflow",
    modelType: Workflow,
    copy: WORKFLOW_ARCHIVE_COPY,
    render: () => {
      return <WorkflowViewLayout {...PAGE_PROPS} />;
    },
  },
  {
    name: "status page",
    modelType: StatusPage,
    copy: STATUS_PAGE_ARCHIVE_COPY,
    render: () => {
      return <StatusPageViewLayout {...PAGE_PROPS} />;
    },
  },
  {
    name: "dashboard",
    modelType: Dashboard,
    copy: DASHBOARD_ARCHIVE_COPY,
    render: () => {
      return <DashboardViewLayout {...PAGE_PROPS} />;
    },
  },
  {
    name: "on-call policy",
    modelType: OnCallDutyPolicy,
    copy: ON_CALL_POLICY_ARCHIVE_COPY,
    render: () => {
      return <OnCallDutyPolicyViewLayout {...PAGE_PROPS} />;
    },
  },
];

async function renderLayout(layout: ViewLayout): Promise<void> {
  const path: string = `/resources/${RESOURCE_ID}/page`;
  goTo(path);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <PageRoute path="/resources/:id" element={layout.render()}>
            <PageRoute
              path="page"
              element={<div data-testid="resource-page" />}
            />
          </PageRoute>
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  bannerRenders.length = 0;
  exportCards.length = 0;
  archiveCards.length = 0;
});

afterEach(() => {
  cleanup();
});

describe.each(LAYOUTS)("the $name's pages", (layout: ViewLayout) => {
  test("carry the archived banner for the resource in the URL, in its words", async () => {
    await renderLayout(layout);

    expect(bannerRenders.length).toBeGreaterThan(0);
    const props: BannerProps = bannerRenders[bannerRenders.length - 1]!;
    expect(props.modelType).toBe(layout.modelType);
    expect(props.modelId.toString()).toBe(RESOURCE_ID);
    expect(props.copy).toBe(layout.copy);
  });

  test("put it above the page itself", async () => {
    await renderLayout(layout);

    const banner: HTMLElement = screen.getByTestId("archived-banner");
    const page: HTMLElement = screen.getByTestId("resource-page");

    expect(banner).toHaveTextContent(
      `${layout.copy.singularName} banner for ${RESOURCE_ID}`,
    );
    expect(
      banner.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByTestId("archived-banner")).toHaveLength(1);
  });
});

describe("an on-call policy's Settings page", () => {
  async function renderSettings(): Promise<void> {
    goTo(`/dashboard/${PROJECT_ID}/on-call-duty/policies/${RESOURCE_ID}/settings`);

    await act(async () => {
      render(<OnCallDutyPolicySettings {...PAGE_PROPS} />);
    });
  }

  test("exports the policy in the URL", async () => {
    await renderSettings();

    expect(exportCards).toHaveLength(1);
    expect(exportCards[0]!.modelType).toBe(OnCallDutyPolicy);
    expect(exportCards[0]!.modelId.toString()).toBe(RESOURCE_ID);
  });

  test("archives it with the on-call policy's words, then goes back to the policy list", async () => {
    await renderSettings();

    expect(archiveCards).toHaveLength(1);
    const card: ArchiveCardProps = archiveCards[0]!;
    expect(card.modelType).toBe(OnCallDutyPolicy);
    expect(card.modelId.toString()).toBe(RESOURCE_ID);
    expect(card.singularName).toBe(ON_CALL_POLICY_ARCHIVE_COPY.singularName);
    expect(card.archiveCardDescription).toBe(
      ON_CALL_POLICY_ARCHIVE_COPY.archiveCardDescription,
    );
    expect(card.unarchiveCardDescription).toBe(
      ON_CALL_POLICY_ARCHIVE_COPY.unarchiveCardDescription,
    );
    expect(card.archiveConfirmMessage).toBe(
      ON_CALL_POLICY_ARCHIVE_COPY.archiveConfirmMessage,
    );
    expect(card.unarchiveConfirmMessage).toBe(
      ON_CALL_POLICY_ARCHIVE_COPY.unarchiveConfirmMessage,
    );
    expect(card.listRoute?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/policies`,
    );
  });

  test("lists Export first, then Archive", async () => {
    await renderSettings();

    expect(
      screen
        .getByTestId("export-card")
        .compareDocumentPosition(screen.getByTestId("archive-card")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
