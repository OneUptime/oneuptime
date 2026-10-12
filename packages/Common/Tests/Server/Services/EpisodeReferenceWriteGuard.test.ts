import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import EpisodeMembershipReference, {
  ALERT_EPISODE_REFERENCE,
  EpisodeMembershipReferenceColumn,
  INCIDENT_EPISODE_REFERENCE,
} from "../../../Server/Utils/Episode/EpisodeMembershipReference";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * An incident's or alert's episode mirrors the episode's members, and only
 * the member services move it - as OneUptime's own writes, root with no
 * project on the request (EpisodeMembershipReference). Nobody may write the
 * columns (EpisodeReferenceColumns.test.ts), and these hold the writes that
 * skip column permissions to the same: a workflow step, which writes as
 * root in its project, and a master admin. An API request is refused here
 * too, before the column check would refuse it, in words that say what to
 * do instead.
 *
 * The services' own hooks run; which records the project has is a stand-in
 * (stubProjectDirectory). A create the hooks let through stops where it
 * would take its incident or alert number (PastTheCheck) instead of going
 * on to the database; an update the hooks let through returns.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194e9a1-0000-4000-8000-000000000001",
);
const EPISODE_ID: string = "0194e9a1-0000-4000-8000-0000000000e1";
const STATE_ID: string = "0194e9a1-0000-4000-8000-0000000000a1";

// Thrown once a write is past the hook's checks.
class PastTheCheck extends Error {}

interface Request {
  caller: string;
  props: DatabaseCommonInteractionProps;
  // An incident or alert is only created in a project.
  createsInProject: boolean;
}

// Each caller that writes in a project, as its request carries it.
const REQUESTS: Array<Request> = [
  {
    caller: "a person through the API or the dashboard",
    props: {
      tenantId: PROJECT_ID,
      userId: new ObjectID("0194e9a1-0000-4000-8000-0000000000c1"),
      userType: UserType.User,
    },
    createsInProject: true,
  },
  {
    caller: "an API key, as Terraform and the MCP tools use",
    props: { tenantId: PROJECT_ID, userType: UserType.API },
    createsInProject: true,
  },
  {
    caller: "a workflow step (root, in its project)",
    props: { isRoot: true, tenantId: PROJECT_ID },
    createsInProject: true,
  },
  {
    caller: "a master admin",
    props: {
      isMasterAdmin: true,
      tenantId: PROJECT_ID,
      userId: new ObjectID("0194e9a1-0000-4000-8000-0000000000c2"),
    },
    createsInProject: true,
  },
  {
    caller: "a master admin with no project on the request",
    props: {
      isMasterAdmin: true,
      userId: new ObjectID("0194e9a1-0000-4000-8000-0000000000c2"),
    },
    createsInProject: false,
  },
];

// OneUptime's own write, as the member services make it.
const SERVER_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

interface Kind {
  name: "Incident" | "Alert";
  reference: EpisodeMembershipReferenceColumn;
  service: unknown;
  // A create that is valid in every way but the episode.
  newRecord: () => Record<string, unknown>;
  counter: "incrementAndGetIncidentCounter" | "incrementAndGetAlertCounter";
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    reference: INCIDENT_EPISODE_REFERENCE,
    service: IncidentService,
    newRecord: () => {
      return { title: "Payments are down", projectId: PROJECT_ID };
    },
    counter: "incrementAndGetIncidentCounter",
  },
  {
    name: "Alert",
    reference: ALERT_EPISODE_REFERENCE,
    service: AlertService,
    newRecord: () => {
      return { title: "Disk is full", projectId: PROJECT_ID };
    },
    counter: "incrementAndGetAlertCounter",
  },
];

// Each way a write names the episode: either name, both, and a clear.
function episodeWrites(kind: Kind): Array<Record<string, unknown>> {
  const [idColumn, relation] = kind.reference.keys as [string, string];

  return [
    { [idColumn]: new ObjectID(EPISODE_ID) },
    { [relation]: { _id: EPISODE_ID } },
    { [idColumn]: new ObjectID(EPISODE_ID), [relation]: { _id: EPISODE_ID } },
    { [idColumn]: null },
  ];
}

function refusalOf(write: () => void): unknown {
  try {
    write();
  } catch (error) {
    return error;
  }

  return null;
}

describe.each(KINDS)("EpisodeMembershipReference: $name", (kind: Kind) => {
  test("names both of the episode's names, ID column first", () => {
    expect(kind.reference.keys).toEqual(
      kind.name === "Incident"
        ? ["incidentEpisodeId", "incidentEpisode"]
        : ["alertEpisodeId", "alertEpisode"],
    );
  });

  test("the refusal says how to join or leave an episode instead", () => {
    const [idColumn] = kind.reference.keys as [string];
    const memberPath: string =
      kind.name === "Incident"
        ? "/incident-episode-member"
        : "/alert-episode-member";

    expect(kind.reference.refusal).toContain(
      `${idColumn} cannot be set directly`,
    );
    expect(kind.reference.refusal).toContain(memberPath);
  });

  test.each(REQUESTS)(
    "refuses $caller writing it, under either name and as a clear",
    ({ props }: Request) => {
      for (const payload of episodeWrites(kind)) {
        const refusal: unknown = refusalOf(() => {
          EpisodeMembershipReference.refuseWriteMadeInProject({
            payload: payload,
            props: props,
            reference: kind.reference,
          });
        });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect((refusal as Error).message).toBe(kind.reference.refusal);
      }
    },
  );

  test("lets OneUptime's own write set it and clear it", () => {
    for (const payload of episodeWrites(kind)) {
      expect(
        refusalOf(() => {
          EpisodeMembershipReference.refuseWriteMadeInProject({
            payload: payload,
            props: SERVER_PROPS,
            reference: kind.reference,
          });
        }),
      ).toBeNull();
    }
  });

  test.each(REQUESTS)(
    "lets $caller make a write that does not name it",
    ({ props }: Request) => {
      const [idColumn] = kind.reference.keys as [string];
      const emptyRecord: unknown =
        kind.name === "Incident" ? new Incident() : new Alert();

      for (const payload of [
        { title: "Renamed" },
        // A column given as undefined is not written: TypeORM skips it.
        { title: "Renamed", [idColumn]: undefined },
        // A model instance has every column as a key, set or not.
        emptyRecord,
        undefined,
      ]) {
        expect(
          refusalOf(() => {
            EpisodeMembershipReference.refuseWriteMadeInProject({
              payload: payload,
              props: props,
              reference: kind.reference,
            });
          }),
        ).toBeNull();
      }
    },
  );
});

describe("the incident and alert hooks", () => {
  beforeEach(() => {
    // Every record the writes name is the project's own.
    stubProjectDirectory({});

    // The project's starting states, which the create hooks look up.
    const incidentState: IncidentState = new IncidentState();
    incidentState._id = STATE_ID;
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(incidentState as never);

    const alertState: AlertState = new AlertState();
    alertState._id = STATE_ID;
    jest
      .spyOn(AlertStateService, "findOneBy")
      .mockResolvedValue(alertState as never);

    // An update reads the records it matches: none here.
    for (const service of [IncidentService, AlertService]) {
      jest
        .spyOn(
          service as unknown as { findBy: () => Promise<unknown> },
          "findBy",
        )
        .mockResolvedValue([] as never);
      // Nor among the records a caller's update may write.
      stubRowsCallerMayWrite(service as never, () => {
        return [];
      });
    }

    // A create the hooks let through stops where it takes its number.
    jest
      .spyOn(ProjectService, "incrementAndGetIncidentCounter")
      .mockImplementation(async () => {
        throw new PastTheCheck();
      });
    jest
      .spyOn(ProjectService, "incrementAndGetAlertCounter")
      .mockImplementation(async () => {
        throw new PastTheCheck();
      });

    // The services' reference checks run, against the stand-in project.
    jest.spyOn(
      ProjectScopedReferenceValidator,
      "validateReferencesBelongToProject",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function hook(
    kind: Kind,
    name: "onBeforeCreate" | "onBeforeUpdate",
  ): (input: unknown) => Promise<unknown> {
    const hooks: Record<string, (input: unknown) => Promise<unknown>> =
      kind.service as Record<string, (input: unknown) => Promise<unknown>>;

    return hooks[name]!.bind(kind.service);
  }

  function create(
    kind: Kind,
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> {
    return hook(
      kind,
      "onBeforeCreate",
    )({
      data: { ...kind.newRecord(), ...values },
      props: props,
    }).then(
      () => {
        return "went on";
      },
      (error: unknown) => {
        return error;
      },
    );
  }

  function update(
    kind: Kind,
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> {
    return hook(
      kind,
      "onBeforeUpdate",
    )({
      data: values,
      query: { _id: "0194e9a1-0000-4000-8000-0000000000d1" },
      props: props,
      limit: 1,
      skip: 0,
    }).then(
      () => {
        return "went on";
      },
      (error: unknown) => {
        return error;
      },
    );
  }

  // Not refused: an update the hooks let through returns.
  function wentOn(outcome: unknown): boolean {
    return outcome === "went on" || outcome instanceof PastTheCheck;
  }

  describe.each(KINDS)("$name", (kind: Kind) => {
    test.each(REQUESTS)(
      "a create by $caller that names the episode is refused before the number is taken",
      async ({ props }: Request) => {
        for (const values of episodeWrites(kind)) {
          const outcome: unknown = await create(kind, values, props);

          expect(outcome).toBeInstanceOf(BadDataException);
          expect((outcome as Error).message).toBe(kind.reference.refusal);
        }

        expect(ProjectService[kind.counter]).not.toHaveBeenCalled();
      },
    );

    test.each(REQUESTS)(
      "an update by $caller that writes the episode is refused",
      async ({ props }: Request) => {
        for (const values of episodeWrites(kind)) {
          const outcome: unknown = await update(
            kind,
            { title: "Renamed", ...values },
            props,
          );

          expect(outcome).toBeInstanceOf(BadDataException);
          expect((outcome as Error).message).toBe(kind.reference.refusal);
        }
      },
    );

    test.each(REQUESTS)(
      "$caller's update without the episode goes on",
      async ({ props }: Request) => {
        expect(wentOn(await update(kind, { title: "Renamed" }, props))).toBe(
          true,
        );
      },
    );

    test.each(
      REQUESTS.filter((request: Request): boolean => {
        return request.createsInProject;
      }),
    )(
      "$caller's create without the episode goes on to take its number",
      async ({ props }: Request) => {
        expect(await create(kind, {}, props)).toBeInstanceOf(PastTheCheck);
        expect(ProjectService[kind.counter]).toHaveBeenCalledTimes(1);
      },
    );

    test("OneUptime's own update moves the episode and clears it, as the member services do", async () => {
      const [idColumn] = kind.reference.keys as [string];

      expect(
        wentOn(
          await update(
            kind,
            { [idColumn]: new ObjectID(EPISODE_ID) },
            SERVER_PROPS,
          ),
        ),
      ).toBe(true);
      expect(
        wentOn(await update(kind, { [idColumn]: null }, SERVER_PROPS)),
      ).toBe(true);
    });
  });
});
