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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE BLOCKLIST'S CLOUD WAFS (#10344), drawn: the AWS WAF web ACLs the
 * blocklist is enforced in (a ModelTable call, so its props are pinned and
 * its cells drawn from them) - each by its name and where it is, where it
 * reads the client's address, and where it stands, with the server's
 * sentence of why when it is not enforcing; Add Web ACL with the web ACLs
 * that may be picked and why others are not; Check Again; Remove, which
 * names what stays in AWS WAF; and Show Rule's rule as code.
 */

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

type Column = {
  field: Record<string, unknown>;
  title: string;
  type?: unknown;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

type CapturedAction = {
  title: string;
  disabled?: boolean;
  tooltip?: string;
  onClick: (
    item: unknown,
    onComplete: () => void,
    onError: (error: Error) => void,
  ) => Promise<void> | void;
};

type CapturedTable = {
  id: string;
  query: Record<string, unknown>;
  createVerb?: string;
  singularName?: string;
  isDeleteable: boolean;
  isEditable?: boolean;
  isCreateable: boolean;
  onCreateClick?: () => void;
  refreshToggle?: string;
  cardProps?: { title?: string; description?: string };
  emptyState?: { title?: string; description?: string };
  formFields?: Array<{ field: Record<string, unknown> }>;
  actionButtons?: Array<CapturedAction>;
  columns: Array<Column>;
};

type CapturedForm = {
  title: string;
  description?: unknown;
  submitButtonText?: string;
  isLoading?: boolean;
  error?: string;
  beforeFormElement?: React.ReactElement;
  onSubmit?: (values: Record<string, unknown>) => Promise<void> | void;
  formProps: {
    initialValues?: Record<string, unknown>;
    fields: Array<{
      field: Record<string, unknown>;
      dropdownOptions?: Array<{ label: string; value: string }>;
    }>;
  };
};

type CapturedConfirm = {
  title: string;
  description: React.ReactElement | string;
  submitButtonText?: string;
  onClose?: () => void;
};

let table: CapturedTable | null = null;
let forms: Array<CapturedForm> = [];
let confirms: Array<CapturedConfirm> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      table = props;
      return React.createElement("div", { "data-testid": props.id });
    },
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedForm) => {
      forms.push(props);
      return React.createElement(
        "div",
        { "data-testid": "form-modal" },
        React.createElement("h2", null, props.title),
        props.beforeFormElement || null,
        props.error
          ? React.createElement(
              "p",
              { "data-testid": "form-error" },
              props.error,
            )
          : null,
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedConfirm) => {
      confirms.push(props);
      return React.createElement(
        "div",
        { "data-testid": "confirm-modal" },
        React.createElement("h2", null, props.title),
        props.description,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      readCloudWafCandidates: jest.fn(),
      checkCloudWaf: jest.fn(),
      removeCloudWaf: jest.fn(),
    };
  },
);

import BlocklistCloudWafs, {
  getCloudWafAddNotes,
  getCloudWafOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCloudWafs";
import * as CloudWafApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafApi";
import {
  CloudWafClientAddressCell,
  CloudWafStatusCell,
  CloudWafWebAclCell,
  getCloudWafStatusTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafCells";
import {
  ADDED_NOT_ENFORCING_TOAST,
  ADDED_TOAST,
  ALL_WEB_ACLS_PICKED,
  CLOUD_WAFS_DESCRIPTION,
  CLOUD_WAFS_EMPTY_TITLE,
  CLOUD_WAFS_TITLE,
  CLOUD_WAF_TEST_IDS,
  LEFT_IN_CLOUD_TITLE,
  NO_AWS_CONNECTION,
  NO_WEB_ACLS,
  REMOVED_TOAST,
  WEB_ACLS_NOT_READ,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafCopy";
import {
  isCloudWafRuleAddedByOneUptime,
  readCloudWafCodeRule,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafRuleModal";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import {
  AwsWafBlocklistCodeRule,
  getAwsWafBlocklistCloudFormation,
  getAwsWafBlocklistTerraform,
} from "../../../Types/CloudConnection/AwsWafBlocklist";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import {
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "71111111-1111-4111-8111-111111111111",
);
const ROW_ID: string = "74444444-4444-4444-8444-444444444444";
const RESOURCE_ID: string = "75555555-5555-4555-8555-555555555555";
const ARN: string =
  "arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/a1b2c3d4-5678-90ab-cdef-111111111111";
const CLOUDFRONT_ARN: string =
  "arn:aws:wafv2:us-east-1:123456789012:global/webacl/prod-cf/a1b2c3d4-5678-90ab-cdef-222222222222";

const english: Translator = getGlobalTranslator();

const api: {
  readCloudWafCandidates: MockedFn;
  checkCloudWaf: MockedFn;
  removeCloudWaf: MockedFn;
} = CloudWafApi as unknown as {
  readCloudWafCandidates: MockedFn;
  checkCloudWaf: MockedFn;
  removeCloudWaf: MockedFn;
};

const SET_ARNS: Record<string, string> = {
  "block-ipv4":
    "arn:aws:wafv2:eu-west-1:123456789012:regional/ipset/oneuptime-1a2b3c4d-block-ipv4/1",
  "block-ipv6":
    "arn:aws:wafv2:eu-west-1:123456789012:regional/ipset/oneuptime-1a2b3c4d-block-ipv6/2",
  "challenge-ipv4":
    "arn:aws:wafv2:eu-west-1:123456789012:regional/ipset/oneuptime-1a2b3c4d-challenge-ipv4/3",
  "challenge-ipv6":
    "arn:aws:wafv2:eu-west-1:123456789012:regional/ipset/oneuptime-1a2b3c4d-challenge-ipv6/4",
};

function cloudWaf(
  values: Partial<SecurityBlockCloudWaf> = {},
): SecurityBlockCloudWaf {
  const model: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();
  model._id = ROW_ID;
  model.name = "prod-alb";
  model.wafId = ARN;
  model.clientAddress = SecurityBlockClientAddress.SourceIp;
  model.status = SecurityBlockCloudWafStatus.Enforcing;
  Object.assign(model, values);
  return model;
}

function candidate(
  values: Partial<CloudWafApi.CloudWafCandidate>,
): CloudWafApi.CloudWafCandidate {
  return {
    cloudResourceId: RESOURCE_ID,
    name: "prod-alb",
    region: "eu-west-1",
    accountId: "123456789012",
    isCloudFront: false,
    connectionId: "c-1",
    connectionName: "Production",
    isBlockingOn: true,
    isListed: true,
    isPicked: false,
    ...values,
  };
}

function lastForm(): CapturedForm {
  expect(forms.length).toBeGreaterThan(0);
  return forms[forms.length - 1]!;
}

function capturedTable(): CapturedTable {
  expect(table).not.toBeNull();
  return table!;
}

function action(title: string): CapturedAction {
  const found: CapturedAction | undefined = (
    capturedTable().actionButtons || []
  ).find((candidate: CapturedAction): boolean => {
    return candidate.title === title;
  });

  expect(found).toBeDefined();
  return found!;
}

let mayWrite: boolean;
let create: MockedFn;
let toast: MockedFn;
let changed: MockedFn;

beforeEach(() => {
  table = null;
  forms = [];
  confirms = [];
  mayWrite = true;
  changed = jest.fn();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return mayWrite
      ? { isAllowed: true }
      : {
          isAllowed: false,
          disabledReason: "You do not have permission to add web ACLs.",
        };
  });
  create = jest.spyOn(ModelAPI, "create").mockResolvedValue({
    data: { _id: ROW_ID },
  } as never) as unknown as MockedFn;
  toast = jest.spyOn(Toast, "success").mockImplementation(() => {
    return "";
  }) as unknown as MockedFn;

  api.readCloudWafCandidates.mockReset();
  api.checkCloudWaf.mockReset();
  api.removeCloudWaf.mockReset();
  api.readCloudWafCandidates.mockResolvedValue({
    candidates: [candidate({})],
    connections: [{ id: "c-1", name: "Production", isBlockingOn: true }],
  } as never);
  api.checkCloudWaf.mockResolvedValue({
    status: SecurityBlockCloudWafStatus.Enforcing,
    statusMessage: null,
  } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <BlocklistCloudWafs onChanged={changed as unknown as () => void} />
      </MemoryRouter>,
    );
  });
}

describe("the Cloud WAFs card", () => {
  test("lists the project's web ACLs, never deleted as a record - Remove is the way - and edited only for where it reads the client's address", async () => {
    await renderCard();

    const listed: CapturedTable = capturedTable();

    expect(listed.id).toBe("security-blocklist-cloud-wafs-table");
    expect(listed.query).toEqual({ projectId: PROJECT_ID });
    expect(listed.isDeleteable).toBe(false);
    expect(listed.isEditable).toBe(true);
    expect(listed.isCreateable).toBe(true);
    expect(listed.createVerb).toBe("Add");
    expect(listed.singularName).toBe("Web ACL");
    expect(listed.cardProps).toEqual({
      title: CLOUD_WAFS_TITLE,
      description: CLOUD_WAFS_DESCRIPTION,
    });
    expect(listed.emptyState?.title).toBe(CLOUD_WAFS_EMPTY_TITLE);
    expect(
      (listed.formFields || []).map(
        (field: { field: Record<string, unknown> }) => {
          return Object.keys(field.field);
        },
      ),
    ).toEqual([["clientAddress"]]);
    expect(
      (listed.actionButtons || []).map((button: CapturedAction): string => {
        return button.title;
      }),
    ).toEqual(["Show Rule", "Check Again", "Remove"]);
    expect(
      listed.columns.map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["Web ACL", "Client Address", "Status", "Checked"]);
  });

  test("a web ACL is named with where it is: its Region, or CloudFront, and its account", () => {
    render(<CloudWafWebAclCell row={cloudWaf()} />);
    expect(screen.getByTestId(CLOUD_WAF_TEST_IDS.webAclCell)).toHaveTextContent(
      "prod-albeu-west-1, account 123456789012",
    );

    cleanup();

    render(
      <CloudWafWebAclCell
        row={cloudWaf({ name: "prod-cf", wafId: CLOUDFRONT_ARN })}
      />,
    );
    expect(
      screen.getByText("CloudFront, account 123456789012"),
    ).toBeInTheDocument();
  });

  test("where it reads the client's address names the header as written", () => {
    render(
      <CloudWafClientAddressCell
        row={cloudWaf({
          clientAddress: SecurityBlockClientAddress.XForwardedFor,
        })}
      />,
    );
    expect(
      screen.getByText("The last address in the X-Forwarded-For header"),
    ).toBeInTheDocument();

    cleanup();

    render(<CloudWafClientAddressCell row={cloudWaf()} />);
    expect(
      screen.getByText("The request's source address"),
    ).toBeInTheDocument();
  });

  test("where it stands is a chip, with the server's sentence of what to do while it is not enforcing", () => {
    const why: string =
      "prod-alb has no free priority below its first rule (priority 0) for OneUptime's two rules, and OneUptime never renumbers your rules. Free two priorities below it, and OneUptime adds them there.";

    render(
      <CloudWafStatusCell
        row={cloudWaf({
          status: SecurityBlockCloudWafStatus.NoFreePriority,
          statusMessage: why,
        })}
      />,
    );

    expect(screen.getByText("No Free Priority")).toBeInTheDocument();
    expect(
      screen.getByTestId(CLOUD_WAF_TEST_IDS.statusMessage),
    ).toHaveTextContent(why);

    cleanup();

    render(<CloudWafStatusCell row={cloudWaf()} />);
    expect(screen.getByText("Enforcing")).toBeInTheDocument();
    expect(
      screen.queryByTestId(CLOUD_WAF_TEST_IDS.statusMessage),
    ).not.toBeInTheDocument();

    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Enforcing)).toBe(
      PillTone.Success,
    );
    expect(
      getCloudWafStatusTone(SecurityBlockCloudWafStatus.WaitingForRule),
    ).toBe(PillTone.Warning);
    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Failed)).toBe(
      PillTone.Danger,
    );
    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Checking)).toBe(
      PillTone.Info,
    );
  });
});

describe("Add Web ACL", () => {
  test("offers the web ACLs that may be picked, and says why the others are not, with where to change it", async () => {
    api.readCloudWafCandidates.mockResolvedValue({
      candidates: [
        candidate({}),
        candidate({
          cloudResourceId: "r-2",
          name: "prod-cf",
          region: "us-east-1",
          isCloudFront: true,
        }),
        candidate({
          cloudResourceId: "r-3",
          name: "staging-alb",
          connectionName: "Staging",
          isBlockingOn: false,
        }),
        candidate({
          cloudResourceId: "r-4",
          name: "metrics-only",
          isListed: false,
        }),
        candidate({ cloudResourceId: "r-5", name: "api-alb", isPicked: true }),
      ],
      connections: [
        { id: "c-1", name: "Production", isBlockingOn: true },
        { id: "c-2", name: "Staging", isBlockingOn: false },
      ],
    } as never);

    await renderCard();
    await act(async () => {
      capturedTable().onCreateClick!();
    });

    const form: CapturedForm = lastForm();

    expect(form.title).toBe("Add Web ACL");
    expect(form.isLoading).toBe(false);
    expect(form.formProps.fields[0]!.dropdownOptions).toEqual([
      { label: "prod-alb (eu-west-1, Production)", value: RESOURCE_ID },
      { label: "prod-cf (CloudFront, Production)", value: "r-2" },
    ]);
    // Where the client's address is read: the source address unless chosen.
    expect(form.formProps.initialValues).toEqual({
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });
    expect(
      form.formProps.fields[1]!.dropdownOptions!.map(
        (option: { label: string }): string => {
          return option.label;
        },
      ),
    ).toEqual([
      "The request's source address",
      "The last address in the X-Forwarded-For header",
      "The CF-Connecting-IP header",
      "The True-Client-IP header",
    ]);

    const note: HTMLElement = screen.getByTestId(CLOUD_WAF_TEST_IDS.addNote);

    expect(note).toHaveTextContent(
      "Web ACLs of Staging are not listed: turn on Block addresses in AWS WAF for the connection, and run its setup command again.",
    );
    expect(note).toHaveTextContent(WEB_ACLS_NOT_READ);
    expect(note).toHaveTextContent("Cloud Connections");
  });

  test("with no AWS connection, or no web ACL found, or every one picked, it says so", () => {
    expect(
      getCloudWafAddNotes({
        translator: english,
        candidates: { candidates: [], connections: [] },
      }),
    ).toEqual([NO_AWS_CONNECTION]);
    expect(
      getCloudWafAddNotes({
        translator: english,
        candidates: {
          candidates: [],
          connections: [{ id: "c-1", name: "Production", isBlockingOn: true }],
        },
      }),
    ).toEqual([NO_WEB_ACLS]);

    const allPicked: CloudWafApi.CloudWafCandidates = {
      candidates: [candidate({ isPicked: true })],
      connections: [{ id: "c-1", name: "Production", isBlockingOn: true }],
    };

    expect(
      getCloudWafOptions({ translator: english, candidates: allPicked }),
    ).toEqual([]);
    expect(
      getCloudWafAddNotes({ translator: english, candidates: allPicked }),
    ).toEqual([ALL_WEB_ACLS_PICKED]);
  });

  test("adds the one picked from the inventory, sets it up at once, and says whether it enforces the blocklist yet", async () => {
    await renderCard();
    await act(async () => {
      capturedTable().onCreateClick!();
    });
    await act(async () => {
      await lastForm().onSubmit!({
        cloudResourceId: RESOURCE_ID,
        clientAddress: SecurityBlockClientAddress.CfConnectingIp,
      });
    });

    const made: SecurityBlockCloudWaf = (
      create.mock.calls[0]![0] as { model: SecurityBlockCloudWaf }
    ).model;

    expect(made.cloudResourceId?.toString()).toBe(RESOURCE_ID);
    expect(made.clientAddress).toBe(SecurityBlockClientAddress.CfConnectingIp);
    // Only what the person picked: OneUptime names the rest from the inventory.
    expect(made.wafId).toBeUndefined();
    expect(made.cloudConnectionId).toBeUndefined();
    expect((api.checkCloudWaf.mock.calls[0]![0] as ObjectID).toString()).toBe(
      ROW_ID,
    );
    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(ADDED_TOAST, { name: "prod-alb" }),
    );
    expect(screen.queryByTestId("form-modal")).not.toBeInTheDocument();
    expect(capturedTable().refreshToggle).toBe("1");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test("one that does not enforce yet says so, and its status says why", async () => {
    api.checkCloudWaf.mockResolvedValue({
      status: SecurityBlockCloudWafStatus.WaitingForRule,
      statusMessage: "prod-alb has no rule that blocks the sets yet.",
    } as never);

    await renderCard();
    await act(async () => {
      capturedTable().onCreateClick!();
    });
    await act(async () => {
      await lastForm().onSubmit!({ cloudResourceId: RESOURCE_ID });
    });

    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(ADDED_NOT_ENFORCING_TOAST, {
        name: "prod-alb",
      }),
    );
  });

  test("a web ACL the server refuses stays in the dialog, saying why", async () => {
    create.mockRejectedValue(
      new Error(
        "Turn on Block addresses in AWS WAF for the connection Staging first, and run its setup command again: it grants the IP sets this needs.",
      ) as never,
    );

    await renderCard();
    await act(async () => {
      capturedTable().onCreateClick!();
    });
    await act(async () => {
      await lastForm().onSubmit!({ cloudResourceId: RESOURCE_ID });
    });

    expect(screen.getByTestId("form-modal")).toBeInTheDocument();
    expect(lastForm().error).toContain("Turn on Block addresses in AWS WAF");
    expect(api.checkCloudWaf).not.toHaveBeenCalled();
  });
});

describe("Check Again and Remove", () => {
  test("Check Again sets the web ACL up and reads it now", async () => {
    await renderCard();

    const done: MockedFn = jest.fn();

    await act(async () => {
      await action("Check Again").onClick(
        cloudWaf(),
        done as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });

    expect((api.checkCloudWaf.mock.calls[0]![0] as ObjectID).toString()).toBe(
      ROW_ID,
    );
    expect(done).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("prod-alb is checked.");
  });

  test("whoever may not change where the blocklist is enforced sees Check Again and Remove locked, with why; Show Rule stays open", async () => {
    mayWrite = false;

    await renderCard();

    for (const title of ["Check Again", "Remove"]) {
      expect(action(title).disabled).toBe(true);
      expect(action(title).tooltip).toBe(
        "You do not have permission to add web ACLs.",
      );
    }

    expect(action("Show Rule").disabled).toBeFalsy();
  });

  test("Remove takes OneUptime out of AWS WAF first, and says the web ACL no longer enforces the blocklist", async () => {
    api.removeCloudWaf.mockResolvedValue([] as never);

    await renderCard();
    await act(async () => {
      await action("Remove").onClick(
        cloudWaf(),
        jest.fn() as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });

    expect(lastForm().title).toBe("Remove Web ACL");
    expect(lastForm().formProps.initialValues).toEqual({ keepInCloud: false });

    await act(async () => {
      await lastForm().onSubmit!({ keepInCloud: false });
    });

    const asked: { id: ObjectID; keepInCloud: boolean } = api.removeCloudWaf
      .mock.calls[0]![0] as { id: ObjectID; keepInCloud: boolean };

    expect(asked.id.toString()).toBe(ROW_ID);
    expect(asked.keepInCloud).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(REMOVED_TOAST, { name: "prod-alb" }),
    );
    expect(confirms).toHaveLength(0);
  });

  test("from OneUptime only, what stays in AWS WAF is named, to delete there", async () => {
    api.removeCloudWaf.mockResolvedValue([
      {
        kind: SecurityBlockCloudWafLeftKind.Rule,
        name: "OneUptime-Blocklist-1a2b3c4d",
        webAcl: "prod-alb",
      },
      {
        kind: SecurityBlockCloudWafLeftKind.IpSet,
        name: "oneuptime-1a2b3c4d-block-ipv4",
      },
    ] as never);

    await renderCard();
    await act(async () => {
      await action("Remove").onClick(
        cloudWaf(),
        jest.fn() as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });
    await act(async () => {
      await lastForm().onSubmit!({ keepInCloud: true });
    });

    expect(
      (api.removeCloudWaf.mock.calls[0]![0] as { keepInCloud: boolean })
        .keepInCloud,
    ).toBe(true);
    expect(confirms[confirms.length - 1]!.title).toBe(LEFT_IN_CLOUD_TITLE);

    const left: HTMLElement = screen.getByTestId(
      CLOUD_WAF_TEST_IDS.leftInCloud,
    );

    expect(left).toHaveTextContent(
      "Rule OneUptime-Blocklist-1a2b3c4d in prod-alb",
    );
    expect(left).toHaveTextContent("IP set oneuptime-1a2b3c4d-block-ipv4");
  });
});

describe("Show Rule", () => {
  const details: Record<string, unknown> = {
    addsRule: false,
    ruleNames: {
      block: "OneUptime-Blocklist-1a2b3c4d",
      challenge: "OneUptime-Challenge-1a2b3c4d",
    },
    setArns: SET_ARNS,
    priorities: { block: null, challenge: null },
  };

  test("a web ACL kept in code gets both rules with every set's ARN and its header, first in the web ACL", () => {
    const row: SecurityBlockCloudWaf = cloudWaf({
      clientAddress: SecurityBlockClientAddress.XForwardedFor,
      ruleDetails: details as never,
    });
    const rule: AwsWafBlocklistCodeRule = readCloudWafCodeRule(row)!;

    expect(isCloudWafRuleAddedByOneUptime(row)).toBe(false);
    expect(rule.priorities).toEqual({ block: 0, challenge: 1 });

    const terraform: string = getAwsWafBlocklistTerraform(rule);
    const cloudFormation: string = getAwsWafBlocklistCloudFormation(rule);

    for (const arn of Object.values(SET_ARNS)) {
      expect(terraform).toContain(arn);
      expect(cloudFormation).toContain(arn);
    }

    expect(terraform).toContain('header_name       = "X-Forwarded-For"');
    expect(cloudFormation).toContain("HeaderName: X-Forwarded-For");
  });

  test("until every set is made there is no rule to show", () => {
    expect(
      readCloudWafCodeRule(
        cloudWaf({
          ruleDetails: {
            ...details,
            setArns: { "block-ipv4": SET_ARNS["block-ipv4"] },
          } as never,
        }),
      ),
    ).toBeNull();
    expect(readCloudWafCodeRule(cloudWaf())).toBeNull();
  });
});
