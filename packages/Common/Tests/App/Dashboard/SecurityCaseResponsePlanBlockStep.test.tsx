/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE BLOCK STEP OF A CASE'S RESPONSE PLAN, DRAWN (#10342): the card in
 * each state a public address's block step can be in - nothing enforces
 * the blocklist, a destination does and nothing is asked yet, a block
 * waiting for approval, running, failed, a block enforced, being applied,
 * held nowhere, or held by a range around the address - in English and in
 * every other language the Dashboard speaks; and what its buttons send:
 * Block for 24 Hours and the choices beside it, through the playbook
 * engine's one-step run, and Lift, as the Blocklist lifts a block.
 */

const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: async (): Promise<unknown> => {
        return {};
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "exception-modal" });
      },
    };
  },
);

import SecurityCaseResponsePlanCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import {
  BLOCK_FROM_CASE_PATH,
  readResponseAddressBlock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseAddressBlocks";
import {
  formatNamesInSentence,
  writeAddressBlockLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseBlockStepModel";
import {
  ACTION_BLOCK_FOR_A_DAY,
  ACTION_COPY,
  BLOCK_ASKED_TOAST,
  BLOCK_CHALLENGE_INSTEAD,
  BLOCK_FOR_SEVEN_DAYS,
  BLOCK_HELP_AWS_WAF,
  BLOCK_HELP_CLOUDFLARE,
  BLOCK_HELP_CONNECT,
  BLOCK_HELP_FIREWALL,
  BLOCK_HELP_HIDE,
  BLOCK_HELP_NFTABLES,
  BLOCK_HELP_NGINX,
  BLOCK_HELP_SHOW,
  BLOCK_STARTED_TOAST,
  BLOCK_UNTIL_LIFTED,
  LIFTED_FROM_PLAN_REASON,
  SECURITY_CASE_RESPONSE_TEST_IDS,
  STEP_BLOCK_AT_DESTINATIONS,
  STEP_BLOCK_FAILED,
  STEP_BLOCK_PUBLIC_IP,
  STEP_BLOCK_RUNNING,
  STEP_BLOCK_WAITING,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import {
  ENFORCEMENT_TOOLTIPS,
  LIFT_ACTION,
  LIFTED_TOAST,
  UNTIL_LIFTED_REFUSED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCopy";
import { SECURITY_BLOCK_DESTINATIONS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementView,
} from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SECURITY_PROTECTED_RANGE_HOLDS } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { Translator } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import Toast from "../../../UI/Utils/Toast";
import UserUtil from "../../../UI/Utils/User";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const RULE_ID: string = "44444444-4444-4444-8444-444444444444";
const ME: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const RUN_ID: string = "cccccccc-cccc-4ccc-8ccc-000000000001";
const STEP_ID: string = "dddddddd-dddd-4ddd-8ddd-000000000001";
const BLOCK_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const RANGE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const ADDRESS: string = "35.196.249.14";
const RANGE: string = "35.196.249.0/24";
const STEP_KEY: string = `contain:block-ip:${ADDRESS}`;
const HOUR: number = 60 * 60 * 1000;

const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

const MATCHES: SecurityCaseMatchesJson = {
  detections: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      source: "Detection Rule",
      title: `Path traversal attempts — ${ADDRESS}`,
      severity: "Medium",
      groupValue: ADDRESS,
      ruleName: "Path traversal attempts",
      eventCount: 12,
      fireCount: 1,
      firstSeenAt: "2026-11-17T19:28:00.000Z",
      lastSeenAt: "2026-11-17T19:28:00.000Z",
      sampleMessage: "",
      isOpening: true,
      rule: {
        id: RULE_ID,
        name: "Path traversal attempts",
        description: "",
        isEnabled: true,
        isRealTime: false,
        isCorrelation: false,
        threshold: 3,
        groupByField: "principalIp",
        distinctCountField: "",
        windowInMinutes: 5,
        sigmaRuleYaml: "",
        falsePositives: [],
        references: [],
        lookFor: [],
        responseSteps: [],
      },
      threatIntelFeedId: "",
      securityEventConnectionId: "",
      basis: SecurityCaseMatchBasis.RuleCondition,
      windowStart: "2026-11-17T19:22:00.000Z",
      windowEnd: "2026-11-17T19:29:00.000Z",
      events: [],
      isKept: false,
      keptPastRetentionCount: 0,
      hiddenEventCount: 0,
      matchedEventCount: 12,
      outcomes: { Rejected: 12 },
    },
  ],
  detectionCount: 1,
  unreadableSources: [],
  failedSources: [],
};

// What the project's blocklist holds, as the card reads it.
let destinations: Array<string>;
let isBlocklistUnread: boolean;
let blocks: Array<SecurityBlock>;
let enforcement: Array<SecurityBlockEnforcement>;
let runs: Array<SecurityPlaybookRun>;
let permissions: Array<Permission>;
let posted: Array<JSONObject>;
let blockAnswer: JSONObject | HTTPErrorResponse;
let toasts: Array<string>;

function blockOf(data: {
  id: string;
  value: string;
  action?: SecurityBlockAction;
  expiresAt: Date | null;
  createdAt: Date;
  createdByName?: string;
}): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock();
  block._id = data.id;
  block.value = data.value;
  block.indicatorType = data.value.includes("/")
    ? SecurityBlockIndicatorType.IpRange
    : SecurityBlockIndicatorType.IpAddress;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = SecurityBlockState.Active;
  block.expiresAt = data.expiresAt as Date;
  block.createdAt = data.createdAt;
  block.source = SecurityBlockSource.Person;

  if (data.createdByName) {
    const user: User = new User();
    user.name = data.createdByName as never;
    block.createdByUser = user;
  }

  return block;
}

function enforcementOf(data: {
  blockId: string;
  destination: string;
  state: SecurityBlockEnforcementState;
  appliedAt?: Date;
  error?: string;
}): SecurityBlockEnforcement {
  const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  row.securityBlockId = new ObjectID(data.blockId);
  row.destinationKey = `Test:${data.destination}`;
  row.destinationName = data.destination;
  row.state = data.state;

  if (data.state === SecurityBlockEnforcementState.Applied) {
    row.appliedAt = data.appliedAt || new Date(Date.now() - 2 * 24 * HOUR);
    row.lastConfirmedAt = new Date();
  }

  if (data.error) {
    row.error = data.error;
  }

  return row;
}

function oneStepRun(status: SecurityPlaybookRunStatus): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID;
  run.status = status;
  run.steps = [
    {
      id: STEP_ID,
      action: SecurityPlaybookActionType.BlockAddress,
      config: {
        blockAction: SecurityBlockAction.Block,
        duration: SecurityBlockDuration.OneDay,
      },
    },
  ] as never;
  run.stepResults = [
    {
      stepId: STEP_ID,
      action: SecurityPlaybookActionType.BlockAddress,
      status: "Pending",
      targets: [
        {
          type: SecurityEntityType.IpAddress,
          value: ADDRESS,
          reason: "On the Case",
          state: "Proposed",
        },
      ],
    },
  ] as never;
  return run;
}

function buildCase(
  stage: SecurityCaseStage = SecurityCaseStage.New,
): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID;
  securityCase.securityCaseStatusId = testStatusId(stage);
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: ADDRESS },
  ] as never;
  securityCase.mitreTactics = ["TA0001"];
  securityCase.mitreTechniques = ["T1190"];
  return securityCase;
}

async function drawn(stage?: SecurityCaseStage): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <SecurityCaseResponsePlanCard
        caseId={new ObjectID(CASE_ID)}
        securityCase={buildCase(stage)}
        values={{
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }}
        matches={MATCHES}
        refreshToggle="first"
        isWorking={false}
        onAssignToMe={() => {}}
        onRunPlaybook={() => {}}
        onDeclareIncident={() => {}}
        onMarkContained={() => {}}
        onCloseCase={() => {}}
      />
    </MemoryRouter>,
  );
  await screen.findAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step);
  // The blocklist is read with the plan: the step is drawn from it once every read has answered.
  await settled();

  return step();
}

/*
 * Every read the card is waiting on answered, and drawn: each answers at
 * once, so a turn of the event loop or two sees all of them through.
 */
async function settled(): Promise<void> {
  for (let turn: number = 0; turn < 2; turn++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

function step(): HTMLElement {
  const found: HTMLElement | undefined = screen
    .queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-step-key") === STEP_KEY;
    });

  expect({ key: STEP_KEY, drawn: Boolean(found) }).toEqual({
    key: STEP_KEY,
    drawn: true,
  });

  return found!;
}

/*
 * Words as drawn: no-break spaces read as spaces, runs of spaces as one, and
 * without the marks that keep a name's direction in a right-to-left sentence.
 */
function text(value: string | null | undefined): string {
  return (value || "")
    .replace(/[\u200e\u200f\u2066-\u2069]/g, "")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

beforeEach(async () => {
  // In English, unless a test reads the step in another language.
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
  PermissionGate.clearPermissionPropsCache();
  destinations = ["Cloudflare", "AWS WAF"];
  isBlocklistUnread = false;
  blocks = [];
  enforcement = [];
  runs = [];
  permissions = [Permission.SecurityMember];
  posted = [];
  blockAnswer = { runId: RUN_ID, needsApproval: true };
  toasts = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ME));
  jest.spyOn(Realtime, "listenToModelEvent").mockImplementation((() => {
    return (): void => {};
  }) as never);
  jest.spyOn(Toast, "success").mockImplementation(((title: string) => {
    toasts.push(title);
    return "";
  }) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const read: { modelType: unknown; query: Record<string, unknown> } =
      args as { modelType: unknown; query: Record<string, unknown> };
    let data: Array<unknown> = [];

    if (read.modelType === SecurityPlaybookRun) {
      data = runs;
    } else if (read.modelType === SecurityBlock) {
      // The address's own blocks, or the ranges that may hold it.
      data = blocks.filter((block: SecurityBlock): boolean => {
        return (
          (block.indicatorType === SecurityBlockIndicatorType.IpRange) ===
          Boolean(read.query["indicatorType"])
        );
      });
    } else if (read.modelType === SecurityBlockEnforcement) {
      data = enforcement;
    } else if (
      read.modelType === SecurityCaseTask ||
      read.modelType === SecurityPlaybook
    ) {
      data = [];
    }

    return { data, count: data.length };
  });
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    const url: string = request.url.toString();

    if (url.endsWith(SECURITY_BLOCK_DESTINATIONS_PATH)) {
      if (isBlocklistUnread) {
        return new HTTPErrorResponse(403, { message: "No access." }, {});
      }

      return new HTTPResponse(
        200,
        {
          destinations: destinations.map((name: string): JSONObject => {
            return { key: `Test:${name}`, name, provider: "Test" };
          }),
          cannotTell: false,
        },
        {},
      );
    }

    if (url.endsWith(BLOCK_FROM_CASE_PATH)) {
      posted.push(request.data);

      return blockAnswer instanceof HTTPErrorResponse
        ? blockAnswer
        : new HTTPResponse(200, blockAnswer, {});
    }

    throw new Error(`Nothing answers ${url}`);
  }) as never);
});

afterEach(async () => {
  // What a click left to finish - the plan read again - finishes before its answers are taken away.
  await settled();
  cleanup();
  jest.restoreAllMocks();
});

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocaleAsDrawn(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function inLanguage(language: string): Promise<Translator> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });

  return dashboardTranslator(language);
}

// ---------- The states, each as a reader in any language reads it ----------

// What a state's expectations read: the reader's words, and the step as drawn.
interface StateRead {
  translator: Translator;
  drawn: HTMLElement;
}

interface BlockState {
  name: string;
  arrange: () => void;
  // What the step says, in the reader's words.
  expect: (data: StateRead) => void;
}

function sentenceOfStep(translator: Translator): string {
  return translator.translateTemplate(STEP_BLOCK_AT_DESTINATIONS, {
    value: ADDRESS,
    destinations: formatNamesInSentence(destinations, translator),
  });
}

function expectSays(drawn: HTMLElement, words: string): void {
  expect(text(drawn.textContent)).toContain(text(words));
}

function expectBlockButton(drawn: HTMLElement, translator: Translator): void {
  expect(
    text(
      within(drawn).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block)
        .textContent,
    ),
  ).toBe(text(translator.translateText(ACTION_BLOCK_FOR_A_DAY)));
}

function expectedLine(data: {
  translator: Translator;
  block: SecurityBlock;
}): string {
  return writeAddressBlockLine({
    block: readResponseAddressBlock({
      block: data.block,
      enforcements: enforcement.filter((row: SecurityBlockEnforcement) => {
        return row.securityBlockId?.toString() === data.block._id?.toString();
      }),
      now: new Date(),
    })!,
    translator: data.translator,
  });
}

function ownBlock(): SecurityBlock {
  return blockOf({
    id: BLOCK_ID,
    value: ADDRESS,
    expiresAt: new Date(Date.now() + 22 * HOUR),
    createdAt: new Date(Date.now() - 2 * 24 * HOUR),
    createdByName: "Jane Doe",
  });
}

const STATES: ReadonlyArray<BlockState> = [
  {
    name: "nothing enforces the blocklist: how to connect what would, and how to block it by hand, folded",
    arrange: () => {
      destinations = [];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      expectSays(
        drawn,
        translator.translateTemplate(STEP_BLOCK_PUBLIC_IP, { value: ADDRESS }),
      );
      expect(
        text(
          within(drawn).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.blockHelp)
            .textContent,
        ),
      ).toContain(
        text(
          translator.translateTemplate(BLOCK_HELP_CONNECT, {
            cloudflare: "Cloudflare",
            awsWaf: "AWS WAF",
            firewall: translator.translateText(BLOCK_HELP_FIREWALL),
          }),
        ),
      );
      expect(
        text(
          within(drawn).getByTestId(
            SECURITY_CASE_RESPONSE_TEST_IDS.blockHelpToggle,
          ).textContent,
        ),
      ).toBe(text(translator.translateText(BLOCK_HELP_SHOW)));
      // OneUptime can do it once something is connected: never "Outside OneUptime".
      expect(
        within(drawn).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.byHand),
      ).toBeNull();
      expect(
        within(drawn).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      ).toBeNull();
      expectSays(drawn, translator.translateText(ACTION_COPY));
    },
  },
  {
    name: "a destination enforces it: the step names where, with Block for 24 Hours",
    arrange: () => {},
    expect: ({ translator, drawn }: StateRead): void => {
      expectSays(drawn, sentenceOfStep(translator));
      expectBlockButton(drawn, translator);
      expect(
        within(drawn).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.blockHelp),
      ).toBeNull();
    },
  },
  {
    name: "a block from the case waits for approval: said, with no second Block",
    arrange: () => {
      runs = [oneStepRun(SecurityPlaybookRunStatus.WaitingForApproval)];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      expectSays(drawn, sentenceOfStep(translator));
      expectSays(drawn, translator.translateText(STEP_BLOCK_WAITING));
      expect(
        within(drawn).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      ).toBeNull();
    },
  },
  {
    name: "a block from the case is running: said, with no second Block",
    arrange: () => {
      runs = [oneStepRun(SecurityPlaybookRunStatus.Running)];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      expectSays(drawn, translator.translateText(STEP_BLOCK_RUNNING));
      expect(
        within(drawn).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      ).toBeNull();
    },
  },
  {
    name: "the last block failed: said as a warning, with Block again",
    arrange: () => {
      runs = [oneStepRun(SecurityPlaybookRunStatus.Failed)];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      expectSays(drawn, translator.translateText(STEP_BLOCK_FAILED));
      expectBlockButton(drawn, translator);
    },
  },
  {
    name: "a block enforced: where, since when, by whom and until when, with Lift, and the step done",
    arrange: () => {
      blocks = [ownBlock()];
      enforcement = [
        enforcementOf({
          blockId: BLOCK_ID,
          destination: "Cloudflare",
          state: SecurityBlockEnforcementState.Applied,
        }),
        enforcementOf({
          blockId: BLOCK_ID,
          destination: "AWS WAF",
          state: SecurityBlockEnforcementState.Applied,
        }),
      ];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      const line: HTMLElement = within(drawn).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.blockLine,
      );

      expect(line).toHaveAttribute("data-enforced", "true");
      expect(text(line.textContent)).toContain(
        text(expectedLine({ translator, block: blocks[0]! })),
      );
      expect(
        text(
          within(line).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.lift)
            .textContent,
        ),
      ).toBe(text(translator.translateText(LIFT_ACTION)));
      expect(drawn).toHaveAttribute("data-done", "true");
      expect(
        within(drawn).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      ).toBeNull();
    },
  },
  {
    name: "a block a destination is still applying: not done yet",
    arrange: () => {
      blocks = [ownBlock()];
      enforcement = [
        enforcementOf({
          blockId: BLOCK_ID,
          destination: "Cloudflare",
          state: SecurityBlockEnforcementState.Pending,
        }),
      ];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      const line: HTMLElement = within(drawn).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.blockLine,
      );

      expect(line).toHaveAttribute("data-enforced", "false");
      expect(text(line.textContent)).toContain(
        text(expectedLine({ translator, block: blocks[0]! })),
      );
      expect(drawn).toHaveAttribute("data-done", "false");
    },
  },
  {
    name: "a block nothing holds: never read as blocked, with why each destination turned it down",
    arrange: () => {
      blocks = [ownBlock()];
      enforcement = [
        enforcementOf({
          blockId: BLOCK_ID,
          destination: "Cloudflare",
          state: SecurityBlockEnforcementState.Failed,
          error: "The list is full.",
        }),
      ];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      const line: HTMLElement = within(drawn).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.blockLine,
      );

      expect(line).toHaveAttribute("data-enforced", "false");
      expect(text(line.textContent)).toContain(
        text(expectedLine({ translator, block: blocks[0]! })),
      );
      expect(text(line.textContent)).toContain(
        text(
          translator.translateTemplate(
            ENFORCEMENT_TOOLTIPS[SecurityBlockEnforcementView.NotApplied],
            { destination: "Cloudflare", reason: "The list is full." },
          ),
        ),
      );
      expect(drawn).toHaveAttribute("data-done", "false");
    },
  },
  {
    name: "a range around the address holds it: the block's line says the range holds it",
    arrange: () => {
      blocks = [
        blockOf({
          id: RANGE_ID,
          value: RANGE,
          expiresAt: null,
          createdAt: new Date(Date.now() - 3 * 24 * HOUR),
        }),
      ];
      enforcement = [
        enforcementOf({
          blockId: RANGE_ID,
          destination: "Cloudflare",
          state: SecurityBlockEnforcementState.Applied,
        }),
      ];
    },
    expect: ({ translator, drawn }: StateRead): void => {
      const line: HTMLElement = within(drawn).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.blockLine,
      );

      expect(text(line.textContent)).toContain(
        text(expectedLine({ translator, block: blocks[0]! })),
      );
      expect(text(line.textContent)).toContain(
        text(
          translator.translateTemplate(SECURITY_PROTECTED_RANGE_HOLDS, {
            value: RANGE,
            address: ADDRESS,
          }),
        ),
      );
      expect(drawn).toHaveAttribute("data-done", "true");
    },
  },
];

describe("the block step, in each state, in every language", () => {
  test.each(LANGUAGES)("%s", async (language: string) => {
    for (const state of STATES) {
      // Each state from a fresh blocklist.
      destinations = ["Cloudflare", "AWS WAF"];
      blocks = [];
      enforcement = [];
      runs = [];
      state.arrange();

      const translator: Translator = await inLanguage(language);
      const drawnStep: HTMLElement = await drawn();

      try {
        state.expect({ translator, drawn: drawnStep });
      } catch (error) {
        throw new Error(
          `${language}: ${state.name}\n${(error as Error).message}`,
        );
      }

      cleanup();
    }
  });
});

describe("how to block it by hand, unfolded", () => {
  test.each(LANGUAGES)(
    "%s: the Cloudflare path, then the AWS CLI, nginx and nftables lines with the address in them",
    async (language: string) => {
      destinations = [];
      const translator: Translator = await inLanguage(language);
      const drawnStep: HTMLElement = await drawn();

      await act(async () => {
        fireEvent.click(
          within(drawnStep).getByTestId(
            SECURITY_CASE_RESPONSE_TEST_IDS.blockHelpToggle,
          ),
        );
      });

      const panel: HTMLElement = within(drawnStep).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.blockHelpPanel,
      );
      const said: string = text(panel.textContent);

      expect(said).toContain(
        text(
          translator.translateTemplate(BLOCK_HELP_CLOUDFLARE, {
            address: ADDRESS,
          }),
        ),
      );

      for (const key of [
        BLOCK_HELP_AWS_WAF,
        BLOCK_HELP_NGINX,
        BLOCK_HELP_NFTABLES,
      ]) {
        expect(said).toContain(text(translator.translateText(key)));
      }

      expect(said).toContain(`deny ${ADDRESS};`);
      expect(said).toContain(
        `nft add element inet filter blocklist { ${ADDRESS} }`,
      );
      expect(said).toContain(`${ADDRESS}/32`);
      expect(
        text(
          within(drawnStep).getByTestId(
            SECURITY_CASE_RESPONSE_TEST_IDS.blockHelpToggle,
          ).textContent,
        ),
      ).toBe(text(translator.translateText(BLOCK_HELP_HIDE)));
    },
  );
});

// ---------- What the buttons send ----------

async function openBlockMenu(drawnStep: HTMLElement): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(
      within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.blockMore),
    );
  });

  await settled();

  return await screen.findByRole("menu");
}

function menuItem(menu: HTMLElement, name: string): HTMLElement {
  const item: HTMLElement | undefined = within(menu)
    .getAllByRole("menuitem")
    .find((candidate: HTMLElement): boolean => {
      return text(candidate.textContent) === name;
    });

  expect({ name, found: Boolean(item) }).toEqual({ name, found: true });

  return item!;
}

describe("Block for 24 Hours, and the choices beside it", () => {
  test("one click asks the playbook engine to block the case's address for a day, and says it waits for approval", async () => {
    const drawnStep: HTMLElement = await drawn();

    await act(async () => {
      fireEvent.click(
        within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      );
    });

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toEqual({
      securityCaseId: CASE_ID,
      value: ADDRESS,
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
    });
    await waitFor(() => {
      expect(toasts).toEqual([BLOCK_ASKED_TOAST.replace("{{value}}", ADDRESS)]);
    });
  });

  test("blocked at once for someone who needs no approval", async () => {
    permissions = [Permission.SecurityAdmin];
    blockAnswer = { runId: RUN_ID, needsApproval: false };
    const drawnStep: HTMLElement = await drawn();

    await act(async () => {
      fireEvent.click(
        within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      );
    });

    await waitFor(() => {
      expect(toasts).toEqual([
        BLOCK_STARTED_TOAST.replace("{{value}}", ADDRESS),
      ]);
    });
  });

  test("Challenge Instead and Block for 7 Days send what they say", async () => {
    let drawnStep: HTMLElement = await drawn();

    let menu: HTMLElement = await openBlockMenu(drawnStep);

    await act(async () => {
      fireEvent.click(menuItem(menu, BLOCK_CHALLENGE_INSTEAD));
    });
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });

    cleanup();
    drawnStep = await drawn();

    menu = await openBlockMenu(drawnStep);

    await act(async () => {
      fireEvent.click(menuItem(menu, BLOCK_FOR_SEVEN_DAYS));
    });
    await waitFor(() => {
      expect(posted).toHaveLength(2);
    });

    expect(
      posted.map((body: JSONObject): Array<unknown> => {
        return [body["blockAction"], body["duration"]];
      }),
    ).toEqual([
      [SecurityBlockAction.Challenge, SecurityBlockDuration.OneDay],
      [SecurityBlockAction.Block, SecurityBlockDuration.SevenDays],
    ]);
  });

  test("Block Until Lifted is a Security Admin's: locked for a Security Member, saying why", async () => {
    const drawnStep: HTMLElement = await drawn();
    const item: HTMLElement = menuItem(
      await openBlockMenu(drawnStep),
      BLOCK_UNTIL_LIFTED,
    );

    expect(item).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(item);
    });

    expect(posted).toEqual([]);
    expect(document.body.textContent).toContain(UNTIL_LIFTED_REFUSED);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])("%s may block until someone lifts it", async (permission: Permission) => {
    permissions = [permission];
    const drawnStep: HTMLElement = await drawn();

    const menu: HTMLElement = await openBlockMenu(drawnStep);

    await act(async () => {
      fireEvent.click(menuItem(menu, BLOCK_UNTIL_LIFTED));
    });

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]!["duration"]).toBe(SecurityBlockDuration.UntilLifted);
  });

  test("a block the server refuses says why, in the plan", async () => {
    blockAnswer = new HTTPErrorResponse(
      400,
      {
        message:
          "35.196.249.14 is the address of load balancer prod-alb in Production.",
      },
      {},
    );
    const drawnStep: HTMLElement = await drawn();

    await act(async () => {
      fireEvent.click(
        within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
      );
    });

    expect(
      await screen.findByText(
        "35.196.249.14 is the address of load balancer prod-alb in Production.",
      ),
    ).toBeInTheDocument();
    expect(toasts).toEqual([]);
  });

  test("a Security Viewer reads the step, its Block locked", async () => {
    permissions = [Permission.SecurityViewer];
    const drawnStep: HTMLElement = await drawn();

    expect(
      within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
    ).toBeDisabled();
  });

  test("a closed case offers no block", async () => {
    const drawnStep: HTMLElement = await drawn(SecurityCaseStage.Closed);

    expect(
      within(drawnStep).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
    ).toBeNull();
  });

  test("the blocklist that cannot be read leaves the step one done by hand, as before", async () => {
    isBlocklistUnread = true;
    const drawnStep: HTMLElement = await drawn();

    expect(
      within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.byHand),
    ).toHaveTextContent("Outside OneUptime");
    expect(
      within(drawnStep).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.block),
    ).toBeNull();
  });
});

describe("Lift", () => {
  beforeEach(() => {
    blocks = [ownBlock()];
    enforcement = [
      enforcementOf({
        blockId: BLOCK_ID,
        destination: "Cloudflare",
        state: SecurityBlockEnforcementState.Applied,
      }),
    ];
  });

  test("lifts the block as the Blocklist lifts one, saying where it was lifted from", async () => {
    const drawnStep: HTMLElement = await drawn();

    await act(async () => {
      fireEvent.click(
        within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.lift),
      );
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: SecurityBlock,
      id: new ObjectID(BLOCK_ID),
      data: {
        state: SecurityBlockState.Lifted,
        liftReason: LIFTED_FROM_PLAN_REASON,
      },
    });
    await waitFor(() => {
      expect(toasts).toEqual([LIFTED_TOAST.replace("{{value}}", ADDRESS)]);
    });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
  ])("%s may lift it", async (permission: Permission) => {
    permissions = [permission];
    const drawnStep: HTMLElement = await drawn();

    expect(
      within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.lift),
    ).toBeEnabled();
  });

  test("a Security Viewer sees the block, with no Lift", async () => {
    permissions = [Permission.SecurityViewer];
    const drawnStep: HTMLElement = await drawn();

    expect(
      within(drawnStep).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.blockLine),
    ).toBeInTheDocument();
    expect(
      within(drawnStep).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.lift),
    ).toBeNull();
  });
});
