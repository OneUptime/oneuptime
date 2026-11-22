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
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import DropFilterImpactApi, {
  getDropFilterImpactRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/DropFilterImpact/DropFilterImpactApi";
import DropFilterImpactPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/DropFilterImpact/DropFilterImpactPreview";
import DropFilterImpactSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/DropFilterImpact/DropFilterImpactSummary";
import useDropFilterImpactConfirmation, {
  DropFilterImpactConfirmation,
  DropFilterSavePurpose,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/DropFilterImpact/useDropFilterImpactConfirmation";
import LogDropFilters from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/DropFilters";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TraceDropFilters from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/DropFilters";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import {
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterRecordCountState,
  getEmptyDropFilterImpact,
} from "../../../Types/Telemetry/DropFilterImpact";
import {
  getEmptyTelemetryFieldReadersByKind,
  SecurityEventsTelemetrySource,
  TelemetryFieldPart,
  TelemetryFieldReaderKind,
  TelemetryFieldSignal,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import ActionButtonSchema, {
  RowActionConfirmation,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import FormSubmitCancelled from "../../../UI/Components/Forms/Types/FormSubmitCancelled";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import type { SpyInstance } from "jest-mock";

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
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE, AS ITS FORM SAYS IT (#10436).
 *
 * One line for the most important effect - Security Events, then the
 * monitors, SLOs and dashboards that read the same records, then how many
 * it matches with nothing reading them - with the details folded under it;
 * the form asks the server a moment after it stops changing; a save asks
 * once more when something reads what the filter takes, and never
 * otherwise; and a row's Enable says it too.
 */

let mockTableProps: ModelTableProps<LogDropFilter> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<LogDropFilter>): React.ReactElement => {
      mockTableProps = props;

      return <section data-testid={props.id} />;
    },
  };
});

const MONITOR_ID: string = "7c7c7c7c-0000-4000-8000-0000000104a1";

function impactOf(
  change: (impact: DropFilterImpact) => void = (): void => {},
  signal: TelemetryFieldSignal = "log",
): DropFilterImpact {
  const impact: DropFilterImpact = getEmptyDropFilterImpact({
    signal,
    action: DropFilterImpactAction.Drop,
    keepPercentage: 0,
    timeLimitInSeconds: 10,
  });

  impact.count = {
    ...impact.count,
    state: DropFilterRecordCountState.Counted,
    total: 1203442,
    matched: 45300,
    securityEventsRead: null,
  };
  impact.readers = getEmptyTelemetryFieldReadersByKind(true);
  impact.securityEvents.isChecked = true;
  change(impact);

  return impact;
}

function securityEventsRead(): DropFilterImpact {
  return impactOf((impact: DropFilterImpact) => {
    impact.count.securityEventsRead = 1240;
    impact.securityEvents.sources = [SecurityEventsTelemetrySource.Logs];
    impact.readers[TelemetryFieldReaderKind.Monitor].readers = [
      {
        id: MONITOR_ID,
        name: "Checkout errors",
        reads: [
          {
            part: TelemetryFieldPart.Attributes,
            key: "http.route",
            use: TelemetryFieldUse.Filter,
          },
        ],
      },
    ];
    impact.readers[TelemetryFieldReaderKind.Monitor].hiddenCount = 1;
  });
}

function drawn(impact: DropFilterImpact, isDetailsOpen?: boolean): void {
  render(
    <MemoryRouter>
      <DropFilterImpactSummary impact={impact} isDetailsOpen={isDetailsOpen} />
    </MemoryRouter>,
  );
}

let impactSpy: SpyInstance<typeof DropFilterImpactApi.getImpact>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/logs/settings/drop-filters`);
  mockTableProps = null;
  DropFilterImpactApi.forgetAnswers();
  impactSpy = jest
    .spyOn(DropFilterImpactApi, "getImpact")
    .mockResolvedValue(securityEventsRead());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the question asked of the server", () => {
  test("none until there is a query, nor for a sample with no share to keep", () => {
    expect(getDropFilterImpactRequest("log", {})).toBeNull();
    expect(getDropFilterImpactRequest("log", { filterQuery: "  " })).toBeNull();
    expect(
      getDropFilterImpactRequest("log", {
        filterQuery: "severityText = 'Debug'",
        action: "sample",
      }),
    ).toBeNull();
    expect(
      getDropFilterImpactRequest("log", {
        filterQuery: "severityText = 'Debug'",
        action: "sample",
        samplePercentage: 100,
      }),
    ).toBeNull();
  });

  test("the filter as the form holds it: picks as plain values, the share as a number", () => {
    expect(
      getDropFilterImpactRequest("trace", {
        filterQuery: "name LIKE 'healthcheck'",
        action: { label: "Sample", value: "sample" },
        samplePercentage: "10",
        name: " Health checks ",
      }),
    ).toEqual({
      signal: "trace",
      filterQuery: "name LIKE 'healthcheck'",
      action: DropFilterImpactAction.Sample,
      samplePercentage: 10,
      name: "Health checks",
    });
    expect(
      getDropFilterImpactRequest("log", {
        filterQuery: "severityText = 'Debug'",
        samplePercentage: 10,
      }),
    ).toEqual({
      signal: "log",
      filterQuery: "severityText = 'Debug'",
      action: DropFilterImpactAction.Drop,
    });
  });
});

describe("the one line", () => {
  test("Security Events first, in amber, with the details folded", () => {
    drawn(securityEventsRead());

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "Security Events read 1,240 logs in the last day that this filter would drop.",
    );
    expect(screen.getByTestId("drop-filter-impact")).toHaveClass("bg-amber-50");
    expect(
      screen.queryByTestId("drop-filter-impact-details"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("drop-filter-impact-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("then the monitors that read what it takes", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.readers[TelemetryFieldReaderKind.Monitor].hiddenCount = 2;
        impact.readers[TelemetryFieldReaderKind.Dashboard].hiddenCount = 4;
      }),
    );

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "2 monitors read what this filter would drop.",
    );
  });

  test("a sample says so", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.action = DropFilterImpactAction.Sample;
        impact.keepPercentage = 10;
        impact.readers[
          TelemetryFieldReaderKind.ServiceLevelObjective
        ].hiddenCount = 1;
      }, "trace"),
    );

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "1 SLO reads what this filter would sample.",
    );
  });

  test("nothing reads them: plain, how many it matches, and that nothing else reads them", () => {
    drawn(impactOf());

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "45,300 logs matched this filter in the last day, and nothing else in this project reads them.",
    );
    expect(screen.getByTestId("drop-filter-impact")).toHaveClass("bg-gray-50");
  });

  test("never says nothing reads them when a kind could not be checked", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.readers[TelemetryFieldReaderKind.Dashboard].isChecked = false;
      }),
      true,
    );

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "45,300 logs matched this filter in the last day.",
    );
    expect(
      screen.getByTestId("telemetry-field-readers-Dashboard-unchecked"),
    ).toHaveTextContent(
      "Whether a dashboard reads what this filter would take could not be checked.",
    );
  });

  test("a count that timed out says so, and how long it was given", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.count.state = DropFilterRecordCountState.TimedOut;
      }),
    );

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "Counting the logs this filter matches took longer than 10 seconds, so it was stopped.",
    );
  });

  test("a query that cannot be read takes nothing, and has no details", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.isQueryReadable = false;
      }),
    );

    expect(screen.getByTestId("drop-filter-impact-line")).toHaveTextContent(
      "This query can't be read, so the filter would take nothing.",
    );
    expect(
      screen.queryByTestId("drop-filter-impact-toggle"),
    ).not.toBeInTheDocument();
  });
});

describe("the details", () => {
  test("how many of the day's records it matches, what Security Events loses, and every reader, the hidden ones counted", () => {
    drawn(securityEventsRead());

    fireEvent.click(screen.getByTestId("drop-filter-impact-toggle"));

    expect(screen.getByTestId("drop-filter-impact-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("drop-filter-impact-count")).toHaveTextContent(
      "45,300 of the 1,203,442 logs stored in the last day match this filter (3.8%).",
    );
    expect(
      screen.getByTestId("drop-filter-impact-security-events-loses"),
    ).toHaveTextContent(
      "It finds sign-ins, attacks and firewall records in these logs. Dropped, they raise no events.",
    );
    expect(
      screen.getByTestId("telemetry-field-readers-heading"),
    ).toHaveTextContent("These read what this filter would drop:");
    expect(
      screen.getByTestId("telemetry-field-readers-Monitor"),
    ).toHaveTextContent("Checkout errors");
    expect(
      screen.getByTestId("telemetry-field-readers-Monitor"),
    ).toHaveTextContent(
      "They get none of what this filter drops: a monitor can go quiet and stay green.",
    );
    expect(
      screen.getByTestId("telemetry-field-readers-Monitor-hidden"),
    ).toHaveTextContent("and 1 more you can't see");
  });

  test("a sample names the rules that fire at a count, and about how many each then needs", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.action = DropFilterImpactAction.Sample;
        impact.keepPercentage = 10;
        impact.count.securityEventsRead = 300;
        impact.securityEvents.sources = [SecurityEventsTelemetrySource.Logs];
        impact.securityEvents.thresholdRules = {
          rules: [
            {
              id: "rule-1",
              name: "Brute force from one IP address",
              threshold: 10,
              windowInMinutes: 5,
              neededWhenSampled: 100,
              countsDistinct: false,
            },
          ],
          hiddenCount: 2,
          isChecked: true,
        };
      }),
      true,
    );

    expect(
      screen.getByTestId("drop-filter-impact-threshold-rule"),
    ).toHaveTextContent("Brute force from one IP address");
    expect(
      screen.getByTestId("drop-filter-impact-threshold-rule"),
    ).toHaveTextContent(
      "Fires at 10 in 5 minutes. Kept at 10%, it needs about 100.",
    );
    expect(
      screen.getByTestId("drop-filter-impact-threshold-rules-hidden"),
    ).toHaveTextContent("and 2 more you can't see");
    expect(
      screen.getByTestId("drop-filter-impact-security-events-loses"),
    ).toHaveTextContent("Kept at 10%, it sees about 10% of them.");
  });

  test("one of OneUptime's own OpenStack filters says it keeps what Security Events reads", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.count.securityEventsRead = 7;
        impact.securityEvents.sources = [SecurityEventsTelemetrySource.Logs];
        impact.securityEvents.keepsWhatSecurityEventsReads = true;
      }),
      true,
    );

    expect(
      screen.getByTestId("drop-filter-impact-security-events-kept"),
    ).toHaveTextContent(
      "This is one of OneUptime's own OpenStack filters, which keep every line Security Events reads.",
    );
  });

  test("a span filter says Your logs reads a request's span for its address", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.securityEvents.sources = [SecurityEventsTelemetrySource.Logs];
      }, "trace"),
      true,
    );

    expect(
      screen.getByTestId("drop-filter-impact-security-events-spans"),
    ).toBeInTheDocument();
  });

  test("a count of only the services the person can read says so", () => {
    drawn(
      impactOf((impact: DropFilterImpact) => {
        impact.count.isScoped = true;
      }),
      true,
    );

    expect(
      screen.getByTestId("drop-filter-impact-count-scoped"),
    ).toHaveTextContent("Counted over the services whose logs you can read.");
  });
});

describe("as the filter is written", () => {
  test("asks a moment after it stops changing, once, and says what it would take", async () => {
    render(
      <MemoryRouter>
        <DropFilterImpactPreview
          signal="log"
          rule={{ filterQuery: "attributes.process.name = 'sshd'" }}
        />
      </MemoryRouter>,
    );

    expect(impactSpy).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("drop-filter-impact-preview-loading"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("drop-filter-impact-line", undefined, {
        timeout: 3000,
      }),
    ).toHaveTextContent("Security Events read 1,240 logs");
    expect(impactSpy).toHaveBeenCalledTimes(1);
  });

  test("a question it could not ask says it could not check, and blocks nothing", async () => {
    impactSpy.mockRejectedValue(new Error("The server did not answer."));

    render(
      <MemoryRouter>
        <DropFilterImpactPreview
          signal="log"
          rule={{ filterQuery: "severityText = 'Debug'" }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId(
        "drop-filter-impact-preview-unchecked",
        undefined,
        { timeout: 3000 },
      ),
    ).toHaveTextContent("What this filter would take could not be checked.");
  });

  test("with no query yet, it draws nothing and asks nothing", async () => {
    render(
      <MemoryRouter>
        <DropFilterImpactPreview signal="log" rule={{ filterQuery: "" }} />
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 700);
      });
    });

    expect(impactSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("drop-filter-impact-preview"),
    ).not.toBeInTheDocument();
  });
});

// A form's save, as a page asks it.
function SaveHarness(props: {
  onReady: (confirmation: DropFilterImpactConfirmation) => void;
}): ReactElement {
  const confirmation: DropFilterImpactConfirmation =
    useDropFilterImpactConfirmation();

  useEffect(() => {
    props.onReady(confirmation);
  });

  return <MemoryRouter>{confirmation.confirmation}</MemoryRouter>;
}

function harness(): () => DropFilterImpactConfirmation {
  let latest: DropFilterImpactConfirmation | null = null;

  render(
    <SaveHarness
      onReady={(confirmation: DropFilterImpactConfirmation) => {
        latest = confirmation;
      }}
    />,
  );

  return (): DropFilterImpactConfirmation => {
    return latest!;
  };
}

describe("before a filter is saved", () => {
  test("a filter that nothing reads saves without a prompt", async () => {
    impactSpy.mockResolvedValue(impactOf());

    const confirmation: () => DropFilterImpactConfirmation = harness();
    let answer: boolean | undefined;

    await act(async () => {
      answer = await confirmation().confirm({
        signal: "log",
        rule: { filterQuery: "severityText = 'Debug'" },
        purpose: DropFilterSavePurpose.Create,
      });
    });

    expect(answer).toBe(true);
    expect(
      screen.queryByTestId("drop-filter-impact-confirmation"),
    ).not.toBeInTheDocument();
  });

  test("one that takes what others read asks once more, with every detail open, and goes on when confirmed", async () => {
    const confirmation: () => DropFilterImpactConfirmation = harness();
    let pending: Promise<boolean> | undefined;

    await act(async () => {
      pending = confirmation().confirm({
        signal: "log",
        rule: { filterQuery: "attributes.process.name = 'sshd'" },
        purpose: DropFilterSavePurpose.Create,
      });
    });

    expect(await screen.findByText("Create This Filter?")).toBeInTheDocument();
    expect(
      screen.getByTestId("drop-filter-impact-confirmation-summary-details"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create Filter"));

    await expect(pending).resolves.toBe(true);
    await waitFor(() => {
      expect(screen.queryByText("Create This Filter?")).not.toBeInTheDocument();
    });
  });

  test("a no calls the save back quietly", async () => {
    const confirmation: () => DropFilterImpactConfirmation = harness();
    let pending: Promise<void> | undefined;

    await act(async () => {
      pending = confirmation().confirmOrCancel({
        signal: "log",
        rule: { filterQuery: "attributes.process.name = 'sshd'" },
        purpose: DropFilterSavePurpose.Save,
      });
    });

    expect(await screen.findByText("Save This Filter?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    let thrown: unknown;

    try {
      await pending;
    } catch (error) {
      thrown = error;
    }

    expect(FormSubmitCancelled.isCancelled(thrown)).toBe(true);
  });

  test("an answer it could not get never stands in the way", async () => {
    impactSpy.mockRejectedValue(new Error("The server did not answer."));

    const confirmation: () => DropFilterImpactConfirmation = harness();
    let answer: boolean | undefined;

    await act(async () => {
      answer = await confirmation().confirm({
        signal: "log",
        rule: { filterQuery: "attributes.process.name = 'sshd'" },
        purpose: DropFilterSavePurpose.Create,
      });
    });

    expect(answer).toBe(true);
  });
});

describe.each([
  {
    page: LogDropFilters,
    signal: "log" as TelemetryFieldSignal,
    model: LogDropFilter,
  },
  {
    page: TraceDropFilters,
    signal: "trace" as TelemetryFieldSignal,
    model: TraceDropFilter as unknown as typeof LogDropFilter,
  },
])(
  "$model.name's list",
  ({
    page,
    signal,
    model,
  }: {
    page: React.FunctionComponent<PageComponentProps>;
    signal: TelemetryFieldSignal;
    model: typeof LogDropFilter;
  }) => {
    function renderPage(): ModelTableProps<LogDropFilter> {
      render(
        <MemoryRouter>
          {React.createElement(page, {} as PageComponentProps)}
        </MemoryRouter>,
      );

      return mockTableProps!;
    }

    test("its form says what the filter would take, under the query and under the action", () => {
      const props: ModelTableProps<LogDropFilter> = renderPage();
      const fields: Array<{
        field?: Record<string, unknown>;
        getFooterElement?: (
          values: Record<string, unknown>,
        ) => ReactElement | undefined;
      }> = (props.formFields || []) as never;
      const footerOf: (name: string) => unknown = (name: string): unknown => {
        return fields.find((field: { field?: Record<string, unknown> }) => {
          return Boolean(field.field?.[name]);
        })?.getFooterElement;
      };

      expect(footerOf("filterQuery")).toBeDefined();
      expect(footerOf("action")).toBeDefined();
      expect(footerOf("samplePercentage")).toBeDefined();
      // A sample's line is under its percentage, not doubled under the action.
      expect(
        (
          footerOf("action") as (
            values: Record<string, unknown>,
          ) => ReactElement | undefined
        )({ filterQuery: "x = 'y'", action: "sample" }),
      ).toBeUndefined();
    });

    test("its create asks when something reads what the filter takes, and a no calls it back", async () => {
      const props: ModelTableProps<LogDropFilter> = renderPage();
      const item: LogDropFilter = new model();

      item.filterQuery = "attributes.process.name = 'sshd'";

      let pending: Promise<LogDropFilter> | undefined;

      await act(async () => {
        pending = props.onBeforeCreate!(
          item,
          {},
          {} as never,
        ) as Promise<LogDropFilter>;
      });

      expect(
        await screen.findByText("Create This Filter?"),
      ).toBeInTheDocument();
      expect(impactSpy.mock.calls[0]![0].signal).toBe(signal);

      fireEvent.click(screen.getByText("Cancel"));

      let thrown: unknown;

      try {
        await pending;
      } catch (error) {
        thrown = error;
      }

      expect(FormSubmitCancelled.isCancelled(thrown)).toBe(true);
    });

    test("its create of a filter nothing reads goes straight on, Drop picked when none was", async () => {
      impactSpy.mockResolvedValue(impactOf(() => {}, signal));

      const props: ModelTableProps<LogDropFilter> = renderPage();
      const item: LogDropFilter = new model();

      item.filterQuery = "severityText = 'Debug'";

      let created: LogDropFilter | undefined;

      await act(async () => {
        created = (await props.onBeforeCreate!(
          item,
          {},
          {} as never,
        )) as LogDropFilter;
      });

      expect(created!.action).toBe("drop");
      expect(screen.queryByText("Create This Filter?")).not.toBeInTheDocument();
    });

    test("its row's Enable says what the filter would take; Disable says what it always said", () => {
      const props: ModelTableProps<LogDropFilter> = renderPage();
      const enable: ActionButtonSchema<LogDropFilter> | undefined = (
        props.actionButtons || []
      ).find((button: ActionButtonSchema<LogDropFilter>) => {
        return button.title === "Enable";
      });
      const disable: ActionButtonSchema<LogDropFilter> | undefined = (
        props.actionButtons || []
      ).find((button: ActionButtonSchema<LogDropFilter>) => {
        return button.title === "Disable";
      });
      const item: LogDropFilter = new model();

      item.name = "Debug lines";
      item.filterQuery = "severityText = 'Debug'";
      item.isEnabled = false;

      const asked: RowActionConfirmation | undefined =
        enable!.getConfirmation!(item);

      expect(asked!.submitButtonText).toBe("Enable");

      render(<MemoryRouter>{asked!.details}</MemoryRouter>);
      expect(
        screen.getByTestId("drop-filter-enable-impact-loading"),
      ).toBeInTheDocument();

      item.isEnabled = true;

      const disabling: RowActionConfirmation | undefined =
        disable!.getConfirmation!(item);

      render(<>{disabling!.details}</>);
      expect(screen.getByTestId("row-switch-consequence")).toHaveTextContent(
        signal === "log"
          ? "A disabled drop filter keeps the logs it would drop, until it is enabled again."
          : "A disabled drop filter keeps the spans it would drop, until it is enabled again.",
      );
    });

    test("its list reads each filter whole, for what Enable says", () => {
      const props: ModelTableProps<LogDropFilter> = renderPage();

      expect(props.selectMoreFields).toEqual(
        expect.objectContaining({
          filterQuery: true,
          action: true,
          samplePercentage: true,
          isEnabled: true,
        }),
      );
    });
  },
);
