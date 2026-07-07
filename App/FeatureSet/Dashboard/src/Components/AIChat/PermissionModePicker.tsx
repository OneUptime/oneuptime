import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "Common/Types/AI/AIChatPermissionMode";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  value: AIChatPermissionMode;
  onChange: (mode: AIChatPermissionMode) => void;
  disabled?: boolean | undefined;
}

const modeIcon: { [key in AIChatPermissionMode]: IconProp } = {
  [AIChatPermissionMode.AskForApproval]: IconProp.ShieldCheck,
  [AIChatPermissionMode.AutoRun]: IconProp.Bolt,
  [AIChatPermissionMode.ReadOnly]: IconProp.Eye,
};

const shortLabel: { [key in AIChatPermissionMode]: string } = {
  [AIChatPermissionMode.AskForApproval]: "Ask to act",
  [AIChatPermissionMode.AutoRun]: "Auto-run",
  [AIChatPermissionMode.ReadOnly]: "Read-only",
};

const PermissionModePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

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
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [isOpen]);

  const options: Array<AIChatPermissionModeOption> =
    AIChatPermissionModeHelper.getOptions();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => {
          setIsOpen((open: boolean) => {
            return !open;
          });
        }}
        title="Choose what the copilot is allowed to do"
        className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
      >
        <Icon
          icon={modeIcon[props.value]}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
        <span>{shortLabel[props.value]}</span>
        <Icon
          icon={IconProp.ChevronDown}
          className="h-3 w-3 flex-shrink-0 text-gray-400"
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Copilot permissions
          </div>
          {options.map((option: AIChatPermissionModeOption) => {
            const isSelected: boolean = option.value === props.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  props.onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 ${
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
                      {option.title}
                    </span>
                    {isSelected && (
                      <Icon
                        icon={IconProp.Check}
                        className="h-3 w-3 text-gray-900"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
                    {option.description}
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
