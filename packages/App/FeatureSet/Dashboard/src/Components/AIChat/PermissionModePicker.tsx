import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "Common/Types/AI/AIChatPermissionMode";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { MenuSide, useMenuSide } from "./MenuSide";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  value: AIChatPermissionMode;
  onChange: (mode: AIChatPermissionMode) => void;
  disabled?: boolean | undefined;
  /*
   * Which edge of the button the menu lines up with. Defaults to "right",
   * for a picker at the right end of a composer's controls. A picker at the
   * left end passes "left": lined up on its right edge, the menu (wider
   * than the button) would open past the left edge of whatever holds it.
   */
  menuAlign?: "left" | "right" | undefined;
  /*
   * Which side of the button the menu opens on. Defaults to "top", for a
   * composer at the foot of its surface. Ask AI's start draws the composer
   * near the top of the dialog, where a menu opening upwards would be cut
   * off by the dialog's edge: there it asks for "bottom". Either way the
   * menu opens on the other side when it would not fit on the one asked
   * for and fits better there (MenuSide).
   */
  menuSide?: MenuSide | undefined;
}

const modeIcon: { [key in AIChatPermissionMode]: IconProp } = {
  [AIChatPermissionMode.AskForApproval]: IconProp.ShieldCheck,
  [AIChatPermissionMode.AutoRun]: IconProp.Bolt,
  [AIChatPermissionMode.ReadOnly]: IconProp.Eye,
};

// English keys, translated when drawn.
const shortLabel: { [key in AIChatPermissionMode]: string } = {
  [AIChatPermissionMode.AskForApproval]: translationKey("Ask to act"),
  [AIChatPermissionMode.AutoRun]: translationKey("Auto-run"),
  [AIChatPermissionMode.ReadOnly]: translationKey("Read-only"),
};

const PermissionModePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const menuRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const menuId: string = useId();
  // 8 px between the button and the menu (mt-2 / mb-2).
  const menuSide: MenuSide = useMenuSide({
    isOpen: isOpen,
    preferred: props.menuSide || "top",
    gap: 8,
    buttonRef: buttonRef,
    menuRef: menuRef,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    /*
     * Escape closes the menu and hands focus back to the button it came
     * from - and only the menu: the key is marked as spent, so the dialog
     * the picker sits in (Ask AI) does not close with it.
     */
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const options: Array<AIChatPermissionModeOption> =
    AIChatPermissionModeHelper.getOptions();

  return (
    <div className="relative" ref={containerRef}>
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
        className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
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
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={translator.translateText("AI permissions")}
          data-menu-side={menuSide}
          className={`absolute z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ${
            menuSide === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
          } ${props.menuAlign === "left" ? "left-0" : "right-0"}`}
        >
          <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
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
                  <Icon icon={modeIcon[option.value]} className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-900">
                      {translator.translateText(option.title)}
                    </span>
                    {isSelected && (
                      <Icon
                        icon={IconProp.Check}
                        className="h-3 w-3 text-gray-900"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
                    {translator.translateText(option.description)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PermissionModePicker;
