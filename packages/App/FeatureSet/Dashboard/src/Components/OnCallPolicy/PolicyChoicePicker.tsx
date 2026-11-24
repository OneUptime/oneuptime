import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { SharedNameFacts } from "Common/UI/Utils/SharedNameOptions";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// How long typing rests before the server is asked.
export const POLICY_SEARCH_DELAY_MS: number = 250;

// An on-call policy offered to pick.
export interface PolicyPickerChoice {
  id: string;
  name: string;
  // What tells it from another policy of its name (#10314).
  sharedName?: SharedNameFacts | undefined;
}

/*
 * The policies the picker offers, each once: the project's first ones by
 * name, what the newest search found past them, and the one picked - kept
 * while other searches come and go. Two policies of one name are told apart
 * by what sets each apart (SharedNameOptions, #10314).
 */
export const getPolicyChoiceOptions: (data: {
  policies: Array<PolicyPickerChoice>;
  found: Array<PolicyPickerChoice>;
  picked: PolicyPickerChoice | null;
}) => Array<DropdownOption> = (data: {
  policies: Array<PolicyPickerChoice>;
  found: Array<PolicyPickerChoice>;
  picked: PolicyPickerChoice | null;
}): Array<DropdownOption> => {
  const seen: Set<string> = new Set<string>();
  const options: Array<DropdownOption> = [];

  for (const entry of [
    ...data.policies,
    ...data.found,
    ...(data.picked ? [data.picked] : []),
  ]) {
    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    // A policy's name is the project's own, drawn as written.
    options.push({
      value: entry.id,
      label: entry.name,
      isUserContent: true,
      ...(entry.sharedName ? { sharedName: entry.sharedName } : {}),
    });
  }

  return options;
};

export interface ComponentProps<TChoice extends PolicyPickerChoice> {
  /*
   * The project's first policies by name, as the page read them: the same
   * list until the page reads them again, when what a search found is
   * dropped - a policy may have been deleted or archived since.
   */
  policies: Array<TChoice>;
  // The id of the policy chosen; undefined for none yet.
  value: string | undefined;
  onChange: (choice: TChoice) => void;
  // The project's policies whose name holds what is typed, from the server.
  search: (text: string) => Promise<Array<TChoice>>;
  ariaLabelledby: string;
  dataTestId?: string | undefined;
}

/*
 * AN ON-CALL POLICY TO PICK, HOWEVER MANY THE PROJECT HAS (#10764).
 *
 * The On-Call guided setup's policy to add people to, and Setup Health's
 * quick fix's policy a new on-call rule pages, offered the project's first
 * 10,000 policies in service by name, read once: a policy past them could
 * not be picked. They offer the first ones, and search the server for what
 * is typed - debounced, the newest answer winning - keeping the policy
 * picked named while other searches come and go.
 */
const PolicyChoicePicker: <TChoice extends PolicyPickerChoice>(
  props: ComponentProps<TChoice>,
) => ReactElement = <TChoice extends PolicyPickerChoice>(
  props: ComponentProps<TChoice>,
): ReactElement => {
  const [found, setFound] = useState<Array<TChoice>>([]);
  const [picked, setPicked] = useState<TChoice | null>(null);
  const timerRef: MutableRefObject<number | null> = useRef<number | null>(null);
  const sequenceRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  // The page read the project's policies again: what was found is dropped.
  useEffect(() => {
    sequenceRef.current++;
    setFound([]);
  }, [props.policies]);

  // The policy picked, while it is still the one chosen.
  const chosen: TChoice | null =
    picked && picked.id === props.value ? picked : null;

  const onSearchTextChange: (text: string) => void = (text: string): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!text.trim()) {
      return;
    }

    const sequence: number = ++sequenceRef.current;

    timerRef.current = window.setTimeout(() => {
      props
        .search(text)
        .then((policies: Array<TChoice>) => {
          if (sequence === sequenceRef.current) {
            setFound(policies);
          }
        })
        .catch(() => {
          // The first policies, read as the page opened, are still offered.
        });
    }, POLICY_SEARCH_DELAY_MS);
  };

  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getPolicyChoiceOptions({
      policies: props.policies,
      found: found,
      picked: chosen,
    });
  }, [props.policies, found, chosen]);

  return (
    <Dropdown
      options={options}
      value={options.find((option: DropdownOption): boolean => {
        return option.value === props.value;
      })}
      isClearable={false}
      ariaLabelledby={props.ariaLabelledby}
      dataTestId={props.dataTestId}
      onSearchTextChange={onSearchTextChange}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        if (typeof value !== "string") {
          return;
        }

        const choice: TChoice | undefined = [
          ...props.policies,
          ...found,
          ...(chosen ? [chosen] : []),
        ].find((entry: TChoice): boolean => {
          return entry.id === value;
        });

        if (!choice) {
          return;
        }

        setPicked(choice);
        props.onChange(choice);
      }}
    />
  );
};

export default PolicyChoicePicker;
