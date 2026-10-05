import Project from "Common/Models/DatabaseModels/Project";
import { isPlanGatedColumnOff } from "Common/Types/Billing/PlanGatedColumnDefault";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import RequireSsoForLoginCard from "./RequireSsoForLoginCard";

/*
 * Settings -> SSO below the Scale plan, on OneUptime Cloud: the page is the
 * plan's upsell. A project a Scale trial - or a move down from Scale - left
 * requiring SSO still requires it: the server holds everyone to it whatever
 * the plan, and the project's SAML providers keep signing people in.
 *
 * A paid feature can always be switched off, on any plan: the server lets
 * requireSsoForLogin go back to its default (off) on every plan. So while
 * the project requires SSO, its switch is drawn under the upsell, where it
 * can be turned off; turning it on again needs Scale, which the switch's
 * pill and note say.
 *
 * Read once, when the page opens, and the card is handed what was read
 * (no second read). Once drawn, the card stays after the switch is turned
 * off, so its "Saved" shows and the switch can be read - locked then,
 * saying that requiring SSO again needs Scale. A project that does not
 * require SSO - nearly all of them - gets nothing under the upsell, and so
 * does one whose read fails: the upsell is the page.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

export const REQUIRE_SSO_FOR_LOGIN_LEFTOVER_TEST_ID: string =
  "project-require-sso-leftover";

const RequireSsoForLoginLeftover: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // The project as read, while it still requires SSO.
  const [requiringProject, setRequiringProject] = useState<Project | null>(
    null,
  );
  const projectIdString: string = props.projectId.toString();

  useEffect(() => {
    let isCurrent: boolean = true;

    setRequiringProject(null);

    ModelAPI.getItem<Project>({
      modelType: Project,
      id: props.projectId,
      select: {
        requireSsoForLogin: true,
      },
    })
      .then((project: Project | null): void => {
        if (
          isCurrent &&
          project &&
          !isPlanGatedColumnOff(
            project.getTableColumnMetadata("requireSsoForLogin"),
            project.requireSsoForLogin,
          )
        ) {
          setRequiringProject(project);
        }
      })
      .catch((): void => {
        // Nothing is drawn: the upsell is the page.
      });

    return () => {
      isCurrent = false;
    };
  }, [projectIdString]);

  if (!requiringProject) {
    return <></>;
  }

  return (
    <div data-testid={REQUIRE_SSO_FOR_LOGIN_LEFTOVER_TEST_ID}>
      <RequireSsoForLoginCard
        projectId={props.projectId}
        isPlanLeftover={true}
        initialProject={requiringProject}
      />
    </div>
  );
};

export default RequireSsoForLoginLeftover;
