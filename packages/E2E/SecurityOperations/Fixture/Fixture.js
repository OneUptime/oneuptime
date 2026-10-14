/*
 * Offline fixture for the Security Events SOC pages: the overview, the case
 * queue, a case, entities, the rule library, ATT&CK coverage, playbooks, a
 * playbook and the playbook runs - the production layout (breadcrumbs and
 * side menu) and pages from this branch, mounted under their real RouteMap
 * patterns.
 *
 * Only the data boundary is replaced: ModelAPI and API answer from the
 * in-memory tables below, and the Security product's own routes (overview,
 * top entities, entity activity) answer what the server would work out from
 * the same rows - the overview's numbers come from
 * computeSecurityOverviewMetrics, the function the server calls. Realtime is
 * stubbed: nothing here pushes changes.
 *
 * The workspace is a fabricated "Acme Commerce" whose SOC has a busy month:
 * a password spray against Okta under investigation with a containment step
 * waiting for approval, a known-bad domain nobody has picked up, a contained
 * credential dump, and a month of closed cases behind them. Every name,
 * address and domain is made up (example domains, documentation addresses).
 *
 * Scenarios, parsed once per page load:
 *
 *   ?theme=  dark adds html.dark (handled by server.js).
 *   ?empty=  1: a project that has not set anything up yet - no cases, no
 *            detections, no playbooks, no rules.
 *   ?role=   owner (default) | viewer: Security Viewer only, so it can read
 *            but not change anything.
 *
 * Every read is recorded on window.__securityOperationsFixture: getItem,
 * list, count and API requests, the writes, and `unhandled` - anything the
 * fixture does not model. The spec asserts `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import SecurityEventsLayout from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Layout";
import SecurityOverviewPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Overview";
import SecurityCasesPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Cases";
import SecurityCaseViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView";
import SecurityEntitiesPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities";
import RuleLibraryPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary";
import AttackCoveragePage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/AttackCoverage";
import SecurityPlaybooksPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Playbooks";
import SecurityPlaybookViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookView";
import SecurityPlaybookRunsPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookRuns";
import { SECURITY_PLAYBOOK_TEMPLATES } from "../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplates";
import RouteMap, {
  SecurityEventsRoutePath,
} from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseFeed, {
  SecurityCaseFeedEventType,
} from "Common/Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "Common/Models/DatabaseModels/SecurityDetection";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { DETECTION_RULE_LIBRARY } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus, {
  isOpenSecurityCaseStatus,
} from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { formatSecurityCaseNumber } from "Common/Types/SecurityCase/SecurityCaseNumber";
import { SecurityPlaybookActionType } from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { computeSecurityOverviewMetrics } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const isEmpty = params.get("empty") === "1";
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const rolePermissions =
  role === "viewer" ? [Permission.SecurityViewer] : [Permission.ProjectOwner];

const NOW = new Date();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(milliseconds) {
  return new Date(NOW.getTime() - milliseconds);
}

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const ID = {
  user: (n) => uuid("80000000", n),
  team: (n) => uuid("81000000", n),
  case: (n) => uuid("20000000", n),
  detection: (n) => uuid("21000000", n),
  feed: (n) => uuid("22000000", n),
  note: (n) => uuid("23000000", n),
  playbook: (n) => uuid("24000000", n),
  run: (n) => uuid("25000000", n),
  rule: (n) => uuid("26000000", n),
  connection: (n) => uuid("27000000", n),
};

let rowCounter = 9000;

function rowId() {
  rowCounter++;
  return uuid("99000000", rowCounter);
}

const projectObjectId = new ObjectID(PROJECT_ID);

const fixture = {
  now: NOW.toISOString(),
  scenario: { empty: isEmpty, role },
  ids: {
    project: PROJECT_ID,
    sprayCase: ID.case(142),
    unassignedCase: ID.case(141),
    containPlaybook: ID.playbook(3),
    waitingRun: ID.run(1),
  },
  getItemRequests: [],
  listRequests: [],
  countRequests: [],
  apiRequests: [],
  realtimeSubscriptions: [],
  creates: [],
  updates: [],
  deletes: [],
  unhandled: [],
};
window.__securityOperationsFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function make(modelType, record) {
  return Object.assign(new modelType(), record);
}

/*
 * The test suites' one seeded generator, so every load draws the same month
 * of history (and the screenshots match from run to run).
 */
const random = seededRandom(20261014);

function pick(items) {
  return items[random(items.length)];
}

/*
 * ---------------------------------------------------------------------------
 * In-memory tables
 * ---------------------------------------------------------------------------
 */
const tables = new Map();

function tableName(modelType) {
  return new modelType().tableName;
}

function table(modelType) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    tables.set(name, { modelType, records: [] });
  }
  return tables.get(name).records;
}

function insert(modelType, record) {
  const full = {
    _id: rowId(),
    projectId: projectObjectId,
    createdAt: NOW,
    ...record,
  };
  table(modelType).push(full);
  return full;
}

function comparable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "object" && value.constructor !== Object) {
    return value.toString();
  }
  return value;
}

function matches(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || key === "projectId") {
      continue;
    }
    const actual = record[key];
    if (condition instanceof Includes) {
      const values = (condition.values || []).map((value) => {
        return String(comparable(value));
      });
      if (!values.includes(String(comparable(actual)))) {
        return false;
      }
      continue;
    }
    if (condition instanceof IsNull) {
      if (actual !== null && actual !== undefined) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotNull) {
      if (actual === null || actual === undefined) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotEqual) {
      if (String(comparable(actual)) === String(comparable(condition.value))) {
        return false;
      }
      continue;
    }
    if (condition instanceof Search) {
      if (
        !String(actual ?? "")
          .toLowerCase()
          .includes(String(condition.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (
      condition === null ||
      typeof condition !== "object" ||
      condition instanceof ObjectID
    ) {
      if (String(comparable(actual)) !== String(comparable(condition))) {
        return false;
      }
    }
  }
  return true;
}

function sortRecords(records, sort) {
  const entries = Object.entries(sort || {});
  if (entries.length === 0) {
    return records;
  }
  return [...records].sort((left, right) => {
    for (const [key, order] of entries) {
      const a = comparable(left[key]);
      const b = comparable(right[key]);
      if (a === b) {
        continue;
      }
      const direction = order === SortOrder.Descending ? -1 : 1;
      if (a === undefined || a === null) {
        return direction;
      }
      if (b === undefined || b === null) {
        return -direction;
      }
      return a > b ? direction : -direction;
    }
    return 0;
  });
}

/*
 * ---------------------------------------------------------------------------
 * People and the project
 * ---------------------------------------------------------------------------
 */
function person(number, name, email) {
  return make(User, {
    _id: ID.user(number),
    name: new Name(name),
    email: new Email(email),
  });
}

const people = {
  maya: person(1, "Maya Chen", "maya.chen@acme-commerce.example"),
  diego: person(2, "Diego Alvarez", "diego.alvarez@acme-commerce.example"),
  priya: person(3, "Priya Nair", "priya.nair@acme-commerce.example"),
  sam: person(4, "Sam Okafor", "sam.okafor@acme-commerce.example"),
};

const socTeam = make(Team, { _id: ID.team(1), name: "SOC Tier 2" });

const project = make(Project, { _id: PROJECT_ID, name: "Acme Commerce" });

function assignee(user) {
  return user
    ? { assignedToUser: user, assignedToUserId: new ObjectID(user._id) }
    : { assignedToUser: undefined, assignedToUserId: undefined };
}

function entity(type, value) {
  return { type, value };
}

/*
 * ---------------------------------------------------------------------------
 * Cases, detections, timeline and notes
 * ---------------------------------------------------------------------------
 */
const SPRAY_IP = "203.0.113.47";
const SPRAY_USERS = [
  "j.wilson@acme-commerce.example",
  "a.ng@acme-commerce.example",
  "k.morgan@acme-commerce.example",
];

function addCase(number, record) {
  return insert(SecurityCase, {
    _id: ID.case(number),
    caseNumber: number,
    caseNumberWithPrefix: formatSecurityCaseNumber(number),
    ...record,
  });
}

if (!isEmpty) {
  addCase(142, {
    title: `Password spray against Okta from ${SPRAY_IP}`,
    description:
      "A burst of failed Okta sign-ins for many accounts from one address, followed by one success.",
    status: SecurityCaseStatus.Investigating,
    priority: SecurityCasePriority.Critical,
    ...assignee(people.maya),
    source: SecurityDetectionSource.DetectionRule,
    entities: [
      entity(SecurityEntityType.IpAddress, SPRAY_IP),
      ...SPRAY_USERS.map((user) => {
        return entity(SecurityEntityType.User, user);
      }),
      entity(SecurityEntityType.Domain, "acme-commerce.okta.example"),
    ],
    mitreTactics: ["TA0006", "TA0001"],
    mitreTechniques: ["T1110.003", "T1078.004"],
    detectionCount: 3,
    firstDetectedAt: ago(3 * HOUR + 12 * MINUTE),
    lastDetectedAt: ago(9 * MINUTE),
    acknowledgedAt: ago(2 * HOUR + 58 * MINUTE),
    groupingKey: `rule:okta-password-spray:${SPRAY_IP}`,
    createdAt: ago(3 * HOUR + 12 * MINUTE),
    createdByUser: undefined,
  });
  addCase(141, {
    title: "Known-bad domain resolved by build-runner-07",
    description:
      "A build runner looked up a domain on the threat intel feed's command-and-control list.",
    status: SecurityCaseStatus.New,
    priority: SecurityCasePriority.High,
    ...assignee(undefined),
    source: SecurityDetectionSource.ThreatIntel,
    entities: [
      entity(SecurityEntityType.Domain, "update-sync.bad-cdn.example"),
      entity(SecurityEntityType.Host, "build-runner-07"),
      entity(SecurityEntityType.IpAddress, "198.51.100.23"),
    ],
    mitreTactics: ["TA0011"],
    mitreTechniques: ["T1071.004"],
    detectionCount: 1,
    firstDetectedAt: ago(48 * MINUTE),
    lastDetectedAt: ago(31 * MINUTE),
    createdAt: ago(48 * MINUTE),
  });
  addCase(140, {
    title: "CrowdStrike: credential dumping on fin-ws-112",
    status: SecurityCaseStatus.Contained,
    priority: SecurityCasePriority.Critical,
    ...assignee(people.diego),
    source: SecurityDetectionSource.ConnectedProduct,
    entities: [
      entity(SecurityEntityType.Host, "fin-ws-112"),
      entity(SecurityEntityType.User, "r.alvarez@acme-commerce.example"),
      entity(SecurityEntityType.Process, "procdump64.exe"),
    ],
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1003.001"],
    detectionCount: 2,
    firstDetectedAt: ago(26 * HOUR),
    lastDetectedAt: ago(25 * HOUR),
    acknowledgedAt: ago(25 * HOUR + 40 * MINUTE),
    containedAt: ago(24 * HOUR + 15 * MINUTE),
    createdAt: ago(26 * HOUR),
  });
  addCase(139, {
    title: "Impossible travel for k.morgan@acme-commerce.example",
    status: SecurityCaseStatus.Investigating,
    priority: SecurityCasePriority.Medium,
    ...assignee(people.priya),
    source: SecurityDetectionSource.DetectionRule,
    entities: [
      entity(SecurityEntityType.User, "k.morgan@acme-commerce.example"),
      entity(SecurityEntityType.IpAddress, "192.0.2.180"),
    ],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1078"],
    detectionCount: 1,
    firstDetectedAt: ago(7 * HOUR),
    lastDetectedAt: ago(7 * HOUR),
    acknowledgedAt: ago(6 * HOUR),
    createdAt: ago(7 * HOUR),
  });
  addCase(138, {
    title: "Defender XDR: suspicious PowerShell on web-03",
    status: SecurityCaseStatus.New,
    priority: SecurityCasePriority.High,
    ...assignee(undefined),
    source: SecurityDetectionSource.ConnectedProduct,
    entities: [
      entity(SecurityEntityType.Host, "web-03"),
      entity(SecurityEntityType.Process, "powershell.exe -enc"),
    ],
    mitreTactics: ["TA0002"],
    mitreTechniques: ["T1059.001"],
    detectionCount: 1,
    firstDetectedAt: ago(2 * HOUR),
    lastDetectedAt: ago(2 * HOUR),
    createdAt: ago(2 * HOUR),
  });
  addCase(137, {
    title: "Admin API key created outside the change window",
    status: SecurityCaseStatus.New,
    priority: SecurityCasePriority.Medium,
    ...assignee(people.maya),
    source: SecurityDetectionSource.DetectionRule,
    entities: [
      entity(SecurityEntityType.User, "deploy-bot@acme-commerce.example"),
    ],
    mitreTactics: ["TA0003"],
    mitreTechniques: ["T1098"],
    detectionCount: 1,
    firstDetectedAt: ago(5 * HOUR),
    lastDetectedAt: ago(5 * HOUR),
    createdAt: ago(5 * HOUR),
  });
  addCase(136, {
    title: "S3 bucket policy made public: acme-exports",
    status: SecurityCaseStatus.Closed,
    priority: SecurityCasePriority.High,
    verdict: SecurityCaseVerdict.TruePositive,
    closingNote: "Policy reverted, access logs reviewed: no reads.",
    ...assignee(people.sam),
    source: SecurityDetectionSource.DetectionRule,
    entities: [entity(SecurityEntityType.Other, "arn:aws:s3:::acme-exports")],
    mitreTactics: ["TA0010"],
    mitreTechniques: ["T1537"],
    detectionCount: 1,
    firstDetectedAt: ago(2 * DAY),
    lastDetectedAt: ago(2 * DAY),
    acknowledgedAt: ago(2 * DAY - 20 * MINUTE),
    closedAt: ago(2 * DAY - 3 * HOUR),
    createdAt: ago(2 * DAY),
  });

  /*
   * A month of history behind them, for the queue's Closed view and the
   * overview's trend, mean times and verdicts.
   */
  const HISTORY_TITLES = [
    "Repeated MFA push denials for a sales account",
    "Tor exit node sign-in to the VPN",
    "Mass file deletion on fileshare-02",
    "New inbox forwarding rule to an outside address",
    "Okta admin role granted outside change control",
    "Port scan from a guest Wi-Fi address",
    "Phishing link clicked from a vendor invoice",
    "GuardDuty: unusual API calls from a CI role",
    "Brute force against the bastion host",
    "Suspicious OAuth app consent",
  ];
  const HISTORY_TACTICS = [
    "TA0006",
    "TA0001",
    "TA0040",
    "TA0009",
    "TA0004",
    "TA0007",
    "TA0001",
    "TA0005",
    "TA0006",
    "TA0003",
  ];
  const VERDICTS = [
    SecurityCaseVerdict.TruePositive,
    SecurityCaseVerdict.BenignPositive,
    SecurityCaseVerdict.FalsePositive,
    SecurityCaseVerdict.FalsePositive,
    SecurityCaseVerdict.BenignPositive,
    SecurityCaseVerdict.Undetermined,
  ];
  const PRIORITIES = [
    SecurityCasePriority.Critical,
    SecurityCasePriority.High,
    SecurityCasePriority.High,
    SecurityCasePriority.Medium,
    SecurityCasePriority.Medium,
    SecurityCasePriority.Medium,
    SecurityCasePriority.Low,
    SecurityCasePriority.Low,
    SecurityCasePriority.Informational,
  ];
  const SOURCES = [
    SecurityDetectionSource.DetectionRule,
    SecurityDetectionSource.DetectionRule,
    SecurityDetectionSource.ThreatIntel,
    SecurityDetectionSource.ConnectedProduct,
  ];
  const ASSIGNEES = [people.maya, people.diego, people.priya, people.sam];

  for (let number = 135; number >= 100; number--) {
    const index = 135 - number;
    const openedAt = ago(
      (2.2 + index * 0.78) * DAY + random(10) * HOUR,
    );
    const toAcknowledge = (8 + random(80)) * MINUTE;
    const toContain = toAcknowledge + (1 + random(6)) * HOUR;
    const toClose = toContain + (2 + random(30)) * HOUR;
    addCase(number, {
      title: HISTORY_TITLES[index % HISTORY_TITLES.length],
      status: SecurityCaseStatus.Closed,
      priority: pick(PRIORITIES),
      verdict: pick(VERDICTS),
      ...assignee(pick(ASSIGNEES)),
      source: pick(SOURCES),
      entities: [
        entity(SecurityEntityType.Host, `ws-${200 + index}`),
        entity(
          SecurityEntityType.User,
          `user${index}@acme-commerce.example`,
        ),
      ],
      mitreTactics: [HISTORY_TACTICS[index % HISTORY_TACTICS.length]],
      mitreTechniques: [],
      detectionCount: 1 + random(4),
      firstDetectedAt: openedAt,
      lastDetectedAt: new Date(openedAt.getTime() + toAcknowledge),
      acknowledgedAt: new Date(openedAt.getTime() + toAcknowledge),
      containedAt:
        random() > 0.35 ? new Date(openedAt.getTime() + toContain) : undefined,
      closedAt: new Date(openedAt.getTime() + toClose),
      createdAt: openedAt,
    });
  }

  // The spray case's own detections.
  insert(SecurityDetection, {
    _id: ID.detection(1),
    securityCaseId: new ObjectID(ID.case(142)),
    title: "Okta password spray",
    description:
      "One address failing sign-in for 10 or more distinct accounts in 10 minutes.",
    severity: "High",
    source: SecurityDetectionSource.DetectionRule,
    ruleName: "Okta password spray",
    detectionRuleId: new ObjectID(ID.rule(1)),
    groupValue: SPRAY_IP,
    entities: [
      entity(SecurityEntityType.IpAddress, SPRAY_IP),
      ...SPRAY_USERS.map((user) => {
        return entity(SecurityEntityType.User, user);
      }),
    ],
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110.003"],
    eventCount: 412,
    fireCount: 31,
    firstSeenAt: ago(3 * HOUR + 12 * MINUTE),
    lastSeenAt: ago(9 * MINUTE),
    sampleMessage: `user.session.start FAILURE: INVALID_CREDENTIALS for k.morgan@acme-commerce.example from ${SPRAY_IP}`,
    createdAt: ago(3 * HOUR + 12 * MINUTE),
  });
  insert(SecurityDetection, {
    _id: ID.detection(2),
    securityCaseId: new ObjectID(ID.case(142)),
    title: `Known-bad address ${SPRAY_IP} (Tor exit node)`,
    severity: "Medium",
    source: SecurityDetectionSource.ThreatIntel,
    ruleName: "Abuse.ch Feodo + Tor exits",
    groupValue: SPRAY_IP,
    entities: [entity(SecurityEntityType.IpAddress, SPRAY_IP)],
    mitreTactics: [],
    mitreTechniques: [],
    eventCount: 412,
    fireCount: 5,
    firstSeenAt: ago(3 * HOUR + 10 * MINUTE),
    lastSeenAt: ago(12 * MINUTE),
    sampleMessage: `Indicator ${SPRAY_IP} matched source.ip`,
    createdAt: ago(3 * HOUR + 10 * MINUTE),
  });
  insert(SecurityDetection, {
    _id: ID.detection(3),
    securityCaseId: new ObjectID(ID.case(142)),
    title: "Okta sign-in success after a spray",
    severity: "Critical",
    source: SecurityDetectionSource.DetectionRule,
    ruleName: "Okta success after failures",
    detectionRuleId: new ObjectID(ID.rule(2)),
    groupValue: SPRAY_IP,
    entities: [
      entity(SecurityEntityType.IpAddress, SPRAY_IP),
      entity(SecurityEntityType.User, "k.morgan@acme-commerce.example"),
    ],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1078.004"],
    eventCount: 1,
    fireCount: 1,
    firstSeenAt: ago(41 * MINUTE),
    lastSeenAt: ago(41 * MINUTE),
    sampleMessage: `user.session.start SUCCESS for k.morgan@acme-commerce.example from ${SPRAY_IP}`,
    createdAt: ago(41 * MINUTE),
  });

  /*
   * Two weeks of detections for the overview's trend and top rules, by
   * source. Only firstSeenAt, source and the rule matter there.
   */
  const RULES = [
    ["Okta password spray", ID.rule(1)],
    ["Okta success after failures", ID.rule(2)],
    ["Admin role granted", ID.rule(3)],
    ["Public S3 bucket policy", ID.rule(4)],
    ["Encoded PowerShell", ID.rule(5)],
  ];
  for (let day = 0; day < 14; day++) {
    const count = 3 + random(9) + (day < 2 ? 6 : 0);
    for (let n = 0; n < count; n++) {
      const source = pick([
        SecurityDetectionSource.DetectionRule,
        SecurityDetectionSource.DetectionRule,
        SecurityDetectionSource.DetectionRule,
        SecurityDetectionSource.ThreatIntel,
        SecurityDetectionSource.ConnectedProduct,
      ]);
      const [ruleName, ruleId] = pick(RULES);
      const seenAt = ago(day * DAY + random(20) * HOUR);
      insert(SecurityDetection, {
        title: ruleName,
        severity: pick(["Low", "Medium", "High"]),
        source,
        ruleName:
          source === SecurityDetectionSource.DetectionRule ? ruleName : "",
        detectionRuleId:
          source === SecurityDetectionSource.DetectionRule
            ? new ObjectID(ruleId)
            : undefined,
        fireCount: 1 + random(5),
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        createdAt: seenAt,
        // Not on any case the fixture opens.
        securityCaseId: new ObjectID(ID.case(100 + (n % 30))),
      });
    }
  }

  // The spray case's timeline, oldest first.
  const feed = (number, eventType, markdown, at, user) => {
    insert(SecurityCaseFeed, {
      _id: ID.feed(number),
      securityCaseId: new ObjectID(ID.case(142)),
      securityCaseFeedEventType: eventType,
      feedInfoInMarkdown: markdown,
      postedAt: at,
      createdAt: at,
      user: user,
      userId: user ? new ObjectID(user._id) : undefined,
    });
  };
  feed(
    1,
    SecurityCaseFeedEventType.CaseOpened,
    "**Case opened** by the detection rule **Okta password spray**: 14 accounts failed to sign in from `203.0.113.47` in 10 minutes.",
    ago(3 * HOUR + 12 * MINUTE),
  );
  feed(
    2,
    SecurityCaseFeedEventType.PlaybookRun,
    "Playbook **Enrich New Cases** ran: 2 steps succeeded.",
    ago(3 * HOUR + 11 * MINUTE),
  );
  feed(
    3,
    SecurityCaseFeedEventType.ThreatIntel,
    "`203.0.113.47` is on **Abuse.ch Feodo + Tor exits** (Tor exit node, confidence 85).",
    ago(3 * HOUR + 10 * MINUTE),
  );
  feed(
    4,
    SecurityCaseFeedEventType.AssigneeChanged,
    "**Maya Chen** took the case.",
    ago(2 * HOUR + 58 * MINUTE),
    people.maya,
  );
  feed(
    5,
    SecurityCaseFeedEventType.StatusChanged,
    "Status changed from **New** to **Investigating**.",
    ago(2 * HOUR + 58 * MINUTE),
    people.maya,
  );
  feed(
    6,
    SecurityCaseFeedEventType.DetectionAdded,
    "**Okta success after failures** joined the case: `k.morgan@acme-commerce.example` signed in from `203.0.113.47`.",
    ago(41 * MINUTE),
  );
  feed(
    7,
    SecurityCaseFeedEventType.PriorityChanged,
    "Priority raised from **High** to **Critical** by the new detection.",
    ago(41 * MINUTE),
  );
  feed(
    8,
    SecurityCaseFeedEventType.ApprovalRequested,
    "Playbook **Contain Compromised Okta Users** is waiting for approval to **Suspend Okta User** for `k.morgan@acme-commerce.example`.",
    ago(38 * MINUTE),
    people.maya,
  );

  insert(SecurityCaseNote, {
    _id: ID.note(1),
    securityCaseId: new ObjectID(ID.case(142)),
    note: "Spray started 09:02 UTC. 14 accounts targeted, all from the same Tor exit. k.morgan's success at 11:33 is the one that matters - reached out to her manager to confirm she was not travelling.",
    createdByUser: people.maya,
    createdByUserId: new ObjectID(people.maya._id),
    createdAt: ago(35 * MINUTE),
  });
  insert(SecurityCaseNote, {
    _id: ID.note(2),
    securityCaseId: new ObjectID(ID.case(142)),
    note: "Okta shows a new device enrolled for k.morgan at 11:35. Approving the suspend.",
    createdByUser: people.diego,
    createdByUserId: new ObjectID(people.diego._id),
    createdAt: ago(20 * MINUTE),
  });
}

/*
 * ---------------------------------------------------------------------------
 * Playbooks and their runs
 * ---------------------------------------------------------------------------
 */
function templateSteps(key) {
  const template = SECURITY_PLAYBOOK_TEMPLATES.find((item) => {
    return item.key === key;
  });
  return template ? template.getSteps() : [];
}

const CONTAIN_STEPS = [
  {
    id: "step-intel",
    action: SecurityPlaybookActionType.CheckThreatIntel,
    config: {},
    requiresApproval: false,
    continueOnFailure: true,
    onlyIfThreatIntelMatched: false,
  },
  {
    id: "step-suspend",
    action: SecurityPlaybookActionType.SuspendOktaUser,
    config: { connectionId: ID.connection(1) },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
  {
    id: "step-sessions",
    action: SecurityPlaybookActionType.EndOktaSessions,
    config: { connectionId: ID.connection(1) },
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
  {
    id: "step-note",
    action: SecurityPlaybookActionType.AddCaseNote,
    config: {
      note: "Suspended {{case.number}}'s users in Okta and ended their sessions.",
    },
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
];

if (!isEmpty) {
  insert(SecurityEventConnection, {
    _id: ID.connection(1),
    name: "Okta production",
    provider: SecurityEventConnectorProvider.OktaSystemLog,
  });

  insert(SecurityPlaybook, {
    _id: ID.playbook(1),
    name: "Enrich New Cases",
    description:
      "Checks every new case's entities against threat intel and pulls their recent activity onto the case.",
    isEnabled: true,
    trigger: SecurityPlaybookTrigger.CaseOpened,
    steps: templateSteps("enrich"),
    runCount: 128,
    lastRunAt: ago(48 * MINUTE),
    createdAt: ago(40 * DAY),
  });
  insert(SecurityPlaybook, {
    _id: ID.playbook(2),
    name: "Escalate Known-Bad Indicators",
    description:
      "Raises a case to Critical and moves it to Investigating when its entities are on a threat intel feed.",
    isEnabled: true,
    trigger: SecurityPlaybookTrigger.DetectionAdded,
    minimumPriority: SecurityCasePriority.High,
    steps: templateSteps("known-bad"),
    runCount: 17,
    lastRunAt: ago(31 * MINUTE),
    createdAt: ago(32 * DAY),
  });
  insert(SecurityPlaybook, {
    _id: ID.playbook(3),
    name: "Contain Compromised Okta Users",
    description:
      "Suspends the case's users in Okta and ends their sessions, after an analyst approves.",
    isEnabled: true,
    trigger: SecurityPlaybookTrigger.CaseOpened,
    minimumPriority: SecurityCasePriority.Critical,
    detectionSource: SecurityDetectionSource.DetectionRule,
    steps: CONTAIN_STEPS,
    runCount: 6,
    lastRunAt: ago(40 * MINUTE),
    createdAt: ago(21 * DAY),
  });
  insert(SecurityPlaybook, {
    _id: ID.playbook(4),
    name: "Triage Imported Alerts",
    description:
      "Counts the activity of the entities in an imported alert and notes where to look first.",
    isEnabled: false,
    trigger: SecurityPlaybookTrigger.CaseOpened,
    detectionSource: SecurityDetectionSource.ConnectedProduct,
    steps: templateSteps("imported-alerts"),
    runCount: 0,
    createdAt: ago(3 * DAY),
  });

  const result = (step, status, minutesAgo, extra) => {
    return {
      stepId: step.id,
      action: step.action,
      status,
      startedAt: ago(minutesAgo * MINUTE).toISOString(),
      completedAt:
        status === SecurityPlaybookStepStatus.Running ||
        status === SecurityPlaybookStepStatus.WaitingForApproval ||
        status === SecurityPlaybookStepStatus.Pending
          ? undefined
          : ago((minutesAgo - 0.2) * MINUTE).toISOString(),
      ...extra,
    };
  };

  const run = (number, record) => {
    insert(SecurityPlaybookRun, {
      _id: ID.run(number),
      ...record,
    });
  };

  run(1, {
    securityCaseId: new ObjectID(ID.case(142)),
    securityCase: make(SecurityCase, {
      _id: ID.case(142),
      caseNumberWithPrefix: formatSecurityCaseNumber(142),
      title: `Password spray against Okta from ${SPRAY_IP}`,
    }),
    securityPlaybookId: new ObjectID(ID.playbook(3)),
    playbookName: "Contain Compromised Okta Users",
    trigger: SecurityPlaybookTrigger.CaseOpened,
    status: SecurityPlaybookRunStatus.WaitingForApproval,
    steps: CONTAIN_STEPS,
    stepResults: [
      result(CONTAIN_STEPS[0], SecurityPlaybookStepStatus.Succeeded, 40, {
        message: `${SPRAY_IP} is on Abuse.ch Feodo + Tor exits. 3 users have no match.`,
      }),
      result(
        CONTAIN_STEPS[1],
        SecurityPlaybookStepStatus.WaitingForApproval,
        39,
        {
          message:
            "Waiting for someone who can approve Security playbook steps.",
        },
      ),
      result(CONTAIN_STEPS[2], SecurityPlaybookStepStatus.Pending, 39),
      result(CONTAIN_STEPS[3], SecurityPlaybookStepStatus.Pending, 39),
    ],
    currentStepIndex: 1,
    threatIntelMatched: true,
    startedAt: ago(40 * MINUTE),
    createdAt: ago(40 * MINUTE),
  });

  const enrichSteps = templateSteps("enrich");
  run(2, {
    securityCaseId: new ObjectID(ID.case(142)),
    securityCase: make(SecurityCase, {
      _id: ID.case(142),
      caseNumberWithPrefix: formatSecurityCaseNumber(142),
      title: `Password spray against Okta from ${SPRAY_IP}`,
    }),
    securityPlaybookId: new ObjectID(ID.playbook(1)),
    playbookName: "Enrich New Cases",
    trigger: SecurityPlaybookTrigger.CaseOpened,
    status: SecurityPlaybookRunStatus.Succeeded,
    steps: enrichSteps,
    stepResults: enrichSteps.map((step, index) => {
      return result(step, SecurityPlaybookStepStatus.Succeeded, 191 - index, {
        message: [
          `${SPRAY_IP} matched 1 indicator.`,
          "5 entities looked up: 412 events and 31 findings in the last 24 hours.",
          "Added the triage checklist to the case.",
        ][index],
      });
    }),
    currentStepIndex: enrichSteps.length,
    threatIntelMatched: true,
    startedAt: ago(191 * MINUTE),
    completedAt: ago(190 * MINUTE),
    createdAt: ago(191 * MINUTE),
  });

  const escalateSteps = templateSteps("known-bad");
  run(3, {
    securityCaseId: new ObjectID(ID.case(141)),
    securityCase: make(SecurityCase, {
      _id: ID.case(141),
      caseNumberWithPrefix: formatSecurityCaseNumber(141),
      title: "Known-bad domain resolved by build-runner-07",
    }),
    securityPlaybookId: new ObjectID(ID.playbook(2)),
    playbookName: "Escalate Known-Bad Indicators",
    trigger: SecurityPlaybookTrigger.DetectionAdded,
    status: SecurityPlaybookRunStatus.Running,
    steps: escalateSteps,
    stepResults: escalateSteps.map((step, index) => {
      return result(
        step,
        index === 0
          ? SecurityPlaybookStepStatus.Succeeded
          : index === 1
            ? SecurityPlaybookStepStatus.Running
            : SecurityPlaybookStepStatus.Pending,
        31 - index,
        index === 0
          ? { message: "update-sync.bad-cdn.example matched 1 indicator." }
          : {},
      );
    }),
    currentStepIndex: 1,
    threatIntelMatched: true,
    startedAt: ago(31 * MINUTE),
    createdAt: ago(31 * MINUTE),
  });

  run(4, {
    securityCaseId: new ObjectID(ID.case(138)),
    securityCase: make(SecurityCase, {
      _id: ID.case(138),
      caseNumberWithPrefix: formatSecurityCaseNumber(138),
      title: "Defender XDR: suspicious PowerShell on web-03",
    }),
    securityPlaybookId: new ObjectID(ID.playbook(1)),
    playbookName: "Enrich New Cases",
    trigger: SecurityPlaybookTrigger.CaseOpened,
    status: SecurityPlaybookRunStatus.Failed,
    steps: enrichSteps,
    stepResults: enrichSteps.map((step, index) => {
      return result(
        step,
        index === 0
          ? SecurityPlaybookStepStatus.Succeeded
          : SecurityPlaybookStepStatus.Failed,
        120 - index,
        index === 0
          ? { message: "No entity matched an indicator." }
          : {
              error:
                "The events store did not answer within 30 seconds. Run the playbook again from the case.",
            },
      );
    }),
    currentStepIndex: 1,
    threatIntelMatched: false,
    startedAt: ago(120 * MINUTE),
    completedAt: ago(119 * MINUTE),
    errorMessage: "Step 2 (Look Up Entity Activity) failed.",
    createdAt: ago(120 * MINUTE),
  });

  run(5, {
    securityCaseId: new ObjectID(ID.case(140)),
    securityCase: make(SecurityCase, {
      _id: ID.case(140),
      caseNumberWithPrefix: formatSecurityCaseNumber(140),
      title: "CrowdStrike: credential dumping on fin-ws-112",
    }),
    securityPlaybookId: new ObjectID(ID.playbook(3)),
    playbookName: "Contain Compromised Okta Users",
    trigger: SecurityPlaybookTrigger.Manual,
    triggeredByUser: people.diego,
    triggeredByUserId: new ObjectID(people.diego._id),
    status: SecurityPlaybookRunStatus.Succeeded,
    steps: CONTAIN_STEPS,
    stepResults: CONTAIN_STEPS.map((step, index) => {
      return result(
        step,
        SecurityPlaybookStepStatus.Succeeded,
        25 * 60 - index,
        index === 1
          ? {
              message: "Suspended r.alvarez@acme-commerce.example in Okta.",
              approval: {
                decision: "Approved",
                decidedByUserId: people.diego._id,
                decidedAt: ago((25 * 60 - 2) * MINUTE).toISOString(),
                comment: "Confirmed with the user's manager.",
              },
            }
          : { message: "Done." },
      );
    }),
    currentStepIndex: CONTAIN_STEPS.length,
    threatIntelMatched: false,
    startedAt: ago(25 * HOUR),
    completedAt: ago(25 * HOUR - 5 * MINUTE),
    createdAt: ago(25 * HOUR),
  });
}

/*
 * ---------------------------------------------------------------------------
 * Detection rules: six from the library, on, and one of the team's own, off
 * ---------------------------------------------------------------------------
 */
if (!isEmpty) {
  DETECTION_RULE_LIBRARY.slice(0, 6).forEach((entry, index) => {
    insert(DetectionRule, {
      _id: ID.rule(index + 1),
      name: entry.title,
      description: entry.description,
      sigmaRuleYaml: entry.sigmaRuleYaml,
      isEnabled: true,
      evaluationIntervalInMinutes: entry.evaluationIntervalInMinutes,
      shouldCreateCase: true,
      lastEvaluatedAt: ago(3 * MINUTE),
      createdAt: ago((30 - index) * DAY),
    });
  });
  insert(DetectionRule, {
    _id: ID.rule(20),
    name: "Legacy VPN brute force",
    description: "Replaced by the library's rule.",
    sigmaRuleYaml: DETECTION_RULE_LIBRARY[6]?.sigmaRuleYaml || "",
    isEnabled: false,
    evaluationIntervalInMinutes: 5,
    shouldCreateCase: false,
    createdAt: ago(90 * DAY),
  });
}

// What a playbook's steps can name: policies, severities, labels, workflows.
insert(OnCallDutyPolicy, { name: "Security on-call" });
insert(IncidentSeverity, { name: "SEV1", color: "#dc2626", order: 1 });
insert(IncidentSeverity, { name: "SEV2", color: "#f97316", order: 2 });
insert(Label, { name: "credential-access", color: "#6366f1" });
insert(Workflow, { name: "Open a ticket in the IT queue" });

// Tables the pages may read even when they are empty.
for (const modelType of [
  SecurityCase,
  SecurityDetection,
  SecurityCaseFeed,
  SecurityCaseNote,
  SecurityPlaybook,
  SecurityPlaybookRun,
  SecurityEventConnection,
  DetectionRule,
  Team,
]) {
  table(modelType);
}
table(Team).push({ ...socTeam, projectId: projectObjectId });

/*
 * ---------------------------------------------------------------------------
 * The Security product's own routes
 * ---------------------------------------------------------------------------
 */
function openCases() {
  return table(SecurityCase).filter((item) => {
    return isOpenSecurityCaseStatus(item.status);
  });
}

function overviewRow(item) {
  return {
    createdAt: item.createdAt,
    priority: item.priority,
    status: item.status,
    verdict: item.verdict,
    assignedToUserId: item.assignedToUserId?.toString(),
    acknowledgedAt: item.acknowledgedAt,
    containedAt: item.containedAt,
    closedAt: item.closedAt,
    mitreTactics: item.mitreTactics,
  };
}

function overview() {
  const windowStart = ago(30 * DAY);
  const detectionWindowStart = ago(14 * DAY);
  const metrics = computeSecurityOverviewMetrics({
    openCases: openCases().map(overviewRow),
    casesInWindow: table(SecurityCase)
      .filter((item) => {
        return item.createdAt >= windowStart;
      })
      .map(overviewRow),
    detectionsInWindow: table(SecurityDetection)
      .filter((item) => {
        return item.firstSeenAt >= detectionWindowStart;
      })
      .map((item) => {
        return {
          firstSeenAt: item.firstSeenAt,
          source: item.source,
          ruleName: item.ruleName,
          detectionRuleId: item.detectionRuleId?.toString(),
          fireCount: item.fireCount,
        };
      }),
    windowStart,
    detectionWindowStart,
    now: NOW,
  });

  return {
    generatedAt: NOW.toISOString(),
    caseWindowInDays: 30,
    detectionWindowInDays: 14,
    myOpenCases: openCases().filter((item) => {
      return item.assignedToUserId?.toString() === people.maya._id;
    }).length,
    runsWaitingForApproval: table(SecurityPlaybookRun).filter((item) => {
      return item.status === SecurityPlaybookRunStatus.WaitingForApproval;
    }).length,
    isTruncated: false,
    metrics: serialize(metrics),
  };
}

const TOP_ENTITIES = [
  [SPRAY_IP, 36, 2, 4, 9],
  ["k.morgan@acme-commerce.example", 33, 3, 5, 41],
  ["j.wilson@acme-commerce.example", 31, 1, 4, 9],
  ["a.ng@acme-commerce.example", 31, 1, 4, 9],
  ["fin-ws-112", 12, 2, 5, 25 * 60],
  ["build-runner-07", 4, 1, 4, 31],
  ["update-sync.bad-cdn.example", 4, 1, 4, 31],
  ["web-03", 3, 1, 4, 120],
  ["192.0.2.180", 2, 1, 3, 7 * 60],
  ["deploy-bot@acme-commerce.example", 1, 1, 3, 5 * 60],
];

function topEntities(body) {
  if (isEmpty) {
    return { entities: [] };
  }
  const limit = Number(body?.limit || 10);
  return {
    entities: TOP_ENTITIES.slice(0, limit).map(
      ([value, findingCount, ruleCount, maxSeverityId, minutesAgo]) => {
        return {
          value,
          findingCount,
          ruleCount,
          maxSeverityId,
          lastSeen: ago(minutesAgo * MINUTE).toISOString(),
        };
      },
    ),
  };
}

function entityActivity(body) {
  const values = Array.isArray(body?.values) ? body.values : [];
  return {
    activity: values.map((value, index) => {
      const known = TOP_ENTITIES.find((item) => {
        return item[0] === value;
      });
      return {
        value,
        eventCount: known ? known[1] * 13 + 7 : 3 + index,
        findingCount: known ? known[1] : 0,
        maxSeverityId: known ? known[3] : 2,
        firstSeen: ago(6 * DAY + index * HOUR).toISOString(),
        lastSeen: ago((known ? known[4] : 60) * MINUTE).toISOString(),
      };
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Identity, realtime and data-layer stubs
 * ---------------------------------------------------------------------------
 */
const AVATAR_COLOURS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"];

UserUtil.getProfilePictureRoute = (userId) => {
  const user = Object.values(people).find((item) => {
    return item._id === userId.toString();
  });
  const initials = (user ? user.name.toString() : "?")
    .split(" ")
    .map((part) => {
      return part[0] || "";
    })
    .join("")
    .slice(0, 2);
  const colour =
    AVATAR_COLOURS[
      (user ? Object.values(people).indexOf(user) : 0) % AVATAR_COLOURS.length
    ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${colour}"/><text x="32" y="41" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="600" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return {
    toString: () => {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    },
  };
};

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(people.maya._id);
UserUtil.getName = () => people.maya.name;
UserUtil.getEmail = () => people.maya.email;
PermissionUtil.getAllPermissions = () => [...rolePermissions];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

Realtime.listenToModelEvent = (event) => {
  fixture.realtimeSubscriptions.push({
    modelName: event.modelType?.name,
    eventType: event.eventType,
  });
  return () => {};
};
Realtime.listenToAnalyticsModelEvent = () => {
  return () => {};
};

function knownTable(modelType, kind, extra) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    fixture.unhandled.push({ kind, modelName: name, ...extra });
    return null;
  }
  return tables.get(name);
}

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.getItemRequests.push({ modelName, id });
  const known = knownTable(options.modelType, "getItem", { id });
  const record = known?.records.find((item) => {
    return String(item._id) === id;
  });
  return record ? make(options.modelType, record) : null;
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    sort: serialize(options.sort),
    skip,
    limit,
  });
  const known = knownTable(options.modelType, "getList", {
    query: serialize(options.query),
  });
  const records = sortRecords(
    (known?.records || []).filter((record) => {
      return matches(record, options.query);
    }),
    options.sort,
  );
  return {
    data: records.slice(skip, skip + limit).map((record) => {
      return make(options.modelType, record);
    }),
    count: records.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });
  const known = knownTable(options.modelType, "count", {
    query: serialize(options.query),
  });
  return (known?.records || []).filter((record) => {
    return matches(record, options.query);
  }).length;
};

ModelAPI.getCount = ModelAPI.count;

ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.updates.push({ modelName, id, data: serialize(options.data) });
  const record = (tables.get(modelName)?.records || []).find((item) => {
    return String(item._id) === id;
  });
  if (record) {
    Object.assign(record, options.data);
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.createOrUpdate = async (options) => {
  const modelName = tableName(options.modelType);
  const data = BaseModel.toJSON(options.model, options.modelType);
  fixture.creates.push({ modelName, data: serialize(data) });
  const record = {
    ...options.model,
    _id: options.model._id || rowId(),
    projectId: projectObjectId,
    createdAt: NOW,
  };
  tables.get(modelName)?.records.push(record);
  return new HTTPResponse(
    200,
    BaseModel.toJSON(make(options.modelType, record), options.modelType),
    {},
  );
};

ModelAPI.create = async (options) => {
  return ModelAPI.createOrUpdate(options);
};

ModelAPI.deleteItem = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.deletes.push({ modelName, id: options.id?.toString() });
};

/*
 * What the server does when someone decides a held step: approving runs the
 * step and the ones after it (here, at once), rejecting ends the run.
 */
function decideApproval(runId, isApproved, body) {
  const run = table(SecurityPlaybookRun).find((item) => {
    return String(item._id) === runId;
  });
  if (!run || run.status !== SecurityPlaybookRunStatus.WaitingForApproval) {
    return new HTTPErrorResponse(
      400,
      { message: "This run is not waiting for approval." },
      {},
    );
  }
  const held = run.currentStepIndex;
  run.stepResults = run.stepResults.map((result, index) => {
    if (index < held) {
      return result;
    }
    if (index === held) {
      return {
        ...result,
        status: isApproved
          ? SecurityPlaybookStepStatus.Succeeded
          : SecurityPlaybookStepStatus.Rejected,
        completedAt: NOW.toISOString(),
        message: isApproved
          ? "Suspended k.morgan@acme-commerce.example in Okta."
          : "Rejected: nothing was done.",
        approval: {
          decision: isApproved ? "Approved" : "Rejected",
          decidedByUserId: people.maya._id,
          decidedAt: NOW.toISOString(),
          comment: body?.comment || undefined,
        },
      };
    }
    return isApproved
      ? {
          ...result,
          status: SecurityPlaybookStepStatus.Succeeded,
          startedAt: NOW.toISOString(),
          completedAt: NOW.toISOString(),
          message: "Done.",
        }
      : result;
  });
  run.status = isApproved
    ? SecurityPlaybookRunStatus.Succeeded
    : SecurityPlaybookRunStatus.Cancelled;
  run.currentStepIndex = isApproved ? run.stepResults.length : held;
  run.completedAt = NOW;
  return new HTTPResponse(200, {}, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url, body: serialize(options.data) });
  const path = new window.URL(url).pathname;

  if (method === "POST" && path.endsWith("/security-case/overview")) {
    return new HTTPResponse(200, overview(), {});
  }
  if (method === "POST" && path.endsWith("/security-case/top-entities")) {
    return new HTTPResponse(200, topEntities(options.data), {});
  }
  if (method === "POST" && path.endsWith("/security-case/entity-activity")) {
    return new HTTPResponse(200, entityActivity(options.data), {});
  }
  const decision = path.match(
    /\/security-playbook-run\/([^/]+)\/(approve|reject)$/,
  );
  if (method === "POST" && decision) {
    return decideApproval(decision[1], decision[2] === "approve", options.data);
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return new HTTPErrorResponse(
    404,
    { message: "Not modelled by the fixture." },
    {},
  );
}

API.get = async (options) => handleApi("GET", options);
API.post = async (options) => handleApi("POST", options);
API.put = async (options) => handleApi("PUT", options);
API.delete = async (options) => handleApi("DELETE", options);
API.fetch = async (options) => handleApi(options.method || "GET", options);

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router: the menu's pages inside the layout, a case and a playbook on
 * their own, as Routes/SecurityEventsRoutes.tsx mounts them.
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function FixtureLayout() {
  useNavigationHooks();
  return <SecurityEventsLayout {...pageProps(undefined)} />;
}

function withParams(Page, pageKey) {
  return function PageWithParams() {
    useNavigationHooks();
    return <Page {...pageProps(pageKey)} />;
  };
}

function StubPage(props) {
  useNavigationHooks();
  const location = useLocation();
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-8 py-12">
      <h2 className="text-xl font-semibold text-gray-900">{props.title}</h2>
      <p
        data-testid="stub-page"
        data-page={props.pageKey}
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </div>
  );
}

// The menu's pages this fixture renders, and the ones it stubs.
const PAGES = [
  [PageMap.SECURITY_EVENTS_OVERVIEW, SecurityOverviewPage],
  [PageMap.SECURITY_CASES, SecurityCasesPage],
  [PageMap.SECURITY_EVENTS_ENTITIES, SecurityEntitiesPage],
  [PageMap.SECURITY_EVENTS_RULE_LIBRARY, RuleLibraryPage],
  [PageMap.SECURITY_EVENTS_ATTACK_COVERAGE, AttackCoveragePage],
  [PageMap.SECURITY_PLAYBOOKS, SecurityPlaybooksPage],
  [PageMap.SECURITY_PLAYBOOK_RUNS, SecurityPlaybookRunsPage],
];
const STUB_PAGES = [
  [PageMap.SECURITY_EVENTS_CORRELATE, "Correlate"],
  [PageMap.SECURITY_EVENTS_DETECTION_RULES, "Detection Rules"],
  [PageMap.SECURITY_EVENTS_THREAT_INTEL, "Threat Intel"],
  [PageMap.SECURITY_EVENTS_MONITORS, "Monitors"],
  [PageMap.SECURITY_EVENTS_CONNECTIONS, "Connections"],
  [PageMap.SECURITY_EVENTS_DOCUMENTATION, "Setup Guide"],
];

const CaseView = withParams(SecurityCaseViewPage, PageMap.SECURITY_CASE_VIEW);
const PlaybookView = withParams(
  SecurityPlaybookViewPage,
  PageMap.SECURITY_PLAYBOOK_VIEW,
);

function FixtureApp() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Commerce</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Routes>
          <Route
            path={`${RouteMap[PageMap.SECURITY_EVENTS].toString()}/${
              SecurityEventsRoutePath[PageMap.SECURITY_CASE_VIEW]
            }`}
            element={<CaseView />}
          />
          <Route
            path={`${RouteMap[PageMap.SECURITY_EVENTS].toString()}/${
              SecurityEventsRoutePath[PageMap.SECURITY_PLAYBOOK_VIEW]
            }`}
            element={<PlaybookView />}
          />
          <Route
            path={RouteMap[PageMap.SECURITY_EVENTS].toString()}
            element={<FixtureLayout />}
          >
            {PAGES.map(([pageKey, Page]) => {
              return (
                <Route
                  key={pageKey}
                  path={SecurityEventsRoutePath[pageKey]}
                  element={<Page {...pageProps(pageKey)} />}
                />
              );
            })}
            {STUB_PAGES.map(([pageKey, title]) => {
              return (
                <Route
                  key={pageKey}
                  path={SecurityEventsRoutePath[pageKey]}
                  element={<StubPage pageKey={pageKey} title={title} />}
                />
              );
            })}
          </Route>
          <Route
            path="*"
            element={<StubPage pageKey="unknown" title="Not modelled" />}
          />
        </Routes>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
