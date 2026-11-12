import ProductKey from "../Product/ProductKey";
import {
  ESSENTIAL_PRODUCTS,
  HIDEABLE_PRODUCTS,
  ProjectProductSettings,
  ProjectProductsChosenBy,
} from "../Product/ProjectProducts";

/*
 * A SAMPLE PROJECT TO LOOK AROUND IN (issue #6808).
 *
 * A new project is empty, so it cannot show what an incident timeline, an
 * on-call rotation or a trace looks like. One click makes a second project
 * for the person, "Sample: Acme Shop", filled with made-up monitors,
 * incidents, alerts, an on-call policy, a status page, a service with its
 * logs, traces and metrics, an SLO and a dashboard, and opens it.
 *
 * It can never notify anyone or be seen by the public, and it is never
 * billed (Project.isSampleProject, and every reader SampleProjectReadersGuard
 * lists). Every page of it says what it is, with the way to delete it and
 * back to the person's own project. It goes away when the person deletes
 * it, and on OneUptime Cloud after SAMPLE_PROJECT_IDLE_DAYS without a visit.
 * A self-hosted server makes it from this code: nothing is fetched from
 * oneuptime.com.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

export const SAMPLE_PROJECT_NAME: string = "Sample: Acme Shop";

// The made-up company the sample's monitors, status page and service belong to.
export const SAMPLE_COMPANY_NAME: string = "Acme Shop";

/*
 * On OneUptime Cloud, a sample nobody has opened for this many days is
 * deleted (Project.lastActive, which every signed-in request moves on).
 */
export const SAMPLE_PROJECT_IDLE_DAYS: number = 14;

/*
 * How long the sample's logs, spans and metrics are kept: the sample's
 * whole life on Cloud, and a day more. A self-hosted sample keeps its other
 * records until it is deleted; its telemetry ages out after this.
 */
export const SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS: number =
  SAMPLE_PROJECT_IDLE_DAYS + 1;

/*
 * The products the sample has something in, and shows: Essentials, and the
 * telemetry of its one service with the dashboard over it. Every other
 * product is kept under More products (#6814), as a project's goals would
 * leave it.
 */
export const SAMPLE_PROJECT_PRODUCTS: ReadonlyArray<ProductKey> = [
  ...ESSENTIAL_PRODUCTS,
  ProductKey.Logs,
  ProductKey.Metrics,
  ProductKey.Traces,
  ProductKey.Services,
  ProductKey.Dashboards,
];

// The sample's Project.productSettings: everything it has nothing in is hidden.
export const getSampleProjectProductSettings: (
  now: Date,
) => ProjectProductSettings = (now: Date): ProjectProductSettings => {
  return {
    hidden: HIDEABLE_PRODUCTS.filter((product: ProductKey): boolean => {
      return !SAMPLE_PROJECT_PRODUCTS.includes(product);
    }),
    keptHiddenWithData: [],
    /*
     * As a member's choice: the sample's goals are never asked, and nothing
     * may choose its menu again from them.
     */
    chosenBy: ProjectProductsChosenBy.Member,
    changedAt: now.toISOString(),
    changedByUserId: null,
  };
};

/*
 * THE SAMPLE PEOPLE: who staffs the sample's on-call policy and owns its
 * incidents. They are not real people and never can be (User.sampleProjectId):
 * their addresses are on the .invalid domain, which RFC 2606 keeps from ever
 * reaching a mailbox, and MailService refuses to send to it at all.
 */
export const SAMPLE_PERSON_EMAIL_DOMAIN: string = "sample.invalid";

export interface SamplePerson {
  // The start of their address, before the project's mark.
  handle: string;
  name: string;
}

export const SAMPLE_PEOPLE: ReadonlyArray<SamplePerson> = [
  { handle: "maya.chen", name: "Maya Chen" },
  { handle: "sam.okafor", name: "Sam Okafor" },
  { handle: "lena.fischer", name: "Lena Fischer" },
  { handle: "diego.alvarez", name: "Diego Alvarez" },
];

/*
 * A sample person's address: their handle, marked with their sample's id
 * (every address on the server is unique), at the reserved domain.
 */
export const getSamplePersonEmail: (data: {
  handle: string;
  projectId: string;
}) => string = (data: { handle: string; projectId: string }): string => {
  const mark: string = data.projectId.replace(/-/g, "").toLowerCase();

  return `${data.handle}+${mark}@${SAMPLE_PERSON_EMAIL_DOMAIN}`;
};

// Whether an address is a sample person's: nothing is ever sent to one.
export const isSamplePersonEmail: (email: unknown) => boolean = (
  email: unknown,
): boolean => {
  if (email === null || email === undefined) {
    return false;
  }

  const text: string = String(email).trim().toLowerCase();

  return (
    text.endsWith(`@${SAMPLE_PERSON_EMAIL_DOMAIN}`) ||
    text.endsWith(`.${SAMPLE_PERSON_EMAIL_DOMAIN}`)
  );
};

/*
 * WHAT A SENDER SAYS INSTEAD OF SENDING for a sample project: on the
 * on-call timeline, in the logs, and to a caller that asked to send.
 */
export const SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE: string =
  "This is a sample project, so nothing is sent from it.";

export const getSampleProjectNotSentReason: (channel: string) => string = (
  channel: string,
): string => {
  return `${channel} not sent: ${SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE}`;
};

// What a sender says for a sample person's address.
export const SAMPLE_PERSON_NOT_SENT_REASON: string =
  "Email not sent: this address belongs to a sample person, who is not real.";

/*
 * WHAT A SAMPLE PROJECT REFUSES, and why: each is a sentence that says what
 * to do instead.
 */
export const SAMPLE_PROJECT_REFUSALS: {
  readonly testPage: string;
  readonly monitor: string;
  readonly telemetryIngestion: string;
  readonly workflow: string;
  readonly ai: string;
  readonly workspace: string;
  readonly statusPageDomain: string;
  readonly member: string;
  readonly samplePersonElsewhere: string;
  readonly creationRestricted: string;
  readonly notASample: string;
} = {
  testPage:
    "This is a sample project, so nothing is sent from it. Send a test page from your own project.",
  monitor:
    "This is a sample project, so its monitors are never checked. Create this monitor in your own project.",
  telemetryIngestion:
    "This is a sample project, so it takes no telemetry. Send your telemetry to your own project.",
  workflow:
    "This is a sample project, so its workflows never run. Run this workflow in your own project.",
  ai: "This is a sample project, so OneUptime AI does not work in it. Use OneUptime AI in your own project.",
  workspace:
    "This is a sample project, so it cannot be connected to a workspace. Connect your own project instead.",
  statusPageDomain:
    "This is a sample project, so its status page is never public and takes no custom domain. Add the domain to a status page in your own project.",
  member:
    "This is a sample project, so nobody else can be invited to it. Invite your team to your own project.",
  samplePersonElsewhere:
    "This person is a sample person, made up for a sample project, so they cannot join another project. Invite a real person instead.",
  creationRestricted:
    "Only admins can create projects on this server, and a sample project is a project. Ask your server admin to add you to a project.",
  notASample:
    "This project is not a sample project, so it is not deleted from here. Delete it from Project Settings.",
};

/*
 * THE SAMPLE'S API (SampleProjectAPI).
 *
 *   POST /sample-project/create  makes the person's sample, or finds the one
 *                                they have, and answers its id
 *   POST /sample-project/delete  deletes the sample the request names
 *                                (its project header)
 */
export const SAMPLE_PROJECT_API_PATH: string = "/sample-project";
export const SAMPLE_PROJECT_CREATE_ROUTE: string = `${SAMPLE_PROJECT_API_PATH}/create`;
export const SAMPLE_PROJECT_DELETE_ROUTE: string = `${SAMPLE_PROJECT_API_PATH}/delete`;

// Where a sample was started from, as its event says (sample_project/started).
export enum SampleProjectEntryPoint {
  // The "No projects" page a new account lands on.
  Welcome = "welcome",
  // The goal question's "Just looking around" (#6803).
  Goals = "goals",
  // Home, for a project with nothing in it yet.
  Home = "home",
}

export const SAMPLE_PROJECT_ENTRY_POINTS: ReadonlyArray<SampleProjectEntryPoint> =
  [
    SampleProjectEntryPoint.Welcome,
    SampleProjectEntryPoint.Goals,
    SampleProjectEntryPoint.Home,
  ];

export const isSampleProjectEntryPoint: (
  value: unknown,
) => value is SampleProjectEntryPoint = (
  value: unknown,
): value is SampleProjectEntryPoint => {
  return (
    typeof value === "string" &&
    (SAMPLE_PROJECT_ENTRY_POINTS as ReadonlyArray<string>).includes(value)
  );
};

// What the create route answers.
export interface SampleProjectCreateAnswer {
  projectId: string;
  // False when the person had a sample already, and it was opened instead.
  isNew: boolean;
}

/*
 * Whether a sample nobody has opened for SAMPLE_PROJECT_IDLE_DAYS is due to
 * be deleted (OneUptime Cloud's job): its last visit (Project.lastActive),
 * or when it was made if nobody has opened it since.
 */
export const isSampleProjectIdle: (data: {
  lastActive: Date | null | undefined;
  createdAt: Date | null | undefined;
  now: Date;
}) => boolean = (data: {
  lastActive: Date | null | undefined;
  createdAt: Date | null | undefined;
  now: Date;
}): boolean => {
  const lastVisit: Date | null | undefined = data.lastActive || data.createdAt;

  if (!lastVisit) {
    return false;
  }

  const idleForMs: number = data.now.getTime() - new Date(lastVisit).getTime();

  return idleForMs >= SAMPLE_PROJECT_IDLE_DAYS * 24 * 60 * 60 * 1000;
};
