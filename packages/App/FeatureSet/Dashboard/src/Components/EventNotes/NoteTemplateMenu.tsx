import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface NoteTemplateOption {
  id: string;
  name: string;
  note: string;
}

export interface ComponentProps {
  loadTemplates: () => Promise<Array<NoteTemplateOption>>;
  onPick: (template: NoteTemplateOption) => void;
  settingsRoute?: Route | undefined;
  isDisabled?: boolean | undefined;
  // Opens the menu above the trigger, for a trigger near the bottom of a card.
  isOpeningUpwards?: boolean | undefined;
}

// Above this many templates the menu grows a filter box.
export const TEMPLATE_FILTER_THRESHOLD: number = 6;

type TemplatePreviewFunction = (note: string) => string;

// The first line of the template with its markdown markers stripped.
export const getTemplatePreview: TemplatePreviewFunction = (
  note: string,
): string => {
  const firstLine: string =
    note
      .split("\n")
      .map((line: string) => {
        return line.trim();
      })
      .find((line: string) => {
        return line.length > 0;
      }) || "";

  return firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`~]/g, "")
    .trim();
};

/*
 * "Templates" in the composer. Picking one drops its text straight into the
 * note being written - no second dialog, and nothing already typed is lost.
 * Templates load the first time the menu opens, so a page nobody writes on
 * never asks for them.
 */
const NoteTemplateMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [templates, setTemplates] = useState<Array<NoteTemplateOption> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      setTemplates(await props.loadTemplates());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (isComponentVisible && templates === null && !isLoading && !error) {
      load();
    }

    if (!isComponentVisible) {
      setFilterText("");
    }
  }, [isComponentVisible]);

  const visibleTemplates: Array<NoteTemplateOption> = (templates || []).filter(
    (template: NoteTemplateOption) => {
      const needle: string = filterText.trim().toLowerCase();

      if (!needle) {
        return true;
      }

      return (
        template.name.toLowerCase().includes(needle) ||
        template.note.toLowerCase().includes(needle)
      );
    },
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div
          className="space-y-2 px-3 py-3"
          data-testid="note-templates-loading"
          aria-busy="true"
        >
          {[0, 1, 2].map((index: number) => {
            return (
              <div
                key={index}
                className="h-9 animate-pulse rounded-md bg-gray-100"
              />
            );
          })}
        </div>
      );
    }

    if (error) {
      return (
        <div className="px-4 py-4 text-sm">
          <p className="text-red-700">{error}</p>
          <button
            type="button"
            className="mt-2 font-medium text-indigo-600 hover:text-indigo-500"
            onClick={() => {
              load();
            }}
          >
            {tx("Try again")}
          </button>
        </div>
      );
    }

    if (templates && templates.length === 0) {
      return (
        <div
          className="px-4 py-5 text-center"
          data-testid="note-templates-empty"
        >
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.Template} className="h-4 w-4 text-gray-500" />
          </div>
          <p className="mt-2 text-sm font-medium text-gray-900">
            {tx("No note templates yet")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {tx(
              "Save the updates you write most often as templates and reuse them here.",
            )}
          </p>
          {props.settingsRoute && (
            <Link
              to={props.settingsRoute}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              <>
                {tx("Create a template")}
                <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
              </>
            </Link>
          )}
        </div>
      );
    }

    return (
      <>
        {(templates?.length || 0) >= TEMPLATE_FILTER_THRESHOLD && (
          <div className="border-b border-gray-100 p-2">
            <input
              type="search"
              autoFocus={true}
              value={filterText}
              aria-label={tx("Filter templates")}
              placeholder={tx("Filter templates…")}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setFilterText(event.target.value);
              }}
              className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {visibleTemplates.map((template: NoteTemplateOption) => {
            const preview: string = getTemplatePreview(template.note);

            return (
              <li key={template.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                  onClick={() => {
                    props.onPick(template);
                    setIsComponentVisible(false);
                  }}
                >
                  <span className="w-full truncate text-sm font-medium text-gray-900">
                    {template.name || tx("Untitled template")}
                  </span>
                  {preview && (
                    <span className="w-full truncate text-xs text-gray-500">
                      {preview}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {visibleTemplates.length === 0 && (
            <li className="px-3 py-3 text-sm text-gray-500">
              {tx("No templates match your filter.")}
            </li>
          )}
        </ul>
        {props.settingsRoute && (
          <div className="border-t border-gray-100 px-3 py-2">
            <Link
              to={props.settingsRoute}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              {tx("Manage templates")}
            </Link>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={props.isDisabled}
        aria-haspopup="listbox"
        aria-expanded={isComponentVisible}
        data-testid="note-template-menu-button"
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon icon={IconProp.Template} className="h-4 w-4" />
        <span>{tx("Templates")}</span>
        <Icon
          icon={IconProp.ChevronDown}
          className="h-3.5 w-3.5 text-gray-400"
        />
      </button>

      {isComponentVisible && (
        <div
          data-testid="note-template-menu"
          className={`absolute left-0 z-30 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 ${
            props.isOpeningUpwards ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {tx("Insert a template")}
          </div>
          {getBody()}
        </div>
      )}
    </div>
  );
};

export default NoteTemplateMenu;
