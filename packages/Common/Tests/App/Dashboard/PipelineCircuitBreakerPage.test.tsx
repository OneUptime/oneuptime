import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A PIPELINE'S CIRCUIT BREAKER PAGE (#6548).
 *
 * It opens on how the breaker stands: stopped since when and why - each
 * failing check and late table opening its table - said go, or never
 * asked. Test Now asks it as a dry run, and says what it would answer.
 * Whether a late table stops the pipeline is one switch, saved as it is
 * flipped; and the step to add to the pipeline names this pipeline as the
 * breaker finds it, for a shell, Airflow and dbt. The API is mocked.
 */

const getStateMock: MockFunction = getJestMockFunction();
const testMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
let switchProps: Record<string, unknown> | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getPipelineCircuitBreaker: (...args: Array<any>) => {
          return getStateMock(...args);
        },
        testPipelineCircuitBreaker: (...args: Array<any>) => {
          return testMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("22222222-2222-4222-8222-000000000001");
      },
      navigate: (): void => {
        return undefined;
      },
    },
  };
});

// The switch saves its own column: here, it says which, and with what words.
jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      switchProps = props;
      const describe: (isOn: boolean) => string = props["getDescription"] as (
        isOn: boolean,
      ) => string;

      return React.createElement(
        "div",
        { "data-testid": "switch-card" },
        `${props["cardTitle"]} | ${props["title"]} | ${describe(false)}`,
      );
    },
  };
});

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

import DataPipelineCircuitBreaker, {
  CIRCUIT_BREAKER_STATUS_TEST_ID,
  CIRCUIT_BREAKER_TEST_RESULT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataPipeline/View/CircuitBreaker";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import {
  DataCircuitBreakerAnswer,
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
  DataCircuitBreakerVerdict,
} from "../../../Types/DataObservability/DataCircuitBreaker";
import { DataPipelineCircuitBreakerState } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../Types/ObjectID";

const PIPELINE_ID: string = "22222222-2222-4222-8222-000000000001";
const ORDERS: string = "33333333-3333-4333-8333-000000000001";
const CUSTOMERS: string = "33333333-3333-4333-8333-000000000002";

const ON_ORDERS: DataCircuitBreakerReason = {
  kind: DataCircuitBreakerReasonKind.CheckFailing,
  dataAssetId: ORDERS,
  table: "public.orders",
  database: "warehouse",
  check: "unique order id",
  dataCheckId: "44444444-4444-4444-8444-000000000001",
  lateBySeconds: 0,
};

const ON_CUSTOMERS: DataCircuitBreakerReason = {
  kind: DataCircuitBreakerReasonKind.TableLate,
  dataAssetId: CUSTOMERS,
  table: "public.customers",
  database: null,
  check: null,
  dataCheckId: null,
  lateBySeconds: 3 * 60 * 60,
};

function state(
  fields: Partial<DataPipelineCircuitBreakerState> = {},
): DataPipelineCircuitBreakerState {
  return {
    dataPipelineId: PIPELINE_ID,
    stopsOnLateTables: false,
    checkedAt: null,
    stoppedAt: null,
    reasons: [],
    ...fields,
  };
}

function answer(
  fields: Partial<DataCircuitBreakerAnswer> = {},
): DataCircuitBreakerAnswer {
  return {
    verdict: DataCircuitBreakerVerdict.Go,
    reasons: [],
    tables: [
      {
        dataAssetId: ORDERS,
        table: "public.orders",
        database: "warehouse",
        freshness: DataAssetFreshness.Fresh,
        lateBySeconds: 0,
        checkCount: 2,
        failingCheckCount: 0,
      },
    ],
    notFound: [],
    stopsOnLateTables: false,
    pipeline: {
      dataPipelineId: PIPELINE_ID,
      name: "orders_daily",
      namespace: "airflow://prod",
    },
    isRecorded: false,
    isSwitchedOff: false,
    checkedAt: new Date().toISOString(),
    answer: "Go",
    ...fields,
  };
}

function pipeline(): DataPipeline {
  const row: DataPipeline = new DataPipeline();
  row._id = PIPELINE_ID;
  row.jobName = "orders_daily";
  row.jobNamespace = "airflow://prod";
  row.pipelineKey = "airflow://prod/orders_daily";
  return row;
}

async function open(): Promise<HTMLElement> {
  render(
    <DataPipelineCircuitBreaker
      {...({} as React.ComponentProps<typeof DataPipelineCircuitBreaker>)}
    />,
  );

  return await screen.findByTestId(CIRCUIT_BREAKER_STATUS_TEST_ID);
}

beforeEach(() => {
  getStateMock.mockReset();
  testMock.mockReset();
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(pipeline());
  switchProps = null;
});

afterEach(() => {
  cleanup();
});

describe("how the breaker stands", () => {
  test("stopped: since when, and each reason opening its table", async () => {
    getStateMock.mockResolvedValue(
      state({
        checkedAt: new Date().toISOString(),
        stoppedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        reasons: [ON_ORDERS, ON_CUSTOMERS],
      }),
    );

    const status: HTMLElement = await open();

    await waitFor(() => {
      expect(within(status).getByText("Stopped")).toBeInTheDocument();
    });
    expect(
      within(status).getByText(/^Stopped the pipeline /),
    ).toBeInTheDocument();
    expect(within(status).getByText("Why it stopped")).toBeInTheDocument();

    // A failing check: its name and its table, opening the table's Checks tab.
    const check: HTMLElement = within(status).getByText(
      "unique order id · public.orders",
    );
    expect(check.closest("a")?.getAttribute("href")).toContain(
      `/tables/${ORDERS}/checks`,
    );
    expect(within(status).getByText("Check Failing")).toBeInTheDocument();
    expect(within(status).getByText("warehouse")).toBeInTheDocument();

    // A late table: how late, opening the table.
    const late: HTMLElement = within(status).getByText("public.customers");
    expect(late.closest("a")?.getAttribute("href")).toContain(
      `/tables/${CUSTOMERS}`,
    );
    expect(within(status).getByText("Late by 3 hours")).toBeInTheDocument();
    expect(getStateMock.mock.calls[0]![0].toString()).toBe(PIPELINE_ID);
  });

  test("stopped, with no reason its reader may read: says so, naming none", async () => {
    getStateMock.mockResolvedValue(
      state({ stoppedAt: new Date().toISOString(), reasons: [] }),
    );

    const status: HTMLElement = await open();

    await waitFor(() => {
      expect(
        within(status).getByText(
          "The tables that stopped it are not ones you may read.",
        ),
      ).toBeInTheDocument();
    });
  });

  test("said go: when", async () => {
    getStateMock.mockResolvedValue(
      state({ checkedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }),
    );

    const status: HTMLElement = await open();

    await waitFor(() => {
      expect(within(status).getByText("Clear to Run")).toBeInTheDocument();
    });
    expect(
      within(status).getByText(/^Cleared the pipeline to run /),
    ).toBeInTheDocument();
    expect(within(status).queryByText("Why it stopped")).toBeNull();
  });

  test("never asked: what to do, and the step below", async () => {
    getStateMock.mockResolvedValue(state());

    const status: HTMLElement = await open();

    await waitFor(() => {
      expect(within(status).getByText("Not Set Up")).toBeInTheDocument();
    });
    expect(
      within(status).getByText(
        "No step of this pipeline has asked yet. Add the step below to the start of the pipeline.",
      ),
    ).toBeInTheDocument();
  });

  test("a read that fails says why, with a way to try again", async () => {
    getStateMock.mockRejectedValueOnce(new Error("The server did not answer."));
    getStateMock.mockResolvedValueOnce(state());

    const status: HTMLElement = await open();

    await waitFor(() => {
      expect(
        within(status).getByText("The server did not answer."),
      ).toBeInTheDocument();
    });
  });
});

describe("Test Now", () => {
  test("asks as a dry run, and says the breaker would stop it, and why", async () => {
    getStateMock.mockResolvedValue(state());
    testMock.mockResolvedValue(
      answer({
        verdict: DataCircuitBreakerVerdict.Stop,
        reasons: [ON_ORDERS],
      }),
    );

    await open();
    await waitFor(() => {
      expect(screen.getByText("Not Set Up")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Test Now/ }));

    const result: HTMLElement = await screen.findByTestId(
      CIRCUIT_BREAKER_TEST_RESULT_TEST_ID,
    );

    expect(within(result).getByText("Would Stop")).toBeInTheDocument();
    expect(
      within(result).getByText(
        "It would stop the pipeline now. Testing keeps nothing on the pipeline.",
      ),
    ).toBeInTheDocument();
    expect(
      within(result).getByText("unique order id · public.orders"),
    ).toBeInTheDocument();
    expect((testMock.mock.calls[0]![0] as ObjectID).toString()).toBe(
      PIPELINE_ID,
    );
  });

  test("a go over no known table says nothing would be checked", async () => {
    getStateMock.mockResolvedValue(state());
    testMock.mockResolvedValue(answer({ tables: [] }));

    await open();
    await waitFor(() => {
      expect(screen.getByText("Not Set Up")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Test Now/ }));

    const result: HTMLElement = await screen.findByTestId(
      CIRCUIT_BREAKER_TEST_RESULT_TEST_ID,
    );

    expect(
      within(result).getByText(
        /^Clear to run: OneUptime knows none of the tables/,
      ),
    ).toBeInTheDocument();
  });
});

describe("what stops it, and the step to add", () => {
  test("one switch, saving the pipeline's own column, off by default and said so", async () => {
    getStateMock.mockResolvedValue(state());

    await open();

    expect(switchProps?.["column"]).toBe("circuitBreakerStopsOnLateTables");
    expect(switchProps?.["modelType"]).toBe(DataPipeline);
    expect(screen.getByTestId("switch-card")).toHaveTextContent(
      "What Stops It | Stop when a table it reads is late | Late tables do not stop the pipeline: a late table may only mean a quiet day.",
    );
  });

  test("the step names this pipeline as the breaker finds it, with failWithStatusCode", async () => {
    getStateMock.mockResolvedValue(state());

    await open();

    await waitFor(() => {
      expect(
        screen.getByText(/"pipeline":"airflow:\/\/prod\/orders_daily"/),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByText(/failWithStatusCode/).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Airflow" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "dbt" })).toBeInTheDocument();
  });
});
