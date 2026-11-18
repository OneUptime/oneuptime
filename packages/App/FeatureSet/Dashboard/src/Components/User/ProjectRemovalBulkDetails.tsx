import { PROJECT_REMOVAL_LOCK_COPY } from "../../Utils/ProjectRemovalReach";
import TeamMembershipRemoval from "../../Utils/TeamMembershipRemoval";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { PersonKeptInProject } from "Common/Types/Team/ProjectRemovalReach";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * IN A BULK REMOVE FROM PROJECT'S DIALOG: WHO STAYS (#6599).
 *
 * The selected people the reader's Remove from Project would leave in the
 * project (Utils/ProjectRemovalReach) are skipped, and listed among those
 * not removed once it has run. The dialog says so before it runs, under
 * the names of everyone selected: how many stay, and who.
 */

export const PROJECT_REMOVAL_BULK_DETAILS_TEST_ID: string =
  "project-removal-bulk-kept";

export interface ComponentProps {
  items: Array<TeamMember>;
  getPersonKept: (row: TeamMember) => PersonKeptInProject | undefined;
}

const ProjectRemovalBulkDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const kept: Array<TeamMember> = props.items.filter(
    (item: TeamMember): boolean => {
      return Boolean(props.getPersonKept(item));
    },
  );

  if (kept.length === 0) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId={PROJECT_REMOVAL_BULK_DETAILS_TEST_ID}
      title={
        <div>
          <p>
            {translator.translatePlural(
              PROJECT_REMOVAL_LOCK_COPY.bulkIntro,
              kept.length,
            )}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {kept.map((item: TeamMember, index: number): ReactElement => {
              return (
                <li
                  key={`${index}-${item.id?.toString() || ""}`}
                  className="break-words font-medium"
                  data-testid="project-removal-bulk-kept-person"
                >
                  {TeamMembershipRemoval.getUserLabel(item.user)}
                </li>
              );
            })}
          </ul>
        </div>
      }
    />
  );
};

export default ProjectRemovalBulkDetails;
