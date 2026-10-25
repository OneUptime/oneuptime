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
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
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
  STATE_LISTS[StateListType.SecurityCaseStatus];

/*
 * What the page calls one status and several: "Create Case Status" under
 * the Case Statuses title, not the model's "Security Case Status" - the
 * menu, the breadcrumbs and the title already say it is Security Events.
 */
const SINGULAR_NAME: string = translationKey("Case Status");
const PLURAL_NAME: string = translationKey("Case Statuses");

/*
 * Security Events > Settings > Case Statuses: the project's own statuses a
 * case moves through, in the order a case comes through them - dragged into
 * order, created and edited from the usual form, each saying what a case in
 * it counts as: not acknowledged, acknowledged, contained or closed
 * (Common/Utils/SecurityCase/SecurityCaseStatuses). The new, acknowledged,
 * contained and closed statuses are built in - renamed, never deleted - and
 * keep their order (the server refuses a move that would break it, and
 * says why).
 *
 * Most projects never come here: New, Investigating, Contained and Closed
 * are the steps every case goes through. A team adds its own - "Triage",
 * "Eradicating", "Closed - Duplicate" - when its process has a step of its
 * own. Drawn as the incident states and postmortem statuses are.
 */
const SecurityCaseStatusesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Archive and Unarchive, and the folded Archived section. See the hook.
  const archive: ArchivableValues<SecurityCaseStatus> =
    useArchivableValues<SecurityCaseStatus>({
      modelType: SecurityCaseStatus,
      type: ArchivableValueType.SecurityCaseStatus,
      singularName: SINGULAR_NAME,
      pluralName: PLURAL_NAME,
    });

  // The rows on the page, which "Counts as" is worked out from.
  const [rows, setRows] = useState<Array<SecurityCaseStatus>>([]);

  return (
    <Fragment>
      <ModelTable<SecurityCaseStatus>
        modelType={SecurityCaseStatus}
        singularName={SINGULAR_NAME}
        pluralName={PLURAL_NAME}
        query={archive.query}
        actionButtons={archive.actionButtons}
        getDeleteConfirmation={archive.getDeleteConfirmation}
        refreshToggle={archive.refreshToggle}
        id="security-case-status-table"
        userPreferencesKey="security-case-status-table"
        name="Security Events > Settings > Case Statuses"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showViewIdButton={true}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus].title,
          description:
            STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus].description,
        }}
        getDeleteDisabledReason={(
          item: SecurityCaseStatus,
        ): string | undefined => {
          return getStateSettingsDeleteLockedReason({
            definition: DEFINITION,
            copy: STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus],
            item: item,
          });
        }}
        onFetchSuccess={(data: Array<SecurityCaseStatus>) => {
          setRows(data);
          // Every case page, list and picker reads the new list, not a cached one.
          ModelListCache.invalidate(SecurityCaseStatus);
        }}
        selectMoreFields={{
          color: true,
          isNewStatus: true,
          isAcknowledgedStatus: true,
          isContainedStatus: true,
          isClosedStatus: true,
        }}
        filters={[]}
        columns={getStateSettingsColumns<SecurityCaseStatus>({
          definition: DEFINITION,
          copy: STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus],
          rows: rows,
        })}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getStateSettingsFormFields<SecurityCaseStatus>(
          STATE_SETTINGS_COPY[StateListType.SecurityCaseStatus],
        )}
        showRefreshButton={true}
      />
      {archive.element}
    </Fragment>
  );
};

export default SecurityCaseStatusesPage;
