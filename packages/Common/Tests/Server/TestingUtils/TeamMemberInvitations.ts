import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";

/*
 * A MEMBERSHIP'S INVITATION, AS ITS CREATE SENDS IT (#10180).
 *
 * TeamMemberService.onBeforeCreate decides what an invitation is - the
 * account, the membership, its count and its window - and plans its email;
 * the email is built, its link's token minted and sent once the membership
 * is made, after the request (startPlannedInvitation, the last thing
 * onCreateSuccess does). Suites that drive onBeforeCreate with the database
 * stood in for, and read the email, its token or the address's count, run
 * both halves with this: onBeforeCreate, then the planned invitation for the
 * row it would write, settled - and get back what onBeforeCreate handed on.
 * A refusal throws out of onBeforeCreate, as it does, with nothing started.
 */

type BeforeCreate = (
  createBy: CreateBy<TeamMember>,
) => Promise<OnCreate<TeamMember>>;

export async function runInvitationHooks(
  createBy: CreateBy<TeamMember>,
): Promise<OnCreate<TeamMember>> {
  const onCreate: OnCreate<TeamMember> = await (
    TeamMemberService as unknown as { onBeforeCreate: BeforeCreate }
  ).onBeforeCreate(createBy);

  // The row the INSERT would write is what onBeforeCreate handed on.
  TeamMemberService.startPlannedInvitation(onCreate, onCreate.createBy.data);

  await TeamMemberService.whenInvitationsSent();

  return onCreate;
}

/*
 * A suite's hook caller (callHook) that runs a membership's onBeforeCreate
 * through runInvitationHooks, and any other hook as it is.
 */
export async function callTeamMemberHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  if (service === TeamMemberService && name === "onBeforeCreate") {
    return await runInvitationHooks(args[0] as CreateBy<TeamMember>);
  }

  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return await hooks[name]!.apply(service, args);
}
