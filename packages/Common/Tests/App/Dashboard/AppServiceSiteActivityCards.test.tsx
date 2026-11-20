import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * WHAT AZURE SAYS OF AN APP SERVICE APP, ON ITS INSTANCES AND REVISIONS
 * TABS (#10294), RENDERED.
 *
 * Each instance Azure runs the app on, with when its own telemetry last
 * named it (an instance whose service.instance.id is its
 * WEBSITE_INSTANCE_ID is the same one); each deployment Azure keeps, the
 * one running now marked; and, for a list Azure would not give, why, in
 * the reader's words.
 */

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

import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import {
  EmptyMessageParts,
  splitEmptyMessage,
} from "../../../UI/Components/Table/EmptyTableMessage";
import {
  AppServiceDeploymentStatus,
  AppServiceInstanceState,
  AppServiceSiteActivity,
  AppServiceSiteReadError,
} from "../../../Types/Cloud/AppServiceSiteActivity";
import {
  APP_SERVICE_ACTIVE_DEPLOYMENT,
  APP_SERVICE_NO_DEPLOYMENTS,
  APP_SERVICE_NO_INSTANCES,
  APP_SERVICE_NOT_ASKED,
  APP_SERVICE_READ_ERRORS,
  AppServiceDeploymentsCard,
  AppServiceInstancesCard,
  getAppServiceInstanceRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppServiceSiteActivityCards";

const MINUTE_MS: number = 60 * 1000;
const INSTANCE_A: string =
  "8f0a3d1c2b4e6f8a0c2e4a6b8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5e";
const INSTANCE_B: string =
  "1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

function activity(
  fields: Partial<AppServiceSiteActivity> = {},
): AppServiceSiteActivity {
  return {
    readAt: new Date().toISOString(),
    instances: {
      items: [
        { id: INSTANCE_A, state: AppServiceInstanceState.Ready },
        { id: INSTANCE_B, state: AppServiceInstanceState.Stopped },
      ],
    },
    deployments: {
      items: [
        {
          id: "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
          status: AppServiceDeploymentStatus.Succeeded,
          active: true,
          author: "Ops Bot",
          deployer: "GitHub",
          message: "Merge pull request #212",
          startTime: minutesAgo(95).toISOString(),
          endTime: minutesAgo(90).toISOString(),
        },
        {
          id: "0c8f1d2e-3b4a-4c5d-9e6f-7a8b9c0d1e2f",
          status: AppServiceDeploymentStatus.Failed,
          active: false,
          author: "",
          deployer: "GITHUB_ZIP_DEPLOY",
          message: "",
          startTime: minutesAgo(2000).toISOString(),
          endTime: null,
        },
      ],
    },
    image: null,
    ...fields,
  };
}

function telemetryInstance(
  name: string,
  minutes: number,
): CloudResourceInstance {
  return Object.assign(new CloudResourceInstance(), {
    instanceName: name,
    lastSeenAt: minutesAgo(minutes),
  });
}

async function draw(element: React.ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
}

function rowsOf(testId: string): Array<HTMLElement> {
  return within(screen.getByTestId(testId)).getAllByRole("row").slice(1);
}

/*
 * A notice as its empty state draws it: headed by its first sentence,
 * without its full stop, the rest under it.
 */
function expectNotice(testId: string, sentence: string): void {
  const parts: EmptyMessageParts = splitEmptyMessage(sentence);
  const notice: HTMLElement = screen.getByTestId(testId);

  expect(notice).toHaveTextContent(parts.title);

  if (parts.description) {
    expect(notice).toHaveTextContent(parts.description);
  }
}

afterEach(() => {
  cleanup();
});

describe("Azure's instances", () => {
  test("each with its state, and when the app's telemetry last named it - the same id the detectors write", () => {
    const rows: ReturnType<typeof getAppServiceInstanceRows> =
      getAppServiceInstanceRows({
        instances: activity().instances.items!,
        telemetryInstances: [
          telemetryInstance(INSTANCE_A.toUpperCase(), 2),
          telemetryInstance("some-other-host", 1),
        ],
      });

    expect(
      rows.map((row: { id: string; telemetrySeenAt: Date | null }) => {
        return [row.id, Boolean(row.telemetrySeenAt)];
      }),
    ).toEqual([
      [INSTANCE_A, true],
      [INSTANCE_B, false],
    ]);
  });

  test("drawn as a list: the id whole, its state, and the telemetry's last sighting or a quiet dash", async () => {
    await draw(
      <AppServiceInstancesCard
        activity={activity()}
        telemetryInstances={[telemetryInstance(INSTANCE_A, 2)]}
      />,
    );

    const card: HTMLElement = screen.getByTestId("app-service-instances");

    expect(within(card).getByText("Instances in Azure")).toBeInTheDocument();
    expect(within(card).getByText("Ready")).toBeInTheDocument();
    expect(within(card).getByText("Stopped")).toBeInTheDocument();
    expect(card.textContent).toContain(INSTANCE_A.slice(0, 20));
    // A number keeps its unit on its line: a no-break space between them.
    expect(card.textContent).toMatch(/Last seen 2\sminutes ago/);
  });

  test("none listed, none askable, or a refusal: one sentence says which", async () => {
    const cases: Array<[AppServiceSiteActivity | null, string]> = [
      [activity({ instances: { items: [] } }), APP_SERVICE_NO_INSTANCES],
      [null, APP_SERVICE_NOT_ASKED],
      ...Object.values(AppServiceSiteReadError).map(
        (error: AppServiceSiteReadError): [AppServiceSiteActivity, string] => {
          return [
            activity({ instances: { items: null, error } }),
            APP_SERVICE_READ_ERRORS[error],
          ];
        },
      ),
    ];

    for (const [read, sentence] of cases) {
      await draw(
        <AppServiceInstancesCard activity={read} telemetryInstances={[]} />,
      );

      expectNotice("app-service-instances-notice", sentence);
      cleanup();
    }
  });
});

describe("Azure's deployments", () => {
  test("newest first, the one running now marked, its outcome, who deployed it and its message", async () => {
    await draw(<AppServiceDeploymentsCard activity={activity()} />);

    const rows: Array<HTMLElement> = rowsOf("app-service-deployments");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("4d1c9a8");
    expect(rows[0]).toHaveTextContent(APP_SERVICE_ACTIVE_DEPLOYMENT);
    expect(rows[0]).toHaveTextContent("Succeeded");
    expect(rows[0]).toHaveTextContent("Ops Bot");
    expect(rows[0]).toHaveTextContent("Merge pull request #212");
    expect(rows[1]).toHaveTextContent("0c8f1d2e");
    expect(rows[1]).toHaveTextContent("Failed");
    // No author: the deployer says who.
    expect(rows[1]).toHaveTextContent("GITHUB_ZIP_DEPLOY");
    expect(rows[1]).not.toHaveTextContent(APP_SERVICE_ACTIVE_DEPLOYMENT);
  });

  test("a container app's image is said above its list, and an app with none says what a deploy is for it", async () => {
    await draw(
      <AppServiceDeploymentsCard
        activity={activity({
          deployments: { items: [] },
          image: "otel/opentelemetry-collector-contrib:0.118.0",
        })}
      />,
    );

    expect(screen.getByTestId("app-service-image")).toHaveTextContent(
      "Azure runs the image otel/opentelemetry-collector-contrib:0.118.0.",
    );
    expectNotice("app-service-deployments-notice", APP_SERVICE_NO_DEPLOYMENTS);
  });

  test("a refusal says why", async () => {
    await draw(
      <AppServiceDeploymentsCard
        activity={activity({
          deployments: { items: null, error: AppServiceSiteReadError.NoAccess },
        })}
      />,
    );

    expectNotice(
      "app-service-deployments-notice",
      APP_SERVICE_READ_ERRORS[AppServiceSiteReadError.NoAccess],
    );
  });
});
