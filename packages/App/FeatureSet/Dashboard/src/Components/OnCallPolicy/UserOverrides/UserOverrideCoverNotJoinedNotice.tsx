import {
  ProjectMembershipAnswer,
  ProjectMembershipStatus,
} from "../../../Utils/ProjectMembershipLoader";
import useProjectMembership from "../../../Utils/UseProjectMembership";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * UNDER "WHO COVERS?": THE PERSON PICKED HAS NOT JOINED THE PROJECT YET
 * (#10670).
 *
 * The picker offers someone invited who has not accepted, and the server
 * takes them as the cover, as it takes them on an escalation rule or in a
 * rotation (#10412): an override is often planned for someone about to join.
 * But nothing pages them until they do, so until then the away person's
 * pages reach nobody - and the form says so the moment they are picked,
 * before anything is saved. The override's lines in the policy's feed and
 * channels say the same once it is (OnCallChatText).
 *
 * Says nothing for a member, for nobody picked, and while membership is not
 * known (ProjectMembershipLoader: null is "say nothing").
 */

export const USER_OVERRIDE_COVER_NOT_JOINED_TEXT: string = translationKey(
  "They haven't accepted their invitation to this project yet, so nobody is paged in place of the person away until they do.",
);

export interface ComponentProps {
  // Who "Who covers?" holds; none while the rotation covers.
  coverUserId: string | null | undefined;
}

const UserOverrideCoverNotJoinedNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const membership: ProjectMembershipAnswer = useProjectMembership(
    props.coverUserId || null,
  );

  if (!props.coverUserId || membership !== ProjectMembershipStatus.Invited) {
    return <></>;
  }

  // A div: Icon draws one, and a div may not sit in a paragraph.
  return (
    <div
      data-testid="user-override-cover-not-joined"
      role="status"
      className="mt-2 flex items-start gap-1.5 text-sm text-amber-800"
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
      />
      <span>
        {translator.translateText(USER_OVERRIDE_COVER_NOT_JOINED_TEXT)}
      </span>
    </div>
  );
};

export default UserOverrideCoverNotJoinedNotice;
