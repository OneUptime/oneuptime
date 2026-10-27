import {
  AIChatCitationTarget,
  AIChatWidget,
} from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { navigateToCitationTarget } from "../CitationTargetNav";

export interface ComponentProps {
  widget: AIChatWidget;
}

/*
 * The card a write leaves under the answer: what was created or changed
 * ("ALT-12 · High memory usage on test01"), with an Open to it, as the
 * other widgets have. Its heading and values wrap rather than being cut
 * at one line: on a phone the alert's own title was lost after a few
 * words.
 */
const ResourceCardWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fields: Array<{ label: string; value: string }> =
    props.widget.data.fields || [];
  const link: AIChatCitationTarget | undefined = props.widget.data.link;
  /*
   * Open says what it opens to a screen reader and on hover: under an
   * answer that created an incident and an alert, two bare "Open"s did not
   * say which was which.
   */
  const openName: string = props.widget.data.heading
    ? translator.translateTemplate("Open {{name}}", {
        name: props.widget.data.heading,
      })
    : translator.translateText("Open") || "Open";

  return (
    <div
      data-testid="ai-chat-resource-card"
      className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500">
          <Icon icon={IconProp.CheckCircle} className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          {/*
           * Open sits on the kind's line, so the heading and the facts
           * under it keep the card's whole width: beside them, on a
           * phone, it squeezed every value onto two lines.
           */}
          {(props.widget.data.resourceType || link) && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                {props.widget.data.resourceType}
              </div>
              {link && (
                <button
                  type="button"
                  data-testid="ai-chat-resource-card-open"
                  aria-label={openName}
                  title={openName}
                  onClick={() => {
                    navigateToCitationTarget(link);
                  }}
                  className="-my-1 -me-1.5 flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {translator.translateText("Open")}
                  <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          <div
            data-testid="ai-chat-resource-card-heading"
            className="line-clamp-3 break-words text-sm font-semibold text-gray-900"
          >
            {props.widget.data.heading}
          </div>
          {props.widget.data.subheading && (
            <div className="mt-0.5 break-words text-xs text-gray-500">
              {props.widget.data.subheading}
            </div>
          )}
          {fields.length > 0 && (
            <dl className="mt-2.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              {fields.map(
                (field: { label: string; value: string }, index: number) => {
                  return (
                    <React.Fragment key={index}>
                      <dt className="text-[11px] font-medium text-gray-400">
                        {field.label}
                      </dt>
                      <dd className="line-clamp-2 min-w-0 break-words text-[11px] text-gray-700">
                        {field.value}
                      </dd>
                    </React.Fragment>
                  );
                },
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResourceCardWidget;
