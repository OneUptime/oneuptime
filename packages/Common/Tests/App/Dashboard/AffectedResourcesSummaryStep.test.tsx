import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The incident and scheduled maintenance wizards end on a summary that lists
 * what each step picked. The "Resources Affected" step uses one picker that
 * writes to every resource relation the page hands it, but its summary is
 * hand-written per page - so a resource type the picker offers can be left
 * out of it. Podman hosts were: pick only Podman hosts and the summary said
 * "No resources affected", although the selection saved fine.
 *
 * The invariant pinned here: every resource prop the editor picker is given
 * shows up in the summary. It drives the real pages, with ModelForm mocked to
 * capture the fields it is handed (as MonitorCreateFromMonitorBackedDevice
 * does), reads the resource props off the picker element the step renders,
 * and renders the step's summary once per prop with only that type selected.
 * A resource type added to a page's picker later is picked up without edits
 * here.
 */

type CapturedField = {
  stepId?: string | undefined;
  getCustomElement?:
    | ((
        values: Record<string, unknown>,
        elementProps: Record<string, unknown>,
      ) => React.ReactElement)
    | undefined;
  getSummaryElement?:
    | ((item: Record<string, unknown>) => React.ReactElement)
    | undefined;
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

/*
 * The monitor summary looks its monitors up by id. Off the network, it
 * renders how many ids it was given so the count is still observable.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/FetchMonitors",
  () => {
    return {
      __esModule: true,
      default: (props: { monitorIds: Array<unknown> }): React.ReactElement => {
        return <div>{`${props.monitorIds.length} monitor ids`}</div>;
      },
    };
  },
);

import AffectedResourcesPicker, {
  AffectedResourcesPayload,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import ScheduledMaintenanceCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

type ResourceProp = Exclude<
  keyof AffectedResourcesPayload,
  "__affectedResourcesPayload"
>;

/*
 * Every relation the picker can write. A Record keyed by the payload's own
 * fields, so a resource type added to the picker fails to compile here until
 * it is listed.
 */
const RESOURCE_PROPS: Record<ResourceProp, true> = {
  monitors: true,
  hosts: true,
  kubernetesClusters: true,
  dockerHosts: true,
  podmanHosts: true,
  proxmoxClusters: true,
  vmwareVCenters: true,
  cephClusters: true,
  dockerSwarmClusters: true,
  iotFleets: true,
  databaseServers: true,
  networkSites: true,
  services: true,
};

const RESOURCE_PROP_NAMES: Array<ResourceProp> = Object.keys(
  RESOURCE_PROPS,
) as Array<ResourceProp>;

const NOTHING_SELECTED_PATTERN: RegExp = /No resources affected/;

/*
 * The selection size the per-type check uses, as a standalone number. Not \b:
 * textContent runs a heading into the count after it ("Monitors3 monitor ids").
 */
const COUNT_OF_THREE_PATTERN: RegExp = /(^|\D)3(\D|$)/;

type PageUnderTest = {
  name: string;
  component: React.FunctionComponent<PageComponentProps>;
  route: string;
};

const PAGES: Array<PageUnderTest> = [
  {
    name: "incident create",
    component: IncidentCreate,
    route: "/dashboard/incidents/create",
  },
  {
    name: "scheduled maintenance create",
    component: ScheduledMaintenanceCreate,
    route: "/dashboard/scheduled-maintenance-events/create",
  },
];

type PickerStep = {
  resourceProps: Array<ResourceProp>;
  getSummaryElement: (item: Record<string, unknown>) => React.ReactElement;
};

async function openForm(page: PageUnderTest): Promise<CapturedFormProps> {
  const project: Project = new Project();

  render(
    <MemoryRouter>
      <page.component
        pageRoute={new Route(page.route)}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
  });

  return capturedForm!;
}

/** The fields whose editor is the picker and that render a summary. */
function findPickerSteps(form: CapturedFormProps): Array<PickerStep> {
  const emptySelection: Record<string, unknown> = {};
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

function renderSummary(
  step: PickerStep,
  item: Record<string, unknown>,
): string {
  const { container } = render(step.getSummaryElement(item));
  const text: string = container.textContent || "";
  cleanup();
  return text;
}

function ids(count: number): Array<string> {
  return Array.from({ length: count }, () => {
    return ObjectID.generate().toString();
  });
}

describe("the Resources Affected summary step", () => {
  beforeEach(() => {
    capturedForm = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);
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
        expect.arrayContaining(["monitors", "podmanHosts"]),
      );
    });

    test("counts a selection of every resource type the picker offers", async () => {
      const steps: Array<PickerStep> = findPickerSteps(await openForm(page));
      const missing: Array<string> = [];

      for (const step of steps) {
        for (const prop of step.resourceProps) {
          const text: string = renderSummary(step, { [prop]: ids(3) });

          if (
            NOTHING_SELECTED_PATTERN.test(text) ||
            !COUNT_OF_THREE_PATTERN.test(text)
          ) {
            missing.push(`${prop}: "${text}"`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    test("says so when nothing is selected", async () => {
      const [step] = findPickerSteps(await openForm(page));

      expect(renderSummary(step!, {})).toMatch(NOTHING_SELECTED_PATTERN);
    });

    test("names Podman hosts, singular and plural", async () => {
      const [step] = findPickerSteps(await openForm(page));

      expect(renderSummary(step!, { podmanHosts: ids(1) })).toContain(
        "1 Podman host",
      );
      expect(renderSummary(step!, { podmanHosts: ids(1) })).not.toContain(
        "1 Podman hosts",
      );
      expect(renderSummary(step!, { podmanHosts: ids(2) })).toContain(
        "2 Podman hosts",
      );
    });

    test("offers databases and names them, singular and plural", async () => {
      const [step] = findPickerSteps(await openForm(page));

      expect(step!.resourceProps).toContain("databaseServers");
      expect(renderSummary(step!, { databaseServers: ids(1) })).toContain(
        "1 database",
      );
      expect(renderSummary(step!, { databaseServers: ids(1) })).not.toContain(
        "1 databases",
      );
      expect(renderSummary(step!, { databaseServers: ids(2) })).toContain(
        "2 databases",
      );
      expect(renderSummary(step!, { databaseServers: ids(2) })).not.toMatch(
        NOTHING_SELECTED_PATTERN,
      );
    });

    test("lists Podman hosts alongside the other resource types", async () => {
      const [step] = findPickerSteps(await openForm(page));

      const text: string = renderSummary(step!, {
        monitors: ids(1),
        dockerHosts: ids(2),
        podmanHosts: ids(4),
        services: ids(1),
      });

      expect(text).toContain("1 monitor ids");
      expect(text).toContain("2 Docker hosts");
      expect(text).toContain("4 Podman hosts");
      expect(text).toContain("1 service");
    });
  });
});
