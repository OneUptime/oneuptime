import {
  ADD_RECOMMENDED_TITLE,
  ADD_RULES_DESCRIPTION,
  ADD_RULES_TITLE,
  ADD_RULES_WITHOUT_DATA,
  DATA_KIND_TITLES,
} from "./RuleLibraryCopy";
import RuleLibraryDataStatus from "./RuleLibraryDataStatus";
import {
  LibraryRuleDataStatus,
  countEntriesWithoutData,
  getLibraryRuleDataStatus,
} from "./RuleLibraryUtil";
import { SecurityEventKindsSeen } from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import { DetectionRuleLibraryEntry } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Before the header adds more than one rule at a time, it says what it will
 * do: how many rules, which ones - each with the events it reads and whether
 * the project sends them - that they start on and open a security case when
 * they match, and how many would find nothing until their events arrive.
 * The rules are added only when the reader says so.
 */

export const RULE_LIBRARY_ADD_DIALOG_LIST_TEST_ID: string =
  "rule-library-add-list";

export interface ComponentProps {
  entries: Array<DetectionRuleLibraryEntry>;
  isRecommended: boolean;
  seen: SecurityEventKindsSeen | null;
  onConfirm: () => void;
  onClose: () => void;
}

const RuleLibraryAddDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const count: number = props.entries.length;
  const withoutData: number = countEntriesWithoutData(
    props.entries,
    props.seen,
  );

  return (
    <ConfirmModal
      title={translator.translatePlural(
        props.isRecommended ? ADD_RECOMMENDED_TITLE : ADD_RULES_TITLE,
        count,
      )}
      description={translator.translatePlural(ADD_RULES_DESCRIPTION, count)}
      submitButtonText={count === 1 ? "Add Rule" : "Add Rules"}
      onClose={props.onClose}
      onSubmit={props.onConfirm}
    >
      <div className="space-y-3">
        <ul
          className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200"
          data-testid={RULE_LIBRARY_ADD_DIALOG_LIST_TEST_ID}
        >
          {props.entries.map(
            (entry: DetectionRuleLibraryEntry): ReactElement => {
              const status: LibraryRuleDataStatus = getLibraryRuleDataStatus(
                entry.dataKind,
                props.seen,
              );

              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  data-testid={`rule-library-add-item-${entry.id}`}
                >
                  <span className="min-w-0 text-sm font-medium text-gray-900">
                    {entry.title}
                  </span>
                  <span className="flex flex-none items-center gap-2 text-xs text-gray-500">
                    {translator.translateText(DATA_KIND_TITLES[entry.dataKind])}
                    <RuleLibraryDataStatus status={status} />
                  </span>
                </li>
              );
            },
          )}
        </ul>
        {withoutData > 0 ? (
          <p
            className="text-sm text-gray-600"
            data-testid="rule-library-add-without-data"
          >
            {translator.translatePlural(ADD_RULES_WITHOUT_DATA, withoutData)}
          </p>
        ) : (
          <></>
        )}
      </div>
    </ConfirmModal>
  );
};

export default RuleLibraryAddDialog;
