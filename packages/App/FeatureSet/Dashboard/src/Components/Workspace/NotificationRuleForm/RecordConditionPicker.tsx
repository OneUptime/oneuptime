import { VALUE_NOT_FOUND_NAME } from "./NotificationRuleConditionWords";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Select from "Common/Types/BaseDatabase/Select";
import { NotificationRuleConditionCheckOn } from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { RuleCriteriaCopy } from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import RecordsById from "Common/UI/Utils/RecordsById";
import { getSharedNameSelect } from "Common/UI/Utils/SharedNameOptions";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A WORKSPACE RULE'S OR SUMMARY'S RECORD CONDITION, SEARCHED ON THE SERVER
 * (#10646, #10689): "Monitor is any of ...", "Incident Labels are any of
 * ...", an SLO rule's SLOs, an on-call rule's policies.
 *
 * The rules and summaries pages read every monitor, label, SLO and policy
 * of the project - the first 10,000 by name - to offer them here and to
 * name the ones a condition holds. One past them could not be picked, and
 * one a condition held read "No longer in this project".
 *
 * The picker searches the server as it is typed in, 50 by name
 * (EntityDropdown), and never offers an archived value (#7582). What the
 * condition holds is read by its ids: an archived one stays, marked
 * Archived, to keep or take out, and one deleted since is a chip of its
 * own in the card's words, "No longer in this project" (#7807). Nothing
 * changes until the condition does.
 */

export interface RecordConditionKind {
  modelType: { new (): BaseModel };
  /*
   * Only these are offered: never an archived one. A label is left out by
   * EntityDropdown itself (ArchivedValuePicker); the others say so here.
   */
  query: Record<string, unknown>;
  // What a held one is read with, beside its name: whether it is archived.
  select: Select<BaseModel>;
}

// Archived records are retired: never offered for a new pick.
export const MONITOR_CONDITION_QUERY: Record<string, unknown> = {
  isArchived: false,
};

const MONITOR_KIND: RecordConditionKind = {
  modelType: Monitor,
  query: MONITOR_CONDITION_QUERY,
  select: { _id: true, name: true, isArchived: true } as Select<BaseModel>,
};

const LABEL_KIND: RecordConditionKind = {
  modelType: Label,
  // EntityDropdown leaves archived labels out (ArchivedValuePicker).
  query: {},
  select: {
    _id: true,
    name: true,
    color: true,
    isArchived: true,
    // What tells labels of one name apart (#10064).
    ...getSharedNameSelect(Label),
  } as Select<BaseModel>,
};

const SLO_KIND: RecordConditionKind = {
  modelType: ServiceLevelObjective,
  query: { isArchived: false },
  select: { _id: true, name: true, isArchived: true } as Select<BaseModel>,
};

const ON_CALL_POLICY_KIND: RecordConditionKind = {
  modelType: OnCallDutyPolicy,
  query: { isArchived: false },
  select: {
    _id: true,
    name: true,
    isArchived: true,
    // What tells policies of one name apart (#10064).
    ...getSharedNameSelect(OnCallDutyPolicy),
  } as Select<BaseModel>,
};

/*
 * The record conditions searched on the server, by their field: every
 * field whose values are a kind of the project's records that can pass
 * 10,000. A state, a severity, a status or a case's priority is one of a
 * short list the page reads whole.
 */
export const RECORD_CONDITION_KINDS: Partial<
  Record<NotificationRuleConditionCheckOn, RecordConditionKind>
> = {
  [NotificationRuleConditionCheckOn.Monitors]: MONITOR_KIND,
  [NotificationRuleConditionCheckOn.MonitorLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.IncidentLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.AlertLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.AlertEpisodeLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.IncidentEpisodeLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.SecurityCaseLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.SloLabels]: LABEL_KIND,
  [NotificationRuleConditionCheckOn.Slos]: SLO_KIND,
  [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: ON_CALL_POLICY_KIND,
};

// The kind of record a field's values are, when it is searched on the server.
export const getRecordConditionKind: (
  checkOn: NotificationRuleConditionCheckOn | undefined,
) => RecordConditionKind | undefined = (
  checkOn: NotificationRuleConditionCheckOn | undefined,
): RecordConditionKind | undefined => {
  return checkOn ? RECORD_CONDITION_KINDS[checkOn] : undefined;
};

export interface ComponentProps {
  kind: RecordConditionKind;
  ids: Array<string>;
  onChange: (ids: Array<string>) => void;
  id?: string | undefined;
  // In the reader's words already.
  ariaLabel: string;
  ariaDescribedby?: string | undefined;
  dataTestId?: string | undefined;
  // Take the focus as it is drawn (EntityDropdown's autoFocus).
  autoFocus?: boolean | undefined;
}

// What a held record reads as: its name, Archived, or gone.
type HeldOptions = Map<string, DropdownOption>;

const RecordConditionPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [held, setHeld] = useState<HeldOptions | null>(null);

  /*
   * Asked for the focus as it is drawn: kept for the dropdown, which is
   * drawn once what the condition holds is named.
   */
  const focusOnDrawRef: MutableRefObject<boolean> = useRef<boolean>(
    Boolean(props.autoFocus),
  );

  const idsKey: string = props.ids
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .join("|");

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const known: HeldOptions = new Map(held || []);
      const toRead: Array<string> = props.ids.filter((id: string): boolean => {
        return !known.has(id.toLowerCase());
      });

      if (toRead.length === 0) {
        if (!held) {
          setHeld(known);
        }

        return;
      }

      try {
        const records: Array<BaseModel> = await RecordsById.read<BaseModel>({
          modelType: props.kind.modelType,
          ids: toRead,
          select: props.kind.select,
        });

        for (const record of records) {
          const id: string = record._id?.toString().toLowerCase() || "";
          const raw: Record<string, unknown> = record as unknown as Record<
            string,
            unknown
          >;

          if (!id) {
            continue;
          }

          known.set(id, {
            value: id,
            label: (raw["name"] as string | undefined) || id,
            // A record's name is its owner's, drawn as written.
            isUserContent: true,
            ...(raw["color"] ? { color: raw["color"] as never } : {}),
            ...(raw["isArchived"] === true ? { isArchived: true } : {}),
          });
        }

        // Asked for by its id, and not there: deleted since.
        for (const id of RecordsById.getValuesToRead({ ids: toRead })) {
          if (!known.has(id)) {
            known.set(id, {
              value: id,
              label: VALUE_NOT_FOUND_NAME,
              isUserContent: false,
              isNotFound: true,
            });
          }
        }
      } catch {
        /*
         * Naming them is the picker's to do then: it reads a held value by
         * its id itself, and the search must not fail with this read.
         */
      }

      if (isCurrent) {
        setHeld(known);
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [idsKey, props.kind.modelType]);

  /*
   * Drawn once what it holds is named: drawn before, the picker would read
   * the same ids itself.
   */
  if (!held && props.ids.length > 0) {
    return <InlineValueSkeleton />;
  }

  // What the condition holds, each named where its name was read.
  const value: Array<DropdownOption | string> = props.ids.map(
    (id: string): DropdownOption | string => {
      return held?.get(id.toLowerCase()) || id;
    },
  );

  return (
    <EntityDropdown
      id={props.id}
      className="relative w-full"
      modelType={props.kind.modelType}
      labelField="name"
      valueField="_id"
      query={props.kind.query}
      isMultiSelect={true}
      ariaLabel={props.ariaLabel}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId={props.dataTestId}
      autoFocus={focusOnDrawRef.current}
      placeholder={RuleCriteriaCopy.selectOneOrMore}
      notFoundLabel={VALUE_NOT_FOUND_NAME}
      value={value as EntityDropdownValue}
      onChange={(
        next: DropdownValue | Array<DropdownValue> | null,
        change: DropdownChange,
      ) => {
        // A record just picked is named by the search that offered it.
        const known: HeldOptions = new Map(held || []);

        for (const option of change.selectedOptions) {
          const id: string = String(option.value).toLowerCase();

          if (!known.has(id)) {
            known.set(id, { ...option, value: id });
          }
        }

        setHeld(known);

        props.onChange(
          (Array.isArray(next) ? next : next ? [next] : []).map(
            (entry: DropdownValue): string => {
              return entry.toString();
            },
          ),
        );
      }}
    />
  );
};

export default RecordConditionPicker;
