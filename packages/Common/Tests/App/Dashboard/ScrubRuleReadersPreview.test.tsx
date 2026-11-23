import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import ScrubRuleReadersApi from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/FieldReaders/ScrubRuleReadersApi";
import ScrubRuleAddressesApi from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/HashInstead/ScrubRuleAddressesApi";
import ScrubRuleValueCountsApi from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleCounts/ScrubRuleValueCountsApi";
import ScrubRuleReadersPreview, {
  getScrubRuleReadersRequest,
  readRuleServiceId,
  SCRUB_RULE_READERS_UNCHECKED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/FieldReaders/ScrubRuleReadersPreview";
import LogScrubRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/ScrubRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TraceScrubRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/ScrubRules";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import Service from "../../../Models/DatabaseModels/Service";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import ObjectID from "../../../Types/ObjectID";
import {
  getEmptyTelemetryFieldReadersByKind,
  ScrubRuleReadersRequest,
  TelemetryFieldPart,
  TelemetryFieldReaderKind,
  TelemetryFieldReaders,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import { RowActionConfirmation } from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Column from "../../../UI/Components/ModelTable/Column";
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
 * WHAT A SCRUB RULE BEING WRITTEN, OR TURNED ON, WOULD TAKE AWAY (#10433).
 *
 * The log and trace scrub rule forms say under the rule's name what reads
 * the values it would hide - monitors, dashboards, saved views, recording
 * rules, SLOs, Security Events - and a rule's Enable asks with the same
 * list (ScrubRuleReadersPreview, from the server's lookup). The rules list
 * says whose records each rule scrubs: one service's, or every one's.
 */

let mockTableProps: ModelTableProps<LogScrubRule> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<LogScrubRule>): React.ReactElement => {
      mockTableProps = props;

      return <section data-testid={props.id} />;
    },
  };
});

const SERVICE_ID: string = "6b6b6b6b-0000-4000-8000-0000000000b2";
const MONITOR_ID: string = "7c7c7c7c-0000-4000-8000-0000000000c3";

function monitorReads(): TelemetryFieldReaders {
  const readers: TelemetryFieldReaders = {
    kinds: getEmptyTelemetryFieldReadersByKind(true),
    securityEvents: { isChecked: true, sources: [], loses: [] },
  };

  readers.kinds[TelemetryFieldReaderKind.Monitor].readers = [
    {
      id: MONITOR_ID,
      name: "Sign-ups by email",
      reads: [
        {
          part: TelemetryFieldPart.Attributes,
          key: "user.email",
          use: TelemetryFieldUse.Filter,
        },
      ],
    },
  ];

  return readers;
}

let readersSpy: SpyInstance<typeof ScrubRuleReadersApi.getReaders>;

// A field of a rules page's form, as the test reads it.
interface FormFieldOfPage {
  field?: Record<string, unknown> | undefined;
  getFooterElement?:
    | ((values: Record<string, unknown>) => ReactElement | undefined)
    | undefined;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/logs/settings/scrub-rules`);
  mockTableProps = null;
  readersSpy = jest
    .spyOn(ScrubRuleReadersApi, "getReaders")
    .mockResolvedValue(monitorReads());
  /*
   * What the rules pages read beside their rules: the IP Address rules
   * hiding addresses from Security Events (#10396), and what each rule
   * changed (#10366). None, and nothing counted.
   */
  jest
    .spyOn(ScrubRuleAddressesApi, "getRulesHidingAddresses")
    .mockResolvedValue({ isChecked: true, signalsRead: [], rules: [] });
  jest.spyOn(ScrubRuleValueCountsApi, "getCounts").mockResolvedValue({
    since: new Date().toISOString(),
    days: 7,
    isChecked: true,
    rules: [],
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the question asked of the server", () => {
  test("none until a pattern type is picked, or while a custom pattern cannot run", () => {
    expect(getScrubRuleReadersRequest("log", {})).toBeNull();
    expect(
      getScrubRuleReadersRequest("log", {
        patternType: "custom",
        customRegex: "",
      }),
    ).toBeNull();
    expect(
      getScrubRuleReadersRequest("trace", {
        patternType: "custom",
        customRegex: "(",
      }),
    ).toBeNull();
    // A pattern that matches empty text scrubs nothing: nothing to ask.
    expect(
      getScrubRuleReadersRequest("log", {
        patternType: "custom",
        customRegex: "a*",
      }),
    ).toBeNull();
  });

  test("the rule as the form holds it: picks as plain values, the service by its id", () => {
    expect(
      getScrubRuleReadersRequest("log", {
        patternType: { label: "Email Address", value: "email" },
        scrubAction: { label: "Hash", value: "hash" },
        fieldsToScrub: "body",
        service: { label: "checkout", value: SERVICE_ID },
      }),
    ).toEqual({
      signal: "log",
      patternType: "email",
      scrubAction: "hash",
      fieldsToScrub: "body",
      serviceId: SERVICE_ID,
    } as ScrubRuleReadersRequest);
    // A custom pattern goes with it; a built-in one needs none.
    expect(
      getScrubRuleReadersRequest("trace", {
        patternType: "custom",
        customRegex: "SECRET-[0-9]+",
        customRegexIgnored: "x",
      } as never),
    ).toEqual({
      signal: "trace",
      patternType: "custom",
      customRegex: "SECRET-[0-9]+",
    });
    expect(
      getScrubRuleReadersRequest("log", {
        patternType: "email",
        customRegex: "left over",
      }),
    ).toEqual({ signal: "log", patternType: "email" });
  });

  test("a saved rule, as a row holds it", () => {
    const rule: LogScrubRule = new LogScrubRule();

    rule.patternType = "ipAddress" as never;
    rule.scrubAction = "redact" as never;
    rule.fieldsToScrub = "attributes" as never;
    rule.serviceId = new ObjectID(SERVICE_ID);

    expect(getScrubRuleReadersRequest("log", rule)).toEqual({
      signal: "log",
      patternType: "ipAddress",
      scrubAction: "redact",
      fieldsToScrub: "attributes",
      serviceId: SERVICE_ID,
    });
  });

  test("the service however it is held - an id, an ObjectID, a loaded service, a pick - and none for every service", () => {
    const service: Service = new Service();

    service._id = SERVICE_ID;

    expect(readRuleServiceId({ service: SERVICE_ID })).toBe(SERVICE_ID);
    expect(readRuleServiceId({ serviceId: new ObjectID(SERVICE_ID) })).toBe(
      SERVICE_ID,
    );
    expect(readRuleServiceId({ service: service })).toBe(SERVICE_ID);
    expect(readRuleServiceId({ service: { _id: SERVICE_ID } })).toBe(
      SERVICE_ID,
    );
    expect(
      readRuleServiceId({ service: { label: "checkout", value: SERVICE_ID } }),
    ).toBe(SERVICE_ID);
    for (const none of [undefined, null, "", "checkout", { name: "x" }]) {
      expect(readRuleServiceId({ service: none })).toBe("");
    }
  });
});

describe("what it says", () => {
  test("asks once the values settle, and lists what reads them", async () => {
    render(
      <MemoryRouter>
        <ScrubRuleReadersPreview
          signal="log"
          rule={{ patternType: "email", service: SERVICE_ID }}
        />
      </MemoryRouter>,
    );

    // Not on every keystroke: after a moment.
    expect(readersSpy).not.toHaveBeenCalled();

    expect(
      await screen.findByTestId("telemetry-field-readers-Monitor", undefined, {
        timeout: 3000,
      }),
    ).toHaveTextContent("Sign-ups by email");
    expect(readersSpy).toHaveBeenCalledTimes(1);
    expect(readersSpy).toHaveBeenCalledWith({
      signal: "log",
      patternType: "email",
      serviceId: SERVICE_ID,
    });
  });

  test("values that change before it asks are asked once, as they end up", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ScrubRuleReadersPreview
          signal="trace"
          rule={{ patternType: "email" }}
        />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter>
        <ScrubRuleReadersPreview
          signal="trace"
          rule={{ patternType: "phoneNumber" }}
        />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(readersSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    expect(readersSpy).toHaveBeenCalledWith({
      signal: "trace",
      patternType: "phoneNumber",
    });
  });

  test("nothing that reads them: it says nothing", async () => {
    readersSpy.mockResolvedValue({
      kinds: getEmptyTelemetryFieldReadersByKind(true),
      securityEvents: { isChecked: true, sources: [], loses: [] },
    });
    render(
      <MemoryRouter>
        <ScrubRuleReadersPreview signal="log" rule={{ patternType: "email" }} />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(readersSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    expect(
      screen.queryByTestId("telemetry-field-readers"),
    ).not.toBeInTheDocument();
  });

  test("a lookup that fails says it could not be checked, never that nothing reads them", async () => {
    readersSpy.mockRejectedValue(new Error("Something went wrong."));
    render(
      <MemoryRouter>
        <ScrubRuleReadersPreview signal="log" rule={{ patternType: "email" }} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(SCRUB_RULE_READERS_UNCHECKED, undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
  });

  test("a rule that cannot run asks nothing", async () => {
    render(
      <MemoryRouter>
        <ScrubRuleReadersPreview
          signal="log"
          rule={{ patternType: "custom", customRegex: "(" }}
        />
      </MemoryRouter>,
    );

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 600);
    });
    expect(readersSpy).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    name: "Logs",
    page: LogScrubRules,
    signal: "log",
    model: LogScrubRule,
    itemName: "Log Scrub Rule",
  },
  {
    name: "Traces",
    page: TraceScrubRules,
    signal: "trace",
    model: TraceScrubRule,
    itemName: "Trace Scrub Rule",
  },
] as Array<{
  name: string;
  page: React.FunctionComponent<PageComponentProps>;
  signal: "log" | "trace";
  model: { new (): LogScrubRule };
  itemName: string;
}>)(
  "$name > Settings > Scrub Rules",
  ({
    page,
    signal,
    model,
    itemName,
  }: {
    page: React.FunctionComponent<PageComponentProps>;
    signal: "log" | "trace";
    model: { new (): LogScrubRule };
    itemName: string;
  }) => {
    function renderPage(): ModelTableProps<LogScrubRule> {
      render(
        <MemoryRouter>
          {React.createElement(page, {} as PageComponentProps)}
        </MemoryRouter>,
      );

      return mockTableProps!;
    }

    function scopeColumn(
      props: ModelTableProps<LogScrubRule>,
    ): Column<LogScrubRule> {
      return props.columns.find((column: Column<LogScrubRule>): boolean => {
        return column.title === "Scope";
      })!;
    }

    test("says whose records each rule scrubs: one service's, or every one's", () => {
      const props: ModelTableProps<LogScrubRule> = renderPage();
      const column: Column<LogScrubRule> = scopeColumn(props);
      const scoped: LogScrubRule = new model();
      const service: Service = new Service();

      service.name = "checkout";
      scoped.service = service;

      expect(column.field).toEqual({ service: { name: true } });

      render(<>{column.getElement!(scoped)}</>);
      expect(screen.getByText("checkout")).toBeInTheDocument();
      expect(screen.getByText("Service:")).toBeInTheDocument();
      cleanup();

      render(<>{column.getElement!(new model())}</>);
      expect(screen.getByText("Project-wide")).toBeInTheDocument();
    });

    test("reads the whole rule, whichever columns are shown, for Enable's question", () => {
      expect(renderPage().selectMoreFields).toMatchObject({
        customRegex: true,
        patternType: true,
        scrubAction: true,
        fieldsToScrub: true,
        serviceId: true,
      });
    });

    test("Enable asks, saying what reads the values the rule would hide; Disable does not", () => {
      const props: ModelTableProps<LogScrubRule> = renderPage();
      const rule: LogScrubRule = new model();

      rule.patternType = "email" as never;
      rule.serviceId = new ObjectID(SERVICE_ID);

      expect(props.rowSwitch?.column).toBe("isEnabled");

      const confirmation: RowActionConfirmation | undefined = props.rowSwitch!
        .getRowConfirmation!({
        value: true,
        item: rule,
        name: "Scrub emails",
      });

      expect(confirmation).toMatchObject({
        title: `Enable ${itemName}`,
        submitButtonText: "Enable",
        submitButtonType: ButtonStyleType.PRIMARY,
      });

      const details: ReactElement = confirmation!.details!;

      expect(details.type).toBe(ScrubRuleReadersPreview);
      expect(details.props).toMatchObject({ signal, rule });
      expect(
        props.rowSwitch!.getRowConfirmation!({
          value: false,
          item: rule,
          name: "Scrub emails",
        }),
      ).toBeUndefined();
    });

    test("its form asks for the one service, and says under the name what reads the values", () => {
      const props: ModelTableProps<LogScrubRule> = renderPage();
      const fields: Array<FormFieldOfPage> = (props.formFields || []) as never;
      const keys: Array<string> = fields.map(
        (field: FormFieldOfPage): string => {
          return Object.keys(field.field || {})[0] as string;
        },
      );

      expect(keys).toContain("service");

      const name: FormFieldOfPage = fields.find(
        (field: FormFieldOfPage): boolean => {
          return Object.keys(field.field || {})[0] === "name";
        },
      )!;
      const values: Record<string, unknown> = {
        patternType: "email",
        service: SERVICE_ID,
      };
      const footer: ReactElement = name.getFooterElement!(values)!;

      expect(footer.type).toBe(ScrubRuleReadersPreview);
      expect(footer.props).toMatchObject({ signal, rule: values });
    });
  },
);
