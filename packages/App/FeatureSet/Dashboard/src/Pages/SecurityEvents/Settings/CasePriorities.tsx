import PageComponentProps from "../../PageComponentProps";
import { STATE_SETTINGS_COPY } from "../../../Components/StateSettings/StateSettingsCopy";
import { getStateSettingsDeleteLockedReason } from "../../../Components/StateSettings/StateSettingsRows";
import {
  getStateSettingsColumns,
  getStateSettingsFormFields,
} from "../../../Components/StateSettings/StateSettingsTable";
import useArchivableValues, {
  ArchivableValues,
} from "../../../Components/ArchivableValue/UseArchivableValues";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ArchivableValueType } from "Common/Utils/ArchivableValues";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListType,
} from "Common/Utils/StateOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.SecurityCasePriority];

/*
 * What the page calls one priority and several: "Create Case Priority"
 * under the Case Priorities title, as Case Statuses does.
 */
const SINGULAR_NAME: string = translationKey("Case Priority");
const PLURAL_NAME: string = translationKey("Case Priorities");

/*
 * Security Events > Settings > Case Priorities: how urgent a case is, the
 * project's own, most urgent first - dragged into rank, created and edited
 * from the usual form. The order is what every "at least" reads - a
 * playbook for cases at least High, a person told about cases from High up
 * (Common/Utils/SecurityCase/SecurityCasePriorities).
 *
 * Critical, High, Medium, Low and Informational are built in: each is where
 * the detections of its severity open their cases, which the Detections
 * column says, whatever the project renames it to. They are renamed and
 * recoloured, never deleted, and keep their order; a project's own -
 * "Emergency" above Critical - goes anywhere among them, and is set by
 * people and playbooks. Drawn as the incident severities are.
 */
const SecurityCasePrioritiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Archive and Unarchive, and the folded Archived section. See the hook.
  const archive: ArchivableValues<SecurityCasePriority> =
    useArchivableValues<SecurityCasePriority>({
      modelType: SecurityCasePriority,
      type: ArchivableValueType.SecurityCasePriority,
      singularName: SINGULAR_NAME,
      pluralName: PLURAL_NAME,
    });

  const [rows, setRows] = useState<Array<SecurityCasePriority>>([]);

  return (
    <Fragment>
      <ModelTable<SecurityCasePriority>
        modelType={SecurityCasePriority}
        singularName={SINGULAR_NAME}
        pluralName={PLURAL_NAME}
        query={archive.query}
        actionButtons={archive.actionButtons}
        getDeleteConfirmation={archive.getDeleteConfirmation}
        bulkActions={archive.bulkActions}
        refreshToggle={archive.refreshToggle}
        id="security-case-priority-table"
        userPreferencesKey="security-case-priority-table"
        name="Security Events > Settings > Case Priorities"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.SecurityCasePriority].title,
          description:
            STATE_SETTINGS_COPY[StateListType.SecurityCasePriority].description,
        }}
        getDeleteDisabledReason={(
          item: SecurityCasePriority,
        ): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.SecurityCasePriority],
            item: item,
          });
        }}
        onFetchSuccess={(data: Array<SecurityCasePriority>) => {
          setRows(data);
          // Every case page, list and picker reads the new list, not a cached one.
          ModelListCache.invalidate(SecurityCasePriority);
        }}
        selectMoreFields={{
          color: true,
          isCriticalPriority: true,
          isHighPriority: true,
          isMediumPriority: true,
          isLowPriority: true,
          isInformationalPriority: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<SecurityCasePriority>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.SecurityCasePriority],
          rows: rows,
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<SecurityCasePriority>(
          STATE_SETTINGS_COPY[StateListType.SecurityCasePriority],
        )}
        showRefreshButton={true}
      />
      {archive.element}
    </Fragment>
  );
};

export default SecurityCasePrioritiesPage;
