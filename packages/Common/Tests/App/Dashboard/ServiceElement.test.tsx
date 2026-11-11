import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A SERVICE AMONG A ROW'S AFFECTED RESOURCES: ITS COLOUR IN AN ICON'S ROOM
 * (the UI review of #6740).
 *
 * A row's Affected Resources (AffectedResourcesCell, on the incidents,
 * alerts and scheduled maintenance lists) names each resource beside its
 * kind's icon - and a service beside its colour. The service was drawn as
 * a row of its own: a block flex row, its 12px colour, an 8px gap, its
 * name. So its name stood 8px before every other name in the list, and
 * its link ran the list's whole width: its focus ring was cut off at the
 * column's edges, and a click anywhere past a short name's end opened the
 * service rather than the row.
 *
 * Listed among records with icons (alignWithIcons), its colour takes an
 * icon's room and its name is the same line of its own beside it as
 * theirs (RecordLinkName's mark): it starts where they do, and its link is
 * as wide as its colour and name. Everywhere else - the services list,
 * traces, logs - it is drawn exactly as it always was.
 *
 * AppLink is a plain anchor here, so the hrefs can be read.
 */
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

import ServiceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceElement";
import MonitorElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor";
import {
  RECORD_LINK_ICON_CLASS_NAME,
  RECORD_LINK_MARK_CLASS_NAME,
  RECORD_LINK_NAME_LINE_CLASS_NAME,
  RECORD_LINK_NAME_ROW_CLASS_NAME,
  RECORD_LINK_NAME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/RecordLink/RecordLinkName";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES } from "../../../UI/Components/Table/TableLayout";
import { UNKNOWN_SERVICE_NAME } from "../../../UI/Utils/TelemetryService";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const SERVICE_ID: string = "0193c0de-6740-4aaa-8bbb-000000000101";
const MONITOR_ID: string = "0193c0de-6740-4aaa-8bbb-000000000102";
const ENGLISH_SERVICE: string = "checkout-api (payments, EU West)";
const ARABIC_SERVICE: string = "واجهة الدفع";
const ENGLISH_MONITOR: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";

// The colour a service is given here, as the browser writes it back.
const SERVICE_COLOR: string = "#6366f1";
const SERVICE_COLOR_AS_DRAWN: string = "rgb(99, 102, 241)";

const NAME_LINE_CLASSES: Array<string> =
  RECORD_LINK_NAME_LINE_CLASS_NAME.split(" ");
const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");

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

beforeEach(() => {
  // Route population, and the unknown service's id, read the project's id.
  goTo(`/dashboard/${PROJECT_ID}/alerts`);
});

afterEach(() => {
  cleanup();
});

const drawOn: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <div data-testid="holder">{element}</div>
    </I18nextProvider>,
  ).getByTestId("holder");
};

const serviceOf: (data: {
  name: string | undefined;
  id?: string | undefined;
  color?: string | undefined;
}) => Service = (data: {
  name: string | undefined;
  id?: string | undefined;
  color?: string | undefined;
}): Service => {
  const service: Service = new Service();

  if (data.id) {
    service._id = data.id;
  }

  if (data.name !== undefined) {
    service.name = data.name;
  }

  if (data.color) {
    service.serviceColor = new Color(data.color);
  }

  return service;
};

const ENGLISH: () => Service = (): Service => {
  return serviceOf({
    id: SERVICE_ID,
    name: ENGLISH_SERVICE,
    color: SERVICE_COLOR,
  });
};

// The parts of a record link's row: its first box, its mark or icon, its name.
interface RowParts {
  row: HTMLElement;
  firstBox: HTMLElement;
  name: HTMLElement;
}

const rowPartsOf: (name: HTMLElement) => RowParts = (
  name: HTMLElement,
): RowParts => {
  const row: HTMLElement = name.parentElement as HTMLElement;

  return {
    row: row,
    firstBox: row.firstElementChild as HTMLElement,
    name: name,
  };
};

// The colour square ColorSquareCube draws.
const colourIn: (element: HTMLElement) => HTMLElement = (
  element: HTMLElement,
): HTMLElement => {
  return element.querySelector("div.rounded.h-3.w-3") as HTMLElement;
};

describe("listed among records drawn with their kind's icon (alignWithIcons)", () => {
  test.each(["ar", "fa"])(
    "on a %s page its colour stands in an icon's room and its English name is a line of its own beside it, read left to right",
    (language: string) => {
      drawOn(language, <ServiceElement service={ENGLISH()} alignWithIcons />);

      const link: HTMLElement = screen.getByRole("link");

      // Still the link to the service, its hover underline and all.
      expect(link.getAttribute("href")).toContain(SERVICE_ID);
      expect(link).toHaveClass("hover:underline");
      expect(link).toHaveTextContent(ENGLISH_SERVICE);

      const parts: RowParts = rowPartsOf(
        screen.getByTestId(RECORD_LINK_NAME_TEST_ID),
      );

      // The row a record with an icon draws, the link's one box.
      expect(link.children).toHaveLength(1);
      expect(link.firstElementChild).toBe(parts.row);
      expect(parts.row.tagName).toBe("SPAN");
      expect(parts.row.getAttribute("class")).toBe(
        RECORD_LINK_NAME_ROW_CLASS_NAME,
      );
      expect(parts.row).not.toHaveAttribute("dir");
      expect(parts.row.children).toHaveLength(2);

      // First, at the line's start: the icon's room, the colour in it.
      expect(parts.firstBox.children).toHaveLength(1);

      const room: HTMLElement = parts.firstBox.firstElementChild as HTMLElement;

      expect(room.getAttribute("class")).toBe(RECORD_LINK_MARK_CLASS_NAME);
      expect(room).not.toHaveAttribute("dir");
      expect(room.children).toHaveLength(1);
      expect(room.firstElementChild).toBe(colourIn(link));
      expect(colourIn(link).style.backgroundColor).toBe(SERVICE_COLOR_AS_DRAWN);
      // A colour, not a kind's icon.
      expect(link.querySelector("svg")).toBeNull();

      // Then its name: its own line, read its way, cut short at its own end.
      expect(parts.row.lastElementChild).toBe(parts.name);
      expect(parts.name.tagName).toBe("SPAN");
      expect(parts.name).toHaveAttribute("dir", "ltr");
      expect(parts.name.textContent).toBe(ENGLISH_SERVICE);
      expect(parts.name).toHaveClass(...NAME_LINE_CLASSES, ...CLAMPED_CLASSES);
      expect(parts.name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test("on an English page nothing has a dir, and its name has its line's classes only", () => {
    const holder: HTMLElement = drawOn(
      "en",
      <ServiceElement service={ENGLISH()} alignWithIcons />,
    );

    expect(holder.querySelector("[dir]")).toBeNull();
    expect(
      screen.getByTestId(RECORD_LINK_NAME_TEST_ID).getAttribute("class"),
    ).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
  });

  test("an Arabic name on an Arabic page reads the page's way", () => {
    const holder: HTMLElement = drawOn(
      "ar",
      <ServiceElement
        service={serviceOf({
          id: SERVICE_ID,
          name: ARABIC_SERVICE,
          color: SERVICE_COLOR,
        })}
        alignWithIcons
      />,
    );

    expect(holder.querySelector("[dir]")).toBeNull();
    expect(
      screen.getByTestId(RECORD_LINK_NAME_TEST_ID).getAttribute("class"),
    ).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
  });

  /*
   * In a row's Affected Resources each name follows its icon - or the
   * service's colour - in the same row, so they all start in one place.
   * The service drew its colour (12px) and gap as a row of its own, and
   * its name stood 8px before the monitor's above it.
   */
  test.each(["en", "fa"])(
    "on a %s page its name starts where a monitor's with its icon does: the same row, the same room before it, the same line",
    (language: string) => {
      drawOn(
        language,
        <>
          <MonitorElement
            monitor={(() => {
              const monitor: Monitor = new Monitor();
              monitor._id = MONITOR_ID;
              monitor.name = ENGLISH_MONITOR;
              return monitor;
            })()}
            showIcon={true}
          />
          <ServiceElement service={ENGLISH()} alignWithIcons />
        </>,
      );

      const [monitorName, serviceName] = screen.getAllByTestId(
        RECORD_LINK_NAME_TEST_ID,
      ) as [HTMLElement, HTMLElement];
      const monitor: RowParts = rowPartsOf(monitorName);
      const service: RowParts = rowPartsOf(serviceName);

      expect(monitorName.textContent).toBe(ENGLISH_MONITOR);
      expect(serviceName.textContent).toBe(ENGLISH_SERVICE);

      // The same row, as the link's one box.
      expect(service.row.getAttribute("class")).toBe(
        monitor.row.getAttribute("class"),
      );
      expect(monitor.row.parentElement!.tagName).toBe("A");
      expect(service.row.parentElement!.tagName).toBe("A");

      /*
       * Before the name, a box holding one 20px box set on its line: the
       * icon's svg, or the room the colour is drawn in.
       */
      expect(monitor.firstBox.children).toHaveLength(1);
      expect(service.firstBox.children).toHaveLength(1);

      const icon: Element = monitor.firstBox.firstElementChild as Element;
      const room: Element = service.firstBox.firstElementChild as Element;

      expect(icon.tagName.toLowerCase()).toBe("svg");
      expect(icon).toHaveClass(...RECORD_LINK_ICON_CLASS_NAME.split(" "));

      for (const sizeAndPlace of ["h-5", "w-5", "align-middle"]) {
        expect(icon).toHaveClass(sizeAndPlace);
        expect(room).toHaveClass(sizeAndPlace);
      }

      // The same line, with the same classes and the same way.
      expect(service.name.getAttribute("class")).toBe(
        monitor.name.getAttribute("class"),
      );
      expect(service.name.getAttribute("dir")).toBe(
        monitor.name.getAttribute("dir"),
      );
    },
  );

  /*
   * The link is an inline: a block inside it (the row the service used to
   * draw, "flex") made it run the whole width of its item's line - its
   * focus ring at the column's edges, cut off by the item's clip, and a
   * click past a short name's end opened the service. Its one box is the
   * row, set on the line, as wide as the colour and the name.
   */
  test("its link is as wide as its colour and name: its one box is a row set on the line, not a block", () => {
    drawOn("fa", <ServiceElement service={ENGLISH()} alignWithIcons />);

    const link: HTMLElement = screen.getByRole("link");
    const rowClasses: Array<string> = (
      link.firstElementChild!.getAttribute("class") || ""
    ).split(" ");

    expect(link.children).toHaveLength(1);
    expect(rowClasses).toEqual(
      expect.arrayContaining(["inline-flex", "max-w-full"]),
    );

    for (const runsTheLinesWidth of [
      "flex",
      "block",
      "w-full",
      "flex-1",
      "grow",
    ]) {
      expect(rowClasses).not.toContain(runsTheLinesWidth);
    }

    // No block anywhere between the link and its colour and name.
    expect(link.querySelector("div.flex")).toBeNull();
    expect(link.querySelector(".mt-1")).toBeNull();
  });

  /*
   * A table's cell lays a record's bare name out as a line of text: it
   * matches the one shape a record link with no icon draws, a span whose
   * class is exactly "flex" (TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES).
   * A service with its colour is a row with a line of its own, which that
   * must leave alone.
   */
  test("it is never the bare flex span a table's cell lays out as a line of text", () => {
    const holder: HTMLElement = drawOn(
      "fa",
      <ServiceElement service={ENGLISH()} alignWithIcons />,
    );

    expect(TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES).toContain(
      "span[class=flex]",
    );
    expect(holder.querySelector("span[class=flex]")).toBeNull();
  });

  test("a serviceNameClassName is not read: its name takes its line's classes, as every other name in the list does", () => {
    drawOn(
      "en",
      <ServiceElement
        service={ENGLISH()}
        serviceNameClassName="truncate font-semibold"
        alignWithIcons
      />,
    );

    expect(
      screen.getByTestId(RECORD_LINK_NAME_TEST_ID).getAttribute("class"),
    ).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
  });

  test("a service with no colour of its own is drawn black, in the same room", () => {
    drawOn(
      "en",
      <ServiceElement
        service={serviceOf({ id: SERVICE_ID, name: ENGLISH_SERVICE })}
        alignWithIcons
      />,
    );

    const link: HTMLElement = screen.getByRole("link");

    expect(colourIn(link).style.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(colourIn(link).parentElement!.getAttribute("class")).toBe(
      RECORD_LINK_MARK_CLASS_NAME,
    );
  });

  /*
   * Telemetry that names no service is drawn under a stand-in whose id is
   * the project's: there is no page to link to. It is named, beside its
   * colour, in the same row.
   */
  test("the stand-in for telemetry that names no service is named, not linked, its colour and name still in a row", () => {
    const holder: HTMLElement = drawOn(
      "en",
      <ServiceElement
        service={serviceOf({ id: PROJECT_ID, name: UNKNOWN_SERVICE_NAME })}
        alignWithIcons
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();

    const name: HTMLElement = screen.getByTestId(RECORD_LINK_NAME_TEST_ID);

    expect(name.textContent).toBe("Unknown Service");

    const parts: RowParts = rowPartsOf(name);

    expect(parts.row.getAttribute("class")).toBe(
      RECORD_LINK_NAME_ROW_CLASS_NAME,
    );
    expect(parts.row.parentElement!.tagName).toBe("DIV");
    expect(parts.row.parentElement!.parentElement).toBe(holder);
    expect(parts.firstBox.firstElementChild!.getAttribute("class")).toBe(
      RECORD_LINK_MARK_CLASS_NAME,
    );
    expect(colourIn(holder).style.backgroundColor).toBe("rgb(0, 0, 0)");
  });

  test("a service with no id is named, not linked", () => {
    drawOn(
      "fa",
      <ServiceElement
        service={serviceOf({ name: ENGLISH_SERVICE, color: SERVICE_COLOR })}
        alignWithIcons
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID)).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("a service with no name draws an empty line, not 'undefined'", () => {
    drawOn(
      "fa",
      <ServiceElement
        service={serviceOf({
          id: SERVICE_ID,
          name: undefined,
          color: SERVICE_COLOR,
        })}
        alignWithIcons
      />,
    );

    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID).textContent).toBe("");
    expect(screen.getByRole("link").textContent).toBe("");
  });

  test("a name is text, never markup", () => {
    const hostile: string = '<img src="x" onerror="alert(1)"> checkout-api';
    const holder: HTMLElement = drawOn(
      "ar",
      <ServiceElement
        service={serviceOf({
          id: SERVICE_ID,
          name: hostile,
          color: SERVICE_COLOR,
        })}
        alignWithIcons
      />,
    );

    expect(holder.querySelector("img")).toBeNull();
    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID).textContent).toBe(
      hostile,
    );
  });
});

/*
 * The services list, a trace's spans, the logs and profiles draw a service
 * alone, not in a list of records with icons: exactly as it always was.
 */
describe("anywhere else (no alignWithIcons): drawn as it always was", () => {
  test("on an English page: its colour, then its name, in a row of their own", () => {
    drawOn("en", <ServiceElement service={ENGLISH()} />);

    const link: HTMLElement = screen.getByRole("link");

    expect(link.getAttribute("href")).toContain(SERVICE_ID);
    expect(link.innerHTML).toBe(
      `<div class="flex gap-2"><div class="mt-1"><div class="rounded h-3 w-3" style="background-color: ${SERVICE_COLOR_AS_DRAWN};"></div></div><div>${ENGLISH_SERVICE}</div></div>`,
    );
    expect(screen.queryByTestId(RECORD_LINK_NAME_TEST_ID)).toBeNull();
  });

  test("its serviceNameClassName still styles its name", () => {
    drawOn(
      "en",
      <ServiceElement
        service={ENGLISH()}
        serviceNameClassName="truncate font-semibold"
      />,
    );

    expect(screen.getByText(ENGLISH_SERVICE).getAttribute("class")).toBe(
      "truncate font-semibold",
    );
  });

  test.each(["ar", "fa"])(
    "on a %s page its English name reads left to right on its own line beside its colour, as it did",
    (language: string) => {
      drawOn(
        language,
        <ServiceElement service={ENGLISH()} serviceNameClassName="truncate" />,
      );

      const name: HTMLElement = screen.getByText(ENGLISH_SERVICE);

      expect(name.tagName).toBe("DIV");
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      expect(name.parentElement!.getAttribute("class")).toBe("flex gap-2");
      expect(name.previousElementSibling!.getAttribute("class")).toBe("mt-1");
      // No icon's room, no record link's row.
      expect(
        document.querySelector(`[class="${RECORD_LINK_MARK_CLASS_NAME}"]`),
      ).toBeNull();
      expect(
        document.querySelector(`[class="${RECORD_LINK_NAME_ROW_CLASS_NAME}"]`),
      ).toBeNull();
    },
  );

  test("the stand-in for telemetry that names no service is named, not linked", () => {
    const holder: HTMLElement = drawOn(
      "en",
      <ServiceElement
        service={serviceOf({ id: PROJECT_ID, name: UNKNOWN_SERVICE_NAME })}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(holder.textContent).toBe("Unknown Service");
  });
});
