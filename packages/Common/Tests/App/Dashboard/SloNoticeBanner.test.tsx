import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import SloNoticeBanner from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import Icon from "../../../UI/Components/Icon/Icon";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

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
 * The notice banner sits at the top of every SLO page and fetches its own
 * SLO. These render it against the SLO shapes that matter and assert what a
 * user actually sees: which states get a banner, how loud it is, where its
 * link goes — and that "window not yet full", which describes a number
 * rather than a problem, no longer takes over the top of the page.
 */

const SLO_ID: ObjectID = new ObjectID("33333333-0000-4000-8000-000000000001");
const OVERVIEW_PATH: string = `/dashboard/${PROJECT_ID}/slos/${SLO_ID.toString()}`;
const SETTINGS_PATH: string = `${OVERVIEW_PATH}/settings`;
const MONITORS_PATH: string = `${OVERVIEW_PATH}/monitors`;
const BANNER_TEST_ID: string = "slo-notice-banner";
const SECONDS_PER_DAY: number = 24 * 60 * 60;
const WAITING_TITLE: string = "Waiting for SLO evaluation";
const WAITING_BODY: string =
  "Monitors are attached. OneUptime evaluates this SLO every few minutes. Results will appear once monitor status data is available and the next evaluation completes.";

type SloFields = Record<string, unknown>;

function makeMonitor(id: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  return monitor;
}

const MEASURING: SloFields = {
  isArchived: false,
  isEnabled: true,
  sloStatus: SloStatus.Healthy,
  sliType: SliType.MonitorUptime,
  targetPercentage: 99.9,
  windowType: SloWindowType.Rolling,
  windowDays: 30,
  multiMonitorMode: SloMultiMonitorMode.AnyDown,
  errorBudgetTotalSeconds: 0.001 * 30 * SECONDS_PER_DAY,
  lastEvaluatedAt: new Date(),
  monitors: [makeMonitor("44444444-0000-4000-8000-000000000001")],
};

function makeSlo(fields: SloFields): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const writable: Record<string, unknown> = slo as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return slo;
}

function serveSlo(fields: SloFields): ReturnType<typeof jest.spyOn> {
  return jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(makeSlo({ ...MEASURING, ...fields }));
}

async function findBanner(): Promise<HTMLElement> {
  return await screen.findByTestId(BANNER_TEST_ID);
}

function iconMarkup(icon: IconProp): string {
  const { container, unmount } = render(<Icon icon={icon} />);
  const markup: string = container.querySelector("svg")?.innerHTML || "";
  unmount();
  return markup;
}

async function expectNoBanner(
  getItem: ReturnType<typeof jest.spyOn>,
): Promise<void> {
  await waitFor(() => {
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  // Let the resolved fetch commit before asserting that nothing rendered.
  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.queryByTestId(BANNER_TEST_ID)).toBeNull();
}

beforeEach(() => {
  goTo(OVERVIEW_PATH);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SloNoticeBanner", () => {
  test("asks for everything its notices depend on, including the archive flag", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = serveSlo({});

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await waitFor(() => {
      expect(getItem).toHaveBeenCalledTimes(1);
    });

    expect(getItem).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: ServiceLevelObjective,
        id: SLO_ID,
        select: expect.objectContaining({
          isArchived: true,
          isEnabled: true,
          sloStatus: true,
          sliType: true,
          targetPercentage: true,
          lastEvaluatedAt: true,
          monitors: { _id: true },
        }),
      }),
    );
  });

  test("says nothing about an SLO that is measuring normally", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = serveSlo({});

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await expectNoBanner(getItem);
  });

  /*
   * The full blue "Window not yet full" box read like an outage. A young
   * rolling SLO is healthy; the overview shows its window fill beside the
   * budget instead of a page-wide banner.
   */
  test("no longer raises a banner for a rolling window that is not yet full", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = serveSlo({
      errorBudgetTotalSeconds: 0.001 * 7 * SECONDS_PER_DAY,
    });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await expectNoBanner(getItem);
    expect(screen.queryByText("Window not yet full")).toBeNull();
  });

  test("renders nothing when the SLO cannot be read", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("network down"));

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await expectNoBanner(getItem);
  });

  test("tells the user an archived SLO is archived and links to Settings", async () => {
    serveSlo({ isArchived: true, isEnabled: false });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();

    expect(banner).toHaveAttribute("role", "status");
    expect(screen.getByText("This SLO is archived")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      SETTINGS_PATH,
    );
    expect(screen.queryByText("This SLO is disabled")).toBeNull();
  });

  test("does not link to Settings from the Settings page itself", async () => {
    goTo(SETTINGS_PATH);
    serveSlo({ isArchived: true });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await findBanner();

    expect(screen.getByText("This SLO is archived")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("explains a disabled SLO calmly and points at Settings", async () => {
    serveSlo({ isEnabled: false });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();

    expect(banner).toHaveAttribute("role", "status");
    expect(screen.getByText("This SLO is disabled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      SETTINGS_PATH,
    );
  });

  test("warns about a misconfigured SLO with no monitors and links to the Monitors page", async () => {
    serveSlo({ sloStatus: SloStatus.Misconfigured, monitors: [] });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();

    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveClass("bg-amber-50", "border-amber-200");
    expect(screen.getByText("No monitors attached")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Attach monitors" }),
    ).toHaveAttribute("href", MONITORS_PATH);
  });

  test("shows information when 16 monitors are attached but the stored evaluation status is still misconfigured", async () => {
    const infoIcon: string = iconMarkup(IconProp.Info);
    const warningIcon: string = iconMarkup(IconProp.Alert);
    serveSlo({
      sloStatus: SloStatus.Misconfigured,
      lastEvaluatedAt: new Date("2026-09-21T10:00:00Z"),
      monitors: Array.from({ length: 16 }, (_: unknown, index: number) => {
        return makeMonitor(
          `44444444-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        );
      }),
    });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();
    const icon: SVGElement | null = banner.querySelector("svg");

    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveClass("bg-white", "border-gray-200");
    expect(banner).not.toHaveClass("bg-amber-50", "border-amber-200");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(WAITING_TITLE)).toHaveClass("text-gray-900");
    expect(screen.getByText(WAITING_BODY)).toBeInTheDocument();
    expect(icon).toHaveClass("text-blue-600");
    expect(icon?.innerHTML).toBe(infoIcon);
    expect(icon?.innerHTML).not.toBe(warningIcon);
    expect(screen.getByRole("link", { name: "View monitors" })).toHaveAttribute(
      "href",
      MONITORS_PATH,
    );
    expect(screen.queryByText("This SLO cannot be evaluated")).toBeNull();
    expect(screen.queryByText("Review monitors")).toBeNull();
  });

  test.each([null, undefined])(
    "explains pending monitor data without a previous evaluation timestamp (%s)",
    async (lastEvaluatedAt: null | undefined) => {
      serveSlo({
        sloStatus: SloStatus.Misconfigured,
        lastEvaluatedAt: lastEvaluatedAt,
      });

      render(<SloNoticeBanner sloId={SLO_ID} />);

      const banner: HTMLElement = await findBanner();

      expect(banner).toHaveAttribute("role", "status");
      expect(screen.getByText(WAITING_TITLE)).toBeInTheDocument();
      expect(screen.getByText(WAITING_BODY)).toBeInTheDocument();
      expect(screen.queryByText("Not evaluated yet")).toBeNull();
      expect(screen.queryByText("This SLO cannot be evaluated")).toBeNull();
    },
  );

  test.each([null, undefined])(
    "uses the same informational state when the SLI type uses its default (%s)",
    async (sliType: null | undefined) => {
      serveSlo({ sloStatus: SloStatus.Misconfigured, sliType: sliType });

      render(<SloNoticeBanner sloId={SLO_ID} />);

      const banner: HTMLElement = await findBanner();

      expect(banner).toHaveAttribute("role", "status");
      expect(screen.getByText(WAITING_TITLE)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "View monitors" }),
      ).toHaveAttribute("href", MONITORS_PATH);
    },
  );

  test("keeps the evaluation information on the Monitors page without linking back to that page", async () => {
    goTo(MONITORS_PATH);
    serveSlo({ sloStatus: SloStatus.Misconfigured });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();

    expect(banner).toHaveAttribute("role", "status");
    expect(screen.getByText(WAITING_TITLE)).toBeInTheDocument();
    expect(screen.getByText(WAITING_BODY)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("still warns when attached monitors cannot make an unsupported SLI type evaluable", async () => {
    serveSlo({ sloStatus: SloStatus.Misconfigured, sliType: SliType.Metric });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();

    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveClass("bg-amber-50", "border-amber-200");
    expect(
      screen.getByText("This SLO cannot be evaluated"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only "Monitor Uptime" SLIs are supported/),
    ).toBeInTheDocument();
    expect(screen.queryByText(WAITING_TITLE)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test.each([0, 100, null])(
    "still warns about an invalid target (%s) even with monitors attached",
    async (targetPercentage: number | null) => {
      serveSlo({
        sloStatus: SloStatus.Misconfigured,
        targetPercentage: targetPercentage,
      });

      render(<SloNoticeBanner sloId={SLO_ID} />);

      const banner: HTMLElement = await findBanner();

      expect(banner).toHaveAttribute("role", "alert");
      expect(banner).toHaveClass("bg-amber-50", "border-amber-200");
      expect(
        screen.getByText("The target is out of range"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Edit objective" }),
      ).toHaveAttribute("href", SETTINGS_PATH);
      expect(screen.queryByText(WAITING_TITLE)).toBeNull();
    },
  );

  test("asks a brand-new SLO for monitors before its first evaluation", async () => {
    serveSlo({ sloStatus: null, lastEvaluatedAt: null, monitors: [] });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await findBanner();

    expect(screen.getByText("No monitors attached")).toBeInTheDocument();
  });

  test("explains a paused SLO and links to its monitors", async () => {
    serveSlo({ sloStatus: SloStatus.Paused });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    const banner: HTMLElement = await findBanner();

    expect(banner).toHaveAttribute("role", "status");
    expect(screen.getByText("Measurement is paused")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View monitors" })).toHaveAttribute(
      "href",
      MONITORS_PATH,
    );
  });

  test("does not link to the Monitors page from the Monitors page", async () => {
    goTo(MONITORS_PATH);
    serveSlo({ sloStatus: SloStatus.Paused });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await findBanner();

    expect(screen.queryByRole("link")).toBeNull();
  });

  test("says an SLO with monitors is simply waiting for its first evaluation, with no link", async () => {
    serveSlo({ sloStatus: null, lastEvaluatedAt: null });

    render(<SloNoticeBanner sloId={SLO_ID} />);

    await findBanner();

    expect(screen.getByText("Not evaluated yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("re-reads the SLO when its refresh toggle changes, so a fixed problem disappears", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValueOnce(makeSlo({ ...MEASURING, isEnabled: false }))
      .mockResolvedValueOnce(makeSlo(MEASURING));

    const { rerender } = render(
      <SloNoticeBanner sloId={SLO_ID} refreshToggle="0" />,
    );

    await findBanner();
    expect(screen.getByText("This SLO is disabled")).toBeInTheDocument();

    rerender(<SloNoticeBanner sloId={SLO_ID} refreshToggle="1" />);

    await waitFor(() => {
      expect(screen.queryByTestId(BANNER_TEST_ID)).toBeNull();
    });
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  test("changes from a missing-monitor warning to evaluation information after attaching monitors, then disappears after a healthy evaluation", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValueOnce(
        makeSlo({
          ...MEASURING,
          sloStatus: SloStatus.Misconfigured,
          monitors: [],
        }),
      )
      .mockResolvedValueOnce(
        makeSlo({ ...MEASURING, sloStatus: SloStatus.Misconfigured }),
      )
      .mockResolvedValueOnce(makeSlo(MEASURING));

    const { rerender } = render(
      <SloNoticeBanner sloId={SLO_ID} refreshToggle="0" />,
    );

    expect(await findBanner()).toHaveAttribute("role", "alert");
    expect(screen.getByText("No monitors attached")).toBeInTheDocument();

    rerender(<SloNoticeBanner sloId={SLO_ID} refreshToggle="1" />);

    expect(await screen.findByText(WAITING_TITLE)).toBeInTheDocument();
    expect(screen.getByTestId(BANNER_TEST_ID)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByText("No monitors attached")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "View monitors" })).toHaveAttribute(
      "href",
      MONITORS_PATH,
    );

    rerender(<SloNoticeBanner sloId={SLO_ID} refreshToggle="2" />);

    await waitFor(() => {
      expect(screen.queryByTestId(BANNER_TEST_ID)).toBeNull();
    });
    expect(getItem).toHaveBeenCalledTimes(3);
  });
});
