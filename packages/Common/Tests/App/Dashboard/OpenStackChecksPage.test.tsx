import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "../../../Models/DatabaseModels/OpenStackCloudCheck";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackApiCheckResult,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
} from "../../../Types/OpenStack/OpenStackCheck";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  getOpenStackApiServiceRows,
  getOpenStackCertificateRows,
  getOpenStackCheckDurationText,
  getOpenStackLifecycleRegionViews,
  getOpenStackTokenSummary,
  isOpenStackApiCheckOneClick,
  isOpenStackCheckConnectionNeeded,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackChecksView";
import { keepOpenStackCheckCredentialKind } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackCheckFormFields";
import OpenStackCloudChecks from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Checks";

/*
 * A cloud's Checks page, over a stand-in for the network. What matters here:
 *
 *   - turning a check on is one click where it can be, and the one that writes says what it creates;
 *   - a failed run names the step and who said what, and each step's duration is there;
 *   - a read that failed is never mistaken for "off": someone would turn on what is already on.
 *
 * A form is its own world with tests of its own, so it stands in as what it was handed.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(120000);

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

interface FormStandIn {
  title: string;
  onBeforeCreate?: (
    item: OpenStackCloudCheck,
    misc: object,
  ) => Promise<OpenStackCloudCheck>;
  onBeforeUpdate?: (
    item: OpenStackCloudCheck,
    misc: object,
  ) => Promise<OpenStackCloudCheck>;
  modelIdToEdit?: ObjectID;
  description?: string;
  formProps: {
    formType: string;
    fields: Array<{ title: string; required?: unknown }>;
  };
}

const forms: Array<FormStandIn> = [];

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: FormStandIn) => {
      forms.push(props);

      return (
        <div data-testid="form-stand-in">
          <span data-testid="form-title">{props.title}</span>
          <span data-testid="form-description">{props.description}</span>
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/Probe",
  () => {
    return {
      __esModule: true,
      default: {
        getAllProbes: async (): Promise<Array<unknown>> => {
          return [];
        },
      },
    };
  },
);

const CLOUD_ID: string = "71000000-0000-4000-8000-000000000001";
const CHECK_ID: string = "77000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-11-05T10:00:00.000Z");

const NOVA_SAID: string = "No valid host was found.";

function failedRun(data?: {
  finishedAt?: string;
  bootInMs?: number;
}): OpenStackLifecycleRun {
  return {
    runId: "20261105095500-abcdef",
    regionName: "RegionOne",
    startedAt: "2026-11-05T09:50:00.000Z",
    finishedAt: data?.finishedAt || "2026-11-05T09:55:00.000Z",
    status: "Failed",
    failedStep: OpenStackLifecycleStep.ServerActive,
    fault: { source: "nova", code: 500, message: NOVA_SAID },
    steps: [
      {
        step: OpenStackLifecycleStep.ServerCreate,
        status: "Passed",
        durationInMs: 1200,
      },
      {
        step: OpenStackLifecycleStep.ServerActive,
        status: "Failed",
        durationInMs: data?.bootInMs || 2400,
        fault: { source: "nova", code: 500, message: NOVA_SAID },
      },
    ],
    phases: {},
    leftoverCount: 0,
    requestCount: 12,
    writeCount: 2,
    warnings: [],
  };
}

function recordsOf(
  run: OpenStackLifecycleRun | undefined,
  attempt?: OpenStackLifecycleRun,
): OpenStackLifecycleRecords {
  return {
    RegionOne: {
      regionName: "RegionOne",
      lastVerdict: run,
      lastAttempt: attempt,
      phaseVerdicts: {},
      recent: [],
    },
  };
}

function apiResult(): OpenStackApiCheckResult {
  return {
    startedAt: "2026-11-05T09:59:00.000Z",
    durationInMs: 900,
    regionNames: ["RegionOne"],
    token: { status: "Passed", durationInMs: 180 },
    services: [
      {
        regionName: "RegionOne",
        serviceType: "compute",
        serviceName: "nova",
        read: "GET /servers?limit=1",
        outcome: "Answered",
        status: 200,
        durationInMs: 80,
      },
      {
        regionName: "RegionOne",
        serviceType: "volumev3",
        serviceName: "cinder",
        read: "GET /volumes?limit=1",
        outcome: "Failing",
        status: 503,
        durationInMs: 900,
        message: "It answered 503.",
      },
    ],
    certificates: [
      {
        host: "nova.example",
        port: 443,
        validTo: "2027-06-01T00:00:00.000Z",
        regionNames: ["RegionOne"],
        serviceTypes: ["compute"],
      },
      {
        host: "keystone.example",
        port: 443,
        validTo: "2026-11-10T00:00:00.000Z",
        regionNames: ["RegionOne"],
        serviceTypes: ["identity"],
      },
      {
        host: "old.example",
        port: 8443,
        validTo: "2026-11-01T00:00:00.000Z",
        regionNames: ["RegionOne"],
        serviceTypes: ["image"],
      },
      {
        host: "soon.example",
        port: 443,
        validTo: "2026-11-25T00:00:00.000Z",
        regionNames: ["RegionOne"],
        serviceTypes: ["network"],
      },
    ],
    warnings: [],
  };
}

interface Stand {
  cloud: OpenStackCloud;
  check: OpenStackCloudCheck | null;
  listError: Error | null;
}

const stand: Stand = {
  cloud: new OpenStackCloud(),
  check: null,
  listError: null,
};

function probeCollectedCloud(): OpenStackCloud {
  return Object.assign(new OpenStackCloud(), {
    name: "Lab",
    collectionMethod: OpenStackCollectionMethod.Probe,
    authUrl: "https://keystone.example:5000/v3",
    isCredentialSet: true,
    collectionProbeId: new ObjectID("72000000-0000-4000-8000-000000000001"),
  });
}

function agentCloud(): OpenStackCloud {
  return Object.assign(new OpenStackCloud(), {
    name: "Lab",
    collectionMethod: OpenStackCollectionMethod.Agent,
  });
}

function checkOn(extra: object): OpenStackCloudCheck {
  const check: OpenStackCloudCheck = Object.assign(
    new OpenStackCloudCheck(),
    {
      isApiCheckEnabled: true,
      isLifecycleCheckEnabled: true,
      isCredentialSet: true,
      lifecycleProjectName: "oneuptime-checks",
      lifecycleCheckIntervalInMinutes: 30,
    },
    extra,
  );

  check.id = new ObjectID(CHECK_ID);

  return check;
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <OpenStackCloudChecks {...({} as never)} />
    </MemoryRouter>,
  );
}

let create: ReturnType<typeof jest.spyOn>;
let updateById: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  forms.length = 0;
  stand.cloud = probeCollectedCloud();
  stand.check = null;
  stand.listError = null;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(CLOUD_ID));
  jest
    .spyOn(PermissionGate, "check")
    .mockReturnValue({ isAllowed: true } as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return stand.cloud;
  }) as unknown as typeof ModelAPI.getItem);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    if (stand.listError) {
      throw stand.listError;
    }

    return {
      data: stand.check ? [stand.check] : [],
      count: stand.check ? 1 : 0,
      skip: 0,
      limit: 1,
    };
  }) as unknown as typeof ModelAPI.getList);

  create = jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue({ data: {} } as never);
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("with no check on", () => {
  test("says what each does, and the one that writes says what it creates", async () => {
    renderPage();

    expect(
      await screen.findByTestId("openstack-api-checks-off"),
    ).toHaveTextContent("It only reads");
    expect(
      screen.getByTestId("openstack-lifecycle-statement"),
    ).toHaveTextContent("creates one small server");
    expect(
      screen.getByTestId("openstack-lifecycle-statement"),
    ).toHaveTextContent("refuses to run");
    // Off until someone turns it on, and nothing was written by looking.
    expect(create).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  test("on a cloud a probe collects, API checks are one click and no form", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Turn On API Checks"));

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });

    const written: OpenStackCloudCheck = (
      create.mock.calls[0]![0] as { model: OpenStackCloudCheck }
    ).model;

    expect(written.isApiCheckEnabled).toBe(true);
    expect(written.isLifecycleCheckEnabled).toBeUndefined();
    expect(written.openStackCloudId?.toString()).toBe(CLOUD_ID);
    expect(screen.queryByTestId("form-stand-in")).not.toBeInTheDocument();
  });

  test("on a cloud the agent collects, a form asks where Keystone is", async () => {
    stand.cloud = agentCloud();
    renderPage();

    fireEvent.click(await screen.findByText("Turn On API Checks"));

    expect(await screen.findByTestId("form-stand-in")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    const titles: Array<string> = forms[0]!.formProps.fields.map(
      (field: { title: string }) => {
        return field.title;
      },
    );

    expect(titles).toContain("Keystone Address");
    expect(titles).toContain("Probe");
    expect(titles).toContain("Secret or Password");
  });

  test("the lifecycle form says what it creates, and turning it on creates the row for this cloud", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Turn On the Lifecycle Check"));

    expect(await screen.findByTestId("form-description")).toHaveTextContent(
      "creates one small server",
    );

    const form: FormStandIn = forms[forms.length - 1]!;

    expect(form.formProps.formType).toBe("Create");

    const titles: Array<string> = form.formProps.fields.map(
      (field: { title: string }) => {
        return field.title;
      },
    );

    expect(titles).toContain("Project It Has to Itself");
    expect(titles).toContain("OSProfiler Key");

    const written: OpenStackCloudCheck = await form.onBeforeCreate!(
      new OpenStackCloudCheck(),
      {},
    );

    expect(written.isLifecycleCheckEnabled).toBe(true);
    expect(written.openStackCloudId?.toString()).toBe(CLOUD_ID);
  });

  test("a saved row is updated, not made again", async () => {
    stand.check = Object.assign(new OpenStackCloudCheck(), {
      isApiCheckEnabled: false,
      isLifecycleCheckEnabled: false,
    });
    stand.check.id = new ObjectID(CHECK_ID);
    renderPage();

    fireEvent.click(await screen.findByText("Turn On the Lifecycle Check"));
    await screen.findByTestId("form-stand-in");

    const form: FormStandIn = forms[forms.length - 1]!;

    expect(form.formProps.formType).toBe("Update");
    expect(form.modelIdToEdit?.toString()).toBe(CHECK_ID);
  });
});

describe("a read that failed", () => {
  test("is never read as off, because someone would turn on what is already on", async () => {
    stand.listError = new Error("The server went away.");
    renderPage();

    expect(
      await screen.findByTestId("openstack-checks-read-failed"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Turn On API Checks")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Turn On the Lifecycle Check"),
    ).not.toBeInTheDocument();
  });
});

describe("with the checks on", () => {
  test("a failed run names the step and what Nova said, with each step's duration", async () => {
    stand.check = checkOn({
      lifecycleRecords: recordsOf(failedRun()),
      lastApiCheckAt: new Date(),
      apiCheckResult: apiResult(),
    });
    renderPage();

    expect(
      await screen.findByTestId("openstack-lifecycle-failed-step"),
    ).toHaveTextContent("Wait for ACTIVE");
    expect(screen.getByTestId("openstack-lifecycle-fault")).toHaveTextContent(
      `Nova said (500): ${NOVA_SAID}`,
    );
    expect(
      screen.getByTestId("openstack-lifecycle-step-server_create"),
    ).toHaveTextContent("1.2 s");
    expect(
      screen.getByTestId("openstack-lifecycle-step-server_active"),
    ).toHaveTextContent("2.4 s");
  });

  test("a service's own words are only ever text", async () => {
    const run: OpenStackLifecycleRun = failedRun();

    run.steps[1]!.fault!.message = "<img src=x onerror=alert(1)>";
    stand.check = checkOn({ lifecycleRecords: recordsOf(run) });

    renderPage();

    expect(
      await screen.findByTestId("openstack-lifecycle-fault"),
    ).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(
      screen.getByTestId("openstack-lifecycle-fault").querySelector("img"),
    ).toBeNull();
  });

  test("a refused run says why, and is not a failed step", async () => {
    const refused: OpenStackLifecycleRun = {
      ...failedRun(),
      status: "Refused",
      steps: [],
      failedStep: undefined,
      fault: undefined,
      message: "That credential has admin rights. Nothing was written.",
    };

    stand.check = checkOn({ lifecycleRecords: recordsOf(undefined, refused) });
    renderPage();

    expect(
      await screen.findByTestId("openstack-lifecycle-attempt"),
    ).toHaveTextContent("Nothing was written.");
    expect(
      screen.queryByTestId("openstack-lifecycle-failed-step"),
    ).not.toBeInTheDocument();
  });

  test("Run Now asks for a run, and nothing else", async () => {
    stand.check = checkOn({});
    renderPage();

    fireEvent.click(await screen.findByText("Run Now"));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });

    const call: { id: ObjectID; data: object } = updateById.mock
      .calls[0]![0] as { id: ObjectID; data: object };

    expect(call.id.toString()).toBe(CHECK_ID);
    expect(Object.keys(call.data)).toEqual(["lifecycleRunRequestedAt"]);
  });

  test("with a key saved it can be forgotten, and the key itself is never read", async () => {
    stand.check = checkOn({ isOsProfilerKeySet: true });
    renderPage();

    fireEvent.click(
      await screen.findByTestId("openstack-lifecycle-forget-key"),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });

    expect((updateById.mock.calls[0]![0] as { data: object }).data).toEqual({
      osProfilerKey: null,
    });

    const select: object = (
      (ModelAPI.getList as unknown as jest.Mock).mock.calls[0]![0] as {
        select: object;
      }
    ).select;

    expect(Object.keys(select)).not.toContain("osProfilerKey");
    expect(Object.keys(select)).not.toContain("credentialSecret");
  });

  test("turned off with a run behind it, it says a probe is clearing up", async () => {
    stand.check = checkOn({
      isLifecycleCheckEnabled: false,
      isSweepPending: true,
    });
    renderPage();

    expect(
      await screen.findByTestId("openstack-lifecycle-sweeping"),
    ).toHaveTextContent("clearing up");
    expect(screen.getByText("Turn On the Lifecycle Check")).toBeInTheDocument();
  });
});

describe("what the page works out", () => {
  test("durations read as a person would say them", () => {
    expect(getOpenStackCheckDurationText(850)).toBe("850 ms");
    expect(getOpenStackCheckDurationText(1500)).toBe("1.5 s");
    expect(getOpenStackCheckDurationText(200_000)).toBe("3m 20s");
    expect(getOpenStackCheckDurationText(119_900)).toBe("2m 0s");
    expect(getOpenStackCheckDurationText(Number.NaN)).toBe("0 ms");
  });

  test("API checks are one click only with a probe, an address and a credential", () => {
    expect(isOpenStackApiCheckOneClick(probeCollectedCloud())).toBe(true);
    expect(isOpenStackApiCheckOneClick(agentCloud())).toBe(false);

    const noSecret: OpenStackCloud = probeCollectedCloud();

    noSecret.isCredentialSet = false;
    expect(isOpenStackApiCheckOneClick(noSecret)).toBe(false);
  });

  test("a form only insists on a connection when nothing has one", () => {
    expect(
      isOpenStackCheckConnectionNeeded({
        cloud: probeCollectedCloud(),
        check: null,
      }),
    ).toBe(false);
    expect(
      isOpenStackCheckConnectionNeeded({ cloud: agentCloud(), check: null }),
    ).toBe(true);
    expect(
      isOpenStackCheckConnectionNeeded({
        cloud: agentCloud(),
        check: Object.assign(new OpenStackCloudCheck(), {
          authUrl: "https://keystone.example:5000/v3",
        }),
      }),
    ).toBe(false);
  });

  test("the failing service reads first, and a refusal is still an answer", () => {
    const rows: ReturnType<typeof getOpenStackApiServiceRows> =
      getOpenStackApiServiceRows(apiResult());

    expect(rows[0]!.service).toBe("cinder");
    expect(rows[0]!.tone).toBe("bad");
    expect(rows[1]!.tone).toBe("good");
    expect(getOpenStackApiServiceRows(null)).toEqual([]);

    const refused: OpenStackApiCheckResult = apiResult();

    refused.services[0]!.outcome = "Refused";
    expect(
      getOpenStackApiServiceRows(refused).find(
        (row: { service: string }) => {
          return row.service === "nova";
        },
      )?.tone,
    ).toBe("neutral");
  });

  test("a refused token reads as failing, in Keystone's words", () => {
    const result: OpenStackApiCheckResult = apiResult();

    result.token = {
      status: "BackingOff",
      durationInMs: 0,
      message: "The request you have made requires authentication.",
    };

    const token: ReturnType<typeof getOpenStackTokenSummary> =
      getOpenStackTokenSummary(result);

    expect(token?.tone).toBe("bad");
    expect(token?.message).toContain("requires authentication");
  });

  test("certificates read soonest first, at the templates' 30 and 7 days", () => {
    const rows: ReturnType<typeof getOpenStackCertificateRows> =
      getOpenStackCertificateRows({ result: apiResult(), now: NOW });

    expect(
      rows.map((row: { address: string; tone: string; daysText: string }) => {
        return [row.address, row.tone, row.daysText];
      }),
    ).toEqual([
      ["old.example:8443", "bad", "Expired"],
      ["keystone.example:443", "bad", "4 days left"],
      ["soon.example:443", "warning", "19 days left"],
      ["nova.example:443", "good", "207 days left"],
    ]);
  });

  test("a verdict too old to speak for the cloud says so", () => {
    const [current] = getOpenStackLifecycleRegionViews({
      records: recordsOf(failedRun()),
      intervalInMinutes: 30,
      now: NOW,
    });

    expect(current!.isStale).toBe(false);
    expect(current!.tone).toBe("bad");
    expect(current!.failedStepTitle).toBe("Wait for ACTIVE");

    const [stale] = getOpenStackLifecycleRegionViews({
      records: recordsOf(
        failedRun({ finishedAt: "2026-11-05T08:00:00.000Z" }),
      ),
      intervalInMinutes: 30,
      now: NOW,
    });

    expect(stale!.isStale).toBe(true);
    expect(stale!.tone).toBe("warning");
    expect(stale!.headline).toContain("may no longer be so");
  });

  test("a boot past the template's line is called slow, and a failed one is not", () => {
    const passed: OpenStackLifecycleRun = {
      ...failedRun(),
      status: "Succeeded",
      failedStep: undefined,
      fault: undefined,
      steps: [
        {
          step: OpenStackLifecycleStep.ServerActive,
          status: "Passed",
          durationInMs: 301_000,
        },
      ],
    };

    expect(
      getOpenStackLifecycleRegionViews({
        records: recordsOf(passed),
        intervalInMinutes: 30,
        now: NOW,
      })[0]!.isBootSlow,
    ).toBe(true);
    expect(
      getOpenStackLifecycleRegionViews({
        records: recordsOf(failedRun({ bootInMs: 301_000 })),
        intervalInMinutes: 30,
        now: NOW,
      })[0]!.isBootSlow,
    ).toBe(false);
  });

  test("regions read by name, and none at all is nothing to read", () => {
    const records: OpenStackLifecycleRecords = {
      ...recordsOf(failedRun()),
      Asia: { regionName: "Asia", phaseVerdicts: {}, recent: [] },
    };

    expect(
      getOpenStackLifecycleRegionViews({
        records: records,
        intervalInMinutes: 30,
        now: NOW,
      }).map((region: { regionName: string }) => {
        return region.regionName;
      }),
    ).toEqual(["Asia", "RegionOne"]);
    expect(
      getOpenStackLifecycleRegionViews({
        records: undefined,
        intervalInMinutes: 30,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a form that typed no new secret leaves the saved credential alone", () => {
    const kept: OpenStackCloudCheck = keepOpenStackCheckCredentialKind(
      Object.assign(new OpenStackCloudCheck(), {
        credentialKind: "applicationCredential",
        applicationCredentialId: "",
        keystoneUsername: "",
      }),
    );

    expect(kept.credentialKind).toBeUndefined();
    expect(kept.applicationCredentialId).toBeUndefined();
    expect(kept.keystoneUsername).toBeUndefined();

    const typed: OpenStackCloudCheck = keepOpenStackCheckCredentialKind(
      Object.assign(new OpenStackCloudCheck(), {
        credentialKind: "password",
        credentialSecret: "new",
        applicationCredentialId: "stale",
        keystoneUsername: "check",
      }),
    );

    expect(typed.applicationCredentialId).toBeUndefined();
    expect(typed.keystoneUsername).toBe("check");
  });
});
