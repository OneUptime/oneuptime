import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChatProvider } from "./useAiChat";

export interface ComponentProps {
  providers: Array<ChatProvider>;
  selectedProviderId: string | undefined;
  onSelect: (id: string) => void;
  // Compact variant sits inside the composer; full shows the provider name too.
  variant?: "compact" | "full";
  disabled?: boolean;
}

function providerLabel(provider: ChatProvider): string {
  // Prefer the concrete model, falling back to the provider's friendly name.
  return provider.modelName || provider.name || "Model";
}

/*
 * The in-chat provider / model switcher. Lets a user run a conversation
 * against any provider configured for the project (or a shared global
 * provider) and switch mid-thread. Purely presentational — selection is
 * persisted server-side when the next message is sent.
 */
const ProviderPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const variant: "compact" | "full" = props.variant || "compact";

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onClick: (event: MouseEvent) => void = (event: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen]);

  const selected: ChatProvider | undefined = props.providers.find(
    (provider: ChatProvider) => {
      return provider.id === props.selectedProviderId;
    },
  );

  // Nothing to switch between and nothing selected — hide entirely.
  if (props.providers.length === 0 && !selected) {
    return <></>;
  }

  const triggerLabel: string = selected
    ? providerLabel(selected)
    : "Default model";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={props.disabled}
        title="Choose AI model"
        onClick={() => {
          setIsOpen((open: boolean) => {
            return !open;
          });
        }}
        className={`flex max-w-[190px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${
          variant === "compact" ? "" : "px-3 py-1.5"
        }`}
      >
        <Icon
          icon={IconProp.Sparkles}
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
        />
        <span className="truncate font-medium">{triggerLabel}</span>
        <Icon
          icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
          className="h-3 w-3 flex-shrink-0 text-gray-400"
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              AI model
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {props.providers.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-500">
                No AI providers configured yet. Add one in Settings → AI → LLM
                Providers.
              </div>
            )}
            {props.providers.map((provider: ChatProvider) => {
              const isSelected: boolean =
                provider.id === props.selectedProviderId;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    props.onSelect(provider.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 ${
                    isSelected ? "bg-gray-50" : ""
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${
                      isSelected
                        ? "bg-gray-900 text-white"
                        : "border border-gray-300"
                    }`}
                  >
                    {isSelected && (
                      <Icon icon={IconProp.Check} className="h-2.5 w-2.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {provider.modelName || provider.name}
                      </span>
                      {provider.isDefault && (
                        <span className="flex-shrink-0 rounded bg-emerald-50 px-1 py-px text-[9px] font-semibold uppercase text-emerald-600">
                          Default
                        </span>
                      )}
                      {provider.isGlobal && (
                        <span className="flex-shrink-0 rounded bg-sky-50 px-1 py-px text-[9px] font-semibold uppercase text-sky-600">
                          Global
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-gray-400">
                      {provider.name}
                      {provider.llmType ? ` · ${provider.llmType}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProviderPicker;
