import "@testing-library/jest-dom";
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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement, ReactNode } from "react";

/*
 * What a cloud resource's section did not report, and why (#9569): asked of
 * the server when the section is opened; each key metric in the section's
 * order, by its cloud's own name, with since when it did not report and its
 * likely reasons, each with what fixes it where something does.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const mockExplain: MockedFn = jest.fn();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMetricsApi",
  () => {
    return {
      __esModule: true,
      explainCloudResourceUnreportedKeyMetrics: (...args: Array<unknown>) => {
        return mockExplain(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import CloudUnreportedKeyMetricsList, {
  CLOUD_UNREPORTED_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudUnreportedKeyMetricsList";
import { CloudKeyMetricCondition } from "../../../Types/Cloud/CloudKeyMetricCondition";
import { GCP_OPS_AGENT_INSTALL_URL } from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudUnreportedKeyMetricReport,
  CloudUnreportedReason,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-3333-4333-8333-333333333333");

const KEYS: Array<string> = [
  "aws/ec2|cpucreditbalance",
  "aws/ec2|statuscheckfailed",
  "compute.googleapis.com/guest/memory/percent_used",
  "aws/ec2|ebsreadbytes",
];

const REPORTS: Array<CloudUnreportedKeyMetricReport> = [
  // In another order than the section's: the list keeps the section's.
  {
    key: "compute.googleapis.com/guest/memory/percent_used",
    name: "guest/memory/percent_used",
    lastReportedAt: null,
    isNeverReported: true,
    reasons: [{ reason: CloudUnreportedReason.NeedsAgent, fix: "ops-agent" }],
  },
  {
    key: "aws/ec2|cpucreditbalance",
    name: "CPUCreditBalance",
    lastReportedAt: null,
    isNeverReported: true,
    reasons: [
      {
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.Burstable,
      },
    ],
  },
  {
    key: "aws/ec2|statuscheckfailed",
    name: "StatusCheckFailed",
    lastReportedAt: "2026-11-19T07:00:00.000Z",
    isNeverReported: false,
    reasons: [
      { reason: CloudUnreportedReason.NoPermission, fix: "cloud-connect" },
      {
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.NonZero,
      },
    ],
  },
  {
    key: "aws/ec2|ebsreadbytes",
    name: "EBSReadBytes",
    lastReportedAt: null,
    isNeverReported: false,
    reasons: [],
  },
];

async function renderList(keys: Array<string> = KEYS): Promise<void> {
  await act(async () => {
    render(
      <CloudUnreportedKeyMetricsList cloudResourceId={RESOURCE} keys={keys} />,
    );
  });
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId(CLOUD_UNREPORTED_ROW_TEST_ID);
}

beforeEach(() => {
  mockExplain.mockReset();
  mockExplain.mockImplementation(() => {
    return Promise.resolve(REPORTS);
  });
  jest
    .spyOn(OneUptimeDate, "fromNow")
    .mockImplementation((date: Date): string => {
      return date.toISOString() === "2026-11-19T07:00:00.000Z"
        ? "3 hours ago"
        : "some time ago";
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a section's key metrics not reported", () => {
  test("are asked of the server for the section's keys, once", async () => {
    await renderList();

    await waitFor(() => {
      expect(rows()).toHaveLength(4);
    });
    expect(mockExplain).toHaveBeenCalledTimes(1);
    expect(mockExplain.mock.calls[0]![0]).toEqual({
      cloudResourceId: RESOURCE,
      keys: KEYS,
    });
  });

  test("each in the section's order, by its cloud's name, with since when", async () => {
    await renderList();

    await waitFor(() => {
      expect(rows()).toHaveLength(4);
    });
    expect(
      rows().map((row: HTMLElement): string => {
        return row.querySelector("[dir='ltr']")?.textContent || "";
      }),
    ).toEqual([
      "CPUCreditBalance",
      "StatusCheckFailed",
      "guest/memory/percent_used",
      "EBSReadBytes",
    ]);

    expect(within(rows()[0]!).getByText("Never reported")).toBeInTheDocument();
    expect(
      within(rows()[1]!).getByText("Last reported 3 hours ago"),
    ).toBeInTheDocument();
    // Older than the look-back: not "never".
    expect(
      within(rows()[3]!).getByText("Not reported in the last 30 days"),
    ).toBeInTheDocument();
  });

  test("its likely reasons, most likely first, each with what fixes it", async () => {
    await renderList();

    await waitFor(() => {
      expect(rows()).toHaveLength(4);
    });

    expect(
      within(rows()[0]!).getByText(
        "Only a burstable instance or VM reports it.",
      ),
    ).toBeInTheDocument();
    expect(within(rows()[0]!).queryByRole("link")).toBeNull();

    // Each reason, then what fixes it beside it.
    const reasons: Array<Array<string>> = Array.from(
      rows()[1]!.querySelectorAll("ul > li"),
    ).map((item: Element): Array<string> => {
      return Array.from(item.children).map((child: Element): string => {
        return `${child.tagName.toLowerCase()}: ${child.textContent}`;
      });
    });
    expect(reasons).toEqual([
      [
        "span: Its cloud connection was refused when it last read the account: it may be missing a permission.",
        "a: Open Cloud > Connect",
      ],
      [
        "span: Its cloud reports it only when it is not zero, so no data means none happened.",
      ],
    ]);
    expect(
      within(rows()[1]!).getByRole("link", { name: "Open Cloud > Connect" }),
    ).toHaveAttribute("href", expect.stringContaining("/cloud/connect"));

    const agent: HTMLElement = within(rows()[2]!).getByRole("link", {
      name: "Install the Ops Agent",
    });
    expect(agent).toHaveAttribute("href", GCP_OPS_AGENT_INSTALL_URL);
    expect(agent).toHaveAttribute("target", "_blank");
    expect(agent).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(rows()[2]!).getByText(/Only the Ops Agent on the VM reports it\./),
    ).toBeInTheDocument();

    // No reason known: since when alone.
    expect(rows()[3]!.querySelector("ul")).toBeNull();
  });

  test("a key the server did not answer for is left out", async () => {
    mockExplain.mockImplementation(() => {
      return Promise.resolve(REPORTS.slice(0, 1));
    });
    await renderList();

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
  });

  test("a question that fails says why", async () => {
    mockExplain.mockImplementation(() => {
      return Promise.reject(
        new Error("You do not have permission to read this cloud resource."),
      );
    });
    await renderList();

    await waitFor(() => {
      expect(
        screen.getByText(
          "You do not have permission to read this cloud resource.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId(CLOUD_UNREPORTED_ROW_TEST_ID)).toHaveLength(
      0,
    );
  });
});
