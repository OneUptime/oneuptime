import { PendingRecord } from "../../../../Server/Services/DatabaseService";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import EpisodeMemberAddScope, {
  MemberCreateScopeChecker,
} from "../../../../Server/Utils/Episode/EpisodeMemberAddScope";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import Label from "../../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * An incident or an alert is added to an episode - however many at once -
 * only as its caller may add it as a member of their own: the member row is
 * asked about as its own route would ask (DatabaseService.checkCreateScopeOf,
 * CreateScopePermission), and the words of a refusal are the answer for
 * that one. Root and master admin callers add any, asking nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
);
const USER_ID: ObjectID = new ObjectID("4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a");

const OWNED_REFUSAL: string =
  "Your access lets you create Incident Episode Members only for the Incidents you or your teams own.";

function member(): IncidentEpisodeMember {
  const row: IncidentEpisodeMember = new IncidentEpisodeMember();

  row.projectId = PROJECT_ID;
  row.incidentEpisodeId = ObjectID.generate();
  row.incidentId = ObjectID.generate();

  return row;
}

function person(): DatabaseCommonInteractionProps {
  return { userId: USER_ID, tenantId: PROJECT_ID };
}

// A member service whose check of a row answers with `outcome`.
function serviceAnswering(outcome: Error | null): {
  service: MemberCreateScopeChecker<IncidentEpisodeMember>;
  asked: Array<{
    row: IncidentEpisodeMember;
    props: DatabaseCommonInteractionProps;
    pending?: PendingRecord | undefined;
  }>;
} {
  const asked: Array<{
    row: IncidentEpisodeMember;
    props: DatabaseCommonInteractionProps;
    pending?: PendingRecord | undefined;
  }> = [];

  return {
    asked: asked,
    service: {
      checkCreateScopeOf: jest.fn(
        async (data: {
          row: IncidentEpisodeMember;
          props: DatabaseCommonInteractionProps;
          pending?: PendingRecord | undefined;
        }): Promise<void> => {
          asked.push(data);

          if (outcome) {
            throw outcome;
          }
        },
      ),
    },
  };
}

describe("EpisodeMemberAddScope", () => {
  test("a member the caller may add is added: no refusal, the row asked about as it will be written", async () => {
    const { service, asked } = serviceAnswering(null);
    const row: IncidentEpisodeMember = member();

    await expect(
      EpisodeMemberAddScope.getRefusal({
        memberService: service,
        member: row,
        props: person(),
      }),
    ).resolves.toBeNull();

    expect(asked).toHaveLength(1);
    expect(asked[0]!.row).toBe(row);
    expect(asked[0]!.props).toEqual(person());
    expect(asked[0]!.pending).toBeUndefined();
  });

  test("one their permission to create members does not reach is refused, in the words the member's own route answers with", async () => {
    const { service } = serviceAnswering(
      new CreateScopeException(OWNED_REFUSAL),
    );

    await expect(
      EpisodeMemberAddScope.getRefusal({
        memberService: service,
        member: member(),
        props: person(),
      }),
    ).resolves.toBe(OWNED_REFUSAL);
  });

  test("any other failure is not taken for a refusal", async () => {
    const { service } = serviceAnswering(
      new BadDataException("The database is not reachable."),
    );

    await expect(
      EpisodeMemberAddScope.getRefusal({
        memberService: service,
        member: member(),
        props: person(),
      }),
    ).rejects.toThrow("The database is not reachable.");
  });

  test("OneUptime itself and master admins add any, and nothing is asked", async () => {
    const { service, asked } = serviceAnswering(
      new CreateScopeException(OWNED_REFUSAL),
    );

    for (const props of [
      { isRoot: true },
      { ...person(), isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        EpisodeMemberAddScope.getRefusal({
          memberService: service,
          member: member(),
          props: props,
        }),
      ).resolves.toBeNull();
    }

    expect(asked).toHaveLength(0);
  });

  test("an episode created with its members is asked about as it will be saved: its own id, its labels, owned by no one yet", async () => {
    const { service, asked } = serviceAnswering(null);
    const label: Label = new Label(ObjectID.generate());
    const labelId: ObjectID = ObjectID.generate();

    const pending: PendingRecord = EpisodeMemberAddScope.getPendingEpisode({
      episodeModelType: IncidentEpisode,
      labels: [label, labelId],
    });

    expect(pending.modelType).toBe(IncidentEpisode);
    expect(pending.labelIds).toEqual([
      label.id!.toString(),
      labelId.toString(),
    ]);
    // A member takes its owners from its incident or alert, not the episode.
    expect(pending.ownedByCreator).toBe(false);

    await EpisodeMemberAddScope.getRefusal({
      memberService: service,
      member: member(),
      props: person(),
      pendingEpisode: pending,
    });

    expect(asked[0]!.pending).toBe(pending);

    // A new placeholder for every episode; none with no labels at all.
    const other: PendingRecord = EpisodeMemberAddScope.getPendingEpisode({
      episodeModelType: AlertEpisode,
      labels: undefined,
    });

    expect(other.id.toString()).not.toBe(pending.id.toString());
    expect(other.modelType).toBe(AlertEpisode);
    expect(other.labelIds).toEqual([]);
  });
});
