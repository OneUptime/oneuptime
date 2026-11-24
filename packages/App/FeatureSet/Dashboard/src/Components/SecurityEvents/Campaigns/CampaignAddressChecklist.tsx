import {
  LEFT_OUT_HEADING,
  SECURITY_CAMPAIGN_TEST_IDS,
  SELECT_ADDRESS_LABEL,
} from "./CampaignContainmentCopy";
import {
  describeCampaignAddressCheck,
  splitCampaignChecks,
} from "./CampaignContainmentModel";
import { REQUESTS_COUNT } from "../SecurityAttackCampaignsModel";
import { SecurityCampaignAddressCheck } from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE ADDRESSES A BLOCK OF A CAMPAIGN TAKES (#10354), as Block Addresses
 * and a case's Block the Whole Campaign list them: each address it can
 * block with a box, ticked unless the person unticks it, with how many
 * requests it sent; then the ones it leaves out, each with why - already
 * blocked, one of your own or protected, a signed-in user's lately, or
 * OneUptime could not check.
 */

export type CampaignChecklistEntry = SecurityCampaignAddressCheck & {
  requestCount?: number | undefined;
};

export interface ComponentProps {
  checks: Array<CampaignChecklistEntry>;
  // The addresses ticked, as each check names it.
  selected: Array<string>;
  onChange: (selected: Array<string>) => void;
  isDisabled?: boolean | undefined;
}

export function getChecklistValue(check: SecurityCampaignAddressCheck): string {
  return check.value || check.typed;
}

const CampaignAddressChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { blocking, leftOut } = splitCampaignChecks(props.checks);

  return (
    <div
      className="space-y-3"
      data-testid={SECURITY_CAMPAIGN_TEST_IDS.checklist}
    >
      {blocking.length > 0 ? (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
          {blocking.map((check: CampaignChecklistEntry): ReactElement => {
            const value: string = getChecklistValue(check);
            const isTicked: boolean = props.selected.includes(value);

            return (
              <li
                key={value}
                data-testid={SECURITY_CAMPAIGN_TEST_IDS.checklistItem}
                data-value={value}
                className="flex items-center gap-3 rounded px-1 py-0.5"
              >
                <Checkbox
                  value={isTicked}
                  disabled={props.isDisabled}
                  ariaLabel={translator.translateTemplate(
                    SELECT_ADDRESS_LABEL,
                    { address: value },
                  )}
                  isAriaLabelTranslated={true}
                  onChange={(isChecked: boolean) => {
                    props.onChange(
                      isChecked
                        ? [...props.selected, value]
                        : props.selected.filter((other: string) => {
                            return other !== value;
                          }),
                    );
                  }}
                />
                <IsolatedText
                  text={value}
                  className="min-w-0 flex-1 font-mono text-sm text-gray-900 [overflow-wrap:anywhere]"
                />
                {typeof check.requestCount === "number" ? (
                  <span className="shrink-0 text-xs text-gray-500">
                    {translator.translatePlural(
                      REQUESTS_COUNT,
                      check.requestCount,
                    )}
                  </span>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}
      {leftOut.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">
            {translator.translatePlural(LEFT_OUT_HEADING, leftOut.length)}
          </p>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto">
            {leftOut.map((check: CampaignChecklistEntry): ReactElement => {
              const value: string = getChecklistValue(check);

              return (
                <li
                  key={value}
                  data-testid={SECURITY_CAMPAIGN_TEST_IDS.checklistItem}
                  data-value={value}
                  data-left-out="true"
                  className="text-sm"
                >
                  <IsolatedText
                    text={value}
                    className="font-mono text-gray-700 [overflow-wrap:anywhere]"
                  />
                  <p className="text-xs text-gray-600">
                    {describeCampaignAddressCheck({ check, translator }) || ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CampaignAddressChecklist;
