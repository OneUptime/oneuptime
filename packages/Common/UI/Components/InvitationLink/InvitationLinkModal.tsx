import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Modal from "../Modal/Modal";
import { APP_API_URL } from "../../Config";
import API from "../../Utils/API/API";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE INVITATION LINK, HANDED TO A MASTER ADMIN WHO JUST INVITED SOMEONE.
 *
 * On a server that cannot send email (#6825), an invitation is created and
 * nobody hears of it. A master admin - on a fresh self-hosted server, the
 * person who made it - is shown the link the email would have carried, to
 * send by chat (POST /team-member/invitation-link): for someone new, the
 * sign-up link with its registration token, which works once, for that
 * address only, for a week; for someone with an account, the sign-in page.
 * Anybody else is never handed one (Server/Utils/InvitationLink says why),
 * and the invite dialog told them to ask the server's admin.
 *
 * The Dashboard's invite dialogs and the Admin Dashboard's draw it alike.
 */

export const INVITATION_LINK_COPY: {
  inviteDescriptionForAdmin: string;
  invitedPill: string;
  notSignedUpPill: string;
  title: string;
  description: string;
  registeredDescription: string;
  memberDescription: string;
  failed: string;
  done: string;
  getLink: string;
  notSentDescription: string;
  notSentRegisteredDescription: string;
  notSentMemberDescription: string;
  notSentFailed: string;
} = {
  // What a master admin's invite dialog says before Invite is pressed.
  inviteDescriptionForAdmin: translationKey(
    "This server cannot send email yet, so they get no invitation email. The invitation is still created, and you get a link to send them yourself.",
  ),
  // A pending member's pill, where "Invitation Sent" would not be true.
  invitedPill: translationKey("Invited"),
  /*
   * Beside Member, for someone whose invitation was accepted for them
   * before they had an account: they still have to sign up (#8191).
   */
  notSignedUpPill: translationKey("Not Signed Up Yet"),
  title: translationKey("Send them their invitation link"),
  description: translationKey(
    "This server cannot send email, so {{email}} was not emailed. Copy this link and send it yourself. It works once, only for this address, for 7 days.",
  ),
  registeredDescription: translationKey(
    "This server cannot send email, so {{email}} was not emailed. They already have an account: send them this link to sign in and accept the invitation.",
  ),
  // Someone with an account, already a member: nothing left to accept (#8191).
  memberDescription: translationKey(
    "This server cannot send email, so {{email}} was not emailed. They already have an account and are a member now: send them this link to sign in.",
  ),
  failed: translationKey(
    "The invitation was created, but its link could not be read. Open the Admin Dashboard to set their password instead.",
  ),
  done: translationKey("Done"),
  // A pending person's row action, which opens this dialog for them (#7168).
  getLink: translationKey("Get Invitation Link"),
  /*
   * Opened from an invitation email the server failed to send (the
   * server's email log, #7169): the email may have failed on a server that
   * sends others, so the dialog says that this one was not sent.
   */
  notSentDescription: translationKey(
    "The invitation email to {{email}} was not sent. Copy this link and send it yourself. It works once, only for this address, for 7 days.",
  ),
  notSentRegisteredDescription: translationKey(
    "The invitation email to {{email}} was not sent. They already have an account: send them this link to sign in and accept the invitation.",
  ),
  notSentMemberDescription: translationKey(
    "The invitation email to {{email}} was not sent. They already have an account and are a member now: send them this link to sign in.",
  ),
  notSentFailed: translationKey(
    "Their invitation link could not be read. They may not be invited to this project any more: invite them again from its Users page.",
  ),
};

/*
 * Whom the dialog reads the link for: a membership - a row of a list - or,
 * from the server's email log, the project and the address an invitation
 * email went to (#7169).
 */
export interface InvitationLinkInvitee {
  projectId: string;
  email: string;
}

export type InvitationLinkTarget = ObjectID | InvitationLinkInvitee;

/*
 * GET INVITATION LINK, ON A PENDING PERSON'S ROW (#7168).
 *
 * The dialog shows the link once, right after its master admin's own
 * Invite. But a person can be invited by somebody else - a project owner,
 * who is told to ask the server's admin for the link - or have a link that
 * ran out (7 days). So every list that shows a pending person as Invited
 * offers this action on their row, for a master admin on a server known not
 * to send email: it opens the dialog, which reads a fresh link.
 *
 * `isAvailable` says whether this viewer may have the link at all; the
 * server refuses anybody but a master admin whatever the page shows
 * (POST /team-member/invitation-link). The row of somebody who has joined
 * shows nothing: they have no invitation to send - unless the invitation
 * was accepted for them before they had an account (`isNotSignedUp`, from
 * useMembersNotSignedUp), and they still have to sign up with the link
 * (#8191).
 *
 * On a server that sends email, a pending row whose latest invitation email
 * was not sent offers it too (`isEmailNotSent`, from
 * useInvitationEmailsNotSent, #9511): the mail service refused it, and the
 * person never heard. A page hands it over only for a master admin.
 */
export const getInvitationLinkRowAction: <T extends TeamMember>(data: {
  isAvailable: boolean;
  onOpen: (teamMemberId: ObjectID, item: T) => void;
  isNotSignedUp?: ((item: T) => boolean) | undefined;
  isEmailNotSent?: ((item: T) => boolean) | undefined;
}) => ActionButtonSchema<T> = <T extends TeamMember>(data: {
  isAvailable: boolean;
  onOpen: (teamMemberId: ObjectID, item: T) => void;
  isNotSignedUp?: ((item: T) => boolean) | undefined;
  isEmailNotSent?: ((item: T) => boolean) | undefined;
}): ActionButtonSchema<T> => {
  return {
    title: INVITATION_LINK_COPY.getLink,
    buttonStyleType: ButtonStyleType.OUTLINE,
    icon: IconProp.Link,
    isVisible: (item: T): boolean => {
      if (!item.id) {
        return false;
      }

      if (item.hasAcceptedInvitation) {
        return data.isAvailable && Boolean(data.isNotSignedUp?.(item));
      }

      return data.isAvailable || Boolean(data.isEmailNotSent?.(item));
    },
    onClick: (item: T, onCompleteAction: VoidFunction): void => {
      if (item.id) {
        data.onOpen(item.id, item);
      }

      onCompleteAction();
    },
  };
};

export interface InvitationLink {
  link: string;
  isRegistered: boolean;
  // Accepted already: nothing left for them to accept (#8191).
  isAccepted: boolean;
  email: string;
}

/*
 * What the dialog says, for whom: someone new is handed the sign-up link,
 * which works once; someone with an account, the sign-in page - to accept
 * the invitation, or, when it was accepted for them, just to sign in.
 */
export const getInvitationLinkDescription: (
  invitation: InvitationLink,
  options?: { isEmailNotSent?: boolean | undefined } | undefined,
) => string = (
  invitation: InvitationLink,
  options?: { isEmailNotSent?: boolean | undefined } | undefined,
): string => {
  // Opened from an invitation email the server failed to send (#7169).
  if (options?.isEmailNotSent) {
    if (!invitation.isRegistered) {
      return INVITATION_LINK_COPY.notSentDescription;
    }

    return invitation.isAccepted
      ? INVITATION_LINK_COPY.notSentMemberDescription
      : INVITATION_LINK_COPY.notSentRegisteredDescription;
  }

  if (!invitation.isRegistered) {
    return INVITATION_LINK_COPY.description;
  }

  return invitation.isAccepted
    ? INVITATION_LINK_COPY.memberDescription
    : INVITATION_LINK_COPY.registeredDescription;
};

export const INVITATION_LINK_ROUTE: string = "/team-member/invitation-link";

// How the route is asked for the link of a membership, or of a project's invitee.
export const getInvitationLinkRequest: (
  target: InvitationLinkTarget,
) => JSONObject = (target: InvitationLinkTarget): JSONObject => {
  if (target instanceof ObjectID) {
    return { teamMemberId: target.toString() };
  }

  return { projectId: target.projectId, email: target.email };
};

// The link for a membership just created, or null when it cannot be read.
export const fetchInvitationLink: (
  target: InvitationLinkTarget,
) => Promise<InvitationLink | null> = async (
  target: InvitationLinkTarget,
): Promise<InvitationLink | null> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: URL.fromURL(APP_API_URL).addRoute(
          new Route(INVITATION_LINK_ROUTE),
        ),
        data: getInvitationLinkRequest(target),
      });

    if (!response.isSuccess()) {
      return null;
    }

    const data: JSONObject = response.data as JSONObject;

    if (typeof data["link"] !== "string" || !data["link"]) {
      return null;
    }

    return {
      link: data["link"] as string,
      isRegistered: data["isRegistered"] === true,
      isAccepted: data["isAccepted"] === true,
      email: typeof data["email"] === "string" ? (data["email"] as string) : "",
    };
  } catch {
    return null;
  }
};

export interface ComponentProps {
  // The membership whose link this is: a row of a list.
  teamMemberId?: ObjectID | undefined;
  /*
   * Or the project and the address of an invitation email the server
   * failed to send: the server's email log (#7169). The dialog then says
   * that email was not sent.
   */
  invitee?: InvitationLinkInvitee | undefined;
  /*
   * The person's latest invitation email was not sent, on a server that
   * sends email (#9511): the dialog says that one was not sent, not that
   * the server cannot send email. Said for an invitee whatever this is.
   */
  isEmailNotSent?: boolean | undefined;
  onClose: () => void;
}

const InvitationLinkModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [invitation, setInvitation] = useState<InvitationLink | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const isEmailNotSent: boolean = Boolean(
    props.invitee || props.isEmailNotSent,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: Promise<InvitationLink | null> = props.invitee
      ? fetchInvitationLink(props.invitee)
      : props.teamMemberId
        ? fetchInvitationLink(props.teamMemberId)
        : Promise.resolve(null);

    read
      .then((loaded: InvitationLink | null): void => {
        if (isCurrent) {
          setInvitation(loaded);
          setIsLoading(false);
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    props.teamMemberId?.toString(),
    props.invitee?.projectId,
    props.invitee?.email,
  ]);

  return (
    <Modal
      title={INVITATION_LINK_COPY.title}
      description={
        invitation
          ? translator.translateTemplate(
              getInvitationLinkDescription(invitation, {
                isEmailNotSent: isEmailNotSent,
              }),
              { email: invitation.email },
            )
          : undefined
      }
      isBodyLoading={isLoading}
      submitButtonText={INVITATION_LINK_COPY.done}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      onSubmit={props.onClose}
      onClose={props.onClose}
    >
      {invitation ? (
        <div
          className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
          data-testid="invitation-link"
        >
          <code
            className="min-w-0 flex-1 break-all text-sm text-gray-800"
            data-testid="invitation-link-value"
          >
            {invitation.link}
          </code>
          <CopyTextButton
            textToBeCopied={invitation.link}
            size="sm"
            variant="soft"
          />
        </div>
      ) : (
        <p
          className="text-sm text-gray-600 text-pretty"
          data-testid="invitation-link-failed"
        >
          {/*
           * Read by a membership, the invitation is there; by the
           * server's email log, the person may be invited no more.
           */}
          {translator.translateText(
            props.invitee
              ? INVITATION_LINK_COPY.notSentFailed
              : INVITATION_LINK_COPY.failed,
          )}
        </p>
      )}
    </Modal>
  );
};

export default InvitationLinkModal;
