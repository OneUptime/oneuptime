import {
  HeaderAction,
  HeaderActionButton,
} from "../../SecurityCase/SecurityCaseHeader";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME,
  SECURITY_CASE_HEADER_TITLE_CLASS_NAME,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
} from "../../SecurityCase/SecurityCaseHeaderLayout";
import EntityCriticalityPill from "./EntityCriticalityPill";
import {
  ENTITY_ACTIONS_LABEL,
  ENTITY_RISK_TEST_IDS,
  MORE_ENTITY_ACTIONS_LABEL,
  OPEN_IN_CORRELATE,
  RESET_RISK,
  SEARCH_ITS_EVENTS,
} from "./EntityRiskCopy";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
import { SecurityEntityCriticality } from "Common/Types/SecurityCase/SecurityEntityRisk";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

// Reset Risk, as the page offers it: who may, and what it does.
export interface EntityRiskResetAction {
  isAllowed: boolean;
  // Why it is locked, for whoever may not delete security data.
  disabledReason?: string | undefined;
  onClick: () => void;
}

export interface ComponentProps {
  // The entity's value, as the events wrote it: shown as it is, never looked up as words.
  value: string;
  type: SecurityEntityType;
  criticality: SecurityEntityCriticality | null;
  onOpenInCorrelate: () => void;
  onSearchItsEvents: () => void;
  /*
   * Reset Risk, under the ⋯: left out while there is no risk to reset, and
   * while the reader's permissions are still being read.
   */
  reset?: EntityRiskResetAction | undefined;
  // What the header says under its top: how risky the entity is, and why.
  children?: ReactNode;
}

// The ids the header's own parts carry, beside the page's (ENTITY_RISK_TEST_IDS).
export const ENTITY_RISK_HEADER_TEST_IDS: {
  kind: string;
  title: string;
  actions: string;
  openInCorrelate: string;
  searchItsEvents: string;
  more: string;
} = {
  kind: "entity-risk-kind",
  title: "entity-risk-title",
  actions: "entity-risk-actions",
  openInCorrelate: "entity-risk-open-in-correlate",
  searchItsEvents: "entity-risk-search-its-events",
  more: "entity-risk-more",
};

/*
 * Two buttons, not a case's four: each may take 20rem rather than a case
 * button's 16rem, so "Открыть в «Коррелировать»" reads whole on a laptop. A
 * descendant rule, so it outranks the button's own widths at every size; the
 * label still ends in "..." where even that is too narrow.
 */
export const ENTITY_RISK_HEADER_BUTTONS_CLASS_NAME: string =
  "[&_button]:max-w-[20rem]";

/*
 * The top of an entity's page, laid out as a security case's top is
 * (SecurityCaseHeaderLayout): its kind and how much it matters on the first
 * line, the entity itself as the page's title, and the ways into
 * investigating it - Open in Correlate and Search Its Events - at the
 * right, on the first line where the header is wide enough and under the
 * title where it is not, never at the left under the title. Reset Risk,
 * which few people need and which clears what the page shows, waits under
 * the ⋯ in the corner, as a case's Delete Case does.
 */
const EntityRiskHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const actions: Array<HeaderAction> = [
    {
      title: OPEN_IN_CORRELATE,
      icon: IconProp.Share,
      isDisabled: false,
      dataTestId: ENTITY_RISK_HEADER_TEST_IDS.openInCorrelate,
      onClick: props.onOpenInCorrelate,
    },
    {
      title: SEARCH_ITS_EVENTS,
      icon: IconProp.Search,
      isDisabled: false,
      dataTestId: ENTITY_RISK_HEADER_TEST_IDS.searchItsEvents,
      onClick: props.onSearchItsEvents,
    },
  ];

  const reset: EntityRiskResetAction | undefined = props.reset;

  return (
    <section
      className={SECURITY_CASE_HEADER_CLASS_NAME}
      data-testid={ENTITY_RISK_TEST_IDS.entityHeader}
    >
      <div className="px-4 py-4 sm:px-5">
        <div className={SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME}>
          <div className={SECURITY_CASE_HEADER_CHIPS_CLASS_NAME}>
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700"
              data-testid={ENTITY_RISK_HEADER_TEST_IDS.kind}
            >
              <Icon
                icon={getSecurityEntityIcon(props.type)}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
              />
              {translator.translateText(props.type) || props.type}
            </span>
            {props.criticality ? (
              // The size of the kind beside it, as a case's pills beside its number.
              <EntityCriticalityPill
                criticality={props.criticality}
                size={PillSize.Normal}
              />
            ) : (
              <></>
            )}
          </div>

          {/* Before the actions, as it is read; drawn under them on a wide header. */}
          <h1
            className={`${SECURITY_CASE_HEADER_TITLE_CLASS_NAME} font-mono [overflow-wrap:anywhere]`}
            data-testid={ENTITY_RISK_HEADER_TEST_IDS.title}
          >
            {props.value}
          </h1>

          <div
            role="group"
            aria-label={translator.translateText(ENTITY_ACTIONS_LABEL)}
            className={SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME}
            data-testid={ENTITY_RISK_HEADER_TEST_IDS.actions}
          >
            <div
              className={`${SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME} ${ENTITY_RISK_HEADER_BUTTONS_CLASS_NAME}`}
            >
              {actions.map((action: HeaderAction): ReactElement => {
                return (
                  <HeaderActionButton key={action.dataTestId} action={action} />
                );
              })}
            </div>
            {reset ? (
              <div className={SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME}>
                <MoreMenu
                  ariaLabel={translator.translateText(
                    MORE_ENTITY_ACTIONS_LABEL,
                  )}
                  dataTestId={ENTITY_RISK_HEADER_TEST_IDS.more}
                  elementToBeShownInsteadOfButton={
                    <Icon
                      icon={IconProp.EllipsisHorizontal}
                      className="h-4 w-4"
                    />
                  }
                  triggerClassName={
                    SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME
                  }
                  /*
                   * Drawn over the page, not inside the header: the header
                   * is a size container, and a menu inside it would sit
                   * under the cards after it.
                   */
                  isMenuPortaled={true}
                >
                  {[
                    <MoreMenuItem
                      key="reset-risk"
                      icon={IconProp.Refresh}
                      text={RESET_RISK}
                      isDestructive={true}
                      isDisabled={!reset.isAllowed}
                      tooltip={
                        reset.isAllowed ? undefined : reset.disabledReason
                      }
                      dataTestId={ENTITY_RISK_TEST_IDS.reset}
                      onClick={reset.onClick}
                    />,
                  ]}
                </MoreMenu>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>

      {props.children}
    </section>
  );
};

export default EntityRiskHeader;
