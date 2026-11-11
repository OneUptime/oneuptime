import { SERVER_EMAIL_COPY } from "../../Utils/ServerEmail";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal from "Common/UI/Components/Modal/Modal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE INVITATION LINK, HANDED TO A MASTER ADMIN WHO JUST INVITED SOMEONE.
 *
 * On a server that cannot send email (Utils/ServerEmail), an invitation is
 * created and nobody hears of it. A master admin - on a fresh self-hosted
 * server, the person who made it - is shown the link the email would have
 * carried, to send by chat (POST /team-member/invitation-link): for someone
 * new, the sign-up link with its registration token, which works once, for
 * that address only, for a week; for someone with an account, the sign-in
 * page. Anybody else is never handed one (InvitationLink says why), and the
 * invite dialog told them to ask the server's admin.
 */

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
        url: URL.fromURL(APP_API_URL).addRoute(new Route(INVITATION_LINK_ROUTE)),
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
      title={SERVER_EMAIL_COPY.invitationLinkTitle}
      description={
        invitation
          ? translator.translateTemplate(
              invitation.isRegistered
                ? SERVER_EMAIL_COPY.invitationLinkRegisteredDescription
                : SERVER_EMAIL_COPY.invitationLinkDescription,
              { email: invitation.email },
            )
          : undefined
      }
      isBodyLoading={isLoading}
      submitButtonText={SERVER_EMAIL_COPY.done}
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
          {translator.translateText(SERVER_EMAIL_COPY.invitationLinkFailed)}
        </p>
      )}
    </Modal>
  );
};

export default InvitationLinkModal;
