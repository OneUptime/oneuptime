import LabelsElement from "Common/UI/Components/Label/Labels";
import {
  UsedByListActions,
  getUsedByListActions,
} from "../../Components/UsedBy/UsedByListActions";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import {
  ON_CALL_POLICIES_IMPORT_OFFER,
  withToolImportOffer,
} from "../../Components/ToolImport/ToolImportOffer";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import {
  ON_CALL_POLICY_ARCHIVE_COPY,
  ARCHIVE_INSTEAD_OF_DELETE,
} from "../../Components/Archive/ResourceArchiveCopy";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import useCustomFieldFacets from "../../Components/CustomFields/useCustomFieldFacets";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import { getOnCallPolicyCreateFormFields } from "../../Components/OnCallPolicy/OnCallPolicyCreateForm";
import useEveryNewEventRulesOffer, {
  EveryNewEventRulesOffer,
} from "../../Components/OnCallPolicy/UseEveryNewEventRulesOffer";
import { JSONObject } from "Common/Types/JSON";
import useProductFirstRun, {
  ProductFirstRun,
} from "../../Components/ProductOnboarding/UseProductFirstRun";
import ProductShowcase from "../../Components/ProductOnboarding/ProductShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";
import usePagedFirst, {
  PagedFirstOfPolicies,
} from "../../Components/OnCallPolicy/PagedFirst/UsePagedFirst";
import PagedFirstCell, {
  PAGED_FIRST_COLUMN_TITLE,
  getPagedFirstExportText,
} from "../../Components/OnCallPolicy/PagedFirst/PagedFirstCell";
import useSharedNames, {
  SharedNamesOfList,
} from "../../Components/SharedName/UseSharedNames";
import { SharedNameKind } from "Common/Types/Database/SharedNames";

/*
 * Whether the user may add escalation rules, which "Who gets paged first?"
 * does for them: the policy's first rule is created as the user.
 */
const canAddEscalationRules: () => boolean = (): boolean => {
  return PermissionGate.check(
    new OnCallDutyPolicyEscalationRule(),
    ModelAction.Create,
  ).isAllowed;
};

const OnCallDutyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // Until the first one, the page explains the product under the empty table.
  const firstRun: ProductFirstRun = useProductFirstRun<OnCallDutyPolicy>({
    modelType: OnCallDutyPolicy,
    query: { isArchived: false },
  });
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<OnCallDutyPolicy>({ modelType: OnCallDutyPolicy });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<OnCallDutyPolicy>({
      ownerUserModelType: OnCallDutyPolicyOwnerUser,
      ownerTeamModelType: OnCallDutyPolicyOwnerTeam,
      resourceIdField: "onCallDutyPolicyId",
    });

  /*
   * A row's Delete and Archive, and the bulk ones, say what still uses
   * the records first (#7435).
   */
  const usedBy: UsedByListActions<OnCallDutyPolicy> =
    getUsedByListActions<OnCallDutyPolicy>(UsedByRecordKind.OnCallPolicy);

  /*
   * Policies that share a name with another policy (#9746): made before a
   * policy's name was one policy's (#9742), they keep it, and every picker
   * draws them alike. Marked beside their name, counted above the list with
   * how to tell them apart, and each given Rename. The other may be
   * archived: an archived policy keeps its name.
   */
  const sharedNames: SharedNamesOfList<OnCallDutyPolicy> =
    useSharedNames<OnCallDutyPolicy>({
      kind: SharedNameKind.OnCallPolicy,
      modelType: OnCallDutyPolicy,
    });

  // Archived policies leave this list; they are on the Archived page.
  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<OnCallDutyPolicy>({
      archiveConfirmDetails: usedBy.archiveConfirmDetails,
      getArchiveConfirmationDetails: usedBy.getArchiveConfirmationDetails,
      modelType: OnCallDutyPolicy,
      singularName: ON_CALL_POLICY_ARCHIVE_COPY.singularName,
      pluralName: ON_CALL_POLICY_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage:
        ON_CALL_POLICY_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        ON_CALL_POLICY_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
    });

  /*
   * One chip per custom field this project has defined. They arrive a render
   * or two late (the definitions are fetched), which is what
   * `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({
      customFieldsModelType: OnCallDutyPolicyCustomField,
    });

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<OnCallDutyPolicy>({
    persistKey: "on-call-policies-table",
    ownerUserModelType: OnCallDutyPolicyOwnerUser,
    ownerTeamModelType: OnCallDutyPolicyOwnerTeam,
    resourceIdField: "onCallDutyPolicyId",
    showLabelsFacet: true,
    extraFacets: customFieldFacets,
    areFacetsLoading: areCustomFieldFacetsLoading,
  });

  /*
   * "Page this policy for every new incident and alert" is offered on for a
   * project's first policy and off for a later one (#7371,
   * UseEveryNewEventRulesOffer): the list's first page says whether there is
   * a policy yet.
   */
  const everyNewEventRules: EveryNewEventRulesOffer =
    useEveryNewEventRulesOffer();

  /*
   * Who each policy pages first - its first escalation rule's schedules,
   * teams and people, a schedule with who is on call in it now - read for
   * each page the list shows (#9701, Components/OnCallPolicy/PagedFirst), so
   * nobody opens every policy to find out.
   */
  const pagedFirst: PagedFirstOfPolicies = usePagedFirst();

  /*
   * Name, who gets paged first, and the description and labels folded under
   * Advanced (OnCallPolicyCreateForm.ts). Built once, not on every render of
   * the page - and again only when the switch's start changes: on while the
   * project could be on its first policy, off once it is known to be a
   * later one.
   */
  const everyNewEventRulesStartsOn: boolean = everyNewEventRules.startsOn();

  const createFormFields: Array<ModelField<OnCallDutyPolicy>> =
    useMemo((): Array<ModelField<OnCallDutyPolicy>> => {
      return getOnCallPolicyCreateFormFields({
        canAddEscalationRules: canAddEscalationRules,
        offerEveryNewEventRules: everyNewEventRules.isOffered,
        everyNewEventRulesStartsOn: everyNewEventRulesStartsOn,
      });
    }, [everyNewEventRulesStartsOn]);

  return (
    <Fragment>
      <ModelTable<OnCallDutyPolicy>
        modelType={OnCallDutyPolicy}
        refreshToggle={`${firstRun.refreshToken}-${sharedNames.refreshToken}`}
        showCreateForm={firstRun.showCreateForm}
        /*
         * Search's Create On-Call Policy opens this list with ?create=1, and the table
         * opens its create form from it (#7035).
         */
        opensCreateFormFromAddress={true}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[sharedNames.renameAction, ...archiveRowActions]}
        enableJsonImportExport={true}
        id="on-call-duty-table"
        userPreferencesKey="on-call-duty-table"
        customFieldsModelType={OnCallDutyPolicyCustomField}
        topContent={firstRun.getTopContent(
          <Fragment>
            {sharedNames.note}
            {filterBar}
          </Fragment>,
        )}
        /*
         * Beside the empty list's Create, a link to bring the policies over
         * from PagerDuty, Opsgenie and the rest (ToolImportOffer).
         */
        emptyState={withToolImportOffer({
          emptyState: firstRun.getEmptyState(facetEmptyState),
          offer: ON_CALL_POLICIES_IMPORT_OFFER,
          translator: translator,
        })}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<OnCallDutyPolicy>) => {
          onResourcesFetched(data);
          everyNewEventRules.onPoliciesListed(data.length);
          pagedFirst.onPoliciesFetched(data);
          sharedNames.onListFetched();
        }}
        saveFilterProps={{
          tableId: "on-call-policies-table",
        }}
        isDeleteable={true}
        getDeleteConfirmation={usedBy.getDeleteConfirmation}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        name="On-Call > Policies"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
          deleteConfirmationDetails: usedBy.deleteConfirmationDetails,
        }}
        cardProps={{
          title: "On-Call Policies",
          description:
            "On-call policies decide who is notified when an incident or alert opens, and who is next if nobody acknowledges it.",
          titleGlossaryTerm: GlossaryTerm.OnCallPolicy,
        }}
        videoLink={URL.fromString("https://youtu.be/HzhKmCryYdc")}
        formFields={createFormFields}
        onBeforeCreate={(
          item: OnCallDutyPolicy,
          miscDataProps: JSONObject,
        ): Promise<OnCallDutyPolicy> => {
          everyNewEventRules.prepareCreate(miscDataProps);
          return Promise.resolve(item);
        }}
        onCreateSuccess={(
          item: OnCallDutyPolicy,
        ): Promise<OnCallDutyPolicy> => {
          firstRun.onRecordCreated();
          /*
           * A new policy opens on its Escalation Rules: Level 1 is there when
           * someone was picked to be paged first, and adding the first rule
           * is the one thing to do when nobody was.
           */
          if (item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }

          return Promise.resolve(item);
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },

          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
        columns={[
          // The policy's name, marked when another policy shares it (#9746).
          sharedNames.nameColumn,
          /*
           * Right after the name: who gets paged first is what the list is
           * opened for, on a phone's card too. Drawn from the policy's id,
           * so it does not sort (a column of several people would not), and
           * exported as the names it shows.
           */
          {
            field: {
              _id: true,
            },
            title: PAGED_FIRST_COLUMN_TITLE,
            type: FieldType.Element,
            getExportValue: (item: OnCallDutyPolicy): string => {
              return getPagedFirstExportText(
                pagedFirst.getPagedFirst(item),
                translator,
              );
            },
            getElement: (item: OnCallDutyPolicy): ReactElement => {
              return (
                <PagedFirstCell
                  pagedFirst={pagedFirst.getPagedFirst(item)}
                  isLoading={pagedFirst.isLoading}
                />
              );
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,

            getElement: (item: OnCallDutyPolicy): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: OnCallDutyPolicy): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />
      {firstRun.isFirstRun && (
        <ProductShowcase
          product={ProductKey.OnCall}
          // The empty table above says what the list is for.
          hidesDescription={true}
          startButton={firstRun.startButton}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
      {sharedNames.renameModal}
    </Fragment>
  );
};

export default OnCallDutyPage;
