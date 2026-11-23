import BlockAddressModal from "./BlockAddressModal";
import { readBlockEnforcements } from "./BlocklistApi";
import {
  BlockActionCell,
  BlockAddedByCell,
  BlockAddressCell,
  BlockCaseCell,
  BlockEnforcedAtCell,
  BlockExpiresCell,
} from "./BlocklistCells";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
  ACTION_COLUMN_TITLE,
  ACTION_QUARANTINE_OPTION,
  ADDED_BY_COLUMN_TITLE,
  BLOCKLIST_EMPTY_TITLE,
  BLOCKLIST_TABLE_DESCRIPTION,
  BLOCKLIST_TABLE_TITLE,
  BLOCK_VERB,
  CASE_COLUMN_TITLE,
  ENFORCED_AT_COLUMN_TITLE,
  EXPIRES_COLUMN_TITLE,
  EXPIRED_LABEL,
  LIFTED_LABEL,
  STATE_FILTER_TITLE,
} from "./BlocklistCopy";
import {
  BLOCKLIST_KIND_TYPES,
  BLOCKLIST_KIND_WORDS,
  BlocklistKind,
  BlocklistKindWords,
} from "./BlocklistKinds";
import useBlocklistActions, { BlocklistActions } from "./useBlocklistActions";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "Common/Models/DatabaseModels/SecurityBlockEnforcement";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockState,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * ONE TAB OF THE BLOCKLIST (#10338, #10346): the blocks of one kind -
 * addresses and ranges, domains and URLs, or files - each with why, until
 * when, its case and who or what added it, and where it is enforced, a
 * chip per destination. The active blocks first (the State filter shows the
 * ended ones); each can be lifted, extended, or - by a Security Admin -
 * kept until someone lifts it, and several lifted at once. Its create
 * button blocks one of its kind (Block Address, Block Domain or URL, Block
 * File), refusing the project's own and protected values.
 */

/*
 * A tab's table id, which is also where a person's columns are kept: the
 * addresses' as it was before the other kinds came (#10346), so nobody's
 * saved columns reset.
 */
export function getBlocklistTableId(kind: BlocklistKind): string {
  return kind === BlocklistKind.Addresses
    ? "security-blocklist-table"
    : `security-blocklist-table-${kind}`;
}

// The actions a tab's filter offers: an address is challenged, a file quarantined.
export function getBlocklistActionFilterOptions(
  kind: BlocklistKind,
): Array<DropdownOption> {
  const options: Array<DropdownOption> = [
    { label: ACTION_BLOCK_OPTION, value: SecurityBlockAction.Block },
  ];

  if (kind === BlocklistKind.Addresses) {
    options.push({
      label: ACTION_CHALLENGE_OPTION,
      value: SecurityBlockAction.Challenge,
    });
  }

  if (kind === BlocklistKind.Files) {
    options.push({
      label: ACTION_QUARANTINE_OPTION,
      value: SecurityBlockAction.BlockAndQuarantine,
    });
  }

  return options;
}

export interface ComponentProps {
  projectId: ObjectID;
  kind: BlocklistKind;
  // Told when a block is made, lifted or changed: the page reads what enforces it again.
  onChanged: () => void;
  /*
   * How often the page has read what enforces the blocklist again - a
   * cloud WAF set up or taken down under the tabs (#10344), say: the table
   * reads its blocks again with it, for where each is enforced.
   */
  pageRefreshCount?: number | undefined;
}

const BlocklistKindTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const words: BlocklistKindWords = BLOCKLIST_KIND_WORDS[props.kind];
  const [isBlocking, setIsBlocking] = useState<boolean>(false);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [enforcements, setEnforcements] = useState<
    Map<string, Array<SecurityBlockEnforcement>>
  >(new Map());

  const refresh: () => void = (): void => {
    setRefreshCount((count: number): number => {
      return count + 1;
    });
    props.onChanged();
  };

  const actions: BlocklistActions = useBlocklistActions({ onChanged: refresh });
  const now: Date = OneUptimeDate.getCurrentDate();
  // The page's count when it keeps one: its own changes reach it through onChanged.
  const reads: number =
    props.pageRefreshCount === undefined
      ? refreshCount
      : props.pageRefreshCount;

  return (
    <>
      <ModelTable<SecurityBlock>
        modelType={SecurityBlock}
        id={getBlocklistTableId(props.kind)}
        name={
          props.kind === BlocklistKind.Addresses
            ? "Security Events > Blocklist"
            : `Security Events > Blocklist > ${props.kind}`
        }
        userPreferencesKey={getBlocklistTableId(props.kind)}
        singularName={words.singular}
        pluralName={words.plural}
        createVerb={BLOCK_VERB}
        getItemName={(block: SecurityBlock): string => {
          return block.value || "";
        }}
        query={{
          projectId: props.projectId,
          indicatorType: new Includes([...BLOCKLIST_KIND_TYPES[props.kind]]),
        }}
        // The active blocks first; the State filter shows the ended ones.
        initialFilterData={
          {
            state: [SecurityBlockState.Active],
          } as unknown as FilterData<SecurityBlock>
        }
        refreshToggle={reads > 0 ? String(reads) : ""}
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
          description: words.emptyDescription,
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
            filterDropdownOptions: getBlocklistActionFilterOptions(props.kind),
          },
        ]}
        selectMoreFields={{
          state: true,
          action: true,
          reach: true,
          indicatorType: true,
          reason: true,
          expiresAt: true,
          source: true,
          securityCaseId: true,
          createdAt: true,
          // Who made an automatic response policy's block (#10350).
          securityAutomaticResponsePolicy: {
            _id: true,
            name: true,
            kind: true,
          },
        }}
        columns={[
          {
            field: { value: true },
            title: words.valueColumnTitle,
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
          kind={props.kind}
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

export default BlocklistKindTable;
