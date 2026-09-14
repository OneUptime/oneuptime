import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallPolicyOwnerTeam from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildBooleanFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import ModelAPI, { type ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  getCompactPhoneNumberSummary,
  getIncomingCallPolicyPhoneNumberText,
  groupIncomingCallPolicyPhoneNumbers,
  includeLegacyIncomingCallPolicyPhoneNumber,
  type CompactPhoneNumberSummary,
  type IncomingCallPolicyPhoneNumbersByPolicyId,
} from "../../Components/CallSMS/IncomingCallPolicyPhoneNumberUtil";

const IncomingCallPoliciesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [phoneNumbersByPolicyId, setPhoneNumbersByPolicyId] =
    useState<IncomingCallPolicyPhoneNumbersByPolicyId>({});
  const [isLoadingPhoneNumbers, setIsLoadingPhoneNumbers] =
    useState<boolean>(false);
  const [phoneNumbersError, setPhoneNumbersError] = useState<string>("");
  const phoneNumberRequestId: React.MutableRefObject<number> =
    useRef<number>(0);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<IncomingCallPolicy>({ modelType: IncomingCallPolicy });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<IncomingCallPolicy>({
      ownerUserModelType: IncomingCallPolicyOwnerUser,
      ownerTeamModelType: IncomingCallPolicyOwnerTeam,
      resourceIdField: "incomingCallPolicyId",
    });

  const incomingCallPolicyExtraFacets: Array<ResourceFacet> = [
    {
      key: "isEnabled",
      label: "Enabled",
      icon: IconProp.Power,
      isMultiSelect: false,
      options: [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" },
      ],
      supportedOperators: ["is", "is_not"],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildBooleanFacetQuery(values, operator);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<IncomingCallPolicy>({
    persistKey: "incoming-call-policies-table",
    ownerUserModelType: IncomingCallPolicyOwnerUser,
    ownerTeamModelType: IncomingCallPolicyOwnerTeam,
    resourceIdField: "incomingCallPolicyId",
    showLabelsFacet: true,
    extraFacets: incomingCallPolicyExtraFacets,
  });

  const fetchPhoneNumbersForPolicies: (
    policies: Array<IncomingCallPolicy>,
  ) => Promise<void> = async (
    policies: Array<IncomingCallPolicy>,
  ): Promise<void> => {
    const requestId: number = ++phoneNumberRequestId.current;
    const policyIds: Array<ObjectID> = [];

    for (const policy of policies) {
      if (policy.id) {
        policyIds.push(policy.id);
      }
    }

    if (policyIds.length === 0) {
      setPhoneNumbersByPolicyId({});
      setPhoneNumbersError("");
      setIsLoadingPhoneNumbers(false);
      return;
    }

    try {
      setIsLoadingPhoneNumbers(true);
      setPhoneNumbersError("");

      const result: ListResult<IncomingCallPolicyPhoneNumber> =
        await ModelAPI.getList<IncomingCallPolicyPhoneNumber>({
          modelType: IncomingCallPolicyPhoneNumber,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            incomingCallPolicyId: new Includes(policyIds),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            incomingCallPolicyId: true,
            phoneNumber: true,
            callProviderPhoneNumberId: true,
            countryCode: true,
            areaCode: true,
            phoneNumberPurchasedAt: true,
          },
          sort: {
            phoneNumberPurchasedAt: SortOrder.Ascending,
          },
        });

      if (requestId !== phoneNumberRequestId.current) {
        return;
      }

      const groupedPhoneNumbers: IncomingCallPolicyPhoneNumbersByPolicyId =
        groupIncomingCallPolicyPhoneNumbers(result.data);

      for (const policy of policies) {
        if (!policy.id) {
          continue;
        }

        const policyId: string = policy.id.toString();
        groupedPhoneNumbers[policyId] =
          includeLegacyIncomingCallPolicyPhoneNumber(
            groupedPhoneNumbers[policyId] || [],
            policy,
          );
      }

      setPhoneNumbersByPolicyId(groupedPhoneNumbers);
      setIsLoadingPhoneNumbers(false);
    } catch (err) {
      if (requestId !== phoneNumberRequestId.current) {
        return;
      }

      setPhoneNumbersByPolicyId({});
      setPhoneNumbersError(API.getFriendlyMessage(err));
      setIsLoadingPhoneNumbers(false);
    }
  };

  return (
    <Fragment>
      <ModelTable<IncomingCallPolicy>
        modelType={IncomingCallPolicy}
        id="incoming-call-policy-table"
        userPreferencesKey="incoming-call-policy-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<IncomingCallPolicy>) => {
          onResourcesFetched(data);
          void fetchPhoneNumbersForPolicies(data);
        }}
        saveFilterProps={{
          tableId: "incoming-call-policies-table",
        }}
        isDeleteable={false}
        name="On-Call > Incoming Call Policies"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        cardProps={{
          title: "Incoming Call Policies",
          description:
            "Configure incoming call routing policies for your on-call teams. Purchase phone numbers and set up escalation rules.",
        }}
        noItemsMessage={"No incoming call policy found."}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g., Production Support Hotline",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of this incoming call policy",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
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
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              _id: true,
              projectId: true,
              projectCallSMSConfigId: true,
              routingPhoneNumber: true,
              callProviderPhoneNumberId: true,
              phoneNumberCountryCode: true,
              phoneNumberAreaCode: true,
              phoneNumberPurchasedAt: true,
            },
            title: "Phone Numbers",
            type: FieldType.Element,
            /*
             * The cell renders from a second request rather than from this
             * column's own fields, so sorting by them is meaningless and the
             * CSV would otherwise export the raw ids they declare.
             */
            disableSort: true,
            getExportValue: (item: IncomingCallPolicy): string => {
              const policyId: string = item.id?.toString() || "";
              const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> =
                phoneNumbersByPolicyId[policyId] || [];
              const phoneNumberTexts: Array<string> = phoneNumbers
                .map(getIncomingCallPolicyPhoneNumberText)
                .filter((phoneNumber: string): boolean => {
                  return Boolean(phoneNumber);
                });

              if (phoneNumberTexts.length > 0) {
                return phoneNumberTexts.join("; ");
              }

              return item.routingPhoneNumber?.toString() || "";
            },
            getElement: (item: IncomingCallPolicy): ReactElement => {
              const policyId: string = item.id?.toString() || "";
              const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> =
                phoneNumbersByPolicyId[policyId] || [];

              /*
               * Until the attachment request lands (or when it fails) the row
               * already carries the legacy scalar number, so show that rather
               * than blanking a cell that has something true to display.
               */
              const legacyPhoneNumber: string =
                item.routingPhoneNumber?.toString() || "";

              if (
                (isLoadingPhoneNumbers || phoneNumbersError) &&
                phoneNumbers.length === 0
              ) {
                if (legacyPhoneNumber) {
                  return (
                    <div className="flex items-center space-x-2 min-w-0">
                      <Icon
                        icon={IconProp.Call}
                        className="h-4 w-4 text-green-500 flex-shrink-0"
                      />
                      <span className="font-mono truncate">
                        {legacyPhoneNumber}
                      </span>
                    </div>
                  );
                }

                if (isLoadingPhoneNumbers) {
                  return <span className="text-gray-500">Loading…</span>;
                }

                return (
                  <span className="text-red-600" title={phoneNumbersError}>
                    Unavailable
                  </span>
                );
              }

              const summary: CompactPhoneNumberSummary =
                getCompactPhoneNumberSummary(phoneNumbers);

              if (summary.visiblePhoneNumbers.length > 0) {
                return (
                  <div className="flex items-center space-x-2 min-w-0">
                    <Icon
                      icon={IconProp.Call}
                      className="h-4 w-4 text-green-500 flex-shrink-0"
                    />
                    <span className="font-mono truncate">
                      {summary.visiblePhoneNumbers[0]}
                    </span>
                    {summary.additionalPhoneNumbersCount > 0 ? (
                      <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        +{summary.additionalPhoneNumbersCount} more
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              }
              return (
                <div className="flex items-center space-x-2">
                  <Icon
                    icon={IconProp.ExclaimationCircle}
                    className="h-4 w-4 text-yellow-500"
                  />
                  <span className="text-yellow-600 font-medium">
                    Setup Needed
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncomingCallPolicy): ReactElement => {
              if (item.isEnabled) {
                return <Pill text="Enabled" color={Green} />;
              }
              return <Pill text="Disabled" color={Red} />;
            },
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
            getElement: (item: IncomingCallPolicy): ReactElement => {
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
            getElement: (item: IncomingCallPolicy): ReactElement => {
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
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default IncomingCallPoliciesPage;
