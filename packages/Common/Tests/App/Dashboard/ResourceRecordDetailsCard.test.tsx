import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * #5307's follow-up: the Details card of a resource Overview whose facts are
 * its record's columns - a Docker or Podman host's, a Kubernetes, Proxmox or
 * Ceph cluster's, a vCenter's, a storage array's and a host's - drawn for
 * real through ResourceRecordDetailsCard, over a fake read of the record.
 *
 * These cards repeated what the page had already said: the hero's name, its
 * description and when it was last seen, and the header's labels, as
 * "Display Name", "Description", "Last Seen" and "Labels" rows, and "Not
 * reported" for every fact a new resource had not sent, in one column on
 * some pages and two on others. Now: only what the resource reported, two
 * columns from 640px, "No details reported yet." when it has reported
 * nothing, the record's ID line at the foot, Edit in Settings in the header
 * and a phone's Labels card under it.
 */

const getItemMock: MockFunction = getJestMockFunction();

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import ResourceRecordDetailsCard, {
  getFactColumn,
  getResourceRecordDetailFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetailsCard";
import {
  RESOURCE_RECORD_DETAILS_COLUMNS,
  RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE,
  RESOURCE_RECORD_DETAILS_HEADER_LAYOUT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetails";
import {
  CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES,
  CARD_HEADER_LAYOUTS,
  CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
  CARD_HEADER_TITLE_LINE_CLASS_NAMES,
} from "../../../UI/Components/Card/Card";
import { RESOURCE_LABELS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceLabelsCard";
import { EDIT_IN_SETTINGS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import Select from "../../../Types/BaseDatabase/Select";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { getDetailGridClassName } from "../../../UI/Components/Detail/DetailGridLayout";
import ModelDetailField from "../../../UI/Components/ModelDetail/Field";
import FieldType from "../../../UI/Components/Types/FieldType";

const HOST_ID: string = "6d1c4b2e-0000-4000-8000-000000000042";
const SETTINGS: string = `/dashboard/p/docker/${HOST_ID}/settings`;

// A Docker host's facts, as its Overview hands them over.
const FACTS: Array<ModelDetailField<DockerHost>> = [
  {
    field: { hostIdentifier: true },
    title: "Host Name (host.name)",
    fieldType: FieldType.Text,
  },
  {
    field: { osType: true },
    title: "OS Type",
    fieldType: FieldType.Text,
  },
  {
    field: { osVersion: true },
    title: "OS Version",
    fieldType: FieldType.Text,
  },
  {
    field: { agentVersion: true },
    title: "Agent Version",
    fieldType: FieldType.Element,
    getElement: (item: DockerHost): React.ReactElement => {
      return <span data-testid="agent-version">{item.agentVersion}</span>;
    },
  },
];

function label(name: string): Label {
  const item: Label = new Label();
  item.name = name;
  item.color = new Color("#4f46e5");
  return item;
}

function host(values: Partial<DockerHost>): DockerHost {
  const item: DockerHost = new DockerHost();
  item._id = HOST_ID;
  Object.assign(item, values);
  return item;
}

// Everything the hero and the header already say, on every host read here.
const SAID_ELSEWHERE: Partial<DockerHost> = {
  name: "build-agent-07",
  description: "Builds every pull request's images.",
  lastSeenAt: new Date("2026-11-02T08:00:00.000Z"),
  otelCollectorStatus: "connected",
};

const REPORTED: Partial<DockerHost> = {
  ...SAID_ELSEWHERE,
  hostIdentifier: "build-agent-07.eu-west-1.compute.internal",
  osType: "linux",
  osVersion: "Ubuntu 24.04.1 LTS",
  agentVersion: "0.161.1",
};

function renderCard(props: {
  item: DockerHost;
  facts?: Array<ModelDetailField<DockerHost>>;
  refresher?: boolean;
}): ReturnType<typeof render> {
  getItemMock.mockResolvedValue(props.item as never);
  return render(
    <MemoryRouter>
      <ResourceRecordDetailsCard<DockerHost>
        modelType={DockerHost}
        modelId={new ObjectID(HOST_ID)}
        id="docker-host-details"
        title="Docker Host Details"
        settingsRoute={new Route(SETTINGS)}
        refresher={props.refresher}
        facts={props.facts || FACTS}
      />
    </MemoryRouter>,
  );
}

async function detail(): Promise<HTMLElement> {
  return await waitFor((): HTMLElement => {
    const element: HTMLElement | null = document.getElementById(
      "docker-host-details",
    );
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
}

// The rows' labels, in the order the card draws them.
async function rowLabels(): Promise<Array<string>> {
  const element: HTMLElement = await detail();
  return Array.from(element.querySelectorAll("label")).map(
    (row: Element): string => {
      return (row.textContent || "").trim();
    },
  );
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("the card says only what the resource reported", () => {
  test("a reported host: its facts, in the page's order", async () => {
    renderCard({ item: host(REPORTED) });

    expect(await rowLabels()).toEqual([
      "Host Name (host.name)",
      "OS Type",
      "OS Version",
      "Agent Version",
    ]);
    expect(
      screen.getByText("build-agent-07.eu-west-1.compute.internal"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-version")).toHaveTextContent("0.161.1");
  });

  test("a fact it has not reported is no row: never Not reported, never a dash", async () => {
    renderCard({
      item: host({
        ...SAID_ELSEWHERE,
        hostIdentifier: "build-agent-07",
        osVersion: "   ",
      }),
    });

    expect(await rowLabels()).toEqual(["Host Name (host.name)"]);
    const element: HTMLElement = await detail();
    expect(element).not.toHaveTextContent("Not reported");
    expect(element).not.toHaveTextContent("—");
    // An element fact is not drawn for a version it does not have.
    expect(screen.queryByTestId("agent-version")).toBeNull();
  });

  test("never what the hero and the header say: no name, description, last seen, status or labels row", async () => {
    renderCard({
      item: host({
        ...REPORTED,
        labels: [label("production")],
      }),
    });

    const element: HTMLElement = await detail();
    for (const repeated of [
      "Display Name",
      "Name",
      "Description",
      "Last Seen",
      "Labels",
      "Collector Status",
    ]) {
      expect(await rowLabels()).not.toContain(repeated);
    }
    expect(within(element).queryByText("build-agent-07")).toBeNull();
    expect(element).not.toHaveTextContent(
      "Builds every pull request's images.",
    );
    expect(element).not.toHaveTextContent("connected");
    expect(element).not.toHaveTextContent("production");
  });

  test("nothing reported yet: one line says so, and the ID line follows it", async () => {
    renderCard({ item: host(SAID_ELSEWHERE) });

    const element: HTMLElement = await detail();
    const empty: HTMLElement = within(element).getByTestId(
      "detail-empty-message",
    );
    expect(empty).toHaveTextContent(RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE);
    expect(RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE).toBe(
      "No details reported yet.",
    );
    expect(element.querySelector("label")).toBeNull();
    expect(empty.nextElementSibling).toBe(
      within(element).getByTestId("detail-record-line"),
    );
  });
});

describe("the card's shape", () => {
  test("two columns from 640px, on every page", async () => {
    renderCard({ item: host(REPORTED) });

    const element: HTMLElement = await detail();
    expect(RESOURCE_RECORD_DETAILS_COLUMNS).toBe(2);
    const grid: HTMLElement = element.firstElementChild as HTMLElement;
    expect(grid.getAttribute("class")).toBe(
      getDetailGridClassName(RESOURCE_RECORD_DETAILS_COLUMNS),
    );
    expect(grid).toHaveClass("sm:grid-cols-2");
  });

  test("the record's ID line ends it: the whole ID, to copy, in no row", async () => {
    renderCard({ item: host(REPORTED) });

    const element: HTMLElement = await detail();
    const line: HTMLElement = within(element).getByTestId("detail-id-line");
    expect(within(line).getByTestId("detail-id-value").textContent).toBe(
      HOST_ID,
    );
    expect(
      within(line).getByRole("button", { name: "Copy ID to clipboard" }),
    ).toBeInTheDocument();
    expect(await rowLabels()).not.toContain("ID");
    // Last: after every row.
    expect(element.lastElementChild).toBe(
      within(element).getByTestId("detail-record-line"),
    );
  });

  test("its title is its Settings card's, with Edit in Settings and no description", async () => {
    renderCard({ item: host(REPORTED) });
    await detail();

    expect(screen.getByText("Docker Host Details")).toBeInTheDocument();
    const link: HTMLElement = within(
      screen.getByTestId(EDIT_IN_SETTINGS_TEST_ID),
    ).getByRole("link");
    expect(link).toHaveAttribute("href", SETTINGS);
    expect(link).toHaveTextContent("Edit in Settings");
    // No Edit button opening a second form for the same fields.
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  });

  /*
   * The UI review of #5553: in the default header a title with nothing
   * under it hung 7px above the middle of the 38px "Edit in Settings"
   * beside it (they were level only at the top). The stacked header centres
   * the two on each other and keeps the header as tall as the title's line.
   */
  test("its title and Edit in Settings are centred on each other: a stacked header", async () => {
    renderCard({ item: host(REPORTED) });
    await detail();

    expect(RESOURCE_RECORD_DETAILS_HEADER_LAYOUT).toBe("stacked");
    expect(CARD_HEADER_LAYOUTS).toContain(
      RESOURCE_RECORD_DETAILS_HEADER_LAYOUT,
    );

    const header: HTMLElement = screen.getByTestId("card-header");
    expect(header).toHaveAttribute("data-header-layout", "stacked");

    // The title's line centres the actions on it, from md up.
    const titleRow: HTMLElement = within(header).getByTestId(
      "card-header-title-row",
    );
    expect(titleRow).toHaveClass(
      CARD_HEADER_TITLE_LINE_CLASS_NAMES.besideActions,
    );

    // Nothing follows the line: the button hangs only above it ...
    const actions: HTMLElement = within(header).getByTestId(
      "card-header-actions",
    );
    expect(actions).toHaveClass(
      CARD_HEADER_ACTIONS_BESIDE_TITLE_CLASS_NAMES.overNothing,
    );
    expect(actions).toContainElement(
      screen.getByTestId(EDIT_IN_SETTINGS_TEST_ID),
    );
    // ... and the title takes the same room under it.
    expect(within(header).getByTestId("card-header-title-block")).toHaveClass(
      CARD_HEADER_TITLE_BLOCK_OVER_NOTHING_CLASS_NAME,
    );
    expect(within(header).queryByTestId("card-description")).toBeNull();
  });
});

describe("the labels: a phone's card under the details", () => {
  test("read with the record and drawn under the card, from 640px hidden", async () => {
    renderCard({
      item: host({
        ...REPORTED,
        labels: [label("production"), label("team-ci")],
      }),
    });

    const card: HTMLElement = await screen.findByTestId(
      RESOURCE_LABELS_TEST_ID,
    );
    expect(card).toHaveClass("sm:hidden");
    expect(card).toHaveTextContent("production");
    expect(card).toHaveTextContent("team-ci");
    // Under the Details card, not inside it.
    expect(await detail()).not.toContainElement(card);
  });

  test("no labels, no card", async () => {
    renderCard({ item: host({ ...REPORTED, labels: [] }) });
    await detail();

    expect(screen.queryByTestId(RESOURCE_LABELS_TEST_ID)).toBeNull();
  });
});

describe("what the card reads", () => {
  test("the facts' columns, the ID and the labels: never the hero's name, description, last seen or status", async () => {
    renderCard({ item: host(REPORTED) });
    await detail();

    const call: { select: Record<string, unknown>; id: ObjectID } = getItemMock
      .mock.calls[0]![0] as { select: Record<string, unknown>; id: ObjectID };
    expect(call.id.toString()).toBe(HOST_ID);
    expect(Object.keys(call.select).sort()).toEqual(
      [
        "_id",
        "agentVersion",
        "hostIdentifier",
        "labels",
        "osType",
        "osVersion",
      ].sort(),
    );
    expect(call.select["labels"]).toEqual({ name: true, color: true });
  });

  test("a page's refresh reads the record again", async () => {
    const view: ReturnType<typeof render> = renderCard({
      item: host(REPORTED),
      refresher: false,
    });
    await detail();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    getItemMock.mockResolvedValue(
      host({ ...REPORTED, agentVersion: "0.162.0" }) as never,
    );
    await act(async () => {
      view.rerender(
        <MemoryRouter>
          <ResourceRecordDetailsCard<DockerHost>
            modelType={DockerHost}
            modelId={new ObjectID(HOST_ID)}
            id="docker-host-details"
            title="Docker Host Details"
            settingsRoute={new Route(SETTINGS)}
            refresher={true}
            facts={FACTS}
          />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("agent-version")).toHaveTextContent("0.162.0");
    });
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});

describe("the fields the card hands its detail", () => {
  test("each fact is drawn only once its column holds something", () => {
    const fields: Array<ModelDetailField<DockerHost>> =
      getResourceRecordDetailFields<DockerHost>(FACTS);
    const osVersion: ModelDetailField<DockerHost> = fields[2]!;

    expect(osVersion.title).toBe("OS Version");
    expect(osVersion.showIf!(host({ osVersion: "Ubuntu 24.04" }))).toBe(true);
    expect(osVersion.showIf!(host({ osVersion: "" }))).toBe(false);
    expect(osVersion.showIf!(host({ osVersion: "  " }))).toBe(false);
    expect(osVersion.showIf!(host({}))).toBe(false);
  });

  test("a fact that says when itself keeps its own rule", () => {
    const always: () => boolean = (): boolean => {
      return true;
    };
    const fields: Array<ModelDetailField<DockerHost>> =
      getResourceRecordDetailFields<DockerHost>([
        {
          field: { agentVersion: true },
          title: "Collected By",
          fieldType: FieldType.Text,
          showIf: always,
        },
      ]);

    expect(fields[0]!.showIf).toBe(always);
    expect(fields[0]!.showIf!(host({}))).toBe(true);
  });

  test("the record's own ID comes last, for the ID line", () => {
    const fields: Array<ModelDetailField<DockerHost>> =
      getResourceRecordDetailFields<DockerHost>(FACTS);

    expect(fields).toHaveLength(FACTS.length + 1);
    expect(fields[fields.length - 1]).toEqual({
      field: { _id: true } as Select<DockerHost>,
      title: "ID",
      fieldType: FieldType.ObjectID,
    });
  });

  test("a fact's column is the first its field reads", () => {
    expect(getFactColumn<DockerHost>(FACTS[0]!)).toBe("hostIdentifier");
    expect(
      getFactColumn<DockerHost>({
        title: "Nothing",
        fieldType: FieldType.Text,
      } as ModelDetailField<DockerHost>),
    ).toBe("");
  });

  test("the page's facts are left as the page wrote them", () => {
    const before: string = JSON.stringify(
      FACTS.map((fact: ModelDetailField<DockerHost>) => {
        return [fact.title, Boolean(fact.showIf)];
      }),
    );
    getResourceRecordDetailFields<DockerHost>(FACTS);

    expect(
      JSON.stringify(
        FACTS.map((fact: ModelDetailField<DockerHost>) => {
          return [fact.title, Boolean(fact.showIf)];
        }),
      ),
    ).toBe(before);
  });
});
