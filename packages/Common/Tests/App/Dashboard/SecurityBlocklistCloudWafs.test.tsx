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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE BLOCKLIST'S CLOUD WAFS (#10344, #10348, #10349), drawn: the WAFs the
 * blocklist is enforced in - AWS WAF web ACLs, Azure Application Gateway
 * and Front Door WAF policies, Cloud Armor security policies - listed the
 * same way (a ModelTable call, so its props are pinned and its cells drawn
 * from them): each by its name and where it is, where it reads the
 * client's address, and where it stands, with why when it is not
 * enforcing - Azure WAF's and Cloud Armor's reasons in the reader's
 * language. Add WAF with the WAFs that may be picked and why others are
 * not, the access check a policy waits for, and where the client's address
 * is read folded under More fields; Check Again; Put It Back; Client
 * Address; Remove, which names what stays in the cloud; and Show Rule's
 * rule as code, for AWS WAF alone.
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
  isVisible?: ((item: unknown) => boolean) | undefined;
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
  selectMoreFields?: Record<string, unknown>;
  columns: Array<Column>;
};

type CapturedField = {
  field: Record<string, unknown>;
  title?: string;
  description?: string;
  dropdownOptions?: Array<{ label: string; value: string }>;
  collapsibleSection?: { title?: string } | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  getCustomElement?:
    | ((values: Record<string, unknown>) => React.ReactElement)
    | undefined;
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
    fields: Array<CapturedField>;
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

jest.mock("../../../UI/Components/CodeBlock/CodeBlock", () => {
  return {
    __esModule: true,
    default: (props: { code: string }) => {
      return React.createElement("pre", { "data-testid": "code" }, props.code);
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
      putBackCloudWaf: jest.fn(),
      removeCloudWaf: jest.fn(),
      checkCloudWafAccess: jest.fn(),
    };
  },
);

import BlocklistCloudWafs, {
  getClientAddressField,
  getCloudWafAddNotes,
  getCloudWafOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCloudWafs";
import CloudWafAccessPanel from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafAccessPanel";
import * as CloudWafApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafApi";
import {
  CloudWafClientAddressCell,
  CloudWafStatusCell,
  CloudWafWebAclCell,
  getCloudWafStatusTone,
  writeCloudWafStatusMessage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafCells";
import {
  ACCESS_NEEDED_TO_ADD,
  ADDED_NOT_ENFORCING_TOAST,
  ADDED_TOAST,
  ALL_WAFS_PICKED,
  CHANGED_CLIENT_ADDRESS_TOAST,
  CLOUD_WAFS_DESCRIPTION,
  CLOUD_WAFS_EMPTY_TITLE,
  CLOUD_WAFS_TITLE,
  CLOUD_WAF_TEST_IDS,
  KEEP_IN_POLICY_FIELD_DESCRIPTION,
  LEFT_IN_AZURE_TITLE,
  LEFT_IN_CLOUD_ARMOR_TITLE,
  LEFT_IN_CLOUD_TITLE,
  NO_CLOUD_CONNECTION,
  NO_WAFS,
  PUT_BACK_TOAST,
  REMOVED_TOAST,
  REMOVE_AZURE_DESCRIPTION,
  REMOVE_CLOUD_ARMOR_DESCRIPTION,
  WEB_ACLS_NOT_READ,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafCopy";
import {
  isCloudWafRuleAddedByOneUptime,
  readCloudWafCodeRule,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/CloudWafRuleModal";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AwsWafBlocklistCodeRule,
  getAwsWafBlocklistCloudFormation,
  getAwsWafBlocklistTerraform,
} from "../../../Types/CloudConnection/AwsWafBlocklist";
import { CloudArmorPolicyType } from "../../../Types/CloudConnection/CloudArmorBlocklist";
import ObjectID from "../../../Types/ObjectID";
import {
  CLOUD_WAF_REASONS,
  cloudWafReason,
} from "../../../Types/SecurityBlocklist/CloudWafReasons";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockCloudWafKind } from "../../../Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import { toSecurityBlockReasonJson } from "../../../Types/SecurityBlocklist/SecurityBlockReason";
import { createTranslator } from "../../../Types/Translator";
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
const SUBSCRIPTION: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const GATEWAY_POLICY_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/prod-waf`;
const FRONT_DOOR_POLICY_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-edge/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/edgewaf`;
const ARMOR_POLICY_ID: string =
  "projects/acme-prod/global/securityPolicies/prod-lb";
const REGIONAL_ARMOR_POLICY_ID: string =
  "projects/acme-prod/regions/europe-west1/securityPolicies/eu-lb";

const english: Translator = getGlobalTranslator();

const api: {
  readCloudWafCandidates: MockedFn;
  checkCloudWaf: MockedFn;
  putBackCloudWaf: MockedFn;
  removeCloudWaf: MockedFn;
  checkCloudWafAccess: MockedFn;
} = CloudWafApi as unknown as {
  readCloudWafCandidates: MockedFn;
  checkCloudWaf: MockedFn;
  putBackCloudWaf: MockedFn;
  removeCloudWaf: MockedFn;
  checkCloudWafAccess: MockedFn;
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

const AWS_CHOICES: Array<SecurityBlockClientAddress> = [
  SecurityBlockClientAddress.SourceIp,
  SecurityBlockClientAddress.XForwardedFor,
  SecurityBlockClientAddress.CfConnectingIp,
  SecurityBlockClientAddress.TrueClientIp,
];

function cloudWaf(
  values: Partial<SecurityBlockCloudWaf> = {},
): SecurityBlockCloudWaf {
  const model: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();
  model._id = ROW_ID;
  model.name = "prod-alb";
  model.cloudProvider = CloudProvider.AWS;
  model.wafId = ARN;
  model.clientAddress = SecurityBlockClientAddress.SourceIp;
  model.status = SecurityBlockCloudWafStatus.Enforcing;
  Object.assign(model, values);
  return model;
}

function gatewayPolicy(
  values: Partial<SecurityBlockCloudWaf> = {},
): SecurityBlockCloudWaf {
  return cloudWaf({
    name: "prod-waf",
    cloudProvider: CloudProvider.Azure,
    wafId: GATEWAY_POLICY_ID,
    ...values,
  });
}

function frontDoorPolicy(
  values: Partial<SecurityBlockCloudWaf> = {},
): SecurityBlockCloudWaf {
  return cloudWaf({
    name: "edgewaf",
    cloudProvider: CloudProvider.Azure,
    wafId: FRONT_DOOR_POLICY_ID,
    ...values,
  });
}

function armorPolicy(
  values: Partial<SecurityBlockCloudWaf> = {},
): SecurityBlockCloudWaf {
  return cloudWaf({
    name: "prod-lb",
    cloudProvider: CloudProvider.GCP,
    wafId: ARMOR_POLICY_ID,
    ...values,
  });
}

function candidate(
  values: Partial<CloudWafApi.CloudWafCandidate>,
): CloudWafApi.CloudWafCandidate {
  return {
    cloudResourceId: RESOURCE_ID,
    cloudProvider: CloudProvider.AWS,
    kind: SecurityBlockCloudWafKind.AwsWebAcl,
    name: "prod-alb",
    region: "eu-west-1",
    accountId: "123456789012",
    isCloudFront: false,
    cloudArmorPolicyType: null,
    clientAddresses: [...AWS_CHOICES],
    connectionId: "c-1",
    connectionName: "Production",
    isBlockingOn: true,
    isListed: true,
    refusal: "",
    refusalReason: null,
    isPicked: false,
    ...values,
  };
}

function azureCandidate(
  values: Partial<CloudWafApi.CloudWafCandidate>,
): CloudWafApi.CloudWafCandidate {
  return candidate({
    cloudResourceId: "r-azure",
    cloudProvider: CloudProvider.Azure,
    kind: SecurityBlockCloudWafKind.AzureFrontDoor,
    name: "edgewaf",
    region: "global",
    accountId: SUBSCRIPTION,
    clientAddresses: [
      SecurityBlockClientAddress.SourceIp,
      SecurityBlockClientAddress.ForwardedClient,
    ],
    connectionId: "c-azure",
    connectionName: "Production Azure",
    ...values,
  });
}

function armorCandidate(
  values: Partial<CloudWafApi.CloudWafCandidate>,
): CloudWafApi.CloudWafCandidate {
  return candidate({
    cloudResourceId: "r-armor",
    cloudProvider: CloudProvider.GCP,
    kind: SecurityBlockCloudWafKind.CloudArmor,
    name: "prod-lb",
    region: "global",
    accountId: "acme-prod",
    cloudArmorPolicyType: CloudArmorPolicyType.Backend,
    clientAddresses: [
      SecurityBlockClientAddress.SourceIp,
      SecurityBlockClientAddress.UserIp,
    ],
    connectionId: "c-gcp",
    connectionName: "Production GCP",
    ...values,
  });
}

function lastForm(): CapturedForm {
  expect(forms.length).toBeGreaterThan(0);
  return forms[forms.length - 1]!;
}

function fieldOf(form: CapturedForm, key: string): CapturedField {
  const found: CapturedField | undefined = form.formProps.fields.find(
    (field: CapturedField): boolean => {
      return Object.keys(field.field)[0] === key;
    },
  );

  expect(found).toBeDefined();
  return found!;
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

// Whether an action is drawn on a row: one without isVisible always is.
function isShownOn(title: string, row: SecurityBlockCloudWaf): boolean {
  const found: CapturedAction = action(title);

  return found.isVisible ? found.isVisible(row) : true;
}

let mayWrite: boolean;
let create: MockedFn;
let updateById: MockedFn;
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
          disabledReason: "You do not have permission to add WAFs.",
        };
  });
  create = jest.spyOn(ModelAPI, "create").mockResolvedValue({
    data: { _id: ROW_ID },
  } as never) as unknown as MockedFn;
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({} as never) as unknown as MockedFn;
  toast = jest.spyOn(Toast, "success").mockImplementation(() => {
    return "";
  }) as unknown as MockedFn;

  api.readCloudWafCandidates.mockReset();
  api.checkCloudWaf.mockReset();
  api.putBackCloudWaf.mockReset();
  api.removeCloudWaf.mockReset();
  api.checkCloudWafAccess.mockReset();
  api.readCloudWafCandidates.mockResolvedValue({
    candidates: [candidate({})],
    connections: [
      {
        id: "c-1",
        name: "Production",
        provider: CloudProvider.AWS,
        isBlockingOn: true,
      },
    ],
  } as never);
  api.checkCloudWaf.mockResolvedValue({
    status: SecurityBlockCloudWafStatus.Enforcing,
    statusMessage: null,
    statusReason: null,
  } as never);
  api.putBackCloudWaf.mockResolvedValue({
    status: SecurityBlockCloudWafStatus.Enforcing,
    statusMessage: null,
    statusReason: null,
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

async function openAdd(): Promise<CapturedForm> {
  await renderCard();
  await act(async () => {
    capturedTable().onCreateClick!();
  });

  return lastForm();
}

describe("the Cloud WAFs card", () => {
  test("lists the project's WAFs of every cloud, never deleted or edited as a record: Remove and Client Address are the ways", async () => {
    await renderCard();

    const listed: CapturedTable = capturedTable();

    expect(listed.id).toBe("security-blocklist-cloud-wafs-table");
    expect(listed.query).toEqual({ projectId: PROJECT_ID });
    expect(listed.isDeleteable).toBe(false);
    expect(listed.isEditable).toBe(false);
    expect(listed.isCreateable).toBe(true);
    expect(listed.createVerb).toBe("Add");
    expect(listed.singularName).toBe("WAF");
    expect(listed.cardProps).toEqual({
      title: CLOUD_WAFS_TITLE,
      description: CLOUD_WAFS_DESCRIPTION,
    });
    expect(listed.emptyState?.title).toBe(CLOUD_WAFS_EMPTY_TITLE);
    expect(listed.formFields).toBeUndefined();
    // Its cloud, and why it is not enforcing in the reader's words.
    expect(listed.selectMoreFields).toEqual(
      expect.objectContaining({ cloudProvider: true, statusReason: true }),
    );
    expect(
      (listed.actionButtons || []).map((button: CapturedAction): string => {
        return button.title;
      }),
    ).toEqual([
      "Show Rule",
      "Put It Back",
      "Check Again",
      "Client Address",
      "Remove",
    ]);
    expect(
      listed.columns.map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["WAF", "Client Address", "Status", "Checked"]);
  });

  test("a WAF is named with where it is: a web ACL's Region or CloudFront and account, a policy's kind and resource group, a Cloud Armor policy's place and project", () => {
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

    cleanup();

    render(<CloudWafWebAclCell row={gatewayPolicy()} />);
    expect(
      screen.getByText("Application Gateway, resource group rg-prod"),
    ).toBeInTheDocument();

    cleanup();

    render(<CloudWafWebAclCell row={frontDoorPolicy()} />);
    expect(
      screen.getByText("Front Door, resource group rg-edge"),
    ).toBeInTheDocument();

    cleanup();

    render(<CloudWafWebAclCell row={armorPolicy()} />);
    expect(
      screen.getByText("Cloud Armor, global, project acme-prod"),
    ).toBeInTheDocument();

    cleanup();

    render(
      <CloudWafWebAclCell
        row={armorPolicy({ name: "eu-lb", wafId: REGIONAL_ARMOR_POLICY_ID })}
      />,
    );
    expect(
      screen.getByText("Cloud Armor, europe-west1, project acme-prod"),
    ).toBeInTheDocument();
  });

  test("where it reads the client's address is named as its cloud names it, a header as written", () => {
    const cases: Array<[SecurityBlockCloudWaf, string]> = [
      [
        cloudWaf({ clientAddress: SecurityBlockClientAddress.XForwardedFor }),
        "The last address in the X-Forwarded-For header",
      ],
      [cloudWaf(), "The request's source address"],
      [
        frontDoorPolicy(),
        "The address that connected to Front Door (SocketAddr)",
      ],
      [
        frontDoorPolicy({
          clientAddress: SecurityBlockClientAddress.ForwardedClient,
        }),
        "The original client, from X-Forwarded-For (RemoteAddr)",
      ],
      [
        gatewayPolicy(),
        "The address that connected to the gateway (RemoteAddr)",
      ],
      [
        armorPolicy(),
        "The address that connected to the load balancer (origin.ip)",
      ],
      [
        armorPolicy({ clientAddress: SecurityBlockClientAddress.UserIp }),
        "The user IP from the policy's request headers (origin.user_ip)",
      ],
    ];

    for (const [row, text] of cases) {
      render(<CloudWafClientAddressCell row={row} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      cleanup();
    }
  });

  test("where it stands is a chip, with what to do while it is not enforcing: AWS WAF's sentence as the server wrote it", () => {
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
    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Drifted)).toBe(
      PillTone.Warning,
    );
    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Failed)).toBe(
      PillTone.Danger,
    );
    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Checking)).toBe(
      PillTone.Info,
    );
    expect(getCloudWafStatusTone(SecurityBlockCloudWafStatus.Applying)).toBe(
      PillTone.Info,
    );
  });

  test("an Azure WAF or Cloud Armor policy's reason is worded in the reader's language, over the English the server kept beside it", () => {
    const reason: ReturnType<typeof cloudWafReason> = cloudWafReason(
      CLOUD_WAF_REASONS.ruleTurnedOff,
      { rule: "OneUptime1a2b3c4dBlock1", policy: "prod-waf" },
    );
    const row: SecurityBlockCloudWaf = gatewayPolicy({
      status: SecurityBlockCloudWafStatus.Drifted,
      statusMessage: "an older English sentence",
      statusReason: toSecurityBlockReasonJson(reason),
    });

    render(<CloudWafStatusCell row={row} />);

    expect(screen.getByText("Changed by Hand")).toBeInTheDocument();
    expect(
      screen.getByTestId(CLOUD_WAF_TEST_IDS.statusMessage),
    ).toHaveTextContent(
      "OneUptime's rule OneUptime1a2b3c4dBlock1 in prod-waf was turned off by hand, so the blocks it holds are not enforced. Select Put It Back to turn it on again.",
    );

    // In German, as the German Dashboard words it, with the names as written.
    const wordings: Record<string, string> = {
      [CLOUD_WAF_REASONS.ruleTurnedOff]:
        "Die Regel {{rule}} von OneUptime in {{policy}} wurde von Hand ausgeschaltet.",
    };
    const german: Translator = createTranslator(
      (text: string): string | undefined => {
        return wordings[text];
      },
      "de",
    );

    expect(writeCloudWafStatusMessage(german, row)).toBe(
      "Die Regel OneUptime1a2b3c4dBlock1 von OneUptime in prod-waf wurde von Hand ausgeschaltet.",
    );
  });
});

describe("Add WAF", () => {
  test("offers the WAFs of every cloud that may be picked, and says why the others are not, with where to change it", async () => {
    const network: ReturnType<typeof cloudWafReason> = cloudWafReason(
      CLOUD_WAF_REASONS.networkPolicy,
      { policy: "nlb-edge" },
    );

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
        azureCandidate({}),
        azureCandidate({
          cloudResourceId: "r-gateway",
          kind: SecurityBlockCloudWafKind.AzureApplicationGateway,
          name: "prod-waf",
          clientAddresses: [SecurityBlockClientAddress.SourceIp],
        }),
        azureCandidate({
          cloudResourceId: "r-azure-off",
          name: "dev-waf",
          connectionName: "Dev Azure",
          isBlockingOn: false,
        }),
        armorCandidate({}),
        armorCandidate({
          cloudResourceId: "r-armor-network",
          kind: null,
          name: "nlb-edge",
          isListed: false,
          refusal: "nlb-edge is a network edge security policy.",
          refusalReason: network,
        }),
      ],
      connections: [
        {
          id: "c-1",
          name: "Production",
          provider: CloudProvider.AWS,
          isBlockingOn: true,
        },
        {
          id: "c-2",
          name: "Staging",
          provider: CloudProvider.AWS,
          isBlockingOn: false,
        },
      ],
    } as never);

    const form: CapturedForm = await openAdd();

    expect(form.title).toBe("Add WAF");
    expect(form.isLoading).toBe(false);
    expect(fieldOf(form, "cloudResourceId").dropdownOptions).toEqual([
      { label: "prod-alb (eu-west-1, Production)", value: RESOURCE_ID },
      { label: "prod-cf (CloudFront, Production)", value: "r-2" },
      { label: "edgewaf (Front Door, Production Azure)", value: "r-azure" },
      {
        label: "prod-waf (Application Gateway, Production Azure)",
        value: "r-gateway",
      },
      {
        label: "prod-lb (Cloud Armor, global, Production GCP)",
        value: "r-armor",
      },
    ]);

    const note: HTMLElement = screen.getByTestId(CLOUD_WAF_TEST_IDS.addNote);

    expect(note).toHaveTextContent(
      "Web ACLs of Staging are not listed: turn on Block addresses in AWS WAF for the connection, and run its setup command again.",
    );
    expect(note).toHaveTextContent(
      "The WAF policies of Dev Azure are not listed: turn on Block addresses in Azure WAF or Block addresses in Cloud Armor for the connection, under More fields.",
    );
    expect(note).toHaveTextContent(WEB_ACLS_NOT_READ);
    // A policy OneUptime cannot keep the blocklist in, in the reader's words.
    expect(note).toHaveTextContent(
      "nlb-edge is a network edge security policy, whose rules match packets rather than requests, so OneUptime does not keep the blocklist in it. Pick a backend or edge security policy.",
    );
    expect(note).toHaveTextContent("Cloud Connections");
  });

  test("where the client's address is read is folded under More fields, offered only for a WAF that can read it in more than one place, the address that connected first", async () => {
    api.readCloudWafCandidates.mockResolvedValue({
      candidates: [
        candidate({}),
        azureCandidate({}),
        azureCandidate({
          cloudResourceId: "r-gateway",
          kind: SecurityBlockCloudWafKind.AzureApplicationGateway,
          name: "prod-waf",
          clientAddresses: [SecurityBlockClientAddress.SourceIp],
        }),
        armorCandidate({}),
      ],
      connections: [],
    } as never);

    const form: CapturedForm = await openAdd();

    expect(form.formProps.initialValues).toEqual({
      clientAddressAws: SecurityBlockClientAddress.SourceIp,
      clientAddressFrontDoor: SecurityBlockClientAddress.SourceIp,
      clientAddressCloudArmor: SecurityBlockClientAddress.SourceIp,
    });

    const aws: CapturedField = fieldOf(form, "clientAddressAws");
    const frontDoor: CapturedField = fieldOf(form, "clientAddressFrontDoor");
    const armor: CapturedField = fieldOf(form, "clientAddressCloudArmor");

    for (const field of [aws, frontDoor, armor]) {
      expect(field.title).toBe("Client Address");
      expect(field.collapsibleSection?.title).toBe("More fields");
    }

    expect(
      aws.dropdownOptions!.map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual([
      "The request's source address",
      "The last address in the X-Forwarded-For header",
      "The CF-Connecting-IP header",
      "The True-Client-IP header",
    ]);
    expect(frontDoor.dropdownOptions).toEqual([
      {
        label: "The address that connected to Front Door (SocketAddr)",
        value: SecurityBlockClientAddress.SourceIp,
        isUserContent: true,
        isInPageDirection: true,
      },
      {
        label: "The original client, from X-Forwarded-For (RemoteAddr)",
        value: SecurityBlockClientAddress.ForwardedClient,
        isUserContent: true,
        isInPageDirection: true,
      },
    ]);
    expect(armor.dropdownOptions).toEqual([
      {
        label: "The address that connected to the load balancer (origin.ip)",
        value: SecurityBlockClientAddress.SourceIp,
        isUserContent: true,
        isInPageDirection: true,
      },
      {
        label: "The user IP from the policy's request headers (origin.user_ip)",
        value: SecurityBlockClientAddress.UserIp,
        isUserContent: true,
        isInPageDirection: true,
      },
    ]);

    // Each shows for its own kind; Application Gateway reads one address, so none shows.
    const shows: (field: CapturedField, picked: string) => boolean = (
      field: CapturedField,
      picked: string,
    ): boolean => {
      return field.showIf!({ cloudResourceId: picked });
    };

    expect(shows(aws, RESOURCE_ID)).toBe(true);
    expect(shows(frontDoor, RESOURCE_ID)).toBe(false);
    expect(shows(frontDoor, "r-azure")).toBe(true);
    expect(shows(armor, "r-armor")).toBe(true);

    for (const field of [aws, frontDoor, armor]) {
      expect(shows(field, "r-gateway")).toBe(false);
    }

    expect(
      getClientAddressField(
        azureCandidate({
          kind: SecurityBlockCloudWafKind.AzureApplicationGateway,
          clientAddresses: [SecurityBlockClientAddress.SourceIp],
        }),
      ),
    ).toBeNull();
    // An edge security policy reads the address that connected alone.
    expect(
      getClientAddressField(
        armorCandidate({
          cloudArmorPolicyType: CloudArmorPolicyType.Edge,
          clientAddresses: [SecurityBlockClientAddress.SourceIp],
        }),
      ),
    ).toBeNull();
  });

  test("with no cloud connection, or no WAF found, or every one picked, it says so", () => {
    expect(
      getCloudWafAddNotes({
        translator: english,
        candidates: { candidates: [], connections: [] },
      }),
    ).toEqual([NO_CLOUD_CONNECTION]);
    expect(
      getCloudWafAddNotes({
        translator: english,
        candidates: {
          candidates: [],
          connections: [
            {
              id: "c-1",
              name: "Production",
              provider: CloudProvider.AWS,
              isBlockingOn: true,
            },
          ],
        },
      }),
    ).toEqual([NO_WAFS]);

    const allPicked: CloudWafApi.CloudWafCandidates = {
      candidates: [candidate({ isPicked: true })],
      connections: [
        {
          id: "c-1",
          name: "Production",
          provider: CloudProvider.AWS,
          isBlockingOn: true,
        },
      ],
    };

    expect(
      getCloudWafOptions({ translator: english, candidates: allPicked }),
    ).toEqual([]);
    expect(
      getCloudWafAddNotes({ translator: english, candidates: allPicked }),
    ).toEqual([ALL_WAFS_PICKED]);
  });

  test("adds the web ACL picked from the inventory, sets it up at once, and says whether it enforces the blocklist yet", async () => {
    const form: CapturedForm = await openAdd();

    // A web ACL is not a policy: no access check to wait for.
    expect(
      fieldOf(form, "access").showIf!({ cloudResourceId: RESOURCE_ID }),
    ).toBe(false);

    await act(async () => {
      await form.onSubmit!({
        cloudResourceId: RESOURCE_ID,
        clientAddressAws: SecurityBlockClientAddress.CfConnectingIp,
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
    expect(api.checkCloudWafAccess).not.toHaveBeenCalled();
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
      statusReason: null,
    } as never);

    const form: CapturedForm = await openAdd();

    await act(async () => {
      await form.onSubmit!({ cloudResourceId: RESOURCE_ID });
    });

    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(ADDED_NOT_ENFORCING_TOAST, {
        name: "prod-alb",
      }),
    );
  });

  test("a WAF the server refuses stays in the dialog, saying why", async () => {
    create.mockRejectedValue(
      new Error(
        "Turn on Block addresses in AWS WAF for the connection Staging first, and run its setup command again: it grants the IP sets this needs.",
      ) as never,
    );

    const form: CapturedForm = await openAdd();

    await act(async () => {
      await form.onSubmit!({ cloudResourceId: RESOURCE_ID });
    });

    expect(screen.getByTestId("form-modal")).toBeInTheDocument();
    expect(lastForm().error).toContain("Turn on Block addresses in AWS WAF");
    expect(api.checkCloudWaf).not.toHaveBeenCalled();
  });

  test("an Azure WAF policy waits for its connection's access: the dialog asks Azure, shows the lines that grant what is missing, and adds it once every permission is granted", async () => {
    api.readCloudWafCandidates.mockResolvedValue({
      candidates: [azureCandidate({})],
      connections: [],
    } as never);
    api.checkCloudWafAccess.mockResolvedValue({
      checks: [
        {
          permission:
            "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/read",
          isGranted: true,
        },
        {
          permission:
            "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/write",
          isGranted: false,
        },
      ],
      isGranted: false,
      command:
        'az role assignment create --assignee "app" --role "OneUptime WAF Blocklist"',
      shell: "azure",
    } as never);

    const form: CapturedForm = await openAdd();
    const access: CapturedField = fieldOf(form, "access");

    expect(access.showIf!({ cloudResourceId: "r-azure" })).toBe(true);

    // Added before the check answers: refused, nothing made.
    await act(async () => {
      await form.onSubmit!({
        cloudResourceId: "r-azure",
        clientAddressFrontDoor: SecurityBlockClientAddress.ForwardedClient,
      });
    });

    expect(create).not.toHaveBeenCalled();
    expect(lastForm().error).toBe(ACCESS_NEEDED_TO_ADD);

    // The panel, drawn where the dialog draws it, asks Azure at once.
    await act(async () => {
      render(
        <MemoryRouter>
          {lastForm().formProps.fields.find((field: CapturedField): boolean => {
            return Object.keys(field.field)[0] === "access";
          })!.getCustomElement!({ cloudResourceId: "r-azure" })}
        </MemoryRouter>,
      );
    });

    expect(api.checkCloudWafAccess).toHaveBeenCalledWith("r-azure");

    const panel: HTMLElement = screen.getByTestId(CLOUD_WAF_TEST_IDS.access);

    expect(panel).toHaveTextContent(
      "The connection may not write edgewaf yet. Run these lines in Azure Cloud Shell, then select Check Again.",
    );
    expect(panel).toHaveTextContent("Granted");
    expect(panel).toHaveTextContent("Missing");
    expect(
      screen.getByTestId(CLOUD_WAF_TEST_IDS.accessCommand),
    ).toHaveTextContent(
      'az role assignment create --assignee "app" --role "OneUptime WAF Blocklist"',
    );

    // The person runs the lines, and checks again: now it may.
    api.checkCloudWafAccess.mockResolvedValue({
      checks: [
        {
          permission:
            "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/read",
          isGranted: true,
        },
        {
          permission:
            "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/write",
          isGranted: true,
        },
      ],
      isGranted: true,
      command: "",
      shell: "azure",
    } as never);

    await act(async () => {
      fireEvent.click(screen.getByTestId(CLOUD_WAF_TEST_IDS.accessCheck));
    });

    expect(api.checkCloudWafAccess).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(CLOUD_WAF_TEST_IDS.access)).toHaveTextContent(
      "The connection may read and write edgewaf.",
    );
    expect(
      screen.queryByTestId(CLOUD_WAF_TEST_IDS.accessCommand),
    ).not.toBeInTheDocument();

    await act(async () => {
      await lastForm().onSubmit!({
        cloudResourceId: "r-azure",
        clientAddressFrontDoor: SecurityBlockClientAddress.ForwardedClient,
      });
    });

    const made: SecurityBlockCloudWaf = (
      create.mock.calls[0]![0] as { model: SecurityBlockCloudWaf }
    ).model;

    expect(made.cloudResourceId?.toString()).toBe("r-azure");
    expect(made.clientAddress).toBe(SecurityBlockClientAddress.ForwardedClient);
    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(ADDED_TOAST, { name: "edgewaf" }),
    );
  });

  test("an Application Gateway policy, which reads one address, is added reading the address that connected", async () => {
    api.readCloudWafCandidates.mockResolvedValue({
      candidates: [
        azureCandidate({
          cloudResourceId: "r-gateway",
          kind: SecurityBlockCloudWafKind.AzureApplicationGateway,
          name: "prod-waf",
          clientAddresses: [SecurityBlockClientAddress.SourceIp],
        }),
      ],
      connections: [],
    } as never);
    api.checkCloudWafAccess.mockResolvedValue({
      checks: [],
      isGranted: true,
      command: "",
      shell: "azure",
    } as never);

    const form: CapturedForm = await openAdd();

    await act(async () => {
      render(
        <MemoryRouter>
          {fieldOf(form, "access").getCustomElement!({
            cloudResourceId: "r-gateway",
          })}
        </MemoryRouter>,
      );
    });
    await act(async () => {
      // A stale choice of another kind's field is never read.
      await lastForm().onSubmit!({
        cloudResourceId: "r-gateway",
        clientAddressAws: SecurityBlockClientAddress.XForwardedFor,
      });
    });

    expect(
      (create.mock.calls[0]![0] as { model: SecurityBlockCloudWaf }).model
        .clientAddress,
    ).toBe(SecurityBlockClientAddress.SourceIp);
  });

  test("when the cloud cannot be asked, the panel says so in a sentence and offers Check Again", async () => {
    api.checkCloudWafAccess.mockRejectedValue(
      new Error("Google Cloud did not answer.") as never,
    );

    const checked: MockedFn = jest.fn();

    await act(async () => {
      render(
        <CloudWafAccessPanel
          cloudResourceId="r-armor"
          name="prod-lb"
          onChecked={checked as unknown as () => void}
        />,
      );
    });

    const panel: HTMLElement = screen.getByTestId(CLOUD_WAF_TEST_IDS.access);

    expect(panel).toHaveTextContent(
      "OneUptime could not ask your cloud what the connection may do.",
    );
    expect(panel).toHaveTextContent("Google Cloud did not answer.");
    expect(
      screen.getByTestId(CLOUD_WAF_TEST_IDS.accessCheck),
    ).toBeInTheDocument();
    // Never told it may: the dialog keeps waiting.
    expect(checked).not.toHaveBeenCalledWith(
      expect.objectContaining({ isGranted: true }),
    );
  });

  test("a Cloud Armor policy's lines are for Google Cloud Shell", async () => {
    api.checkCloudWafAccess.mockResolvedValue({
      checks: [
        { permission: "compute.securityPolicies.update", isGranted: false },
      ],
      isGranted: false,
      command: "gcloud iam roles create oneuptimeCloudArmorBlocklist",
      shell: "gcp",
    } as never);

    await act(async () => {
      render(
        <CloudWafAccessPanel
          cloudResourceId="r-armor"
          name="prod-lb"
          onChecked={jest.fn() as unknown as () => void}
        />,
      );
    });

    expect(screen.getByTestId(CLOUD_WAF_TEST_IDS.access)).toHaveTextContent(
      "The connection may not write prod-lb yet. Run these lines in Google Cloud Shell, then select Check Again.",
    );
  });
});

describe("Check Again, Put It Back, Client Address and Remove", () => {
  test("Check Again sets the WAF up and reads it now", async () => {
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

  test("whoever may not change where the blocklist is enforced sees every write locked, with why; Show Rule stays open", async () => {
    mayWrite = false;

    await renderCard();

    for (const title of [
      "Put It Back",
      "Check Again",
      "Client Address",
      "Remove",
    ]) {
      expect(action(title).disabled).toBe(true);
      expect(action(title).tooltip).toBe(
        "You do not have permission to add WAFs.",
      );
    }

    expect(action("Show Rule").disabled).toBeFalsy();
  });

  test("Show Rule is AWS WAF's alone; Put It Back only on a policy whose rules were changed by hand; Client Address only where there is a choice", async () => {
    await renderCard();

    const drifted: Partial<SecurityBlockCloudWaf> = {
      status: SecurityBlockCloudWafStatus.Drifted,
    };

    expect(isShownOn("Show Rule", cloudWaf())).toBe(true);
    expect(isShownOn("Show Rule", gatewayPolicy())).toBe(false);
    expect(isShownOn("Show Rule", armorPolicy())).toBe(false);

    expect(isShownOn("Put It Back", gatewayPolicy(drifted))).toBe(true);
    expect(isShownOn("Put It Back", armorPolicy(drifted))).toBe(true);
    expect(isShownOn("Put It Back", gatewayPolicy())).toBe(false);
    expect(isShownOn("Put It Back", cloudWaf(drifted))).toBe(false);

    expect(isShownOn("Client Address", cloudWaf())).toBe(true);
    expect(isShownOn("Client Address", frontDoorPolicy())).toBe(true);
    expect(isShownOn("Client Address", armorPolicy())).toBe(true);
    expect(isShownOn("Client Address", gatewayPolicy())).toBe(false);
    expect(
      isShownOn(
        "Client Address",
        armorPolicy({
          ruleDetails: {
            mode: "rules",
            policyType: CloudArmorPolicyType.Edge,
          } as never,
        }),
      ),
    ).toBe(false);
  });

  test("Put It Back writes OneUptime's rules again and says so", async () => {
    await renderCard();

    const done: MockedFn = jest.fn();

    await act(async () => {
      await action("Put It Back").onClick(
        gatewayPolicy({ status: SecurityBlockCloudWafStatus.Drifted }),
        done as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });

    expect((api.putBackCloudWaf.mock.calls[0]![0] as ObjectID).toString()).toBe(
      ROW_ID,
    );
    expect(done).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(PUT_BACK_TOAST, { name: "prod-waf" }),
    );
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test("a refused Put It Back says why, on the row", async () => {
    api.putBackCloudWaf.mockRejectedValue(
      new Error("Azure refused the change to prod-waf.") as never,
    );

    await renderCard();

    const failed: MockedFn = jest.fn();

    await act(async () => {
      await action("Put It Back").onClick(
        gatewayPolicy({ status: SecurityBlockCloudWafStatus.Drifted }),
        jest.fn() as unknown as () => void,
        failed as unknown as (error: Error) => void,
      );
    });

    expect((failed.mock.calls[0]![0] as Error).message).toBe(
      "Azure refused the change to prod-waf.",
    );
    expect(toast).not.toHaveBeenCalled();
  });

  test("Client Address changes where a Front Door policy reads the address, from the choices it has", async () => {
    await renderCard();
    await act(async () => {
      await action("Client Address").onClick(
        frontDoorPolicy(),
        jest.fn() as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });

    const form: CapturedForm = lastForm();

    expect(form.title).toBe("Change Client Address");
    expect(form.formProps.initialValues).toEqual({
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });
    expect(fieldOf(form, "clientAddress").dropdownOptions).toEqual([
      {
        label: "The address that connected to Front Door (SocketAddr)",
        value: SecurityBlockClientAddress.SourceIp,
        isUserContent: true,
        isInPageDirection: true,
      },
      {
        label: "The original client, from X-Forwarded-For (RemoteAddr)",
        value: SecurityBlockClientAddress.ForwardedClient,
        isUserContent: true,
        isInPageDirection: true,
      },
    ]);

    await act(async () => {
      await form.onSubmit!({
        clientAddress: SecurityBlockClientAddress.ForwardedClient,
      });
    });

    const asked: { id: ObjectID; data: Record<string, unknown> } = updateById
      .mock.calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };

    expect(asked.id.toString()).toBe(ROW_ID);
    // Only where it reads the address: everything else is OneUptime's.
    expect(asked.data).toEqual({
      clientAddress: SecurityBlockClientAddress.ForwardedClient,
    });
    expect(toast).toHaveBeenCalledWith(
      english.translateTemplate(CHANGED_CLIENT_ADDRESS_TOAST, {
        name: "edgewaf",
      }),
    );
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

    expect(lastForm().title).toBe("Remove WAF");
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

  test("an Azure WAF policy's Remove says only OneUptime's rules come out, and from OneUptime only names the rules left there", async () => {
    api.removeCloudWaf.mockResolvedValue([
      {
        kind: SecurityBlockCloudWafLeftKind.Rule,
        name: "OneUptime1a2b3c4dBlock1",
        webAcl: "prod-waf",
      },
    ] as never);

    await renderCard();
    await act(async () => {
      await action("Remove").onClick(
        gatewayPolicy(),
        jest.fn() as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });

    expect(lastForm().description).toBe(
      english.translateTemplate(REMOVE_AZURE_DESCRIPTION, { name: "prod-waf" }),
    );
    expect(fieldOf(lastForm(), "keepInCloud").description).toBe(
      KEEP_IN_POLICY_FIELD_DESCRIPTION,
    );

    await act(async () => {
      await lastForm().onSubmit!({ keepInCloud: true });
    });

    expect(confirms[confirms.length - 1]!.title).toBe(LEFT_IN_AZURE_TITLE);
    expect(
      screen.getByTestId(CLOUD_WAF_TEST_IDS.leftInCloud),
    ).toHaveTextContent("Rule OneUptime1a2b3c4dBlock1 in prod-waf");
  });

  test("a Cloud Armor policy's Remove names its rules by priority and its address groups", async () => {
    api.removeCloudWaf.mockResolvedValue([
      {
        kind: SecurityBlockCloudWafLeftKind.PriorityRule,
        name: "priority 1000",
        webAcl: "prod-lb",
        priority: 1000,
      },
      {
        kind: SecurityBlockCloudWafLeftKind.AddressGroup,
        name: "oneuptime-1a2b3c4d-block-ipv4",
      },
    ] as never);

    await renderCard();
    await act(async () => {
      await action("Remove").onClick(
        armorPolicy(),
        jest.fn() as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
      );
    });

    expect(lastForm().description).toBe(
      english.translateTemplate(REMOVE_CLOUD_ARMOR_DESCRIPTION, {
        name: "prod-lb",
      }),
    );

    await act(async () => {
      await lastForm().onSubmit!({ keepInCloud: true });
    });

    expect(confirms[confirms.length - 1]!.title).toBe(
      LEFT_IN_CLOUD_ARMOR_TITLE,
    );

    const left: HTMLElement = screen.getByTestId(
      CLOUD_WAF_TEST_IDS.leftInCloud,
    );

    expect(left).toHaveTextContent("The rule at priority 1000 in prod-lb");
    expect(left).toHaveTextContent(
      "Address group oneuptime-1a2b3c4d-block-ipv4",
    );
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
