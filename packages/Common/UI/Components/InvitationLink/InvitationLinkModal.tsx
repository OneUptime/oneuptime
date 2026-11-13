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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
  title: string;
  description: string;
  registeredDescription: string;
  failed: string;
  done: string;
} = {
  // What a master admin's invite dialog says before Invite is pressed.
  inviteDescriptionForAdmin: translationKey(
    "This server cannot send email yet, so they get no invitation email. The invitation is still created, and you get a link to send them yourself.",
  ),
  // A pending member's pill, where "Invitation Sent" would not be true.
  invitedPill: translationKey("Invited"),
  title: translationKey("Send them their invitation link"),
  description: translationKey(
    "This server cannot send email, so {{email}} was not emailed. Copy this link and send it yourself. It works once, only for this address, for 7 days.",
  ),
  registeredDescription: translationKey(
    "This server cannot send email, so {{email}} was not emailed. They already have an account: send them this link to sign in and accept the invitation.",
  ),
  failed: translationKey(
    "The invitation was created, but its link could not be read. Open the Admin Dashboard to set their password instead.",
  ),
  done: translationKey("Done"),
};

export interface InvitationLink {
  link: string;
  isRegistered: boolean;
  email: string;
}

export const INVITATION_LINK_ROUTE: string = "/team-member/invitation-link";

// The link for a membership just created, or null when it cannot be read.
export const fetchInvitationLink: (
  teamMemberId: ObjectID,
) => Promise<InvitationLink | null> = async (
  teamMemberId: ObjectID,
): Promise<InvitationLink | null> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: URL.fromURL(APP_API_URL).addRoute(
          new Route(INVITATION_LINK_ROUTE),
        ),
        data: {
          teamMemberId: teamMemberId.toString(),
        },
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
      email: typeof data["email"] === "string" ? (data["email"] as string) : "",
    };
  } catch {
    return null;
  }
};

export interface ComponentProps {
  teamMemberId: ObjectID;
  onClose: () => void;
}

const InvitationLinkModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [invitation, setInvitation] = useState<InvitationLink | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchInvitationLink(props.teamMemberId)
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
  }, [props.teamMemberId.toString()]);

  return (
    <Modal
      title={INVITATION_LINK_COPY.title}
      description={
        invitation
          ? translator.translateTemplate(
              invitation.isRegistered
                ? INVITATION_LINK_COPY.registeredDescription
                : INVITATION_LINK_COPY.description,
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
          {translator.translateText(INVITATION_LINK_COPY.failed)}
        </p>
      )}
    </Modal>
  );
};

export default InvitationLinkModal;
