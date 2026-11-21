import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import BlockAddressModal from "../../Components/SecurityEvents/Blocklist/BlockAddressModal";
import {
  BlocklistDestinations,
  readBlockEnforcements,
  readBlocklistDestinations,
} from "../../Components/SecurityEvents/Blocklist/BlocklistApi";
import {
  BlockActionCell,
  BlockAddedByCell,
  BlockAddressCell,
  BlockCaseCell,
  BlockEnforcedAtCell,
  BlockExpiresCell,
} from "../../Components/SecurityEvents/Blocklist/BlocklistCells";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
  ACTION_COLUMN_TITLE,
  ADDED_BY_COLUMN_TITLE,
  ADDRESS_COLUMN_TITLE,
  BLOCKLIST_EMPTY_DESCRIPTION,
  BLOCKLIST_EMPTY_TITLE,
  BLOCKLIST_TABLE_DESCRIPTION,
  BLOCKLIST_TABLE_TITLE,
  BLOCK_PLURAL,
  BLOCK_SINGULAR,
  BLOCK_VERB,
  CASE_COLUMN_TITLE,
  ENFORCED_AT_COLUMN_TITLE,
  EXPIRES_COLUMN_TITLE,
  EXPIRED_LABEL,
  LIFTED_LABEL,
  STATE_FILTER_TITLE,
} from "../../Components/SecurityEvents/Blocklist/BlocklistCopy";
import BlocklistNotEnforcedNotice from "../../Components/SecurityEvents/Blocklist/BlocklistNotEnforcedNotice";
import BlocklistFeedsStoppedNotice from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedsStoppedNotice";
import useBlocklistActions, {
  BlocklistActions,
} from "../../Components/SecurityEvents/Blocklist/useBlocklistActions";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "Common/Models/DatabaseModels/SecurityBlockEnforcement";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockState,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * SECURITY EVENTS > PLAYBOOKS > BLOCKLIST (#10338): what the project blocks
 * - each address or range, why, until when, its case and who or what added
 * it - and where each block is enforced, a chip per destination with where
 * the block stands there. The active blocks first (the State filter shows
 * the ended ones); each can be lifted, extended, or - by a Security Admin -
 * kept until someone lifts it, and several lifted at once. Block Address
 * makes one, refusing the project's own and protected addresses.
 *
 * While nothing enforces the blocklist, the page says so above the list,
 * with where to connect what would: a block nothing holds blocks nothing.
 */
const SecurityBlocklistPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [isBlocking, setIsBlocking] = useState<boolean>(false);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [destinations, setDestinations] =
    useState<BlocklistDestinations | null>(null);
  const [enforcements, setEnforcements] = useState<
    Map<string, Array<SecurityBlockEnforcement>>
  >(new Map());

  const refresh: () => void = (): void => {
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  const actions: BlocklistActions = useBlocklistActions({ onChanged: refresh });

  useEffect(() => {
    let isCurrent: boolean = true;

    readBlocklistDestinations()
      .then((found: BlocklistDestinations) => {
        if (isCurrent) {
          setDestinations(found);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setDestinations({ destinations: [], cannotTell: true });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshCount]);

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  if (!projectId) {
    return <></>;
  }

  const now: Date = OneUptimeDate.getCurrentDate();

  return (
    <>
      {destinations &&
      (destinations.cannotTell || destinations.destinations.length === 0) ? (
        <BlocklistNotEnforcedNotice cannotTell={destinations.cannotTell} />
      ) : (
        <></>
      )}

      {/* A firewall that stopped reading its feed: its blocks are not enforced there (#10345). */}
      <BlocklistFeedsStoppedNotice refreshToggle={String(refreshCount)} />

      <ModelTable<SecurityBlock>
        modelType={SecurityBlock}
        id="security-blocklist-table"
        name="Security Events > Blocklist"
        userPreferencesKey="security-blocklist-table"
        singularName={BLOCK_SINGULAR}
        pluralName={BLOCK_PLURAL}
        createVerb={BLOCK_VERB}
        getItemName={(block: SecurityBlock): string => {
          return block.value || "";
        }}
        query={{ projectId: projectId }}
        // The active blocks first; the State filter shows the ended ones.
        initialFilterData={
          {
            state: [SecurityBlockState.Active],
          } as unknown as FilterData<SecurityBlock>
        }
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={false}
        onCreateClick={() => {
          setIsBlocking(true);
        }}
        actionButtons={actions.actionButtons}
        bulkActions={{ buttons: [actions.bulkLift] }}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: BLOCKLIST_TABLE_TITLE,
          description: BLOCKLIST_TABLE_DESCRIPTION,
        }}
        emptyState={{
          title: BLOCKLIST_EMPTY_TITLE,
          description: BLOCKLIST_EMPTY_DESCRIPTION,
          icon: IconProp.NoSymbol,
        }}
        onFetchSuccess={(blocks: Array<SecurityBlock>) => {
          readBlockEnforcements(
            blocks
              .map((block: SecurityBlock): ObjectID | undefined => {
                return block.id || undefined;
              })
              .filter((id: ObjectID | undefined): id is ObjectID => {
                return Boolean(id);
              }),
          )
            .then(setEnforcements)
            .catch(() => {
              setEnforcements(new Map());
            });
        }}
        showRefreshButton={true}
        searchableFields={["value", "reason"]}
        filters={[
          {
            field: { state: true },
            title: STATE_FILTER_TITLE,
            type: FieldType.Dropdown,
            filterDropdownOptions: [
              { label: "Active", value: SecurityBlockState.Active },
              { label: LIFTED_LABEL, value: SecurityBlockState.Lifted },
              { label: EXPIRED_LABEL, value: SecurityBlockState.Expired },
            ],
          },
          {
            field: { action: true },
            title: ACTION_COLUMN_TITLE,
            type: FieldType.Dropdown,
            filterDropdownOptions: [
              { label: ACTION_BLOCK_OPTION, value: SecurityBlockAction.Block },
              {
                label: ACTION_CHALLENGE_OPTION,
                value: SecurityBlockAction.Challenge,
              },
            ],
          },
        ]}
        selectMoreFields={{
          state: true,
          action: true,
          reason: true,
          expiresAt: true,
          source: true,
          securityCaseId: true,
          createdAt: true,
        }}
        columns={[
          {
            field: { value: true },
            title: ADDRESS_COLUMN_TITLE,
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[16rem]",
            getElement: (block: SecurityBlock): ReactElement => {
              return <BlockAddressCell block={block} />;
            },
          },
          {
            field: { action: true },
            title: ACTION_COLUMN_TITLE,
            type: FieldType.Element,
            getElement: (block: SecurityBlock): ReactElement => {
              return <BlockActionCell block={block} />;
            },
          },
          {
            field: { state: true },
            title: ENFORCED_AT_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[16rem]",
            getElement: (block: SecurityBlock): ReactElement => {
              return (
                <BlockEnforcedAtCell
                  block={block}
                  enforcements={
                    enforcements.get(block.id?.toString() || "") || []
                  }
                  now={now}
                />
              );
            },
          },
          {
            field: { expiresAt: true },
            title: EXPIRES_COLUMN_TITLE,
            type: FieldType.Element,
            getElement: (block: SecurityBlock): ReactElement => {
              return <BlockExpiresCell block={block} />;
            },
          },
          {
            field: { securityCase: { caseNumberWithPrefix: true } },
            title: CASE_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (block: SecurityBlock): ReactElement => {
              return <BlockCaseCell block={block} />;
            },
          },
          {
            field: {
              createdByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: ADDED_BY_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (block: SecurityBlock): ReactElement => {
              return <BlockAddedByCell block={block} />;
            },
          },
        ]}
      />

      {isBlocking ? (
        <BlockAddressModal
          onClose={() => {
            setIsBlocking(false);
          }}
          onBlocked={() => {
            setIsBlocking(false);
            refresh();
          }}
        />
      ) : (
        <></>
      )}

      {actions.modal}
    </>
  );
};

export default SecurityBlocklistPage;
