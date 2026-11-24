import {
  AUTOMATIC_RESPONSE_TEST_IDS,
  HOURLY_LIMIT_CARD_KEY,
  HOURLY_LIMIT_COLUMN,
  HOURLY_LIMIT_DESCRIPTION,
  HOURLY_LIMIT_FIELD_DESCRIPTION,
  HOURLY_LIMIT_FIELD_TITLE,
  HOURLY_LIMIT_TITLE,
} from "./AutomaticResponseCopy";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../../Pages/Settings/ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN,
  getSecurityAutomaticResponseHourlyLimitError,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // A new limit was saved: the page reads what its notice and guardrails say again.
  onSaved?: (() => void) | undefined;
}

/*
 * THE HOURLY LIMIT OF AUTOMATIC BLOCKS (#10746), under the Automatic
 * Response page's More settings: the most automatic blocks the project's
 * policies make in an hour - 50 unless changed, a whole number from 1 to
 * 500 - before they stop and page the security owners. Checked as it is
 * typed and again by the server (ProjectService.applySecurityAutomatic
 * ResponseLimitRules), and read by every decision from then on
 * (SecurityAutomaticResponseLimit).
 *
 * A Security Admin sets it, as they turn the policies on, and so do a
 * Project Owner and a Project Admin; anyone else sees it, locked, with
 * what would let them change it.
 */
const AutomaticResponseHourlyLimitCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  const gate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: [HOURLY_LIMIT_COLUMN],
    buttonTitle: "Edit",
  });

  return (
    <div data-testid={AUTOMATIC_RESPONSE_TEST_IDS.hourlyLimit}>
      <CardModelDetail<Project>
        name="Automatic Response Hourly Limit"
        cardProps={{
          title: HOURLY_LIMIT_TITLE,
          description: HOURLY_LIMIT_DESCRIPTION,
          buttons: gate.lockedButtons,
          id: HOURLY_LIMIT_CARD_KEY,
        }}
        isEditable={gate.isEditable}
        editButtonText="Edit"
        editModalTitle={HOURLY_LIMIT_TITLE}
        onSaveSuccess={() => {
          props.onSaved?.();
        }}
        formFields={[
          {
            field: { securityAutomaticResponseMaxBlocksPerHour: true },
            title: HOURLY_LIMIT_FIELD_TITLE,
            description: HOURLY_LIMIT_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: String(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR),
            validation: {
              minValue: SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN,
              maxValue: SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX,
            },
            customValidation: (values: FormValues<Project>): string | null => {
              const error: string | null =
                getSecurityAutomaticResponseHourlyLimitError(
                  (values as Record<string, unknown>)[HOURLY_LIMIT_COLUMN],
                );

              return error ? translator.translateText(error) || error : null;
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-automatic-response-hourly-limit",
          modelId: projectId,
          fields: [
            {
              field: { securityAutomaticResponseMaxBlocksPerHour: true },
              title: HOURLY_LIMIT_FIELD_TITLE,
              fieldType: FieldType.Number,
            },
          ],
        }}
      />
    </div>
  );
};

export default AutomaticResponseHourlyLimitCard;
