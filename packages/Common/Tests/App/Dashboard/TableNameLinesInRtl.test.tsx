import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * A NAME BESIDE A MARK, OR OVER A LINE OF ITS OWN, IN AN ARABIC OR PERSIAN
 * LIST (#6657).
 *
 * A list's name cell that lays out more than the name - a provider's logo
 * beside it, a service's colour, a description or the page's own words
 * under it - keeps the page's way (drawsItsOwnLines), so the logo stays at
 * the line's start and the page's words read as they do. Its name draws
 * its own line the way it is written (IsolatedLine, IsolatedText): an
 * English name is cut at its own end, not at its start. These take the
 * real columns the lists hand their table and draw them in a table's cell.
 */

type CapturedColumn = {
  title: string;
  field?: Record<string, unknown> | undefined;
  getLineText?: ((item: unknown) => string | undefined) | undefined;
  getElement?: ((item: unknown) => ReactElement) | undefined;
};

let capturedColumns: Array<CapturedColumn> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { columns?: Array<CapturedColumn> | undefined }) => {
      capturedColumns = props.columns || [];
      return null;
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

import VideoCallConnectionsTable from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallConnectionsTable";
import DbtTestTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DbtTestTable";
import TelemetryServiceTable from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryService/TelemetryServiceTable";
import { OnCallRuleNameCell } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursSummary";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import OnCallPageAs from "../../../Types/OnCallDutyPolicy/OnCallPageAs";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import TableBody from "../../../UI/Components/Table/TableBody";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";

// A list's row as its table reads it: a record with a name or a title.
interface NamedRow {
  _id?: unknown;
  name?: unknown;
  title?: unknown;
  priority?: unknown;
}

const ENGLISH_CONNECTION: string = "Zoom - Incident bridge (EU on-call)";
const ENGLISH_TEST: string = "not_null_orders_customer_id_for_eu_region";
const ENGLISH_DESCRIPTION: string =
  "Every order has a customer, so refunds can be traced.";
const ENGLISH_SERVICE: string = "checkout-api-eu-west-1";
const ENGLISH_RULE: string = "Sev 1 incidents: Payments on-call (EU)";
const SERVICE_ID: string = "7d1e2c3b-4a5f-4e6d-8c7b-9a0b1c2d3e4f";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

// The columns a list hands its table, as ModelTable receives them.
const columnsOf: (list: ReactElement) => Array<CapturedColumn> = (
  list: ReactElement,
): Array<CapturedColumn> => {
  capturedColumns = [];
  render(<MemoryRouter>{list}</MemoryRouter>);
  cleanup();

  return capturedColumns;
};

// The column on the record's name, keyed by that field as ModelTable keys it.
const nameColumnOf: (columns: Array<CapturedColumn>) => Column<NamedRow> = (
  columns: Array<CapturedColumn>,
): Column<NamedRow> => {
  const column: CapturedColumn | undefined = columns.find(
    (each: CapturedColumn): boolean => {
      return Boolean(each.field && "name" in each.field);
    },
  );

  expect(column).toBeDefined();

  return {
    ...(column as unknown as Column<NamedRow>),
    key: "name",
  };
};

const drawRow: (data: {
  language: string;
  column: Column<NamedRow>;
  row: NamedRow;
}) => HTMLElement = (data: {
  language: string;
  column: Column<NamedRow>;
  row: NamedRow;
}): HTMLElement => {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={instances[data.language]!}>
        <table>
          <TableBody<NamedRow>
            id="name-lines-body"
            data={[data.row]}
            columns={[
              data.column,
              { title: "Priority", type: FieldType.Number, key: "priority" },
            ]}
            selectedItems={[]}
            matchBulkSelectedItemByField={undefined}
            isMobile={false}
          />
        </table>
      </I18nextProvider>
    </MemoryRouter>,
  );

  return document.querySelector("tbody td") as HTMLElement;
};

// The nearest box of the name's that has a dir of its own, if any.
const lineOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  return screen.getByText(text);
};

describe.each([
  ["an Arabic page", "ar"],
  ["a Persian page", "fa"],
])("on %s", (_page: string, language: string) => {
  test("a video call connection: its logo stays at the line's start, its English name reads left to right", () => {
    const column: Column<NamedRow> = nameColumnOf(
      columnsOf(
        <VideoCallConnectionsTable
          refreshToggle="1"
          createGate={{ isAllowed: true } as never}
          updateGate={{ isAllowed: true } as never}
          onEdit={jest.fn()}
          onReconnect={jest.fn()}
          onAdd={jest.fn()}
          onConnectionsLoaded={jest.fn()}
        />,
      ),
    );

    // The cell lays out its own lines: it names no words.
    expect(column.getLineText).toBeDefined();

    const connection: VideoCallConnection = new VideoCallConnection();
    connection._id = SERVICE_ID;
    connection.name = ENGLISH_CONNECTION;
    connection.provider = VideoCallProvider.Zoom;

    const cell: HTMLElement = drawRow({
      language,
      column,
      row: connection as unknown as NamedRow,
    });

    // The cell keeps the page's way, so the logo is at its start.
    expect(cell.firstElementChild).not.toHaveAttribute("dir");

    const name: HTMLElement = lineOf(ENGLISH_CONNECTION);

    expect(name.tagName).toBe("P");
    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a dbt test: its English name and its description each read left to right", () => {
    const column: Column<NamedRow> = nameColumnOf(columnsOf(<DbtTestTable />));

    const check: DataCheck = new DataCheck();
    check._id = SERVICE_ID;
    check.name = ENGLISH_TEST;
    check.description = ENGLISH_DESCRIPTION;

    const cell: HTMLElement = drawRow({
      language,
      column,
      row: check as unknown as NamedRow,
    });

    expect(cell.firstElementChild).not.toHaveAttribute("dir");

    for (const text of [ENGLISH_TEST, ENGLISH_DESCRIPTION]) {
      const line: HTMLElement = lineOf(text);

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line).toHaveClass("block", "truncate");
    }
  });

  test("a dbt test named in the page's script is drawn as it always was", () => {
    const column: Column<NamedRow> = nameColumnOf(columnsOf(<DbtTestTable />));

    const check: DataCheck = new DataCheck();
    check._id = SERVICE_ID;
    check.name = "فحص الطلبات";

    drawRow({ language, column, row: check as unknown as NamedRow });

    expect(lineOf("فحص الطلبات")).not.toHaveAttribute("dir");
  });

  test("a service: its colour stays at the line's start, its English name is cut at its own end", () => {
    const column: Column<NamedRow> = nameColumnOf(
      columnsOf(<TelemetryServiceTable />),
    );

    const service: Service = new Service();
    service._id = SERVICE_ID;
    service.name = ENGLISH_SERVICE;
    service.serviceColor = new Color("#0ea5e9");

    const cell: HTMLElement = drawRow({
      language,
      column,
      row: service as unknown as NamedRow,
    });

    expect(cell.firstElementChild).not.toHaveAttribute("dir");

    const name: HTMLElement = lineOf(ENGLISH_SERVICE);

    expect(name).toHaveAttribute("dir", "ltr");
    // Cut short in its own box, which may shrink beside the colour.
    expect(name).toHaveClass(
      "min-w-0",
      "truncate",
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
    // Still a link to the service.
    expect(name.closest("a")?.getAttribute("href")).toContain(SERVICE_ID);
  });

  test("an on-call rule: its English name reads left to right over the page's own words", () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <OnCallRuleNameCell
          name={ENGLISH_RULE}
          rule={{
            whenToPage: OnCallRuleWhenToPage.RightAway,
            pageAs: OnCallPageAs.Observers,
          }}
        />
      </I18nextProvider>,
    );

    const name: HTMLElement = lineOf(ENGLISH_RULE);

    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    // The line under it is the page's: no way of its own.
    expect(name.nextElementSibling).not.toHaveAttribute("dir");
  });

  test("an on-call rule with nothing under its name: the name is an isolate in the page's line", () => {
    const view: ReturnType<typeof render> = render(
      <I18nextProvider i18n={instances[language]!}>
        <OnCallRuleNameCell
          name={ENGLISH_RULE}
          rule={{ whenToPage: OnCallRuleWhenToPage.RightAway }}
        />
      </I18nextProvider>,
    );

    const isolate: HTMLElement = view.container.querySelector(
      "bdi",
    ) as HTMLElement;

    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(view.container.textContent).toBe(ENGLISH_RULE);
  });
});

describe("on an English page", () => {
  test("each name line is drawn as the box it replaced", () => {
    const column: Column<NamedRow> = nameColumnOf(columnsOf(<DbtTestTable />));

    const check: DataCheck = new DataCheck();
    check._id = SERVICE_ID;
    check.name = ENGLISH_TEST;
    check.description = ENGLISH_DESCRIPTION;

    drawRow({ language: "en", column, row: check as unknown as NamedRow });

    for (const text of [ENGLISH_TEST, ENGLISH_DESCRIPTION]) {
      const line: HTMLElement = lineOf(text);

      expect(line).not.toHaveAttribute("dir");
      expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(line).not.toHaveClass(
        CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ")[0]!,
      );
    }
  });
});
