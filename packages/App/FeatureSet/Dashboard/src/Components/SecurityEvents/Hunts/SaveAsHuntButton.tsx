import {
  HUNTS_TEST_IDS,
  SAVES_THIS_SEARCH,
  SAVE_AS_HUNT,
  SAVE_AS_HUNT_DESCRIPTION,
  SAVE_AS_HUNT_NOTHING_TO_SAVE,
  SAVE_HUNT,
} from "./HuntsCopy";
import { HuntSearchLine } from "./HuntCells";
import {
  getNewHuntInitialValues,
  getSaveAsHuntFormFields,
} from "./HuntFormFields";
import {
  HuntSearchState,
  getHuntValuesToSave,
  getHuntViewRoute,
  hasHuntSearchToSave,
} from "./HuntsModel";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityHuntFilters } from "Common/Types/SecurityEvent/SecurityHunt";
import TimeRange from "Common/Types/Time/TimeRange";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // What the Events explorer is searching right now.
  state: HuntSearchState;
}

// What Save as Hunt saves, held from the moment the dialog opens.
interface ValuesToSave {
  searchQuery: string;
  filters: SecurityHuntFilters;
  timeRange: TimeRange;
}

/*
 * "Save as Hunt", on the Events explorer's toolbar: the search on screen -
 * its text, its chips and how far back it looks - kept with a name, to open
 * again from Security Events > Hunts, and run on a schedule if the person
 * chooses one. The dialog says what it saves over its fields, and a new
 * hunt opens on its page. Locked, saying why, with nothing to save or for a
 * role that may not save hunts.
 */
const SaveAsHuntButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [toSave, setToSave] = useState<ValuesToSave | null>(null);

  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Create,
  );
  const hasSearch: boolean = hasHuntSearchToSave(props.state);

  let tooltip: string | undefined = undefined;

  if (!gate.isAllowed) {
    tooltip = gate.disabledReason;
  } else if (!hasSearch) {
    tooltip =
      translator.translateText(SAVE_AS_HUNT_NOTHING_TO_SAVE) ||
      SAVE_AS_HUNT_NOTHING_TO_SAVE;
  }

  return (
    <>
      <Button
        title={SAVE_AS_HUNT}
        icon={IconProp.ViewfinderCircle}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        disabled={!gate.isAllowed || !hasSearch}
        tooltip={tooltip}
        dataTestId={HUNTS_TEST_IDS.saveAsHunt}
        onClick={() => {
          setToSave(getHuntValuesToSave(props.state));
        }}
      />
      {toSave ? (
        <ModelFormModal<SecurityHunt>
          modelType={SecurityHunt}
          name="security-events-save-as-hunt"
          title={SAVE_AS_HUNT}
          description={
            <div className="space-y-3">
              <p>
                {translator.translateText(SAVE_AS_HUNT_DESCRIPTION) ||
                  SAVE_AS_HUNT_DESCRIPTION}
              </p>
              <div
                className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                data-testid={HUNTS_TEST_IDS.saveSummary}
              >
                <p className="text-xs font-medium text-gray-500">
                  {translator.translateText(SAVES_THIS_SEARCH) ||
                    SAVES_THIS_SEARCH}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <HuntSearchLine
                    searchQuery={toSave.searchQuery}
                    filters={toSave.filters}
                  />
                  <span className="whitespace-nowrap text-xs text-gray-500">
                    {translator.translateText(toSave.timeRange) ||
                      toSave.timeRange}
                  </span>
                </div>
              </div>
            </div>
          }
          submitButtonText={SAVE_HUNT}
          onClose={() => {
            setToSave(null);
          }}
          onBeforeCreate={async (item: SecurityHunt): Promise<SecurityHunt> => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (projectId) {
              item.projectId = projectId;
            }

            item.searchQuery = toSave.searchQuery;
            item.filters = toSave.filters as unknown as JSONObject;
            item.timeRange = toSave.timeRange;

            return item;
          }}
          onSuccess={(created: SecurityHunt) => {
            setToSave(null);

            if (created._id) {
              Navigation.navigate(getHuntViewRoute(created._id.toString()));
            }
          }}
          formProps={{
            name: "security-events-save-as-hunt-form",
            modelType: SecurityHunt,
            id: "security-events-save-as-hunt-form",
            formType: FormType.Create,
            fields: getSaveAsHuntFormFields({ translator }),
            initialValues: getNewHuntInitialValues({
              userId: UserUtil.getUserId(),
              timeRange: toSave.timeRange,
            }),
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SaveAsHuntButton;
