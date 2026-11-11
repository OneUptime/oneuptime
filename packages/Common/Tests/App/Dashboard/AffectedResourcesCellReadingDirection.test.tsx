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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A ROW'S AFFECTED RESOURCES ON AN ARABIC OR PERSIAN PAGE (#6740).
 *
 * The incidents, alerts and scheduled maintenance lists name what a row is
 * about in their Affected Resources column (AffectedResourcesCell): each
 * resource's kind's icon, then its name, one to a line, cut short with
 * "..." where the column ends. The UI review of #6736 drew the alerts list
 * in Persian at 1024px: "...lNodesInEuWest1" for a monitor named "High
 * Node Memory Utilization on AllNodesInEuWest1", "...rating Containers"
 * for "Pod CPU Saturating Containers" - the name was a line of the page's,
 * cut where the page's lines end, at its start.
 *
 * Each name is a line of its own now (RecordLinkName; ServiceElement's
 * name, beside its colour, takes the same line's classes): read the way
 * it is written, so an English name is cut at its own end, and as wide as
 * its words beside its icon, so on a phone's card its wrapped lines start
 * on its own side. The icon, the item and the cell keep the page's way:
 * the icon still stands at the line's start, on the right.
 *
 * These draw the real cell in a table's real row (TableBody), as the lists
 * do. AppLink is a plain anchor, so the hrefs can be read.
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

import AffectedResourcesCell, {
  ComponentProps as AffectedResources,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesCell";
import {
  RECORD_LINK_NAME_LINE_CLASS_NAME,
  RECORD_LINK_NAME_ROW_CLASS_NAME,
  RECORD_LINK_NAME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/RecordLink/RecordLinkName";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Host from "../../../Models/DatabaseModels/Host";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Color from "../../../Types/Color";
import TableBody from "../../../UI/Components/Table/TableBody";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
  TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
} from "../../../UI/Components/Table/TableLayout";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const ENGLISH_MONITOR: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";
const ENGLISH_HOST: string = "web-prod-03.eu-west-1.acme-commerce.internal";
const ENGLISH_SERVICE: string = "checkout-api (payments, EU West)";
const ARABIC_MONITOR: string = "ذاكرة العقد مرتفعة في الاتحاد الأوروبي";
const ARABIC_SERVICE: string = "واجهة الدفع";

const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");
const NAME_LINE_CLASSES: Array<string> =
  RECORD_LINK_NAME_LINE_CLASS_NAME.split(" ");

// A list's row as its table reads it: what the cell is handed.
interface Row {
  _id: string;
  title: string;
  resources: AffectedResources;
}

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
  // Route population reads the project id from the current URL.
  goTo(`/dashboard/${PROJECT_ID}/alerts`);
});

afterEach(() => {
  cleanup();
});

let nextId: number = 1;

const recordId: () => string = (): string => {
  const id: string = String(nextId++).padStart(12, "0");

  return `0193c0de-6740-4aaa-8bbb-${id}`;
};

type NamedModel = { _id?: string | undefined; name?: string | undefined };

const named: <T extends NamedModel>(model: T, name: string) => T = <
  T extends NamedModel,
>(
  model: T,
  name: string,
): T => {
  model._id = recordId();
  model.name = name;
  return model;
};

const serviceNamed: (name: string) => Service = (name: string): Service => {
  const service: Service = named(new Service(), name);

  service.serviceColor = new Color("#6366f1");
  return service;
};

// The column the lists hand their table (AlertsTable, IncidentsTable).
const RESOURCES_COLUMN: Column<Row> = {
  title: "Affected Resources",
  type: FieldType.EntityArray,
  key: "resources",
  getElement: (row: Row): ReactElement => {
    return <AffectedResourcesCell {...row.resources} />;
  },
};

const TITLE_COLUMN: Column<Row> = {
  title: "Title",
  type: FieldType.Text,
  key: "title",
};

const drawRows: (data: {
  language: string;
  rows: Array<AffectedResources>;
  isMobile?: boolean | undefined;
}) => HTMLElement = (data: {
  language: string;
  rows: Array<AffectedResources>;
  isMobile?: boolean | undefined;
}): HTMLElement => {
  const rows: Array<Row> = data.rows.map(
    (resources: AffectedResources, index: number): Row => {
      return {
        _id: `0193c0de-6740-4ccc-8ddd-${String(index + 1).padStart(12, "0")}`,
        title: "High Node Memory Utilization",
        resources: resources,
      };
    },
  );

  const body: ReactElement = (
    <TableBody<Row>
      id="affected-resources-body"
      data={rows}
      columns={[TITLE_COLUMN, RESOURCES_COLUMN]}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={Boolean(data.isMobile)}
    />
  );

  return render(
    <I18nextProvider i18n={instances[data.language]!}>
      <div data-testid="holder">
        {data.isMobile ? body : <table>{body}</table>}
      </div>
    </I18nextProvider>,
  ).getByTestId("holder");
};

// The <td> a resource's name is drawn in.
const cellOf: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen.getAllByText(name)[0]!.closest("td") as HTMLElement;
};

// A record link's name: its own line beside its icon (RecordLinkName).
const nameLineOf: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  const line: HTMLElement | undefined = screen
    .getAllByTestId(RECORD_LINK_NAME_TEST_ID)
    .find((each: HTMLElement): boolean => {
      return each.textContent === name;
    });

  if (!line) {
    throw new Error(`No name line reads "${name}"`);
  }

  return line;
};

// A service's name, beside its colour (ServiceElement's IsolatedLine).
const serviceLineOf: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  return screen.getByText(name, { selector: "div" });
};

const MONITOR_HOST_AND_SERVICE: () => AffectedResources =
  (): AffectedResources => {
    return {
      monitors: [named(new Monitor(), ENGLISH_MONITOR)],
      hosts: [named(new Host(), ENGLISH_HOST)],
      services: [serviceNamed(ENGLISH_SERVICE)],
    };
  };

describe("on an Arabic or a Persian page", () => {
  test.each(["ar", "fa"])(
    "on a %s page each English name is a line of its own, read left to right and cut short at its own end",
    (language: string) => {
      drawRows({ language: language, rows: [MONITOR_HOST_AND_SERVICE()] });

      for (const name of [ENGLISH_MONITOR, ENGLISH_HOST]) {
        const line: HTMLElement = nameLineOf(name);

        expect(line).toHaveAttribute("dir", "ltr");
        expect(line).toHaveClass(...NAME_LINE_CLASSES);
        // As wide as its words beside its icon, never aligned to its end.
        expect(line).toHaveClass(...CLAMPED_CLASSES);
        expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        expect(line).not.toHaveClass("truncate");
      }

      // The service's name, beside its colour: the same line.
      const service: HTMLElement = serviceLineOf(ENGLISH_SERVICE);

      expect(service).toHaveAttribute("dir", "ltr");
      expect(service).toHaveClass(...NAME_LINE_CLASSES, ...CLAMPED_CLASSES);
      expect(service).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test.each(["ar", "fa"])(
    "on a %s page the icons, the rows, the items and the cell keep the page's way",
    (language: string) => {
      drawRows({ language: language, rows: [MONITOR_HOST_AND_SERVICE()] });

      const cell: HTMLElement = cellOf(ENGLISH_MONITOR);

      // A column that draws more than words keeps the page's way.
      expect(cell.firstElementChild).not.toHaveAttribute("dir");

      for (const name of [ENGLISH_MONITOR, ENGLISH_HOST]) {
        const line: HTMLElement = nameLineOf(name);
        const row: HTMLElement = line.parentElement as HTMLElement;
        const iconBox: HTMLElement = row.firstElementChild as HTMLElement;

        expect(row.getAttribute("class")).toBe(RECORD_LINK_NAME_ROW_CLASS_NAME);
        expect(row).not.toHaveAttribute("dir");
        // The icon first: at the line's start, the page's right.
        expect(iconBox).not.toBe(line);
        expect(iconBox.querySelector("svg")).not.toBeNull();
        expect(iconBox).not.toHaveAttribute("dir");

        // Each on its item's one line, which ends in "..." as before.
        const item: HTMLElement = line.closest("a")!
          .parentElement as HTMLElement;

        expect(item.getAttribute("class")).toBe(TABLE_LIST_ITEM_CLASS_NAME);
        expect(item).not.toHaveAttribute("dir");
      }

      // The service's colour stays beside its name, the page's way.
      const service: HTMLElement = serviceLineOf(ENGLISH_SERVICE);

      expect(service.parentElement).not.toHaveAttribute("dir");
      expect(service.previousElementSibling).not.toHaveAttribute("dir");

      // Only the three names read their own way.
      expect(
        Array.from(cell.querySelectorAll("[dir]")).map(
          (each: Element): string => {
            return each.textContent || "";
          },
        ),
      ).toEqual([ENGLISH_MONITOR, ENGLISH_HOST, ENGLISH_SERVICE]);
    },
  );

  test("an Arabic name on an Arabic page is drawn the page's way", () => {
    drawRows({
      language: "ar",
      rows: [
        {
          monitors: [named(new Monitor(), ARABIC_MONITOR)],
          services: [serviceNamed(ARABIC_SERVICE)],
        },
      ],
    });

    const monitor: HTMLElement = nameLineOf(ARABIC_MONITOR);

    expect(monitor).not.toHaveAttribute("dir");
    expect(monitor.getAttribute("class")).toBe(
      RECORD_LINK_NAME_LINE_CLASS_NAME,
    );

    const service: HTMLElement = serviceLineOf(ARABIC_SERVICE);

    expect(service).not.toHaveAttribute("dir");
    expect(service.getAttribute("class")).toBe(
      RECORD_LINK_NAME_LINE_CLASS_NAME,
    );
    expect(cellOf(ARABIC_MONITOR).querySelector("[dir]")).toBeNull();
  });

  test("a row's English and Arabic names each read their own way, side by side in one cell", () => {
    drawRows({
      language: "fa",
      rows: [
        {
          monitors: [
            named(new Monitor(), ENGLISH_MONITOR),
            named(new Monitor(), ARABIC_MONITOR),
          ],
        },
      ],
    });

    expect(nameLineOf(ENGLISH_MONITOR)).toHaveAttribute("dir", "ltr");
    expect(nameLineOf(ARABIC_MONITOR)).not.toHaveAttribute("dir");
  });

  /*
   * The cell shows a name cut short in full under the pointer
   * (FullValueTitle): its item no longer runs past its box - its name's
   * line does, and ends in its own "...". jsdom lays nothing out, so the
   * line is handed its widths and its ellipsis here.
   */
  test("a name cut short at its own end still shows in full under the pointer", () => {
    drawRows({ language: "fa", rows: [MONITOR_HOST_AND_SERVICE()] });

    const line: HTMLElement = nameLineOf(ENGLISH_MONITOR);
    const item: HTMLElement = line.closest("a")!.parentElement as HTMLElement;

    Object.defineProperty(line, "scrollWidth", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(line, "clientWidth", {
      configurable: true,
      value: 290,
    });
    line.style.textOverflow = "ellipsis";

    fireEvent.mouseEnter(item);

    expect(item).toHaveAttribute("title", ENGLISH_MONITOR);

    // A name that fits gets no tooltip repeating it.
    const host: HTMLElement = nameLineOf(ENGLISH_HOST).closest("a")!
      .parentElement as HTMLElement;

    fireEvent.mouseEnter(host);

    expect(host).not.toHaveAttribute("title");
  });
});

describe("on an English page", () => {
  test("each name is drawn with its line's classes and no dir; nothing in the cell has one", () => {
    drawRows({ language: "en", rows: [MONITOR_HOST_AND_SERVICE()] });

    for (const name of [ENGLISH_MONITOR, ENGLISH_HOST]) {
      const line: HTMLElement = nameLineOf(name);

      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
    }

    expect(serviceLineOf(ENGLISH_SERVICE).getAttribute("class")).toBe(
      RECORD_LINK_NAME_LINE_CLASS_NAME,
    );
    expect(cellOf(ENGLISH_MONITOR).querySelector("[dir]")).toBeNull();
  });

  test("a Persian name reads right to left, as wide as its words", () => {
    const persian: string = "حافظه گره‌ها در اروپا بالا است";

    drawRows({
      language: "en",
      rows: [{ monitors: [named(new Monitor(), persian)] }],
    });

    const line: HTMLElement = nameLineOf(persian);

    expect(line).toHaveAttribute("dir", "rtl");
    expect(line).toHaveClass(...CLAMPED_CLASSES);
  });
});

/*
 * Every kind of resource the cell lists - eighteen, AffectedResourcesCell's
 * ResourceItem - in its own row, named in English on a Persian page.
 */
interface ResourceKind {
  kind: string;
  englishName: string;
  resources: () => AffectedResources;
  // Where the name is drawn: a record link's line, or a service's.
  lineOf: (name: string) => HTMLElement;
}

const RESOURCE_KINDS: Array<ResourceKind> = [
  {
    kind: "monitor",
    englishName: "Checkout API p95 latency (EU)",
    resources: (): AffectedResources => {
      return {
        monitors: [named(new Monitor(), "Checkout API p95 latency (EU)")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "host",
    englishName: "db-primary-eu-west-1",
    resources: (): AffectedResources => {
      return { hosts: [named(new Host(), "db-primary-eu-west-1")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "network device",
    englishName: "core-switch-fra-02",
    resources: (): AffectedResources => {
      return {
        networkDevices: [named(new NetworkDevice(), "core-switch-fra-02")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "Kubernetes cluster",
    englishName: "prod-eu-west-1 (GKE)",
    resources: (): AffectedResources => {
      return {
        kubernetesClusters: [
          named(new KubernetesCluster(), "prod-eu-west-1 (GKE)"),
        ],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "Docker host",
    englishName: "docker-builder-3",
    resources: (): AffectedResources => {
      return { dockerHosts: [named(new DockerHost(), "docker-builder-3")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "Podman host",
    englishName: "podman-edge-7",
    resources: (): AffectedResources => {
      return { podmanHosts: [named(new PodmanHost(), "podman-edge-7")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "Proxmox cluster",
    englishName: "pve-lab-cluster",
    resources: (): AffectedResources => {
      return {
        proxmoxClusters: [named(new ProxmoxCluster(), "pve-lab-cluster")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "OpenStack cloud",
    englishName: "openstack-region-one",
    resources: (): AffectedResources => {
      return {
        openStackClouds: [named(new OpenStackCloud(), "openstack-region-one")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "VMware vCenter",
    englishName: "vcenter-fra.acme.internal",
    resources: (): AffectedResources => {
      return {
        vmwareVCenters: [
          named(new VMwareVCenter(), "vcenter-fra.acme.internal"),
        ],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "Ceph cluster",
    englishName: "ceph-object-store",
    resources: (): AffectedResources => {
      return { cephClusters: [named(new CephCluster(), "ceph-object-store")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "storage array",
    englishName: "netapp-a400-fra",
    resources: (): AffectedResources => {
      return { storageArrays: [named(new StorageArray(), "netapp-a400-fra")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "Docker Swarm cluster",
    englishName: "swarm-ingress",
    resources: (): AffectedResources => {
      return {
        dockerSwarmClusters: [named(new DockerSwarmCluster(), "swarm-ingress")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "IoT fleet",
    englishName: "warehouse-sensors",
    resources: (): AffectedResources => {
      return { iotFleets: [named(new IoTFleet(), "warehouse-sensors")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "database server",
    englishName: "orders-postgres-16",
    resources: (): AffectedResources => {
      return {
        databaseServers: [named(new DatabaseServer(), "orders-postgres-16")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "cloud resource",
    englishName: "checkout-bucket (S3)",
    resources: (): AffectedResources => {
      return {
        cloudResources: [named(new CloudResource(), "checkout-bucket (S3)")],
      };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "network site",
    englishName: "Frankfurt DC2",
    resources: (): AffectedResources => {
      return { networkSites: [named(new NetworkSite(), "Frankfurt DC2")] };
    },
    lineOf: nameLineOf,
  },
  {
    kind: "service",
    englishName: "payments-worker",
    resources: (): AffectedResources => {
      return { services: [serviceNamed("payments-worker")] };
    },
    lineOf: serviceLineOf,
  },
  {
    kind: "SLO",
    englishName: "Checkout availability 99.9%",
    resources: (): AffectedResources => {
      return {
        serviceLevelObjectives: [
          named(new ServiceLevelObjective(), "Checkout availability 99.9%"),
        ],
      };
    },
    lineOf: nameLineOf,
  },
];

test("every kind of resource the cell lists is drawn here, eighteen of them", () => {
  expect(RESOURCE_KINDS).toHaveLength(18);
});

describe.each(
  RESOURCE_KINDS.map((each: ResourceKind): [string, ResourceKind] => {
    return [each.kind, each];
  }),
)("a %s named in English", (_kind: string, resource: ResourceKind) => {
  test("on a Persian page reads left to right, cut short at its own end", () => {
    drawRows({ language: "fa", rows: [resource.resources()] });

    const line: HTMLElement = resource.lineOf(resource.englishName);

    expect(line).toHaveAttribute("dir", "ltr");
    expect(line).toHaveClass(...NAME_LINE_CLASSES, ...CLAMPED_CLASSES);
    expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    // Its link, and the mark beside it, keep the page's way.
    expect(line.closest("a")).not.toHaveAttribute("dir");
    expect(line.parentElement).not.toHaveAttribute("dir");
  });

  test("on an English page has no dir", () => {
    drawRows({ language: "en", rows: [resource.resources()] });

    const line: HTMLElement = resource.lineOf(resource.englishName);

    expect(line).not.toHaveAttribute("dir");
    expect(line.getAttribute("class")).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
  });
});

/*
 * On a phone each row is a card, and its resources' names run onto the
 * next line instead of ending in "..." (TABLE_CARD_LIST_ITEM_CLASS_NAME).
 * The review of #6736 drew the incidents list in Arabic at 390px: an
 * English name's wrapped lines lined up on the right.
 */
describe("on a phone's card", () => {
  test.each(["ar", "fa"])(
    "on a %s page each English name is its own line, read left to right; the card's value keeps the page's way",
    (language: string) => {
      drawRows({
        language: language,
        rows: [MONITOR_HOST_AND_SERVICE()],
        isMobile: true,
      });

      for (const name of [ENGLISH_MONITOR, ENGLISH_HOST]) {
        const line: HTMLElement = nameLineOf(name);

        expect(line).toHaveAttribute("dir", "ltr");
        expect(line).toHaveClass(...NAME_LINE_CLASSES, ...CLAMPED_CLASSES);

        // Its item wraps it rather than cut it short.
        const item: HTMLElement = line.closest("a")!
          .parentElement as HTMLElement;

        expect(item.getAttribute("class")).toBe(
          TABLE_CARD_LIST_ITEM_CLASS_NAME,
        );
        expect(item).not.toHaveAttribute("dir");
      }

      expect(serviceLineOf(ENGLISH_SERVICE)).toHaveAttribute("dir", "ltr");

      /*
       * The field's value draws more than words (an icon beside each
       * name), so it keeps the card's way; its names read their own.
       */
      const value: HTMLElement = nameLineOf(ENGLISH_MONITOR).closest(
        "dd",
      ) as HTMLElement;

      expect(value).not.toHaveAttribute("dir");
      expect(value.getAttribute("class")).toBe(
        TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
      );
      expect(within(value).getAllByRole("link")).toHaveLength(3);
    },
  );

  test("on an English page nothing in the card has a dir", () => {
    const holder: HTMLElement = drawRows({
      language: "en",
      rows: [MONITOR_HOST_AND_SERVICE()],
      isMobile: true,
    });

    // But the title's own isolate (IsolatedText's <bdi>), as always.
    expect(holder.querySelectorAll("[dir]:not(bdi)")).toHaveLength(0);
    expect(
      nameLineOf(ENGLISH_MONITOR).closest("dd")!.getAttribute("class"),
    ).toBe(TABLE_MOBILE_FIELD_VALUE_CLASS_NAME);
  });
});
