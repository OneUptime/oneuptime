/*
 * THE PROJECTS ASK AI IS ASKED IN, WHEN A LIVE MODEL IS EVALUATED (#7246,
 * #7066).
 *
 * The setup requests (Tests/Server/Utils/AI/AskAiSetupRequests.ts) name
 * the project each is asked in: one that pages nobody yet, one that pages
 * people already, one with a monitor of example.com, one on the Free plan
 * with its status page. The how-do-I questions are asked in the first.
 * Each project is a few records, the same on every run: the people and
 * teams a request names, the monitors and the status page it puts things
 * on, the service it watches, and what the project pages. AskAiEvalTurn
 * answers Ask AI's reads from them, and the setup actions' own checks
 * read them as they would the project's.
 *
 * Pure data: nothing here reads a database. The names are the ones the
 * requests use (Ana Lopez, the Platform team, the API and Website
 * monitors, the Acme Status page, the checkout service).
 */

export enum AskAiEvalProjectKind {
  PagesNobody = "PagesNobody",
  PagesPeople = "PagesPeople",
  ChecksExampleCom = "ChecksExampleCom",
  FreePlanWithStatusPage = "FreePlanWithStatusPage",
}

// How a person can be reached: SetupTools' SetupReachMethod values.
export type AskAiEvalReachMethod = "email" | "sms" | "call" | "push";

export interface AskAiEvalPerson {
  id: string;
  name: string;
  email: string;
}

export interface AskAiEvalTeam {
  id: string;
  name: string;
  memberIds: Array<string>;
}

export interface AskAiEvalMonitor {
  id: string;
  name: string;
  // The address a Website or API monitor checks.
  url: string;
  type: "Website" | "API";
}

export interface AskAiEvalNamedRecord {
  id: string;
  name: string;
}

export interface AskAiEvalProject {
  kind: AskAiEvalProjectKind;
  id: string;
  name: string;
  // The person asking: the project's owner, who sets a project up first.
  me: AskAiEvalPerson;
  members: Array<AskAiEvalPerson>;
  teams: Array<AskAiEvalTeam>;
  monitors: Array<AskAiEvalMonitor>;
  // Its on-call policies; on-call rules run them for every new incident.
  policies: Array<AskAiEvalNamedRecord>;
  statusPages: Array<AskAiEvalNamedRecord>;
  // Its telemetry services, each sending logs, metrics and traces.
  services: Array<AskAiEvalNamedRecord>;
  // OneUptime Cloud's Free plan, whose one status page is taken.
  isFreePlan: boolean;
  // How the person asking can be reached today: a new member's email.
  verifiedMethods: Array<AskAiEvalReachMethod>;
}

const ME: AskAiEvalPerson = {
  id: "e7246000-0000-4000-8000-0000000000a1",
  name: "Maya Chen",
  email: "maya@acme.example",
};

const ANA: AskAiEvalPerson = {
  id: "e7246000-0000-4000-8000-0000000000a2",
  name: "Ana Lopez",
  email: "ana@acme.example",
};

const SAM: AskAiEvalPerson = {
  id: "e7246000-0000-4000-8000-0000000000a3",
  name: "Sam Okafor",
  email: "sam@acme.example",
};

const PAGES_NOBODY: AskAiEvalProject = {
  kind: AskAiEvalProjectKind.PagesNobody,
  id: "e7246000-0000-4000-8000-000000000001",
  name: "Acme",
  me: ME,
  members: [ME, ANA, SAM],
  teams: [
    {
      id: "e7246000-0000-4000-8000-0000000000b1",
      name: "Platform",
      memberIds: [ANA.id, SAM.id],
    },
  ],
  monitors: [
    {
      id: "e7246000-0000-4000-8000-0000000000c1",
      name: "API",
      url: "https://api.acme.example/health",
      type: "API",
    },
    {
      id: "e7246000-0000-4000-8000-0000000000c2",
      name: "Website",
      url: "https://acme.example",
      type: "Website",
    },
  ],
  policies: [],
  statusPages: [
    {
      id: "e7246000-0000-4000-8000-0000000000d1",
      name: "Acme Status",
    },
  ],
  services: [
    {
      id: "e7246000-0000-4000-8000-0000000000d2",
      name: "checkout",
    },
  ],
  isFreePlan: false,
  verifiedMethods: ["email"],
};

const DEFAULT_POLICY: AskAiEvalNamedRecord = {
  id: "e7246000-0000-4000-8000-0000000000e1",
  name: "Default on-call policy",
};

const EXAMPLE_COM_MONITOR: AskAiEvalMonitor = {
  id: "e7246000-0000-4000-8000-0000000000c3",
  name: "Acme website",
  url: "https://example.com",
  type: "Website",
};

export function getAskAiEvalProject(
  kind: AskAiEvalProjectKind,
): AskAiEvalProject {
  switch (kind) {
    case AskAiEvalProjectKind.PagesPeople:
      return { ...PAGES_NOBODY, kind, policies: [DEFAULT_POLICY] };
    case AskAiEvalProjectKind.ChecksExampleCom:
      return {
        ...PAGES_NOBODY,
        kind,
        policies: [DEFAULT_POLICY],
        monitors: [...PAGES_NOBODY.monitors, EXAMPLE_COM_MONITOR],
      };
    case AskAiEvalProjectKind.FreePlanWithStatusPage:
      return {
        ...PAGES_NOBODY,
        kind,
        policies: [DEFAULT_POLICY],
        isFreePlan: true,
      };
    default:
      return { ...PAGES_NOBODY };
  }
}

// Whether the project's on-call policies page people for every new incident.
export function pagesPeople(project: AskAiEvalProject): boolean {
  return project.policies.length > 0;
}
