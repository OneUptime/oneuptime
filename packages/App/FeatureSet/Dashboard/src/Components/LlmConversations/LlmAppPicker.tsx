import Service from "Common/Models/DatabaseModels/Service";
import Select from "Common/Types/BaseDatabase/Select";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import {
  getHeldValue,
  HeldValueOptions,
  useHeldValueOptions,
} from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { SERVICE_COLOR_FIELD } from "../Telemetry/TelemetryServiceScope";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE AI CONVERSATIONS' APP FILTER, SEARCHED ON THE SERVER (#10764).
 *
 * The filter offered the project's first 10,000 apps (telemetry services)
 * by name: an app past them could not be picked, and one a link held showed
 * nothing while the list was still narrowed by it. The picker searches the
 * server as it is typed in (EntityDropdown), 50 by name, archived apps too -
 * they keep sending calls - marked Archived. The app a link holds is named
 * by its id before the picker is drawn (HeldValueOptions), one deleted since
 * reading "No longer available", to keep or clear.
 *
 * A project with no app has nothing to filter by, and draws no filter, as
 * before: one row and the count say whether it has any.
 */

/*
 * What the held app is read with: its name, its colour (the dot a picked
 * one draws too) and whether it is archived.
 */
export const LLM_APP_HELD_SELECT: Select<BaseModel> = {
  _id: true,
  name: true,
  serviceColor: true,
  isArchived: true,
} as Select<BaseModel>;

export interface ComponentProps {
  // The app the list is narrowed to; "" for every app.
  serviceId: string;
  onChange: (serviceId: string) => void;
}

const LlmAppPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hasApps, setHasApps] = useState<boolean>(false);

  const held: HeldValueOptions = useHeldValueOptions({
    modelType: Service,
    ids: props.serviceId ? [props.serviceId] : [],
    select: LLM_APP_HELD_SELECT,
    colorField: SERVICE_COLOR_FIELD,
    notFoundLabel: ENTITY_DROPDOWN_NOT_FOUND_LABEL,
  });

  // Whether the project has an app at all: one row and the count.
  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getList<Service>({
      modelType: Service,
      query: {},
      select: { _id: true },
      limit: 1,
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<Service>): void => {
        if (isCurrent) {
          setHasApps((result.count ?? 0) > 0 || result.data.length > 0);
        }
      })
      .catch((): void => {
        // Unread, the filter is drawn only for an app a link holds.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  // Nothing to filter by, and nothing held: no filter, as before.
  if (!props.serviceId && !hasApps) {
    return <></>;
  }

  return (
    <div data-testid="llm-conversations-app">
      {props.serviceId && !held.options ? (
        // Drawn once the app it holds is named: never its bare id.
        <InlineValueSkeleton widthClassName="w-48" />
      ) : (
        <EntityDropdown
          modelType={Service}
          labelField="name"
          valueField="_id"
          className="relative w-48 max-w-full"
          listsArchivedValues={true}
          marksArchivedRecords={true}
          notFoundLabel={ENTITY_DROPDOWN_NOT_FOUND_LABEL}
          ariaLabel={translator.translateText("App")}
          // Every app is the placeholder; clearing the picker returns to it.
          placeholder={translator.translateText("All apps")}
          isPlaceholderTranslated={true}
          value={
            getHeldValue({
              ids: props.serviceId ? [props.serviceId] : [],
              options: held.options,
            }) as EntityDropdownValue
          }
          onChange={(
            next: DropdownValue | Array<DropdownValue> | null,
            change: DropdownChange,
          ): void => {
            // An app just picked is named by the search that offered it.
            held.remember(change.selectedOptions);

            const serviceId: string =
              next === null || next === undefined || Array.isArray(next)
                ? ""
                : String(next);

            if (serviceId !== props.serviceId) {
              props.onChange(serviceId);
            }
          }}
        />
      )}
    </div>
  );
};

export default LlmAppPicker;
