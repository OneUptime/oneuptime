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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE WORDS OF #10346 IN EVERY LANGUAGE THE DASHBOARD SPEAKS: the
 * Blocklist's domains, URLs and files, the opt-in on a Microsoft Defender
 * or CrowdStrike connection, what protects a domain or a file, and the
 * case's Response Plan steps and checks that block on every machine -
 * each worded in every language with its placeholders, and the Blocklist
 * page and a plan's step drawn in the reader's language.
 */

type CapturedTable = { id: string; pluralName?: string };

let tables: Array<CapturedTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      tables.push(props);
      return React.createElement("div", { "data-testid": "blocklist-table" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      readBlocklistDestinations: async () => {
        return { destinations: [], cannotTell: false };
      },
      readBlockEnforcements: async () => {
        return new Map();
      },
    };
  },
);

import {
  ACTION_QUARANTINE_OPTION,
  BLOCKLIST_TABLE_DESCRIPTION,
  BLOCK_DOMAIN_DESCRIPTION,
  BLOCK_DOMAIN_TITLE,
  BLOCK_FILE_DESCRIPTION,
  BLOCK_FILE_TITLE,
  DOMAINS_EMPTY_DESCRIPTION,
  DOMAIN_COLUMN_TITLE,
  DOMAIN_FIELD_DESCRIPTION,
  DOMAIN_FIELD_PLACEHOLDER,
  DOMAIN_FIELD_TITLE,
  DOMAIN_PLURAL,
  DOMAIN_SINGULAR,
  ENDED_BLOCK_REASON,
  EVERY_MACHINE_FIELD_DESCRIPTION,
  EVERY_MACHINE_FIELD_TITLE,
  EVERY_MACHINE_LABEL,
  EVERY_MACHINE_TOOLTIP,
  FILES_EMPTY_DESCRIPTION,
  FILE_FIELD_DESCRIPTION,
  FILE_FIELD_PLACEHOLDER,
  FILE_PLURAL,
  LIFT_DESCRIPTION,
  LIFT_SELECTED_DESCRIPTION,
  NOTHING_ENFORCES_DESCRIPTION,
  NOT_A_DOMAIN_OR_URL,
  NOT_A_FILE_HASH,
  NOT_ENFORCED_TOOLTIP,
  QUARANTINED_LABEL,
  QUARANTINE_FIELD_DESCRIPTION,
  QUARANTINE_FIELD_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCopy";
import SecurityBlocklistPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Blocklist";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  SECURITY_BLOCK_SENTENCES,
  SecurityBlockIndicatorType,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SECURITY_PROTECTED_ADDRESS_SENTENCES,
  SECURITY_PROTECTED_DOMAIN_HOLDS,
  SECURITY_PROTECTED_OWN_DOMAIN,
  SECURITY_PROTECTED_UNDER_DOMAIN,
  SecurityProtectedAddressSource,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  PROTECTED_DOMAIN_PROBLEM,
  PROTECTED_FILE_HASH_PROBLEM,
} from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  BLOCK_INDICATORS_KEY,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { Translator } from "../../../Types/Translator";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { buildResponsePlan } from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  ResponsePlan,
  ResponseStep,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import {
  ACTION_BLOCK_FILE,
  ACTION_BLOCK_FOR_7_DAYS,
  RESPONSE_BLOCKED,
  STEP_BLOCK_C2_BY_HAND,
  STEP_BLOCK_EVERYWHERE_WITH,
  STEP_BLOCK_FILE_WITH,
  STEP_BLOCK_FILE_WITH_TWO,
  STEP_BLOCK_WAITING,
  STEP_QUARANTINE_FILE_WITH,
  STEP_QUARANTINE_FILE_WITH_TWO,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
import {
  CHECK_BLOCKED_EVERYWHERE,
  CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
  CHECK_BLOCK_ENDED,
  CHECK_BLOCK_NONE,
  CHECK_BLOCK_NOT_HELD,
  CHECK_BLOCK_NOT_HELD_AT,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const EN: Record<string, string> = readDashboardLocale("en");

// The opt-in's words, as each connection's form draws them.
function optInWords(provider: SecurityEventConnectorProvider): Array<string> {
  const field: JSONObject | undefined = (
    getSecurityEventConnectorDefinition(provider)!
      .configFields as unknown as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return candidate["key"] === BLOCK_INDICATORS_KEY;
  });

  return [String(field?.["title"]), String(field?.["description"])];
}

// Every key this work added, or reworded for domains, URLs and files.
const ALL_KEYS: ReadonlyArray<string> = [
  // The Blocklist page: a tab of each kind, its dialog and its cells.
  DOMAIN_SINGULAR,
  DOMAIN_PLURAL,
  FILE_PLURAL,
  DOMAINS_EMPTY_DESCRIPTION,
  FILES_EMPTY_DESCRIPTION,
  DOMAIN_COLUMN_TITLE,
  QUARANTINED_LABEL,
  EVERY_MACHINE_LABEL,
  EVERY_MACHINE_TOOLTIP,
  ACTION_QUARANTINE_OPTION,
  EVERY_MACHINE_FIELD_TITLE,
  EVERY_MACHINE_FIELD_DESCRIPTION,
  BLOCK_DOMAIN_TITLE,
  BLOCK_DOMAIN_DESCRIPTION,
  DOMAIN_FIELD_TITLE,
  DOMAIN_FIELD_DESCRIPTION,
  DOMAIN_FIELD_PLACEHOLDER,
  NOT_A_DOMAIN_OR_URL,
  BLOCK_FILE_TITLE,
  BLOCK_FILE_DESCRIPTION,
  FILE_FIELD_DESCRIPTION,
  FILE_FIELD_PLACEHOLDER,
  NOT_A_FILE_HASH,
  QUARANTINE_FIELD_TITLE,
  QUARANTINE_FIELD_DESCRIPTION,
  BLOCKLIST_TABLE_DESCRIPTION,
  NOT_ENFORCED_TOOLTIP,
  NOTHING_ENFORCES_DESCRIPTION,
  LIFT_DESCRIPTION,
  LIFT_SELECTED_DESCRIPTION,
  ENDED_BLOCK_REASON,
  "The IP addresses, ranges, domains, URLs and files the project blocks: why, until when, and where each block is enforced.",
  // Why a value is refused, in the dialog.
  SECURITY_BLOCK_SENTENCES.enterValue,
  SECURITY_BLOCK_SENTENCES.notAValue,
  SECURITY_BLOCK_SENTENCES.wildcardDomain,
  SECURITY_BLOCK_SENTENCES.unsupportedHash,
  SECURITY_BLOCK_SENTENCES.urlTooLong,
  SECURITY_BLOCK_SENTENCES.urlScheme,
  SECURITY_BLOCK_SENTENCES.checkFailedValue,
  // What protects a domain or a file.
  SECURITY_PROTECTED_DOMAIN_HOLDS,
  SECURITY_PROTECTED_UNDER_DOMAIN,
  SECURITY_PROTECTED_OWN_DOMAIN,
  ...[
    SecurityProtectedAddressSource.OneUptime,
    SecurityProtectedAddressSource.EndpointProduct,
    SecurityProtectedAddressSource.Monitor,
    SecurityProtectedAddressSource.StatusPage,
    SecurityProtectedAddressSource.ProjectDomain,
    SecurityProtectedAddressSource.EmptyFile,
  ].map((source: SecurityProtectedAddressSource): string => {
    return SECURITY_PROTECTED_ADDRESS_SENTENCES[source];
  }),
  PROTECTED_DOMAIN_PROBLEM,
  PROTECTED_FILE_HASH_PROBLEM,
  "Users, hosts, addresses, domains and files that playbooks never contain and the blocklist never blocks, such as break-glass accounts, your domains and your builds.",
  "Nothing is protected yet. Add the accounts, hosts, addresses, domains and files a playbook or a block must never cut off.",
  "A sign-in or host name (* for any characters), an IP address or range, a domain (*.example.com for all under it) or a file hash.",
  // The opt-in on each connection.
  ...optInWords(SecurityEventConnectorProvider.MicrosoftDefenderXdr),
  ...optInWords(SecurityEventConnectorProvider.CrowdStrikeFalcon),
  // The case's Response Plan: its steps, their button and what it says once done.
  STEP_BLOCK_EVERYWHERE_WITH,
  STEP_BLOCK_FILE_WITH,
  STEP_BLOCK_FILE_WITH_TWO,
  STEP_QUARANTINE_FILE_WITH,
  STEP_QUARANTINE_FILE_WITH_TWO,
  STEP_BLOCK_C2_BY_HAND,
  STEP_BLOCK_WAITING,
  ACTION_BLOCK_FOR_7_DAYS,
  ACTION_BLOCK_FILE,
  RESPONSE_BLOCKED,
  // What OneUptime found when it checked such a step.
  CHECK_BLOCKED_EVERYWHERE,
  CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
  CHECK_BLOCK_NOT_HELD,
  CHECK_BLOCK_NOT_HELD_AT,
  CHECK_BLOCK_NONE,
  CHECK_BLOCK_ENDED,
];

describe("every key is English in en.json, and worded in every other language", () => {
  test("each is a key of the Dashboard's English, the opt-in's words among them", () => {
    expect(
      ALL_KEYS.filter((key: string): boolean => {
        return typeof EN[key] !== "string";
      }),
    ).toEqual([]);
    expect(optInWords(SecurityEventConnectorProvider.CrowdStrikeFalcon)).toEqual(
      [
        "Block files with CrowdStrike",
        "OneUptime adds custom IOCs that stop a file running on every computer. Needs the IOC Management: Read and Write scopes.",
      ],
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each its own way, and keeps its placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(
        ALL_KEYS.filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);

      for (const key of ALL_KEYS) {
        expect({ key, placeholders: placeholdersOf(words[key] || "") }).toEqual(
          { key, placeholders: placeholdersOf(EN[key]!) },
        );
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps what a reader types as written: the examples, the schemes and the permission",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const asWritten: Array<[string, Array<string>]> = [
        [NOT_A_DOMAIN_OR_URL, ["evil.example", "http://", "https://"]],
        [SECURITY_BLOCK_SENTENCES.wildcardDomain, ["*", "evil.example"]],
        [NOT_A_FILE_HASH, ["MD5", "SHA-1", "SHA-256"]],
        [
          optInWords(SecurityEventConnectorProvider.MicrosoftDefenderXdr)[1]!,
          ["Ti.ReadWrite.All", "WindowsDefenderATP"],
        ],
        [
          optInWords(SecurityEventConnectorProvider.CrowdStrikeFalcon)[1]!,
          ["IOC Management: Read", "Write"],
        ],
        [PROTECTED_DOMAIN_PROBLEM, ["example.com", "*.example.com"]],
      ];

      for (const [key, kept] of asWritten) {
        for (const text of kept) {
          expect({ key, text, kept: (words[key] || "").includes(text) }).toEqual(
            { key, text, kept: true },
          );
        }
      }
    },
  );
});

describe("a Response Plan step and its check, in every language", () => {
  const DEFENDER_PLAN: ResponsePlan = buildResponsePlan({
    entities: [{ type: SecurityEntityType.Domain, value: "evil.example" }],
    mitreTactics: [],
    mitreTechniques: [],
    isAssigned: true,
    hasIncident: false,
    stage: SecurityCaseStage.Investigating,
    hasContainedStatus: true,
    matches: null,
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    blocklist: {
      holders: [
        {
          name: "Microsoft Defender",
          provider: SecurityBlockDestinationProvider.MicrosoftDefender,
          enforcesOnEveryMachine: true,
          blocks: [SecurityBlockIndicatorType.Domain],
          quarantinesFiles: true,
        },
      ],
      blocks: [],
    },
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s: the domain's step names the domain and the product, in the reader's words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const step: ResponseStep = DEFENDER_PLAN.steps.find(
        (candidate: ResponseStep): boolean => {
          return candidate.key === "contain:block-domain:evil.example";
        },
      )!;
      const text: string = translator.translateTemplate(
        step.text.template,
        step.text.values,
      );

      expect(text).toContain("evil.example");
      expect(text).toContain("Microsoft Defender");
      expect(text).not.toBe(
        "Block evil.example on every machine with Microsoft Defender.",
      );
      expect(
        translator.translateTemplate(CHECK_BLOCK_NOT_HELD_AT, {
          destination: "CrowdStrike Falcon",
          reason: "CrowdStrike Falcon blocks only SHA-256 and MD5 files",
        }),
      ).toContain("CrowdStrike Falcon blocks only SHA-256 and MD5 files");
    },
  );
});

describe("the Blocklist page, drawn in German and in Arabic", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "71111111-1111-4111-8111-111111111111",
  );

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        de: { translation: readDashboardLocale("de") },
        ar: { translation: readDashboardLocale("ar") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  beforeEach(() => {
    tables = [];
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "holdsAnyOf").mockReturnValue(false);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test.each([
    { language: "de", tabs: ["Adressen", "Domänen und URLs", "Dateien"] },
    {
      language: "ar",
      tabs: ["العناوين", "أسماء النطاقات وعناوين URL", "الملفات"],
    },
  ])(
    "$language: a tab of each kind, in the reader's words",
    async (data: { language: string; tabs: Array<string> }) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(data.language);
      });

      const project: Project = new Project();
      project.id = PROJECT_ID;

      await act(async () => {
        render(
          <MemoryRouter>
            <SecurityBlocklistPage
              pageRoute={new Route("/dashboard/security-events/blocklist")}
              currentProject={project}
              hasPaymentMethod={true}
            />
          </MemoryRouter>,
        );
      });

      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string => {
          return (tab.textContent || "").trim();
        }),
      ).toEqual(data.tabs);
      expect(readDashboardLocale(data.language)[DOMAIN_PLURAL]).toBe(
        data.tabs[1],
      );
    },
  );
});
