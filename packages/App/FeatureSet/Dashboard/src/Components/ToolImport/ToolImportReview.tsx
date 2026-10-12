import ToolImportLogo from "./ToolImportLogo";
import ToolImportNoteList from "./ToolImportNoteList";
import {
  countTickedKeys,
  getDefaultToolImportSelection,
  getInitialInviteTeamId,
  getLeftOutReferences,
  getSelectedKeys,
  getToolImportItemsByKey,
  getToolImportPlanSections,
  hasTickedInvites,
  setToolImportKeys,
  TOOL_IMPORT_BUTTON_ROW_CLASS_NAME,
  TOOL_IMPORT_SECTION_PAGE_SIZE,
  ToolImportPlanSection,
} from "./ToolImportPlanView";
import {
  describeToolImportNote,
  describeToolImportSummary,
  formatToolImportDateTime,
  namesValue,
  TOOL_IMPORT_ACTION_LABELS,
  TOOL_IMPORT_KIND_DESCRIPTIONS,
  TOOL_IMPORT_KIND_TERMS,
  TOOL_IMPORT_KIND_TITLES,
  TOOL_IMPORT_PLURALS,
} from "./ToolImportText";
import Color from "Common/Types/Color";
import {
  Blue,
  Gray500,
  Green,
  Orange,
  Slate500,
} from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { getToolImportSourceDefinition } from "Common/Types/ToolImport/ToolImportCatalog";
import {
  isToolImportSubscriberKey,
  ToolImportAction,
  ToolImportInviteTeam,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportSelection,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * Step three: what was found, and what each thing would become. One section
 * per kind; each item says whether it is new, already in OneUptime (and is
 * used as it is), was brought over before, or cannot come over and why,
 * with what will not come over exactly as it was. The person ticks what to
 * bring over and starts the import, which runs in the background.
 *
 * Nothing is created until they start it, and starting it again later never
 * creates anything twice: what an earlier import brought over is shown as
 * such and cannot be ticked.
 *
 * Status page subscribers start unticked, and come over only when the
 * person also confirms they may move them: the box in their section, which
 * the start button waits for while any subscriber is ticked.
 */

const ACTION_COLORS: Record<ToolImportAction, Color> = {
  [ToolImportAction.Create]: Green,
  [ToolImportAction.Invite]: Blue,
  [ToolImportAction.Match]: Slate500,
  [ToolImportAction.AlreadyImported]: Gray500,
  [ToolImportAction.Skip]: Orange,
};

interface ItemProps {
  item: ToolImportPlanItem;
  toolTitle: string;
  isTicked: boolean;
  leftOut: Array<ToolImportPlanItem>;
  onSetKeys: (keys: Array<string>, isTicked: boolean) => void;
}

const ToolImportReviewItem: FunctionComponent<ItemProps> = (
  props: ItemProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const checkboxId: string = useId();
  const detailsId: string = `${checkboxId}-details`;
  const item: ToolImportPlanItem = props.item;
  const summary: string = describeToolImportSummary(
    item.kind,
    item.summary,
    translator,
  );
  const reason: string = item.reason
    ? describeToolImportNote(item.reason, translator, props.toolTitle)
    : "";
  const leftOutTickable: Array<string> = props.leftOut
    .filter((referenced: ToolImportPlanItem): boolean => {
      return referenced.isSelectable;
    })
    .map((referenced: ToolImportPlanItem): string => {
      return referenced.key;
    });

  return (
    <li
      className="flex items-start gap-3 px-4 py-3"
      data-testid={`tool-import-item-${item.key}`}
    >
      <div className="flex h-5 w-4 flex-shrink-0 items-center">
        {item.isSelectable ? (
          <input
            id={checkboxId}
            type="checkbox"
            checked={props.isTicked}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              props.onSetKeys([item.key], event.target.checked);
            }}
            aria-describedby={detailsId}
            data-testid={`tool-import-tick-${item.key}`}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600"
          />
        ) : (
          <div className="text-gray-400">
            <Icon
              icon={
                item.action === ToolImportAction.Skip
                  ? IconProp.Minus
                  : IconProp.Check
              }
              className="h-4 w-4"
            />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.isSelectable ? (
            <label
              htmlFor={checkboxId}
              className="cursor-pointer break-words text-sm font-medium text-gray-900"
            >
              {item.name}
            </label>
          ) : (
            <span className="break-words text-sm font-medium text-gray-900">
              {item.name}
            </span>
          )}
          <Pill
            text={TOOL_IMPORT_ACTION_LABELS[item.action]}
            color={ACTION_COLORS[item.action]}
            size={PillSize.Small}
          />
        </div>
        <div id={detailsId}>
          {summary && (
            <p className="mt-0.5 break-words text-sm text-gray-500">
              {summary}
            </p>
          )}
          {reason && (
            <p
              className="mt-1 text-sm text-gray-600"
              data-testid={`tool-import-reason-${item.key}`}
            >
              {reason}
            </p>
          )}
          <ToolImportNoteList
            notes={item.notes}
            toolTitle={props.toolTitle}
            dataTestId={`tool-import-notes-${item.key}`}
          />
          {props.isTicked && props.leftOut.length > 0 && (
            <div
              className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-amber-700"
              data-testid={`tool-import-left-out-${item.key}`}
            >
              <span>
                {translator.translatePlural(
                  TOOL_IMPORT_PLURALS.usesLeftOut,
                  props.leftOut.length,
                  {
                    names: namesValue(
                      props.leftOut.map(
                        (referenced: ToolImportPlanItem): string => {
                          return referenced.name;
                        },
                      ),
                    ),
                  },
                )}
              </span>
              {leftOutTickable.length > 0 && (
                <button
                  type="button"
                  className="font-medium text-indigo-600 underline hover:text-indigo-700"
                  data-testid={`tool-import-tick-left-out-${item.key}`}
                  onClick={() => {
                    props.onSetKeys(leftOutTickable, true);
                  }}
                >
                  {translator.translateText("Tick them too")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

interface SectionProps {
  section: ToolImportPlanSection;
  toolTitle: string;
  selection: ReadonlySet<string>;
  itemsByKey: ReadonlyMap<string, ToolImportPlanItem>;
  onSetKeys: (keys: Array<string>, isTicked: boolean) => void;
  // Shown between the section's heading and its items.
  children?: ReactElement | undefined;
}

/*
 * The person's word that they may move the subscribers they tick: what
 * they agreed to, and what OneUptime will (not) do with it.
 */
const ToolImportSubscribersConsent: FunctionComponent<{
  isConsented: boolean;
  isNeeded: boolean;
  onChange: (isConsented: boolean) => void;
}> = (props: {
  isConsented: boolean;
  isNeeded: boolean;
  onChange: (isConsented: boolean) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const checkboxId: string = useId();

  return (
    <div
      className="flex items-start gap-3 border-b border-gray-200 bg-white px-4 py-3"
      data-testid="tool-import-subscribers-consent"
    >
      <div className="flex h-5 w-4 flex-shrink-0 items-center">
        <input
          id={checkboxId}
          type="checkbox"
          checked={props.isConsented}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onChange(event.target.checked);
          }}
          data-testid="tool-import-subscribers-consent-tick"
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600"
        />
      </div>
      <div className="min-w-0 text-sm">
        <label
          htmlFor={checkboxId}
          className="cursor-pointer font-medium text-gray-900"
        >
          {translator.translateText(
            "These people agreed to get our status page updates, and I may move their subscriptions to OneUptime.",
          )}
        </label>
        <p className="mt-0.5 text-gray-500">
          {translator.translateText(
            "Nobody is emailed now. Every update they get from OneUptime has a link to unsubscribe.",
          )}
        </p>
        {props.isNeeded && !props.isConsented && (
          <p
            className="mt-1 text-amber-700"
            data-testid="tool-import-subscribers-consent-needed"
          >
            {translator.translateText(
              "Confirm that you may move the subscribers you ticked, or untick them.",
            )}
          </p>
        )}
      </div>
    </div>
  );
};

const ToolImportReviewSection: FunctionComponent<SectionProps> = (
  props: SectionProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const titleId: string = useId();
  const allRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const [shownCount, setShownCount] = useState<number>(
    TOOL_IMPORT_SECTION_PAGE_SIZE,
  );
  const section: ToolImportPlanSection = props.section;
  const selectableCount: number = section.selectableKeys.length;
  const tickedCount: number = countTickedKeys(
    section.selectableKeys,
    props.selection,
  );
  const isAllTicked: boolean =
    selectableCount > 0 && tickedCount === selectableCount;
  const isSomeTicked: boolean = tickedCount > 0 && !isAllTicked;
  const hiddenCount: number = section.items.length - shownCount;

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = isSomeTicked;
    }
  }, [isSomeTicked]);

  return (
    <section
      aria-labelledby={titleId}
      data-testid={`tool-import-section-${section.kind}`}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      <div className="flex items-start gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex h-5 w-4 flex-shrink-0 items-center">
          {selectableCount > 0 && (
            <input
              ref={allRef}
              type="checkbox"
              checked={isAllTicked}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                props.onSetKeys(section.selectableKeys, event.target.checked);
              }}
              aria-label={translator.translateTemplate("Tick all {{kind}}", {
                kind: translatableTerm(TOOL_IMPORT_KIND_TERMS[section.kind], {
                  inSentence: true,
                }),
              })}
              data-testid={`tool-import-tick-all-${section.kind}`}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 id={titleId} className="text-sm font-semibold text-gray-900">
              {translator.translateText(TOOL_IMPORT_KIND_TITLES[section.kind])}
            </h3>
            <span className="text-sm text-gray-500">
              {translator.translatePlural(
                TOOL_IMPORT_PLURALS.found,
                section.items.length,
              )}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {translator.translateText(
              TOOL_IMPORT_KIND_DESCRIPTIONS[section.kind],
            )}
          </p>
        </div>
        {selectableCount > 0 && (
          <span
            className="flex-shrink-0 text-xs font-medium text-gray-500"
            data-testid={`tool-import-section-count-${section.kind}`}
          >
            {translator.translatePlural(
              TOOL_IMPORT_PLURALS.ticked,
              tickedCount,
              {
                total: translator.formatNumber(selectableCount),
              },
            )}
          </span>
        )}
      </div>
      {props.children}
      <ul className="divide-y divide-gray-200">
        {section.items
          .slice(0, shownCount)
          .map((item: ToolImportPlanItem): ReactElement => {
            const isTicked: boolean = props.selection.has(item.key);

            return (
              <ToolImportReviewItem
                key={item.key}
                item={item}
                toolTitle={props.toolTitle}
                isTicked={isTicked}
                leftOut={
                  isTicked
                    ? getLeftOutReferences({
                        item: item,
                        itemsByKey: props.itemsByKey,
                        selection: props.selection,
                      })
                    : []
                }
                onSetKeys={props.onSetKeys}
              />
            );
          })}
      </ul>
      {hiddenCount > 0 && (
        <div className="border-t border-gray-200 px-4 py-2">
          <Button
            title={translator.translatePlural(
              { one: "Show {{count}} more", other: "Show {{count}} more" },
              Math.min(hiddenCount, TOOL_IMPORT_SECTION_PAGE_SIZE),
            )}
            buttonStyle={ButtonStyleType.LINK}
            onClick={() => {
              setShownCount(shownCount + TOOL_IMPORT_SECTION_PAGE_SIZE);
            }}
            dataTestId={`tool-import-show-more-${section.kind}`}
          />
        </div>
      )}
    </section>
  );
};

export interface ComponentProps {
  plan: ToolImportPlan;
  onStart: (selection: ToolImportSelection) => Promise<void>;
  onDiscard: () => Promise<void>;
}

const ToolImportReview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const plan: ToolImportPlan = props.plan;
  const toolTitle: string = getToolImportSourceDefinition(plan.source).title;
  const inviteTeamLabelId: string = useId();

  const [selection, setSelection] = useState<Set<string>>(() => {
    return getDefaultToolImportSelection(plan);
  });
  const [inviteTeamId, setInviteTeamId] = useState<string | null>(() => {
    return getInitialInviteTeamId(plan);
  });
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [subscribersConsent, setSubscribersConsent] = useState<boolean>(false);

  const sections: Array<ToolImportPlanSection> = useMemo(() => {
    return getToolImportPlanSections(plan);
  }, [plan]);

  const itemsByKey: Map<string, ToolImportPlanItem> = useMemo(() => {
    return getToolImportItemsByKey(plan);
  }, [plan]);

  const selectableCount: number = useMemo(() => {
    return plan.items.filter((item: ToolImportPlanItem): boolean => {
      return item.isSelectable;
    }).length;
  }, [plan]);

  const selectedKeys: Array<string> = getSelectedKeys(plan, selection);
  const isInviting: boolean = hasTickedInvites(plan, selection);
  const isMovingSubscribers: boolean = selectedKeys.some(
    isToolImportSubscriberKey,
  );
  const isWaitingForConsent: boolean =
    isMovingSubscribers && !subscribersConsent;

  const teamOptions: Array<DropdownOption> = plan.inviteTeams.map(
    (team: ToolImportInviteTeam): DropdownOption => {
      return { value: team.id, label: team.name };
    },
  );

  const onSetKeys: (keys: Array<string>, isTicked: boolean) => void = (
    keys: Array<string>,
    isTicked: boolean,
  ): void => {
    setSelection((current: Set<string>): Set<string> => {
      return setToolImportKeys(current, keys, isTicked);
    });
  };

  const start: () => Promise<void> = async (): Promise<void> => {
    if (selectedKeys.length === 0 || isStarting || isWaitingForConsent) {
      return;
    }

    setError("");
    setIsStarting(true);

    try {
      await props.onStart({
        selectedKeys: selectedKeys,
        inviteTeamId: isInviting ? inviteTeamId : null,
        ...(isMovingSubscribers ? { subscribersConsent: true } : {}),
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsStarting(false);
    }
  };

  const discard: () => Promise<void> = async (): Promise<void> => {
    if (isDiscarding) {
      return;
    }

    setError("");
    setIsDiscarding(true);

    try {
      await props.onDiscard();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsDiscarding(false);
    }
  };

  return (
    <div data-testid="tool-import-review">
      <div className="flex items-center gap-3">
        <ToolImportLogo source={plan.source} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-900">
            {translator.translateTemplate("What OneUptime found in {{tool}}", {
              tool: toolTitle,
            })}
          </p>
          <p className="text-sm text-gray-500">
            {plan.accountName
              ? translator.translateTemplate("{{account}}, read {{time}}", {
                  account: plan.accountName,
                  time: formatToolImportDateTime(
                    plan.readAt,
                    translator.language,
                  ),
                })
              : translator.translateTemplate("Read {{time}}", {
                  time: formatToolImportDateTime(
                    plan.readAt,
                    translator.language,
                  ),
                })}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-gray-600">
        {translator.translateText(
          "Tick what to bring over. Nothing is created until you start the import, and running it again later never creates anything twice.",
        )}
      </p>

      {plan.notes.length > 0 && (
        <div
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          data-testid="tool-import-plan-notes"
        >
          <ToolImportNoteList notes={plan.notes} toolTitle={toolTitle} />
        </div>
      )}

      {sections.length === 0 ? (
        <p
          className="mt-6 text-sm text-gray-700"
          data-testid="tool-import-nothing-found"
        >
          {translator.translateTemplate(
            "OneUptime found nothing in {{tool}} that it can bring over.",
            { tool: toolTitle },
          )}
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {sections.map((section: ToolImportPlanSection): ReactElement => {
            return (
              <ToolImportReviewSection
                key={section.kind}
                section={section}
                toolTitle={toolTitle}
                selection={selection}
                itemsByKey={itemsByKey}
                onSetKeys={onSetKeys}
              >
                {section.kind === ToolImportResourceKind.StatusPageSubscriber &&
                section.selectableKeys.length > 0 ? (
                  <ToolImportSubscribersConsent
                    isConsented={subscribersConsent}
                    isNeeded={isMovingSubscribers}
                    onChange={setSubscribersConsent}
                  />
                ) : undefined}
              </ToolImportReviewSection>
            );
          })}
        </div>
      )}

      <div
        className="sticky bottom-0 z-10 mt-6 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg"
        data-testid="tool-import-review-footer"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <p
              className="text-sm font-medium text-gray-900"
              data-testid="tool-import-ticked-count"
            >
              {translator.translatePlural(
                TOOL_IMPORT_PLURALS.ticked,
                selectedKeys.length,
                { total: translator.formatNumber(selectableCount) },
              )}
            </p>
            {isInviting && teamOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <span id={inviteTeamLabelId} className="text-sm text-gray-600">
                  {translator.translateText("Invite new people to")}
                </span>
                <div className="w-56">
                  <Dropdown
                    options={teamOptions}
                    value={teamOptions.find((option: DropdownOption) => {
                      return option.value === inviteTeamId;
                    })}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      if (typeof value === "string") {
                        setInviteTeamId(value);
                      }
                    }}
                    isClearable={false}
                    ariaLabelledby={inviteTeamLabelId}
                    dataTestId="tool-import-invite-team"
                  />
                </div>
              </div>
            )}
            {isInviting && teamOptions.length === 0 && (
              <p
                className="text-sm text-amber-700"
                data-testid="tool-import-no-invite-team"
              >
                {translator.translateText(
                  "There is no team you may add new people to, so nobody will be invited.",
                )}
              </p>
            )}
          </div>
          <div className={TOOL_IMPORT_BUTTON_ROW_CLASS_NAME}>
            <Button
              title="Discard"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                void discard();
              }}
              isLoading={isDiscarding}
              disabled={isStarting}
              dataTestId="tool-import-discard"
            />
            <Button
              title="Start import"
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={IconProp.InboxArrowDown}
              onClick={() => {
                void start();
              }}
              isLoading={isStarting}
              disabled={
                selectedKeys.length === 0 || isDiscarding || isWaitingForConsent
              }
              tooltip={
                selectedKeys.length === 0
                  ? "Tick at least one thing to bring over."
                  : isWaitingForConsent
                    ? "Confirm that you may move the subscribers you ticked, or untick them."
                    : undefined
              }
              dataTestId="tool-import-start"
            />
          </div>
        </div>
        {error && (
          <p
            className="mt-2 text-sm text-red-600"
            role="alert"
            data-testid="tool-import-review-error"
          >
            {translator.translateText(error)}
          </p>
        )}
      </div>
    </div>
  );
};

export default ToolImportReview;
