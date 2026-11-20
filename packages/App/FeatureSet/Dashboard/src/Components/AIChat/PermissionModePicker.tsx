import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "Common/Types/AI/AIChatPermissionMode";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import LayeredPopover, {
  LayeredPopoverAlignment,
  LayeredPopoverSide,
} from "Common/UI/Components/Tooltip/LayeredPopover";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { describePermissionMode } from "./PermissionModeWords";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  value: AIChatPermissionMode;
  onChange: (mode: AIChatPermissionMode) => void;
  disabled?: boolean | undefined;
  /*
   * Which edge of the button the menu lines up with, in the line's
   * direction. Defaults to "end", for a picker at the end of a composer's
   * controls. A picker at their start passes "start": lined up on its end,
   * the menu (wider than the button) would hang back past the start of
   * whatever holds it.
   */
  menuAlign?: LayeredPopoverAlignment | undefined;
  /*
   * Which side of the button the menu opens on. Defaults to "top", for a
   * composer at the foot of its surface. A composer near the top of its
   * surface asks for "bottom". Either way the menu opens on the other side
   * when the window has no room for it on the one asked for (LayeredPopover).
   */
  menuSide?: LayeredPopoverSide | undefined;
}

// 8px between the button and the menu.
const MENU_GAP_PX: number = 8;

const modeIcon: { [key in AIChatPermissionMode]: IconProp } = {
  [AIChatPermissionMode.AskForApproval]: IconProp.ShieldCheck,
  [AIChatPermissionMode.AutoRun]: IconProp.Bolt,
  [AIChatPermissionMode.ReadOnly]: IconProp.Eye,
};

/*
 * Each mode's name: on the button for the mode chosen, and in the menu over
 * what the mode means (describePermissionMode), so the menu offers the
 * modes by the names the button and the docs give them. English keys,
 * translated when drawn.
 */
const shortLabel: { [key in AIChatPermissionMode]: string } = {
  [AIChatPermissionMode.AskForApproval]: translationKey("Ask to act"),
  [AIChatPermissionMode.AutoRun]: translationKey("Auto-run"),
  [AIChatPermissionMode.ReadOnly]: translationKey("Read-only"),
};

/*
 * What the AI may do with a request, as a menu: on the tooltip layer
 * (LayeredPopover), placed against the window, so a composer in a card, a
 * dialog or a scrolling panel never cuts it off (#9910). The layer closes
 * it on Escape - spent there, so the panel the picker sits in (Ask AI) does
 * not close with it - on a press outside and on the focus leaving it, and
 * Tab goes through it as if it sat right after its button.
 */
const PermissionModePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const menuId: string = useId();

  const close: () => void = useCallback((): void => {
    setIsOpen(false);
  }, []);

  const options: Array<AIChatPermissionModeOption> =
    AIChatPermissionModeHelper.getOptions();

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => {
          setIsOpen((open: boolean) => {
            return !open;
          });
        }}
        title={translator.translateText("Choose what the AI is allowed to do")}
        className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
          {
            isLocked: props.disabled,
            hoverClassName: "hover:border-gray-300 hover:bg-gray-50",
          },
        )}`}
      >
        <Icon
          icon={modeIcon[props.value]}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
        <span>{translator.translateText(shortLabel[props.value])}</span>
        <Icon
          icon={IconProp.ChevronDown}
          className="h-3 w-3 flex-shrink-0 text-gray-400"
        />
      </button>

      {isOpen && (
        <LayeredPopover
          anchorRef={buttonRef}
          onClose={close}
          side={props.menuSide || "top"}
          align={props.menuAlign || "end"}
          gap={MENU_GAP_PX}
        >
          <div
            id={menuId}
            role="menu"
            aria-label={translator.translateText("AI permissions")}
            className="w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("AI permissions")}
            </div>
            {options.map((option: AIChatPermissionModeOption) => {
              const isSelected: boolean = option.value === props.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    props.onChange(option.value);
                    setIsOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-100 ${
                    isSelected ? "bg-gray-50" : ""
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg ${
                      isSelected
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    <Icon
                      icon={modeIcon[option.value]}
                      className="h-3.5 w-3.5"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-900">
                        {translator.translateText(shortLabel[option.value])}
                      </span>
                      {isSelected && (
                        <Icon
                          icon={IconProp.Check}
                          className="h-3 w-3 text-gray-900"
                        />
                      )}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-gray-500">
                      {translator.translateText(
                        describePermissionMode(option.value),
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </LayeredPopover>
      )}
    </div>
  );
};

export default PermissionModePicker;
