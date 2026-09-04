import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * WHY THIS FILE EXISTS
 *
 * Registering a device asks what the device IS, and the two answers it cannot
 * work without are the address and the PROBE that can reach it. A device with
 * no probe is not polled by anything: it is created, it sits on Pending
 * wearing "No probe", and nobody finds out until somebody wonders why a
 * switch has no interfaces. So the probe is required here — and because
 * requiring a field an operator cannot answer is just a wall, the form
 * answers it for them wherever it honestly can:
 *
 *   1. the selected site's own default probe (the site exists to hold it),
 *   2. otherwise the project's single non-global probe, when there is exactly
 *      one — a question with one possible answer is not a question,
 *   3. otherwise empty, and the operator picks.
 *
 * Every property that makes step 1 SAFE is invisible on screen: it is one
 * request per site id and not one per keystroke, it is remembered so that
 * re-opening the form or flipping between two sites costs nothing, a site
 * with no probe is remembered as such, and it never overwrites a probe the
 * operator picked themselves.
 *
 * The SNMP step is the other half. It stays, it is optional, and it now
 * offers the credential PROFILE beside the device's own credentials — the
 * same either/or the Settings page offers, in the same words, because a
 * device created here and a device edited there have to end up describing
 * their credentials the same way.
 *
 * ModelTable is replaced by a prop recorder — the point is what the page
 * hands it, not re-testing the table (the same approach as
 * NetworkDeviceBulkDelete.test.tsx).
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
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
      getUserId: () => {
        return null;
      },
    },
  };
});

const SITE_ID: string = "77777777-0000-4000-8000-000000000001";
const OTHER_SITE_ID: string = "77777777-0000-4000-8000-000000000002";
const SITE_PROBE_ID: string = "88888888-0000-4000-8000-000000000001";
const OTHER_PROBE_ID: string = "88888888-0000-4000-8000-000000000002";

/*
 * The probe list the page fetches on mount, and the site rows the create form
 * looks up. Both are `let`s with the `mock` prefix so the hoisted factories
 * below may close over them and each test can set what this project owns.
 */
type ProbeRow = {
  _id: string;
  name: string;
  isGlobalProbe?: boolean | undefined;
};

let mockProbeList: Array<ProbeRow> = [];

type GetItemRequest = {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
};

const mockGetItemCalls: Array<GetItemRequest> = [];

let mockGetItem: (
  request: GetItemRequest,
) => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve(null);
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: GetItemRequest): Promise<unknown> => {
        mockGetItemCalls.push(request);
        return mockGetItem(request);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
      // The unbound-devices banner counts on mount; not what this file is about.
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async () => {
        return mockProbeList;
      },
    },
  };
});

/*
 * The facet bar fetches sites, labels and probes on mount and owns the query
 * the table is given. None of that is what these tests are about.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          filterBar: null,
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          hasActiveFilters: false,
          facetSelections: {},
          facetOperators: {},
          setFacetSelection: () => {
            // no-op
          },
          clearAllFacets: () => {
            // no-op
          },
          facetSaveState: {},
          restoreFacetState: () => {
            // no-op
          },
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkOidTemplateActions",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { bulkActions: [], modals: null };
      },
    };
  },
);

/*
 * Stubbed to a recognisable button, so "the page mounts the hook" and "the
 * page puts its actions on the table" are one assertion rather than a source
 * grep that a rename would walk straight past.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSnmpCredentialProfileActions",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          bulkActions: [{ title: "Set SNMP Credential Profile" }],
          modals: null,
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

type FormValuesLike = Record<string, unknown>;

type SetFormValuesFunction = (values: FormValuesLike) => void;

type CapturedFormField = {
  field?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  description?: string | undefined;
  sectionTitle?: string | undefined;
  sectionDescription?: string | undefined;
  placeholder?: string | undefined;
  fieldType?: FormFieldSchemaType | undefined;
  defaultValue?: unknown;
  dropdownModal?: { type: unknown } | undefined;
  sideLink?: { text: string; url: unknown } | undefined;
  required?: boolean | ((values: FormValuesLike) => boolean) | undefined;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
  onChange?:
    | ((
        value: unknown,
        currentFormValues: FormValuesLike,
        setNewFormValues: SetFormValuesFunction,
      ) => void)
    | undefined;
};

type CapturedFormStep = {
  id: string;
  title: string;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField> | undefined;
  formSteps?: Array<CapturedFormStep> | undefined;
  bulkActions?:
    | { buttons?: Array<{ title?: string | undefined }> | undefined }
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import NetworkDevicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  PROBE_FIELD_DESCRIPTION,
  SNMP_STEP_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/network-devices"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function renderDevicesPage(): Promise<CapturedTableProps> {
  const Page: (props: PageComponentProps) => ReactElement =
    NetworkDevicesPage as unknown as (
      props: PageComponentProps,
    ) => ReactElement;

  render(
    <MemoryRouter>
      <Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return capturedTableProps!;
}

function fieldFor(props: CapturedTableProps, key: string): CapturedFormField {
  const match: CapturedFormField | undefined = (props.formFields || []).find(
    (field: CapturedFormField): boolean => {
      return Object.keys(field.field || {})[0] === key;
    },
  );

  expect({ key: key, found: Boolean(match) }).toEqual({
    key: key,
    found: true,
  });

  return match!;
}

/** `required` the way FormField.tsx reads it: a boolean, or a callback. */
function isRequired(field: CapturedFormField, values: FormValuesLike): boolean {
  if (typeof field.required === "function") {
    return field.required(values);
  }

  return field.required === true;
}

function siteRow(probeId: string | undefined): NetworkSite {
  const site: NetworkSite = new NetworkSite();

  if (probeId) {
    site.probeId = new ObjectID(probeId);
  }

  return site;
}

/**
 * Pick a site the way the entity dropdown does — value first, then the form's
 * own setFieldValue — and hand back whatever the field wrote afterwards.
 */
async function selectSite(data: {
  props: CapturedTableProps;
  siteId: string;
  currentFormValues?: FormValuesLike | undefined;
  expectWrite?: boolean | undefined;
}): Promise<Array<FormValuesLike>> {
  const site: CapturedFormField = fieldFor(data.props, "site");
  const writes: Array<FormValuesLike> = [];

  expect(site.onChange).toBeDefined();

  site.onChange!(
    data.siteId,
    data.currentFormValues || { name: "core-switch-01" },
    (values: FormValuesLike): void => {
      writes.push(values);
    },
  );

  if (data.expectWrite === false) {
    /*
     * Nothing to wait FOR, so drain instead: a timer callback runs only once
     * every queued microtask has, so the lookup and its handler have both
     * finished by the time this resolves. Without it, "it wrote nothing"
     * would pass simply by being asserted first.
     */
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    return writes;
  }

  await waitFor(() => {
    expect(writes.length).toBeGreaterThan(0);
  });

  return writes;
}

describe("the create form's Probe field", () => {
  beforeEach(() => {
    capturedTableProps = null;
    mockGetItemCalls.length = 0;
    mockProbeList = [{ _id: "probe-1", name: "Branch probe" }];
    mockGetItem = (): Promise<unknown> => {
      return Promise.resolve(siteRow(SITE_PROBE_ID));
    };
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  /*
   * The regression this file exists for. The probe used to be required only
   * for an "SNMP" device and hidden for a monitor-backed one; this form
   * creates neither kind of exception any more, so a device without a probe
   * is simply a device nothing polls.
   */
  test("is required for every device, and shown for every device", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const probe: CapturedFormField = fieldFor(props, "probe");

    expect(isRequired(probe, { name: "core-switch-01" })).toBe(true);
    // No showIf at all: there is no branch left that hides it.
    expect(probe.showIf).toBeUndefined();
  });

  /*
   * One sentence for the create form, the Settings page and the topology
   * dialog. A private copy here is how "the probe polls this device via SNMP"
   * survived on one surface after ping-first polling made it false.
   */
  test("explains itself with the shared probe description", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(fieldFor(props, "probe").description).toBe(PROBE_FIELD_DESCRIPTION);
  });

  test("defaults to the project's single custom probe", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(fieldFor(props, "probe").defaultValue).toBe("probe-1");
  });

  /*
   * A global probe sits on the public internet and cannot reach an RFC1918
   * address, so pre-selecting one would hand the operator a device guaranteed
   * to read Down — worse than an empty box, because it looks answered.
   */
  test("never defaults to a global probe, even as the only one", async () => {
    mockProbeList = [{ _id: "global-1", name: "US East", isGlobalProbe: true }];

    const props: CapturedTableProps = await renderDevicesPage();

    expect(fieldFor(props, "probe").defaultValue).toBe("");
  });

  // Two custom probes is a real question, and the form must not answer it.
  test("does not guess when the project has more than one custom probe", async () => {
    mockProbeList = [
      { _id: "probe-1", name: "Branch probe" },
      { _id: "probe-2", name: "Datacenter probe" },
    ];

    const props: CapturedTableProps = await renderDevicesPage();

    expect(fieldFor(props, "probe").defaultValue).toBe("");
  });
});

describe("picking a site fills in the site's default probe", () => {
  beforeEach(() => {
    capturedTableProps = null;
    mockGetItemCalls.length = 0;
    mockProbeList = [{ _id: "probe-1", name: "Branch probe" }];
    mockGetItem = (): Promise<unknown> => {
      return Promise.resolve(siteRow(SITE_PROBE_ID));
    };
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("reads the chosen site's probe and writes it into the probe box", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: SITE_ID,
      currentFormValues: { name: "core-switch-01", probe: "probe-1" },
    });

    expect(mockGetItemCalls.length).toBe(1);
    expect(mockGetItemCalls[0]!.modelType).toBe(NetworkSite);
    expect(mockGetItemCalls[0]!.id.toString()).toBe(SITE_ID);
    /*
     * One column. The site row carries credentials-adjacent columns and a
     * whole rollup; this lookup exists to answer one question.
     */
    expect(mockGetItemCalls[0]!.select).toEqual({ probeId: true });

    /*
     * The site is written back beside the probe: this write lands AFTER the
     * dropdown's own setFieldValue, and the values it spreads were snapshot
     * before it — so a write that carried only the probe would undo the very
     * selection that triggered it.
     */
    expect(writes[writes.length - 1]).toEqual({
      name: "core-switch-01",
      site: SITE_ID,
      probe: SITE_PROBE_ID,
    });
  });

  /*
   * "One getItem per site id", which is the whole reason the answers are
   * cached: flipping between two sites while deciding, or opening the create
   * form a second time, must not put a request on the wire per click.
   */
  test("asks the server once per site id, however often the site is picked", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    await selectSite({ props: props, siteId: SITE_ID });
    expect(mockGetItemCalls.length).toBe(1);

    await selectSite({
      props: props,
      siteId: SITE_ID,
      currentFormValues: { probe: SITE_PROBE_ID },
      // Same site, same probe already in the box: nothing left to write.
      expectWrite: false,
    });
    expect(mockGetItemCalls.length).toBe(1);

    mockGetItem = (): Promise<unknown> => {
      return Promise.resolve(siteRow(OTHER_PROBE_ID));
    };

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: OTHER_SITE_ID,
      currentFormValues: { probe: SITE_PROBE_ID },
    });

    // A second site is a second question, and gets asked.
    expect(mockGetItemCalls.length).toBe(2);
    expect(writes[writes.length - 1]!["probe"]).toBe(OTHER_PROBE_ID);
  });

  /*
   * A site with no default probe is an ANSWER, and it is cached as one: the
   * alternative is a lookup on every pick of the sites that have nothing to
   * say.
   */
  test("remembers a site that has no default probe, and leaves the box alone", async () => {
    mockGetItem = (): Promise<unknown> => {
      return Promise.resolve(siteRow(undefined));
    };

    const props: CapturedTableProps = await renderDevicesPage();

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: SITE_ID,
      currentFormValues: { probe: "probe-1" },
      expectWrite: false,
    });

    expect(writes).toEqual([]);
    expect(mockGetItemCalls.length).toBe(1);

    await selectSite({
      props: props,
      siteId: SITE_ID,
      currentFormValues: { probe: "probe-1" },
      expectWrite: false,
    });

    expect(mockGetItemCalls.length).toBe(1);
  });

  /*
   * The site's probe is a DEFAULT, and a default may only replace a default.
   * An operator who picked the one probe that can reach this particular
   * device, and then recorded which site it stands in, must not have that
   * quietly undone.
   */
  test("never overwrites a probe the operator picked themselves", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: SITE_ID,
      // Neither the form's default ("probe-1") nor anything it filled in.
      currentFormValues: { probe: "probe-chosen-by-hand" },
      expectWrite: false,
    });

    expect(writes).toEqual([]);
    // Not even asked: the answer could not be used.
    expect(mockGetItemCalls.length).toBe(0);
  });

  test("replaces the probe it filled in for a previously chosen site", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    await selectSite({ props: props, siteId: SITE_ID });

    mockGetItem = (): Promise<unknown> => {
      return Promise.resolve(siteRow(OTHER_PROBE_ID));
    };

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: OTHER_SITE_ID,
      // What the previous site's lookup put there, not an operator's choice.
      currentFormValues: { probe: SITE_PROBE_ID },
    });

    expect(writes[writes.length - 1]!["probe"]).toBe(OTHER_PROBE_ID);
  });

  // Clearing the site says nothing about which probe can reach the device.
  test("clearing the site looks nothing up and changes nothing", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: "",
      currentFormValues: { probe: "probe-1" },
      expectWrite: false,
    });

    expect(writes).toEqual([]);
    expect(mockGetItemCalls.length).toBe(0);
  });

  /*
   * A lookup that fails must cost one pick, not the form — and must not be
   * remembered as "this site has no probe", which would make one bad response
   * permanent for the life of the page.
   */
  test("a failed lookup leaves the box alone and is not cached as an answer", async () => {
    /*
     * Rejected from a timer rather than immediately, so the handler is
     * attached before the rejection happens and the run does not log a
     * spurious unhandled-rejection warning for a case that is handled.
     */
    mockGetItem = (): Promise<unknown> => {
      return new Promise<unknown>(
        (_resolve: (value: unknown) => void, reject: (err: Error) => void) => {
          setTimeout(() => {
            reject(new Error("Network error"));
          }, 0);
        },
      );
    };

    const props: CapturedTableProps = await renderDevicesPage();

    const writes: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: SITE_ID,
      currentFormValues: { probe: "probe-1" },
      expectWrite: false,
    });

    expect(writes).toEqual([]);

    mockGetItem = (): Promise<unknown> => {
      return Promise.resolve(siteRow(SITE_PROBE_ID));
    };

    const retried: Array<FormValuesLike> = await selectSite({
      props: props,
      siteId: SITE_ID,
      currentFormValues: { probe: "probe-1" },
    });

    expect(mockGetItemCalls.length).toBe(2);
    expect(retried[retried.length - 1]!["probe"]).toBe(SITE_PROBE_ID);
  });
});

describe("the create form's SNMP step", () => {
  beforeEach(() => {
    capturedTableProps = null;
    mockGetItemCalls.length = 0;
    mockProbeList = [{ _id: "probe-1", name: "Branch probe" }];
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  /*
   * The step used to be hidden for a monitor-backed device, which is the only
   * device that is never polled. This form creates no such device, so there
   * is no branch left — and a step every device walks through is a step whose
   * fields must all be skippable.
   */
  test("is shown for every device and gated by nothing", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const snmp: CapturedFormStep | undefined = (props.formSteps || []).find(
      (step: CapturedFormStep): boolean => {
        return step.id === "snmp";
      },
    );

    expect(snmp).toBeDefined();
    expect(snmp!.showIf).toBeUndefined();
    // The stepper is where an operator learns they may walk past it.
    expect(snmp!.title.toLowerCase()).toContain("optional");
  });

  test("says what an empty community string means, in the shared words", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const profile: CapturedFormField = fieldFor(props, "snmpCredentialProfile");

    /*
     * The heading rides on the first field of the step, which is how BasicForm
     * renders a section — sectionDescription is dropped unless a sectionTitle
     * is set beside it.
     */
    expect(profile.sectionTitle).toBe("SNMP");
    expect(profile.sectionDescription).toBe(SNMP_STEP_DESCRIPTION);
  });

  test("credentials are optional: nothing on the step is required but the version", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const onSnmpStep: Array<CapturedFormField> = (
      props.formFields || []
    ).filter((field: CapturedFormField): boolean => {
      return field.stepId === "snmp";
    });

    expect(onSnmpStep.length).toBeGreaterThan(0);

    const community: CapturedFormField = fieldFor(props, "snmpCommunityString");
    const profile: CapturedFormField = fieldFor(props, "snmpCredentialProfile");

    expect(isRequired(community, {})).toBe(false);
    expect(isRequired(profile, {})).toBe(false);
    /*
     * The v3 fields ARE required, but only once V3 is chosen — they are
     * revealed by showIf, so a device left on the defaulted V2c never meets
     * them. The version itself is required and defaulted, which is why it is
     * the one exception.
     */
    expect(isRequired(fieldFor(props, "snmpVersion"), {})).toBe(true);
    expect(fieldFor(props, "snmpVersion").defaultValue).toBe("V2c");
  });

  /*
   * The either/or has to read the same here and on the Settings page, or a
   * device created with a profile and a device switched to one afterwards are
   * described by two different explanations of the same column.
   */
  test("offers the credential profile beside the device's own credentials", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const profile: CapturedFormField = fieldFor(props, "snmpCredentialProfile");

    expect(profile.stepId).toBe("snmp");
    expect(profile.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(profile.dropdownModal?.type).toBe(NetworkSnmpCredentialProfile);
    expect(profile.description).toContain("credentials below win");
    expect(profile.placeholder?.toLowerCase()).toContain("no profile");
    // Somewhere to go when the list is empty, which it is until one is made.
    expect(profile.sideLink?.text).toBe("Manage credential profiles");
  });
});

describe("the device list's bulk actions", () => {
  beforeEach(() => {
    capturedTableProps = null;
    mockProbeList = [{ _id: "probe-1", name: "Branch probe" }];
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  /*
   * A credential profile is only worth having if an EXISTING fleet can be
   * moved onto it — the ping-only devices that need credentials were imported
   * long before anybody wrote the profile down.
   */
  test("include setting an SNMP credential profile on a selection", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const titles: Array<string> = (props.bulkActions?.buttons || []).map(
      (button: { title?: string | undefined }): string => {
        return button.title || "";
      },
    );

    expect(titles).toContain("Set SNMP Credential Profile");
  });
});
