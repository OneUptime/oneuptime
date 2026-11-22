import { VALUE_NOT_FOUND_NAME } from "./NotificationRuleConditionWords";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "MONITOR IS ANY OF ..." IN A WORKSPACE RULE OR SUMMARY, SEARCHED ON THE
 * SERVER (#10646).
 *
 * The rules and summaries pages read every monitor of the project - the
 * first 10,000 by name - to offer them here and to name the ones a
 * condition holds. A monitor past them could not be picked, and one a
 * condition held read "No longer in this project".
 *
 * The picker searches the server as it is typed in, 50 by name
 * (EntityDropdown), and never offers an archived monitor (#7582). What the
 * condition holds is read by its ids: an archived one stays, marked
 * Archived, to keep or take out, and one deleted since is a chip of its
 * own in the card's words, "No longer in this project" (#7807). Nothing
 * changes until the condition does.
 */

// Archived monitors are retired: never offered for a new pick.
export const MONITOR_CONDITION_QUERY: Record<string, unknown> = {
  isArchived: false,
};

export interface ComponentProps {
  ids: Array<string>;
  onChange: (ids: Array<string>) => void;
  id?: string | undefined;
  // In the reader's words already.
  ariaLabel: string;
  ariaDescribedby?: string | undefined;
}

// What a held monitor reads as: its name, Archived, or gone.
type HeldOptions = Map<string, DropdownOption>;

const MonitorConditionPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [held, setHeld] = useState<HeldOptions | null>(null);

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
        const monitors: Array<Monitor> = await RecordsById.read<Monitor>({
          modelType: Monitor,
          ids: toRead,
          select: { _id: true, name: true, isArchived: true },
        });

        for (const monitor of monitors) {
          const id: string = monitor._id?.toString().toLowerCase() || "";

          if (!id) {
            continue;
          }

          known.set(id, {
            value: id,
            label: monitor.name || id,
            // A monitor's name is its owner's, drawn as written.
            isUserContent: true,
            ...(monitor.isArchived ? { isArchived: true } : {}),
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
  }, [idsKey]);

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
      modelType={Monitor}
      labelField="name"
      valueField="_id"
      query={MONITOR_CONDITION_QUERY}
      isMultiSelect={true}
      ariaLabel={props.ariaLabel}
      ariaDescribedby={props.ariaDescribedby}
      placeholder={RuleCriteriaCopy.selectOneOrMore}
      notFoundLabel={VALUE_NOT_FOUND_NAME}
      value={value as EntityDropdownValue}
      onChange={(
        next: DropdownValue | Array<DropdownValue> | null,
        change: DropdownChange,
      ) => {
        // A monitor just picked is named by the search that offered it.
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

export default MonitorConditionPicker;
