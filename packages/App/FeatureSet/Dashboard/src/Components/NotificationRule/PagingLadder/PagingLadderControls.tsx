import {
  PagingMethodChoice,
  getMethodChoiceLabel,
} from "./PagingLadderMethods";
import { getMethodIcon } from "./PagingLadderParts";
import { PAGING_LADDER_COPY, describeWait } from "./PagingLadderWords";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PAGING_LADDER_WAITS_IN_MINUTES,
  getPagingLadderMethodKey,
} from "Common/Types/NotificationRule/PagingLadder";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuDivider from "Common/UI/Components/MoreMenu/Divider";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a person presses on How to Reach Me's ladder (#8139): a step's time,
 * which opens the times a step can have, and the menus that add a way to
 * reach them - to a step, or as a step of its own after the last.
 */

// The times a step's menu offers: the page's, and the step's own when it is another.
export const getWaitChoices: (currentWait: number) => Array<number> = (
  currentWait: number,
): Array<number> => {
  const waits: Set<number> = new Set<number>(PAGING_LADDER_WAITS_IN_MINUTES);
  waits.add(currentWait);

  return Array.from(waits).sort((a: number, b: number): number => {
    return a - b;
  });
};

/*
 * The time a step added after the last one starts at: the first the page
 * offers after the last step's. None after an hour, the longest it offers.
 */
export const getNextStepWait: (lastWait: number) => number | null = (
  lastWait: number,
): number | null => {
  const next: number | undefined = PAGING_LADDER_WAITS_IN_MINUTES.find(
    (wait: number): boolean => {
      return wait > lastWait;
    },
  );

  return next === undefined ? null : next;
};

export interface StepWaitMenuProps {
  wait: number;
  isEditable: boolean;
  onChange: (wait: number) => void;
}

/*
 * A step's time, as its heading: "At once", "After 5 minutes". Pressed, it
 * offers the other times, and the whole step moves to the one picked - to
 * go out with the step already there, if there is one.
 */
export const StepWaitMenu: FunctionComponent<StepWaitMenuProps> = (
  props: StepWaitMenuProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = describeWait(translator, props.wait);

  if (!props.isEditable) {
    return (
      <span
        className="text-sm font-semibold text-gray-900"
        data-testid="paging-ladder-step-wait"
      >
        {label}
      </span>
    );
  }

  return (
    <MoreMenu
      isMenuPortaled={true}
      // The time starts its line, so its menu opens under it.
      isMenuLeftAligned={true}
      dataTestId="paging-ladder-step-wait-menu"
      elementToBeShownInsteadOfButton={
        /*
         * No negative margin and no truncation: MoreMenu wraps its trigger
         * in an inline-block, which a negative margin shrinks under the
         * label, and "At once" was cut to "At o...".
         */
        <button
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={translator.translateTemplate(
            PAGING_LADDER_COPY.changeWait,
            {
              wait: composedValue((sentence: Translator): string => {
                return describeWait(sentence, props.wait);
              }),
            },
          )}
          data-testid="paging-ladder-step-wait"
        >
          <span>{label}</span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
          />
        </button>
      }
    >
      {getWaitChoices(props.wait).map((wait: number): ReactElement => {
        const isSelected: boolean = wait === props.wait;

        /*
         * One time of several, so the tick on the one in use is the
         * item's icon and the others keep its space (PushRepeatControl).
         */
        return (
          <MoreMenuItem
            key={wait}
            // In the reader's words already: drawn as given.
            text={describeWait(translator, wait)}
            isUserContent={true}
            icon={isSelected ? IconProp.Check : undefined}
            isIconSpaceReserved={true}
            isChecked={isSelected}
            dataTestId={`paging-ladder-wait-option-${wait}`}
            onClick={() => {
              if (!isSelected) {
                props.onChange(wait);
              }
            }}
          />
        );
      })}
    </MoreMenu>
  );
};

export interface AddMethodMenuProps {
  // The methods this menu can add, in the order to offer them.
  methods: ReadonlyArray<PagingMethodChoice>;
  onPick: (choice: PagingMethodChoice) => void;
  // Your own page: the last item opens Notification Methods, to set up another.
  onSetUpMore?: (() => void) | undefined;
  // What the menu opens from: a step's Add, Add Step, or the empty ladder's button.
  trigger: ReactElement;
  dataTestId: string;
}

/*
 * The ways to reach somebody that a step can add, each named as the
 * cards below name it ("Phone call: +15550100", #7178) with its icon, and
 * on your own page a way to set up another. Drawn as written, in the
 * page's direction: a "WhatsApp: ..." under a "پیامک: ..." reads from the
 * right on a Persian page, as the Persian ones do.
 */
export const AddMethodMenu: FunctionComponent<AddMethodMenuProps> = (
  props: AddMethodMenuProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const items: Array<ReactElement> = props.methods.map(
    (choice: PagingMethodChoice): ReactElement => {
      const key: string = getPagingLadderMethodKey(choice);

      return (
        <MoreMenuItem
          key={key}
          text={getMethodChoiceLabel(translator, choice)}
          isUserContent={true}
          icon={getMethodIcon(choice)}
          dataTestId={`paging-ladder-add-option-${key}`}
          onClick={() => {
            props.onPick(choice);
          }}
        />
      );
    },
  );

  if (props.onSetUpMore) {
    if (items.length > 0) {
      items.push(<MoreMenuDivider key="divider" />);
    }

    const onSetUpMore: () => void = props.onSetUpMore;

    items.push(
      <MoreMenuItem
        key="set-up-more"
        text={PAGING_LADDER_COPY.setUpMoreMethods}
        icon={IconProp.Settings}
        dataTestId="paging-ladder-set-up-more"
        onClick={() => {
          onSetUpMore();
        }}
      />,
    );
  }

  return (
    <MoreMenu
      isMenuPortaled={true}
      isMenuLeftAligned={true}
      // Room for "Push notification: Pixel 10" on one line.
      isMenuWide={true}
      dataTestId={props.dataTestId}
      elementToBeShownInsteadOfButton={props.trigger}
    >
      {items}
    </MoreMenu>
  );
};
