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
 * A RECORD'S NAME BESIDE ITS KIND'S ICON, READ THE WAY IT IS WRITTEN
 * (#6740).
 *
 * MonitorElement and its eighteen siblings draw a record's name as a link
 * to it, and with showIcon (a row's Affected Resources) its kind's icon
 * beside it. That icon and name were one flex row with the name as bare
 * text in it, which a table's cell laid out as a line of the page's: on a
 * Persian alerts list, "High Node Memory Utilization on AllNodesInEuWest1"
 * read "...lNodesInEuWest1". Each now draws its name through
 * RecordLinkName: with its icon, the name is a line of its own
 * (IsolatedLine) that reads its own way and ends in its own "...".
 * Without its icon, the name is drawn exactly as it always was - a list on
 * a record's own name reads its line from the record, and a table's cell
 * lays that link out as a line of text (TableLayout's
 * TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES).
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

import RecordLinkName, {
  RECORD_LINK_ICON_CLASS_NAME,
  RECORD_LINK_NAME_LINE_CLASS_NAME,
  RECORD_LINK_NAME_ROW_CLASS_NAME,
  RECORD_LINK_NAME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/RecordLink/RecordLinkName";
import MonitorElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor";
import HostElement from "../../../../App/FeatureSet/Dashboard/src/Components/Host/Host";
import NetworkDeviceElement from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/NetworkDeviceElement";
import KubernetesClusterElement from "../../../../App/FeatureSet/Dashboard/src/Components/KubernetesCluster/KubernetesCluster";
import DockerHostElement from "../../../../App/FeatureSet/Dashboard/src/Components/DockerHost/DockerHost";
import PodmanHostElement from "../../../../App/FeatureSet/Dashboard/src/Components/PodmanHost/PodmanHost";
import ProxmoxClusterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxClusterElement";
import OpenStackCloudElement from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCloudElement";
import VMwareVCenterElement from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareVCenterElement";
import CephClusterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephClusterElement";
import StorageArrayElement from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayElement";
import DockerSwarmClusterElement from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmClusterElement";
import IoTFleetElement from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/IoTFleetElement";
import DatabaseServerElement from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerElement";
import CloudResourceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceElement";
import NetworkSiteElement from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/NetworkSiteElement";
import SloElement from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloElement";
import RunnerElement from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/Runner";
import MonitorGroupElement from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupElement";
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
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Runner from "../../../Models/DatabaseModels/Runner";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../../../UI/Components/Icon/Icon";
import { isWrappingLineClassName } from "../../../UI/Components/IsolatedText/IsolatedLine";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES } from "../../../UI/Components/Table/TableLayout";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const RECORD_ID: string = "0193c0de-6740-4aaa-8bbb-000000000001";
const ENGLISH_NAME: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";
const ARABIC_NAME: string = "ذاكرة العقد مرتفعة في الاتحاد الأوروبي";
const PERSIAN_NAME: string = "حافظه گره‌ها در اروپا بالا است";

const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");
const NAME_LINE_CLASSES: Array<string> =
  RECORD_LINK_NAME_LINE_CLASS_NAME.split(" ");

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

// The svg an icon draws, to tell one kind's icon from another's.
const iconMarkupOf: (icon: IconProp) => string = (icon: IconProp): string => {
  const { container } = render(
    <Icon icon={icon} className={RECORD_LINK_ICON_CLASS_NAME} />,
  );
  const markup: string = container.querySelector("svg")?.outerHTML || "";

  cleanup();

  return markup;
};

describe("RecordLinkName with its kind's icon", () => {
  test.each(["ar", "fa"])(
    "on a %s page an English name is a line of its own that reads left to right, beside the icon",
    (language: string) => {
      const holder: HTMLElement = drawOn(
        language,
        <RecordLinkName name={ENGLISH_NAME} icon={IconProp.AltGlobe} />,
      );

      const row: HTMLElement = holder.firstElementChild as HTMLElement;
      const name: HTMLElement = screen.getByTestId(RECORD_LINK_NAME_TEST_ID);

      // The row: the icon, then the name - the page's way, gap not margin.
      expect(row.tagName).toBe("SPAN");
      expect(row.getAttribute("class")).toBe(RECORD_LINK_NAME_ROW_CLASS_NAME);
      expect(row).not.toHaveAttribute("dir");
      expect(row.children).toHaveLength(2);
      expect(row.lastElementChild).toBe(name);

      // The icon's box keeps the page's way: its place is the line's start.
      const iconBox: HTMLElement = row.firstElementChild as HTMLElement;

      expect(iconBox.tagName).toBe("DIV");
      expect(iconBox).not.toHaveAttribute("dir");
      expect(iconBox.querySelector("svg")).toHaveClass(
        ...RECORD_LINK_ICON_CLASS_NAME.split(" "),
      );

      // The name: its own line, read its way, cut short at its own end.
      expect(name.tagName).toBe("SPAN");
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.textContent).toBe(ENGLISH_NAME);
      expect(name).toHaveClass(...NAME_LINE_CLASSES);
      /*
       * As wide as its words, at the page's start (beside the icon): its
       * wrapped lines on a phone's card each run from its own start.
       * Aligned to its end, each line lined up on the right.
       */
      expect(name).toHaveClass(...CLAMPED_CLASSES);
      expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test("on an English page an English name has no dir and no class of its own", () => {
    const holder: HTMLElement = drawOn(
      "en",
      <RecordLinkName name={ENGLISH_NAME} icon={IconProp.Server} />,
    );

    const name: HTMLElement = screen.getByTestId(RECORD_LINK_NAME_TEST_ID);

    expect(name).not.toHaveAttribute("dir");
    expect(name.getAttribute("class")).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
    expect(holder.querySelector("[dir]")).toBeNull();
  });

  test("an Arabic name on an Arabic page, and a Persian one on a Persian page, read the page's way", () => {
    drawOn("ar", <RecordLinkName name={ARABIC_NAME} icon={IconProp.Server} />);

    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID)).not.toHaveAttribute(
      "dir",
    );
    expect(
      screen.getByTestId(RECORD_LINK_NAME_TEST_ID).getAttribute("class"),
    ).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);

    cleanup();

    drawOn("fa", <RecordLinkName name={PERSIAN_NAME} icon={IconProp.Server} />);

    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID)).not.toHaveAttribute(
      "dir",
    );
  });

  test("a Persian name on an English page reads right to left, as wide as its words", () => {
    drawOn("en", <RecordLinkName name={PERSIAN_NAME} icon={IconProp.Server} />);

    const name: HTMLElement = screen.getByTestId(RECORD_LINK_NAME_TEST_ID);

    expect(name).toHaveAttribute("dir", "rtl");
    expect(name).toHaveClass(...CLAMPED_CLASSES);
    expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("a name with no letters (an address) reads as the page does", () => {
    drawOn("fa", <RecordLinkName name="10.20.0.14" icon={IconProp.Server} />);

    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID)).not.toHaveAttribute(
      "dir",
    );
  });

  test("a record with no name draws an empty line, not 'undefined'", () => {
    const holder: HTMLElement = drawOn(
      "fa",
      <RecordLinkName name={undefined} icon={IconProp.Server} />,
    );

    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID).textContent).toBe("");
    expect(holder.textContent).toBe("");
  });

  test("a name is text, never markup", () => {
    const hostile: string = '<img src="x" onerror="alert(1)"> checkout-api';
    const holder: HTMLElement = drawOn(
      "ar",
      <RecordLinkName name={hostile} icon={IconProp.Server} />,
    );

    expect(holder.querySelector("img")).toBeNull();
    expect(screen.getByTestId(RECORD_LINK_NAME_TEST_ID).textContent).toBe(
      hostile,
    );
  });
});

describe("RecordLinkName without an icon", () => {
  test.each(["en", "ar", "fa"])(
    "on a %s page draws the name alone, exactly as it always was",
    (language: string) => {
      const holder: HTMLElement = drawOn(
        language,
        <RecordLinkName name={ENGLISH_NAME} />,
      );

      /*
       * One flex span, its words a space and the name: the shape a table's
       * cell lays out as a line of text.
       */
      expect(holder.innerHTML).toBe(
        `<span class="flex"> ${ENGLISH_NAME}</span>`,
      );
      expect(holder.querySelector("[dir]")).toBeNull();
      expect(screen.queryByTestId(RECORD_LINK_NAME_TEST_ID)).toBeNull();
    },
  );

  test("a record with no name draws the empty span it always did", () => {
    const holder: HTMLElement = drawOn(
      "en",
      <RecordLinkName name={undefined} />,
    );

    expect(holder.innerHTML).toBe(`<span class="flex"> </span>`);
  });
});

/*
 * The classes hold what the layout needs, so a later edit that swaps one
 * for a look-alike says so here rather than on an Arabic page.
 */
describe("the classes the row and its line are drawn with", () => {
  test("the row is a flex row that may shrink, its icon and name apart by a gap, not a margin", () => {
    const classes: Array<string> = RECORD_LINK_NAME_ROW_CLASS_NAME.split(" ");
    // A margin or a padding on one side: space-x-1, mr-1, ms-2, pl-1.
    const SPACING_CLASS_NAME_PATTERN: RegExp =
      /^(?:space-x-|m[rlse]-|p[rlse]-)/;

    expect(classes).toEqual(
      expect.arrayContaining(["flex", "min-w-0", "items-start", "gap-2"]),
    );
    // A margin on one side (space-x, mr-1) lands on the name's far side.
    expect(
      classes.filter((token: string): boolean => {
        return SPACING_CLASS_NAME_PATTERN.test(token);
      }),
    ).toEqual([]);
  });

  test("a table's cell leaves the row alone: its record-link converter matches only the bare flex span", () => {
    expect(RECORD_LINK_NAME_ROW_CLASS_NAME).not.toBe("flex");
    expect(TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES).toContain(
      "span[class=flex]",
    );
  });

  test("the name's line shrinks, cuts itself short with '...', and wraps where its holder lets it", () => {
    expect(NAME_LINE_CLASSES).toEqual(
      expect.arrayContaining([
        "min-w-0",
        "overflow-hidden",
        "text-ellipsis",
        "[overflow-wrap:anywhere]",
      ]),
    );
    // Not one line by itself: a phone's card wraps a long name.
    expect(NAME_LINE_CLASSES).not.toContain("truncate");
    expect(NAME_LINE_CLASSES).not.toContain("whitespace-nowrap");
    // Said to wrap, so a line the other way is as wide as its words.
    expect(isWrappingLineClassName(RECORD_LINK_NAME_LINE_CLASS_NAME)).toBe(
      true,
    );
  });

  test("the icon is centred on the name's first line as an inline box, 20px square", () => {
    expect(RECORD_LINK_ICON_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["inline-block", "align-middle", "h-5", "w-5"]),
    );
  });
});

/*
 * Every record link that draws a kind's icon: the eighteen a row's
 * Affected Resources lists (AffectedResourcesCell, but ServiceElement,
 * whose name was a line of its own already) and the two more that take
 * showIcon (a runner, a monitor group).
 */
interface RecordElement {
  element: string;
  icon: IconProp;
  draw: (data: {
    id?: string | undefined;
    name: string;
    showIcon?: boolean | undefined;
  }) => ReactElement;
}

type NamedModel = { _id?: string | undefined; name?: string | undefined };

const named: <T extends NamedModel>(
  model: T,
  data: { id?: string | undefined; name: string },
) => T = <T extends NamedModel>(
  model: T,
  data: { id?: string | undefined; name: string },
): T => {
  if (data.id) {
    model._id = data.id;
  }
  model.name = data.name;
  return model;
};

const RECORD_ELEMENTS: Array<RecordElement> = [
  {
    element: "MonitorElement",
    icon: IconProp.AltGlobe,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <MonitorElement
          monitor={named(new Monitor(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "HostElement",
    icon: IconProp.Server,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <HostElement host={named(new Host(), data)} showIcon={data.showIcon} />
      );
    },
  },
  {
    element: "NetworkDeviceElement",
    icon: IconProp.Signal,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <NetworkDeviceElement
          networkDevice={named(new NetworkDevice(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "KubernetesClusterElement",
    icon: IconProp.Kubernetes,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <KubernetesClusterElement
          kubernetesCluster={named(new KubernetesCluster(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "DockerHostElement",
    icon: IconProp.Docker,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <DockerHostElement
          dockerHost={named(new DockerHost(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "PodmanHostElement",
    icon: IconProp.Podman,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <PodmanHostElement
          podmanHost={named(new PodmanHost(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "ProxmoxClusterElement",
    icon: IconProp.Proxmox,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <ProxmoxClusterElement
          proxmoxCluster={named(new ProxmoxCluster(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "OpenStackCloudElement",
    icon: IconProp.Cloud,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <OpenStackCloudElement
          openStackCloud={named(new OpenStackCloud(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "VMwareVCenterElement",
    icon: IconProp.VMware,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <VMwareVCenterElement
          vmwareVCenter={named(new VMwareVCenter(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "CephClusterElement",
    icon: IconProp.Ceph,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <CephClusterElement
          cephCluster={named(new CephCluster(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "StorageArrayElement",
    icon: IconProp.StorageArray,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <StorageArrayElement
          storageArray={named(new StorageArray(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "DockerSwarmClusterElement",
    icon: IconProp.DockerSwarm,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <DockerSwarmClusterElement
          dockerSwarmCluster={named(new DockerSwarmCluster(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "IoTFleetElement",
    icon: IconProp.IoT,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <IoTFleetElement
          iotFleet={named(new IoTFleet(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "DatabaseServerElement",
    icon: IconProp.Database,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <DatabaseServerElement
          databaseServer={named(new DatabaseServer(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "CloudResourceElement",
    icon: IconProp.Cloud,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <CloudResourceElement
          cloudResource={named(new CloudResource(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "NetworkSiteElement",
    icon: IconProp.BuildingOffice,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <NetworkSiteElement
          networkSite={named(new NetworkSite(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "SloElement",
    icon: IconProp.Gauge,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <SloElement
          serviceLevelObjective={named(new ServiceLevelObjective(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "RunnerElement",
    icon: IconProp.Terminal,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <RunnerElement
          runner={named(new Runner(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
  {
    element: "MonitorGroupElement",
    icon: IconProp.Squares,
    draw: (data: {
      id?: string | undefined;
      name: string;
      showIcon?: boolean | undefined;
    }): ReactElement => {
      return (
        <MonitorGroupElement
          monitorGroup={named(new MonitorGroup(), data)}
          showIcon={data.showIcon}
        />
      );
    },
  },
];

test("every record link that draws a kind's icon is drawn here, nineteen of them", () => {
  expect(RECORD_ELEMENTS).toHaveLength(19);
  expect(
    new Set(
      RECORD_ELEMENTS.map((each: RecordElement): string => {
        return each.element;
      }),
    ).size,
  ).toBe(19);
});

describe.each(
  RECORD_ELEMENTS.map((each: RecordElement): [string, RecordElement] => {
    return [each.element, each];
  }),
)("<%s>", (_element: string, record: RecordElement) => {
  test.each(["ar", "fa"])(
    "with its icon, on a %s page, its English name is a line of its own read left to right, its icon beside it",
    (language: string) => {
      const expectedIcon: string = iconMarkupOf(record.icon);

      drawOn(
        language,
        record.draw({ id: RECORD_ID, name: ENGLISH_NAME, showIcon: true }),
      );

      const link: HTMLElement = screen.getByRole("link");
      const name: HTMLElement = screen.getByTestId(RECORD_LINK_NAME_TEST_ID);

      // Still the link to the record, its hover underline and all.
      expect(link.getAttribute("href")).toContain(RECORD_ID);
      expect(link).toHaveClass("hover:underline");
      expect(link).toHaveTextContent(ENGLISH_NAME);

      // Its row, its kind's icon, then its name's own line.
      const row: HTMLElement = link.firstElementChild as HTMLElement;

      expect(row.getAttribute("class")).toBe(RECORD_LINK_NAME_ROW_CLASS_NAME);
      expect(row).not.toHaveAttribute("dir");
      expect(row.querySelector("svg")?.outerHTML).toBe(expectedIcon);
      expect(row.lastElementChild).toBe(name);

      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.textContent).toBe(ENGLISH_NAME);
      expect(name).toHaveClass(...NAME_LINE_CLASSES, ...CLAMPED_CLASSES);
      expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test("with its icon, on an English page, nothing has a dir", () => {
    const holder: HTMLElement = drawOn(
      "en",
      record.draw({ id: RECORD_ID, name: ENGLISH_NAME, showIcon: true }),
    );

    expect(holder.querySelector("[dir]")).toBeNull();
    expect(
      screen.getByTestId(RECORD_LINK_NAME_TEST_ID).getAttribute("class"),
    ).toBe(RECORD_LINK_NAME_LINE_CLASS_NAME);
  });

  test("without its icon, its name is drawn exactly as it always was", () => {
    const holder: HTMLElement = drawOn(
      "fa",
      record.draw({ id: RECORD_ID, name: ENGLISH_NAME }),
    );

    expect(holder.querySelector("svg")).toBeNull();
    expect(screen.getByRole("link").innerHTML).toBe(
      `<span class="flex"> ${ENGLISH_NAME}</span>`,
    );
  });

  test("without an id it is named, not linked, and draws no icon", () => {
    const holder: HTMLElement = drawOn(
      "fa",
      record.draw({ name: ENGLISH_NAME, showIcon: true }),
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(holder.innerHTML).toBe(`<span>${ENGLISH_NAME}</span>`);
  });
});
