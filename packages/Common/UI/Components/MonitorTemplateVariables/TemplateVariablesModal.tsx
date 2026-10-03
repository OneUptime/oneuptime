import Modal, { ModalWidth } from "../Modal/Modal";
import Icon, { SizeProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import MonitorType from "../../../Types/Monitor/MonitorType";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "./TemplateVariablesCatalog";

export interface ComponentProps {
  monitorType: MonitorType;
  /**
   * Group-by attribute keys from the metric query, if any. Used to
   * populate the "Series Labels" section with per-host / per-container
   * variables like `{{host.name}}`.
   */
  seriesAttributeKeys?: Array<string> | undefined;
  onClose: () => void;
}

/**
 * Modal that surfaces the dynamic template variables available to the
 * current monitor's incident/alert titles, descriptions, and
 * remediation notes. Organized by monitor type so a metric monitor
 * doesn't show SSL variables (and vice versa), with a live search
 * that scales when a user groups by many attributes.
 *
 * Click a variable to copy `{{var}}` to the clipboard; the chip flips
 * to a "Copied" state briefly so the feedback lands on the thing that
 * was clicked.
 */
const TemplateVariablesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [search, setSearch] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const groups: Array<TemplateVariableGroup> = useMemo(() => {
    return TemplateVariablesCatalog.getVariables({
      monitorType: props.monitorType,
      seriesAttributeKeys: props.seriesAttributeKeys,
    });
  }, [props.monitorType, props.seriesAttributeKeys]);

  const normalized: string = search.trim().toLowerCase();

  const filteredGroups: Array<TemplateVariableGroup> = useMemo(() => {
    if (!normalized) {
      return groups;
    }
    return groups
      .map((group: TemplateVariableGroup): TemplateVariableGroup => {
        return {
          ...group,
          variables: group.variables.filter((v: TemplateVariable) => {
            return (
              v.key.toLowerCase().includes(normalized) ||
              v.description.toLowerCase().includes(normalized)
            );
          }),
        };
      })
      .filter((group: TemplateVariableGroup) => {
        return group.variables.length > 0;
      });
  }, [groups, normalized]);

  const copyToClipboard: (key: string) => void = (key: string): void => {
    const token: string = `{{${key}}}`;
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      void navigator.clipboard.writeText(token);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((current: string | null): string | null => {
        return current === key ? null : current;
      });
    }, 1500);
  };

  const renderVariableRow: (v: TemplateVariable) => ReactElement = (
    v: TemplateVariable,
  ): ReactElement => {
    const isCopied: boolean = copiedKey === v.key;
    return (
      <button
        key={v.key}
        type="button"
        onClick={(): void => {
          copyToClipboard(v.key);
        }}
        className="group w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
        title={translator.translateTemplate("Click to copy {{token}}", {
          token: `{{${v.key}}}`,
        })}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <code className="font-mono text-sm text-indigo-700 break-all">
              {`{{${v.key}}}`}
            </code>
            <p className="mt-1 text-xs leading-snug text-gray-600">
              {translator.translateText(v.description)}
            </p>
            {v.example ? (
              <p className="mt-1 text-xs text-gray-400">
                <TranslatedSentence
                  template="Example: {{example}}"
                  slots={{
                    example: (
                      <span className="font-mono text-gray-500">
                        {v.example}
                      </span>
                    ),
                  }}
                />
              </p>
            ) : null}
          </div>
          <span
            className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition ${
              isCopied
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-500 group-hover:bg-indigo-100 group-hover:text-indigo-700"
            }`}
          >
            {translator.translateText(isCopied ? "Copied" : "Copy")}
          </span>
        </div>
      </button>
    );
  };

  const renderGroup: (group: TemplateVariableGroup) => ReactElement = (
    group: TemplateVariableGroup,
  ): ReactElement => {
    return (
      <div key={group.title} className="space-y-2">
        <div className="border-b border-gray-200 pb-1.5">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText(group.title)}
          </h3>
          {group.description ? (
            <p className="mt-0.5 text-xs text-gray-500">
              {translator.translateText(group.description)}
            </p>
          ) : null}
        </div>
        {group.variables.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.variables.map(renderVariableRow)}
          </div>
        ) : (
          <p className="text-xs italic text-gray-400">
            {translator.translateText("No variables in this section yet.")}
          </p>
        )}
      </div>
    );
  };

  const totalVariables: number = groups.reduce(
    (sum: number, group: TemplateVariableGroup) => {
      return sum + group.variables.length;
    },
    0,
  );

  return (
    <Modal
      title="Dynamic Template Variables"
      description={translator.translatePlural(
        {
          one: "Use these variables in incident and alert titles, descriptions, and remediation notes. Click any variable to copy it. {{count}} variable available for this monitor type.",
          other:
            "Use these variables in incident and alert titles, descriptions, and remediation notes. Click any variable to copy it. {{count}} variables available for this monitor type.",
        },
        totalVariables,
      )}
      onClose={props.onClose}
      closeButtonText="Done"
      modalWidth={ModalWidth.Large}
    >
      <div className="space-y-4">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon
              icon={IconProp.Search}
              size={SizeProp.Smaller}
              className="h-4 w-4 text-gray-400"
            />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
              setSearch(e.target.value);
            }}
            placeholder={translator.translateText("Filter variables…")}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            autoFocus
          />
        </div>

        {filteredGroups.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
            <TranslatedSentence
              template="No variables match {{search}}."
              slots={{ search: <code className="font-mono">{search}</code> }}
            />
          </div>
        ) : (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {filteredGroups.map(renderGroup)}
          </div>
        )}

        <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
          <p className="font-medium">
            {translator.translateText("Syntax tips")}
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              <TranslatedSentence
                template="Wrap the variable name in double braces: {{example}}"
                slots={{
                  example: (
                    <code className="font-mono">{"{{monitorName}}"}</code>
                  ),
                }}
              />
            </li>
            <li>
              <TranslatedSentence
                template="Use dot paths for nested values: {{example}}"
                slots={{
                  example: (
                    <code className="font-mono">
                      {"{{responseBody.data.status}}"}
                    </code>
                  ),
                }}
              />
            </li>
            <li>
              {translator.translateText(
                "Missing values render as empty strings — they will not break the template.",
              )}
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
};

export default TemplateVariablesModal;
