import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  ENFORCEMENT_TOOLTIPS,
  LIFT_ACTION,
  UNTIL_LIFTED_REFUSED,
} from "../../SecurityEvents/Blocklist/BlocklistCopy";
import {
  ACTION_BLOCK_FOR_A_DAY,
  BLOCK_CHALLENGE_INSTEAD,
  BLOCK_CHALLENGE_TOOLTIP,
  BLOCK_FOR_SEVEN_DAYS,
  BLOCK_HELP_AWS_WAF,
  BLOCK_HELP_CLOUDFLARE,
  BLOCK_HELP_CONNECT,
  BLOCK_HELP_FIREWALL,
  BLOCK_HELP_HIDE,
  BLOCK_HELP_NFTABLES,
  BLOCK_HELP_NGINX,
  BLOCK_HELP_SHOW,
  BLOCK_MORE_LABEL,
  BLOCK_UNTIL_LIFTED,
  LIFT_BLOCK_LABEL,
  SECURITY_CASE_RESPONSE_TEST_IDS,
} from "./SecurityCaseResponseCopy";
import {
  BLOCK_CHALLENGE_CHOICE,
  BLOCK_DEFAULT_CHOICE,
  BLOCK_SEVEN_DAYS_CHOICE,
  BLOCK_UNTIL_LIFTED_CHOICE,
  BlockByHandCommands,
  BlockChoice,
  getBlockByHandCommands,
  isRangeAroundAddress,
  writeAddressBlockLine,
} from "./SecurityCaseBlockStepModel";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityBlockEnforcementView } from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SECURITY_PROTECTED_RANGE_HOLDS } from "Common/Types/SecurityBlocklist/SecurityProtectedAddress";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ResponseAddressBlock } from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * THE BLOCK STEP OF A CASE'S RESPONSE PLAN (#10342), as the card draws it:
 *
 *   - Block for 24 Hours, one click, with the rest in a menu beside it:
 *     Challenge Instead (people pass a challenge, scripts and API clients
 *     do not), Block for 7 Days, and Block Until Lifted, a Security
 *     Admin's;
 *   - the block that holds the address: where it is enforced, since when,
 *     by whom and until when - or that a destination is still applying
 *     it, or that nothing enforces it - with Lift;
 *   - while nothing enforces the blocklist: how to let OneUptime block it
 *     (connect Cloudflare, AWS WAF or a firewall), and how to block it by
 *     hand, folded.
 */

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

// Products' names, the same in every language.
const CLOUDFLARE_NAME: string = "Cloudflare";
const AWS_WAF_NAME: string = "AWS WAF";

export interface BlockStepActionsProps {
  address: string;
  // Why blocking is locked for this person; undefined when they may.
  lockReason?: string | undefined;
  // Whether the person may keep a block until someone lifts it.
  mayBlockUntilLifted: boolean;
  isWorking: boolean;
  onBlock: (choice: BlockChoice) => void;
}

export const BlockStepActions: FunctionComponent<BlockStepActionsProps> = (
  props: BlockStepActionsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isLocked: boolean = props.lockReason !== undefined || props.isWorking;

  return (
    <div className="flex items-center gap-1">
      <Button
        title={ACTION_BLOCK_FOR_A_DAY}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        disabled={isLocked}
        tooltip={props.lockReason || undefined}
        dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.block}
        onClick={() => {
          props.onBlock(BLOCK_DEFAULT_CHOICE);
        }}
      />
      <MoreMenu
        menuIcon={IconProp.ChevronDown}
        text=""
        ariaLabel={translator.translateTemplate(BLOCK_MORE_LABEL, {
          value: props.address,
        })}
        isAriaLabelTranslated={true}
        isDisabled={isLocked}
        isMenuPortaled={true}
        dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.blockMore}
      >
        {[
          <MoreMenuItem
            key="challenge"
            icon={IconProp.ShieldCheck}
            text={BLOCK_CHALLENGE_INSTEAD}
            tooltip={BLOCK_CHALLENGE_TOOLTIP}
            onClick={() => {
              props.onBlock(BLOCK_CHALLENGE_CHOICE);
            }}
          />,
          <MoreMenuItem
            key="seven-days"
            icon={IconProp.NoSymbol}
            text={BLOCK_FOR_SEVEN_DAYS}
            onClick={() => {
              props.onBlock(BLOCK_SEVEN_DAYS_CHOICE);
            }}
          />,
          <MoreMenuItem
            key="until-lifted"
            icon={IconProp.Lock}
            text={BLOCK_UNTIL_LIFTED}
            isDisabled={!props.mayBlockUntilLifted}
            tooltip={
              props.mayBlockUntilLifted ? undefined : UNTIL_LIFTED_REFUSED
            }
            onClick={() => {
              props.onBlock(BLOCK_UNTIL_LIFTED_CHOICE);
            }}
          />,
        ]}
      </MoreMenu>
    </div>
  );
};

export interface AddressBlockLineProps {
  address: string;
  block: ResponseAddressBlock;
  // Why lifting is locked for this person; undefined when they may.
  liftLockReason?: string | undefined;
  isWorking: boolean;
  onLift: () => void;
}

export const AddressBlockLine: FunctionComponent<AddressBlockLineProps> = (
  props: AddressBlockLineProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const block: ResponseAddressBlock = props.block;
  const isEnforced: boolean = block.enforcedAt.length > 0;
  const isRange: boolean = isRangeAroundAddress({
    block,
    address: props.address,
  });

  return (
    <div
      className="space-y-0.5 text-xs"
      data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.blockLine}
      data-enforced={isEnforced ? "true" : "false"}
    >
      <p
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${
          isEnforced || block.pendingAt.length > 0
            ? "text-gray-600"
            : "text-amber-700"
        }`}
      >
        <span className="min-w-0 break-words">
          {writeAddressBlockLine({ block, translator })}
        </span>
        {props.liftLockReason === undefined ? (
          <Button
            title={LIFT_ACTION}
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.Small}
            disabled={props.isWorking}
            ariaLabel={translator.translateTemplate(LIFT_BLOCK_LABEL, {
              value: block.value,
            })}
            isAriaLabelTranslated={true}
            dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.lift}
            onClick={props.onLift}
          />
        ) : (
          <></>
        )}
      </p>
      {isRange ? (
        <p className="text-gray-500">
          {translator.translateTemplate(SECURITY_PROTECTED_RANGE_HOLDS, {
            value: block.value,
            address: props.address,
          })}
        </p>
      ) : (
        <></>
      )}
      {!isEnforced
        ? block.notAppliedAt.map(
            (
              entry: { name: string; reason: string | null },
              index: number,
            ): ReactElement => {
              return (
                <p key={index} className="text-amber-700">
                  {translator.translateTemplate(
                    ENFORCEMENT_TOOLTIPS[
                      SecurityBlockEnforcementView.NotApplied
                    ],
                    { destination: entry.name, reason: entry.reason || "" },
                  )}
                </p>
              );
            },
          )
        : []}
    </div>
  );
};

export interface BlockHelpProps {
  address: string;
}

// A code line to copy, as the fold shows each place to block the address by hand.
const CommandLine: FunctionComponent<{ command: string }> = (props: {
  command: string;
}): ReactElement => {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">
        {props.command}
      </code>
      <CopyTextButton
        textToBeCopied={props.command}
        iconOnly={true}
        size="sm"
        variant="soft"
      />
    </div>
  );
};

export const BlockHelp: FunctionComponent<BlockHelpProps> = (
  props: BlockHelpProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const commands: BlockByHandCommands = getBlockByHandCommands(props.address);

  return (
    <div
      className="space-y-1 text-xs text-gray-600"
      data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.blockHelp}
    >
      <p className="break-words">
        <TranslatedSentence
          template={BLOCK_HELP_CONNECT}
          slots={{
            cloudflare: (
              <AppLink
                to={
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
                  ) as Route
                }
                className={LINK_CLASS_NAME}
              >
                {CLOUDFLARE_NAME}
              </AppLink>
            ),
            awsWaf: (
              <AppLink
                to={
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.CLOUD_CONNECT] as Route,
                  ) as Route
                }
                className={LINK_CLASS_NAME}
              >
                {AWS_WAF_NAME}
              </AppLink>
            ),
            firewall: (
              <AppLink
                to={
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SECURITY_BLOCKLIST] as Route,
                  ) as Route
                }
                className={LINK_CLASS_NAME}
              >
                {translator.translateText(BLOCK_HELP_FIREWALL) ||
                  BLOCK_HELP_FIREWALL}
              </AppLink>
            ),
          }}
        />
      </p>
      <button
        type="button"
        className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-expanded={isOpen}
        data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.blockHelpToggle}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        {translator.translateText(isOpen ? BLOCK_HELP_HIDE : BLOCK_HELP_SHOW)}
      </button>
      {isOpen ? (
        <ul
          className="space-y-2"
          data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.blockHelpPanel}
        >
          <li>
            {translator.translateTemplate(BLOCK_HELP_CLOUDFLARE, {
              address: props.address,
            })}
          </li>
          <li className="space-y-1">
            <p>{translator.translateText(BLOCK_HELP_AWS_WAF)}</p>
            <CommandLine command={commands.awsCli} />
          </li>
          <li className="space-y-1">
            <p>{translator.translateText(BLOCK_HELP_NGINX)}</p>
            <CommandLine command={commands.nginx} />
          </li>
          <li className="space-y-1">
            <p>{translator.translateText(BLOCK_HELP_NFTABLES)}</p>
            <CommandLine command={commands.nftables} />
          </li>
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};
