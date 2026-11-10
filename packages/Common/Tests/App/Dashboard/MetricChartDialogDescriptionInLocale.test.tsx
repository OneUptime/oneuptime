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
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A METRIC'S CHART DIALOG SAYS THE METRIC'S DESCRIPTION IN THE READER'S
 * LANGUAGE (issue #6368).
 *
 * A database's and a queue's Metrics tab chart a clicked engine or broker
 * metric in a dialog whose line under the title is the metric's catalog
 * description - what the (i) beside its tile says - and what the chart is
 * cut to. The database's dialog glued the description into an English
 * sentence, and the queue's put it as written into its translated one, so
 * both read English once the (i) beside the tile said it translated.
 *
 * Each dialog words "{{metricDescription}} Charted for this database
 * only." (or "... queue only.") as one sentence and hands the description
 * in as a translatable term: in every language the whole line reads in the
 * reader's words, the description included, and a language that has not
 * worded the sentence reads all of it in English - never a translated
 * sentence around an English description, or the other way round.
 */

interface Reader {
  language: string;
  words: Record<string, unknown>;
}

// The reader the stubbed translation reads, set per test.
const mockReader: Reader = { language: "en", words: {} };

function mockLookUp(text: string): string {
  const worded: unknown = mockReader.words[text];

  return typeof worded === "string" && worded.length > 0 ? worded : text;
}

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: (): {
      translateString: (value: string | undefined) => string | undefined;
      language: string;
    } => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value === undefined ? value : mockLookUp(value);
        },
        language: mockReader.language,
      };
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          const worded: string = mockLookUp(key);
          return worded === key ? options?.defaultValue ?? key : worded;
        },
        i18n: { language: mockReader.language },
      };
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
      },
    },
  };
});

// The dialog's chrome: its title, and the line under it this suite reads.
jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Normal: 0, Medium: 1, Large: 2 },
    default: (props: {
      title: string;
      description?: string;
      children?: React.ReactNode;
    }): React.ReactElement => {
      return (
        <section role="dialog" aria-label={props.title}>
          <p data-testid="modal-description">{props.description}</p>
          {props.children}
        </section>
      );
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }): React.ReactElement => {
        return <div data-testid="chart-card">{props.title}</div>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchDatabaseMetricChartSeries: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseMetricMonitorLink",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseMetricMonitorLink",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchDatabaseMetricCarriesServerId: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
    };
  },
);

import DatabaseMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal";
import MessageQueueMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricChartModal";
import {
  DatabaseServerMetricDefinition,
  findDatabaseServerMetricByName,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import { parseMessageQueueIdentifier } from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

function wordsOf(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const DATABASE_SENTENCE: string =
  "{{metricDescription}} Charted for this database only.";
const QUEUE_SENTENCE: string =
  "{{metricDescription}} Charted for this queue only.";

// postgresql.backends: a curated gauge of the PostgreSQL engine.
const DATABASE_METRIC: DatabaseServerMetricDefinition =
  findDatabaseServerMetricByName(
    "postgresql",
    "postgresql.backends",
  ) as DatabaseServerMetricDefinition;

// RabbitMQ's queue depth: a curated broker metric.
const QUEUE_METRIC: MessageQueueMetricDescriptor = MESSAGE_QUEUE_METRICS.find(
  (descriptor: MessageQueueMetricDescriptor): boolean => {
    return (
      descriptor.system === "rabbitmq" &&
      descriptor.metricName === "rabbitmq.message.current"
    );
  },
) as MessageQueueMetricDescriptor;

function readAs(language: string, words: Record<string, unknown>): void {
  mockReader.language = language;
  mockReader.words = words;
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openDatabaseDialog(): Promise<string> {
  render(
    <MemoryRouter>
      <DatabaseMetricChartModal
        metricName="postgresql.backends"
        unit=""
        keys={["0123456789abcdef"]}
        projectId="10000000-0000-4000-8000-000000000001"
        dbSystem="postgresql"
        databaseServerId={new ObjectID("84858d6c-1111-4aaa-8bbb-000000000001")}
        databaseName="orders-db"
        initialTimeRange={{ range: TimeRange.PAST_THREE_HOURS }}
        onClose={(): void => {}}
      />
    </MemoryRouter>,
  );
  await settle();

  return screen.getByTestId("modal-description").textContent || "";
}

async function openQueueDialog(): Promise<string> {
  render(
    <MemoryRouter>
      <MessageQueueMetricChartModal
        metricName="rabbitmq.message.current"
        unit=""
        keys={["fedcba9876543210"]}
        projectId="8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b"
        messagingSystem="rabbitmq"
        identity={parseMessageQueueIdentifier("rabbitmq||orders")}
        queueName="orders"
        initialTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onClose={(): void => {}}
      />
    </MemoryRouter>,
  );
  await settle();

  return screen.getByTestId("modal-description").textContent || "";
}

interface Dialog {
  name: string;
  sentence: string;
  description: () => string;
  open: () => Promise<string>;
}

const DIALOGS: ReadonlyArray<Dialog> = [
  {
    name: "a database's chart dialog",
    sentence: DATABASE_SENTENCE,
    description: (): string => {
      return DATABASE_METRIC.description;
    },
    open: openDatabaseDialog,
  },
  {
    name: "a queue's chart dialog",
    sentence: QUEUE_SENTENCE,
    description: (): string => {
      return QUEUE_METRIC.description;
    },
    open: openQueueDialog,
  },
];

beforeEach(() => {
  readAs("en", {});
});

afterEach(() => {
  cleanup();
});

describe("the metric a dialog charts", () => {
  test("is a curated metric whose description is a full sentence", () => {
    for (const dialog of DIALOGS) {
      expect(dialog.description()).toMatch(/^[A-Z].+\.$/);
    }
  });
});

describe.each(DIALOGS)("$name", (dialog: Dialog) => {
  test("reads the description, then what the chart is cut to, in English", async () => {
    expect(await dialog.open()).toBe(
      dialog.sentence.replace("{{metricDescription}}", dialog.description()),
    );
  });

  test("looks the description up along with the sentence around it", async () => {
    readAs("de", {
      [dialog.sentence]: "{{metricDescription}} ⟦nur hier⟧",
      [dialog.description()]: "⟦Beschreibung⟧",
    });

    expect(await dialog.open()).toBe("⟦Beschreibung⟧ ⟦nur hier⟧");
  });

  test("reads all of it in English while the language has not worded the sentence", async () => {
    readAs("de", { [dialog.description()]: "⟦Beschreibung⟧" });

    expect(await dialog.open()).toBe(
      dialog.sentence.replace("{{metricDescription}}", dialog.description()),
    );
  });

  test.each(LANGUAGES)(
    "reads all of it in the reader's words in %s",
    async (language: string) => {
      const words: Record<string, unknown> = wordsOf(language);
      const sentence: unknown = words[dialog.sentence];
      const description: unknown = words[dialog.description()];

      // The language words both: the sentence and the description in it.
      expect({ language, sentence: sentence !== dialog.sentence }).toEqual({
        language,
        sentence: true,
      });
      expect({
        language,
        description: description !== dialog.description(),
      }).toEqual({ language, description: true });

      readAs(language, words);
      const line: string = await dialog.open();

      expect(line).toBe(
        String(sentence).replace(
          "{{metricDescription}}",
          String(description).trim(),
        ),
      );
      // Never the English description inside the translated line.
      expect(line).not.toContain(dialog.description());
    },
  );
});
