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
  cleanup,
  render,
  RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident and scheduled maintenance wizards end on a review step that
 * lists what each earlier step picked. The "Resources Affected" step uses one
 * picker that writes to every resource relation the page hands it, and the
 * form holds what it picked as bare IDs. Its summary used to be hand-written
 * per page: it named monitors but only counted every other type ("3 Podman
 * hosts"), so the one place meant to confirm the choice never said which
 * hosts or services were picked - and a type the summary forgot was not even
 * counted. Pick only Podman hosts and it once said "No resources affected",
 * although the selection saved fine.
 *
 * The summary now renders the same picker, read-only, with the same resource
 * types as the editor; the picker looks the names of bare IDs up, so every
 * picked resource is named.
 *
 * The invariant pinned here: every resource prop the editor picker is given
 * is named in the summary. These tests drive the real pages, with ModelForm
 * mocked to capture the fields it is handed (as
 * CreateReviewStepSelectionSummary.test.tsx does), read the resource props
 * off the picker element the step renders, and render the step's summary
 * against a ModelAPI that knows a name for each resource under its own model
 * type only. A resource type added to a page's picker later is picked up
 * without edits here.
 */

type SummaryItem = Record<string, unknown>;

type CapturedField = {
  stepId?: string | undefined;
  getCustomElement?:
    | ((values: SummaryItem, elementProps: SummaryItem) => React.ReactElement)
    | undefined;
  getSummaryElement?: ((item: SummaryItem) => React.ReactElement) | undefined;
};

type CapturedFormProps = {
  fields: Array<CapturedField>;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  // Only the component is stubbed: the pages import FormType from here too.
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourcesPayload,
  NAME_LOADING_PLACEHOLDER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import ScheduledMaintenanceCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Project from "../../../Models/DatabaseModels/Project";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

const PROJECT_ID: string = "3b1d7c2e-5f4a-4e6b-9c8d-7a6f5e4d3c2b";

type ResourceProp = Exclude<
  keyof AffectedResourcesPayload,
  "__affectedResourcesPayload"
>;

type ResourceModel = BaseModel & {
  name?: string | undefined;
};

type ResourceModelType = { new (): BaseModel };

/*
 * Every relation the picker can write, and the model its names are looked up
 * in. A Record keyed by the payload's own fields, so a resource type added to
 * the picker fails to compile here until it is listed - and the API below
 * can tell whether a lookup went to the right model.
 */
const RESOURCE_PROPS: Record<ResourceProp, ResourceModelType> = {
  monitors: Monitor,
  hosts: Host,
  kubernetesClusters: KubernetesCluster,
  dockerHosts: DockerHost,
  podmanHosts: PodmanHost,
  proxmoxClusters: ProxmoxCluster,
  vmwareVCenters: VMwareVCenter,
  cephClusters: CephCluster,
  dockerSwarmClusters: DockerSwarmCluster,
  iotFleets: IoTFleet,
  databaseServers: DatabaseServer,
  networkSites: NetworkSite,
  services: Service,
};

const RESOURCE_PROP_NAMES: Array<ResourceProp> = Object.keys(
  RESOURCE_PROPS,
) as Array<ResourceProp>;

const NOTHING_SELECTED_PATTERN: RegExp = /No resources affected/;

type KnownResource = {
  modelType: ResourceModelType;
  name: string;
};

/*
 * The resources the API knows, by id. Each is known under the one model type
 * it was registered with: a lookup of that id against any other model finds
 * nothing, as the server would.
 */
const KNOWN_RESOURCES: Map<string, KnownResource> = new Map<
  string,
  KnownResource
>();

/*
 * Fresh ids of one resource type, each registered with the API under that
 * type's model and a name saying which prop and which pick it is, so a name
 * on screen can only have come from looking up that very id.
 */
function knownResources(prop: ResourceProp, count: number): Array<string> {
  const ids: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    const id: string = ObjectID.generate().toString();
    KNOWN_RESOURCES.set(id, {
      modelType: RESOURCE_PROPS[prop],
      name: `${prop} resource ${index + 1} ${id.slice(0, 8)}`,
    });
    ids.push(id);
  }

  return ids;
}

function nameOf(id: string): string {
  const known: KnownResource | undefined = KNOWN_RESOURCES.get(id);

  expect(known).toBeDefined();

  return known!.name;
}

type ListRequest = {
  modelType: unknown;
  query?: Record<string, unknown> | undefined;
  select?: Record<string, unknown> | undefined;
};

type ItemRequest = {
  modelType: unknown;
  id: ObjectID;
  select?: Record<string, unknown> | undefined;
};

type ListAnswer = {
  data: Array<ResourceModel>;
  count: number;
  skip: number;
  limit: number;
};

function listOf(data: Array<ResourceModel>): ListAnswer {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

async function answerList(request: ListRequest): Promise<ListAnswer> {
  const idQuery: unknown = request.query?.["_id"];

  /*
   * What the pages ask for on mount (the first incident state and the like)
   * has nothing to do with these summaries: an empty list.
   */
  if (!(idQuery instanceof Includes)) {
    return listOf([]);
  }

  const found: Array<ResourceModel> = [];

  for (const value of idQuery.values) {
    const id: string = value.toString();
    const known: KnownResource | undefined = KNOWN_RESOURCES.get(id);

    if (!known || known.modelType !== request.modelType) {
      continue;
    }

    const model: ResourceModel = new known.modelType() as ResourceModel;
    model._id = id;
    model.name = known.name;
    found.push(model);
  }

  return listOf(found);
}

type Lookup = {
  modelType: unknown;
  ids: Array<string>;
  select: unknown;
};

/*
 * Every request made since the page finished mounting, whichever of getItem
 * or getList carried it, as the model type, ids and columns it asked for.
 */
function lookupsMade(): Array<Lookup> {
  const itemLookups: Array<Lookup> = getItemMock.mock.calls.map(
    (call: Array<unknown>): Lookup => {
      const request: ItemRequest = call[0] as ItemRequest;
      return {
        modelType: request.modelType,
        ids: [request.id.toString()],
        select: request.select,
      };
    },
  );

  const listLookups: Array<Lookup> = getListMock.mock.calls.map(
    (call: Array<unknown>): Lookup => {
      const request: ListRequest = call[0] as ListRequest;
      const idQuery: unknown = request.query?.["_id"];
      const ids: Array<string> = [];

      if (idQuery instanceof Includes) {
        for (const value of idQuery.values) {
          ids.push(value.toString());
        }
      }

      return {
        modelType: request.modelType,
        ids: ids,
        select: request.select,
      };
    },
  );

  return [...itemLookups, ...listLookups];
}

// The lookup the picker should make for a batch of ids of one type.
function nameLookupOf(prop: ResourceProp, ids: Array<string>): Lookup {
  return {
    modelType: RESOURCE_PROPS[prop],
    ids: ids,
    select: expect.objectContaining({ _id: true, name: true }),
  };
}

type PageUnderTest = {
  name: string;
  component: React.FunctionComponent<PageComponentProps>;
  route: string;
  nothingSelectedMessage: string;
  // Offered on this page, so the checks below are not vacuous.
  mustOffer: Array<ResourceProp>;
};

const PAGES: Array<PageUnderTest> = [
  {
    name: "incident create",
    component: IncidentCreate,
    route: "/dashboard/incidents/create",
    nothingSelectedMessage: "No resources affected by this incident.",
    mustOffer: ["monitors", "podmanHosts", "databaseServers"],
  },
  {
    name: "scheduled maintenance create",
    component: ScheduledMaintenanceCreate,
    route: "/dashboard/scheduled-maintenance-events/create",
    nothingSelectedMessage:
      "No resources affected by this scheduled maintenance event.",
    mustOffer: ["monitors", "podmanHosts", "databaseServers", "networkSites"],
  },
];

type PickerStep = {
  resourceProps: Array<ResourceProp>;
  getSummaryElement: (item: SummaryItem) => React.ReactElement;
};

async function openForm(page: PageUnderTest): Promise<CapturedFormProps> {
  render(
    <MemoryRouter>
      <page.component
        pageRoute={new Route(page.route)}
        currentProject={new Project()}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
  });

  /*
   * Whatever the page asks for on mount has been asked by now, so from here
   * on every request is one a summary made.
   */
  getListMock.mockClear();
  getItemMock.mockClear();

  return capturedForm!;
}

/** The fields whose editor is the picker and that render a summary. */
function findPickerSteps(form: CapturedFormProps): Array<PickerStep> {
  const emptySelection: SummaryItem = {};
  for (const prop of RESOURCE_PROP_NAMES) {
    emptySelection[prop] = [];
  }

  const steps: Array<PickerStep> = [];

  for (const field of form.fields) {
    if (!field.getCustomElement || !field.getSummaryElement) {
      continue;
    }

    const editor: React.ReactElement = field.getCustomElement(emptySelection, {
      onChange: (): void => {},
    });

    if (editor.type !== AffectedResourcesPicker) {
      continue;
    }

    const editorProps: Record<string, unknown> = editor.props as Record<
      string,
      unknown
    >;

    steps.push({
      resourceProps: RESOURCE_PROP_NAMES.filter((prop: ResourceProp) => {
        return prop in editorProps;
      }),
      getSummaryElement: field.getSummaryElement,
    });
  }

  return steps;
}

async function openPickerStep(page: PageUnderTest): Promise<PickerStep> {
  const steps: Array<PickerStep> = findPickerSteps(await openForm(page));

  expect(steps).toHaveLength(1);

  return steps[0]!;
}

function renderStepSummary(step: PickerStep, item: SummaryItem): RenderResult {
  return render(<MemoryRouter>{step.getSummaryElement(item)}</MemoryRouter>);
}

/*
 * Whether the summary is still waiting on a name: the picker shows a
 * placeholder on a busy chip until the lookup for it lands.
 */
function isLookingUpNames(container: HTMLElement): boolean {
  return (
    container.querySelectorAll('[aria-busy="true"]').length > 0 ||
    (container.textContent || "").includes(NAME_LOADING_PLACEHOLDER)
  );
}

// Renders the step's summary and waits for every lookup it started to land.
async function renderSummary(
  step: PickerStep,
  item: SummaryItem,
): Promise<RenderResult> {
  const result: RenderResult = renderStepSummary(step, item);

  await waitFor(() => {
    expect(isLookingUpNames(result.container)).toBe(false);
  });

  return result;
}

/*
 * Waits for every name to show in the summary. Resolves false rather than
 * throwing when one never does, so a check over every resource type can
 * report all the types that fail at once.
 */
async function showsEveryName(
  container: HTMLElement,
  names: Array<string>,
): Promise<boolean> {
  try {
    await waitFor(() => {
      for (const name of names) {
        expect(within(container).getByText(name)).toBeInTheDocument();
      }
    });
    return true;
  } catch {
    return false;
  }
}

// Lets anything a summary might have started get as far as the API.
async function nextTick(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

describe("the Resources Affected summary step", () => {
  beforeEach(() => {
    capturedForm = null;
    KNOWN_RESOURCES.clear();
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockImplementation(answerList as never);
    // Nothing these pages or summaries show is fetched one item at a time.
    getItemMock.mockResolvedValue(null as never);

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);

    /*
     * The picker shows only the types the viewer may read
     * (filterTypesByReadPermission); a type it may not is left out, with a
     * note that something is hidden. What these tests pin is which types the
     * summary is handed, not permissions, so the viewer is one who may read
     * every type - a master admin - rather than whatever the cookies and
     * localStorage of the test environment happen to say.
     */
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe.each(PAGES)("on the $name page", (page: PageUnderTest) => {
    test("finds the picker step, so the checks below are not vacuous", async () => {
      const steps: Array<PickerStep> = findPickerSteps(await openForm(page));

      expect(steps).toHaveLength(1);
      expect(steps[0]!.resourceProps).toEqual(
        expect.arrayContaining(page.mustOffer),
      );
    });

    test("names a selection of every resource type the picker offers", async () => {
      const step: PickerStep = await openPickerStep(page);
      const missing: Array<string> = [];

      for (const prop of step.resourceProps) {
        const selected: Array<string> = knownResources(prop, 3);
        const result: RenderResult = renderStepSummary(step, {
          [prop]: selected,
        });

        const named: boolean = await showsEveryName(
          result.container,
          selected.map(nameOf),
        );
        const text: string = result.container.textContent || "";

        if (
          !named ||
          NOTHING_SELECTED_PATTERN.test(text) ||
          isLookingUpNames(result.container) ||
          within(result.container).queryByTestId(
            "affected-resources-hidden-note",
          )
        ) {
          missing.push(`${prop}: "${text}"`);
        }

        result.unmount();
      }

      expect(missing).toEqual([]);
    });

    test("looks each type's names up in its own model, for exactly the ids selected", async () => {
      const step: PickerStep = await openPickerStep(page);
      const lookupsByProp: Record<string, Array<Lookup>> = {};
      const expectedByProp: Record<string, Array<Lookup>> = {};

      for (const prop of step.resourceProps) {
        const selected: Array<string> = knownResources(prop, 3);
        getListMock.mockClear();
        getItemMock.mockClear();

        const result: RenderResult = await renderSummary(step, {
          [prop]: selected,
        });

        lookupsByProp[prop] = lookupsMade();
        expectedByProp[prop] = [nameLookupOf(prop, selected)];

        result.unmount();
      }

      expect(lookupsByProp).toEqual(expectedByProp);
    });

    test("names every resource of a mixed selection, each under its type", async () => {
      const step: PickerStep = await openPickerStep(page);

      const picks: Array<{ prop: ResourceProp; label: string; count: number }> =
        [
          { prop: "monitors", label: "Monitor", count: 1 },
          { prop: "dockerHosts", label: "Docker Host", count: 2 },
          { prop: "podmanHosts", label: "Podman Host", count: 4 },
          { prop: "services", label: "Service", count: 1 },
          { prop: "databaseServers", label: "Database", count: 2 },
        ];

      const item: SummaryItem = {};
      const expectedLookups: Array<Lookup> = [];

      for (const pick of picks) {
        const selected: Array<string> = knownResources(pick.prop, pick.count);
        item[pick.prop] = selected;
        expectedLookups.push(nameLookupOf(pick.prop, selected));
      }

      const { container } = await renderSummary(step, item);

      for (const pick of picks) {
        for (const id of item[pick.prop] as Array<string>) {
          const name: HTMLElement = within(container).getByText(nameOf(id));

          // The chip reads "<Type label><name>".
          expect(name.parentElement).toHaveTextContent(
            `${pick.label}${nameOf(id)}`,
          );
        }
      }

      expect(container.textContent).not.toMatch(NOTHING_SELECTED_PATTERN);

      // One lookup per type, however many of that type were picked.
      expect(lookupsMade()).toHaveLength(expectedLookups.length);
      expect(lookupsMade()).toEqual(expect.arrayContaining(expectedLookups));
    });

    test("keeps its nothing-selected sentence and looks nothing up when nothing is selected", async () => {
      const step: PickerStep = await openPickerStep(page);

      const allEmpty: SummaryItem = {};
      for (const prop of RESOURCE_PROP_NAMES) {
        allEmpty[prop] = [];
      }

      const emptySelections: Array<SummaryItem> = [{}, allEmpty];

      for (const item of emptySelections) {
        const result: RenderResult = await renderSummary(step, item);

        await nextTick();

        expect(result.container).toHaveTextContent(page.nothingSelectedMessage);
        result.unmount();
      }

      expect(lookupsMade()).toEqual([]);
    });

    test("reads a resource the API cannot find as unknown instead of dropping it", async () => {
      const step: PickerStep = await openPickerStep(page);

      const found: string = knownResources("podmanHosts", 1)[0]!;
      // Deleted, or not readable: the lookup does not return it.
      const gone: string = ObjectID.generate().toString();

      const { container } = await renderSummary(step, {
        podmanHosts: [found, gone],
      });

      expect(within(container).getByText(nameOf(found))).toBeInTheDocument();
      expect(
        within(container).getByText("Unknown Podman Host"),
      ).toBeInTheDocument();
      expect(container.textContent).not.toMatch(NOTHING_SELECTED_PATTERN);
      expect(lookupsMade()).toEqual([
        nameLookupOf("podmanHosts", [found, gone]),
      ]);
    });

    test("names resources that arrive with their name without looking them up", async () => {
      /*
       * The alert prefill and incident templates hand the form resources as
       * { _id, name } objects rather than bare ids. Those are named as they
       * come; only a bare id among them is looked up.
       */
      const step: PickerStep = await openPickerStep(page);

      const namedMonitor: { _id: string; name: string } = {
        _id: ObjectID.generate().toString(),
        name: "Checkout API monitor",
      };
      const namedPodmanHost: { _id: string; name: string } = {
        _id: ObjectID.generate().toString(),
        name: "podman-edge-01",
      };
      const bareId: string = knownResources("podmanHosts", 1)[0]!;

      const { container } = await renderSummary(step, {
        monitors: [namedMonitor],
        podmanHosts: [namedPodmanHost, bareId],
      });

      expect(
        within(container).getByText(namedMonitor.name),
      ).toBeInTheDocument();
      expect(
        within(container).getByText(namedPodmanHost.name),
      ).toBeInTheDocument();
      expect(within(container).getByText(nameOf(bareId))).toBeInTheDocument();
      expect(lookupsMade()).toEqual([nameLookupOf("podmanHosts", [bareId])]);
    });

    test("is read-only: no search input and no remove buttons", async () => {
      const step: PickerStep = await openPickerStep(page);

      const monitors: Array<string> = knownResources("monitors", 1);
      const podmanHosts: Array<string> = knownResources("podmanHosts", 2);

      const { container } = await renderSummary(step, {
        monitors: monitors,
        podmanHosts: podmanHosts,
      });

      // Not vacuous: the chips are there.
      for (const id of [...monitors, ...podmanHosts]) {
        expect(within(container).getByText(nameOf(id))).toBeInTheDocument();
      }

      expect(container.querySelectorAll("input")).toHaveLength(0);
      expect(within(container).queryAllByRole("textbox")).toHaveLength(0);
      expect(within(container).queryAllByRole("combobox")).toHaveLength(0);
      expect(
        within(container).queryAllByRole("button", { name: /^Remove\b/ }),
      ).toHaveLength(0);
    });
  });
});
