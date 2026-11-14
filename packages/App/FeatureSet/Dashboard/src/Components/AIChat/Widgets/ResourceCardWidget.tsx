import {
  AIChatCitationTarget,
  AIChatWidget,
  getAIChatResourceCardStatusColor,
  isAIChatReadResourceCard,
} from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { navigateToCitationTarget } from "../CitationTargetNav";
import {
  DrawnResourceCard,
  DrawnResourceCardFact,
  getDrawnResourceCard,
} from "../ResourceCardWords";
import ToolActionSentence, { ToolActionSentences } from "../ToolActionSentence";

export interface ComponentProps {
  widget: AIChatWidget;
}

/*
 * The two looks of the card (issue #6968). A write's is green, with a
 * check: it says something was done. A read's is plain, as the other
 * widgets are: it shows a record as it is, and a monitor that is Offline,
 * or whose monitoring is off, is not something done well. A card saved
 * before cards said which is drawn as a write's, as it was then. Whole
 * class names, each one Theme.css redraws for the dark theme.
 */
export const RESOURCE_CARD_LOOKS: {
  read: { card: string; kind: string; open: string };
  write: { card: string; kind: string; open: string };
} = {
  read: {
    card: "rounded-xl border border-gray-200 bg-white p-3.5",
    kind: "text-gray-500",
    open: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
  },
  write: {
    card: "rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5",
    kind: "text-emerald-600",
    open: "text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800",
  },
};

/*
 * The card a tool leaves under the answer: what a write created or changed
 * ("ALT-12 · High memory usage on test01"), or the record a read looked up
 * ("payments-api", Offline), with an Open to it, as the other widgets
 * have. Its heading and values wrap rather than being cut at one line: on
 * a phone the alert's own title was lost after a few words. Its kind, its
 * line and its facts are in the reader's language when the card has words
 * (ResourceCardWords), each sentence read its language's way with its
 * values set apart; a card saved before them reads as its stored English.
 */
const ResourceCardWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * In the reader's language when the card has words; else its stored
   * English, each fact once: a fact the heading or the line under it
   * already says ("#42", "Severity: High") is left out - for a card saved
   * in an older conversation too (Types/AI/ResourceCardFacts).
   */
  const card: DrawnResourceCard = getDrawnResourceCard(
    props.widget,
    translator,
  );
  const link: AIChatCitationTarget | undefined = props.widget.data.link;
  const isRead: boolean = isAIChatReadResourceCard(props.widget.data);
  const look: { card: string; kind: string; open: string } = isRead
    ? RESOURCE_CARD_LOOKS.read
    : RESOURCE_CARD_LOOKS.write;
  // The status the line names, in its own colour (a monitor's; gray when its monitoring is off).
  const statusColor: string | null = getAIChatResourceCardStatusColor(
    props.widget.data.statusColor,
  );
  /*
   * Open says what it opens to a screen reader and on hover: under an
   * answer that created an incident and an alert, two bare "Open"s did not
   * say which was which.
   */
  const openName: string = card.heading
    ? translator.translateTemplate("Open {{name}}", {
        name: card.heading,
      })
    : translator.translateText("Open") || "Open";

  return (
    <div
      data-testid="ai-chat-resource-card"
      data-card-origin={isRead ? "read" : "write"}
      className={look.card}
    >
      <div className="flex items-start gap-2.5">
        {/*
         * A write's check: something was done. A read's card has none - a
         * monitor looked up while it is down was not done well.
         */}
        {!isRead && (
          <div
            data-testid="ai-chat-resource-card-done"
            className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500"
          >
            <Icon icon={IconProp.CheckCircle} className="h-4 w-4 text-white" />
          </div>
        )}
        {/*
         * A size container: its facts sit beside their names where the
         * card has room, and under them on a phone (below).
         */}
        <div className="min-w-0 flex-1 [container-type:inline-size]">
          {/*
           * Open sits on the kind's line, so the heading and the facts
           * under it keep the card's whole width: beside them, on a
           * phone, it squeezed every value onto two lines.
           */}
          {(card.kind || link) && (
            <div className="flex items-center justify-between gap-2">
              <div
                data-testid="ai-chat-resource-card-kind"
                className={`min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide ${look.kind}`}
              >
                {card.kind}
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
                  className={`-my-1 -me-1.5 flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${look.open}`}
                >
                  {translator.translateText("Open")}
                  <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {/*
           * The record by its number and title: data, read the way most of
           * its letters are, so a Persian page keeps an English title's
           * punctuation at its end.
           */}
          <div
            data-testid="ai-chat-resource-card-heading"
            className="line-clamp-3 break-words text-sm font-semibold text-gray-900"
          >
            <ToolActionSentence
              sentence={{
                text: card.heading,
                direction: null,
                separatorBefore: "",
              }}
            />
          </div>
          {card.line.length > 0 && (
            <div
              data-testid="ai-chat-resource-card-line"
              className="mt-0.5 break-words text-xs text-gray-500"
            >
              {/*
               * The status's own colour before the line that names it, as
               * the Monitors table draws a status: the words say it, so the
               * dot is for the eye only.
               */}
              {statusColor && (
                <span
                  data-testid="ai-chat-resource-card-status-dot"
                  aria-hidden="true"
                  className="me-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{
                    backgroundColor: statusColor,
                    boxShadow: "0 0 0 1px var(--ou-border-strong, #d1d5db)",
                  }}
                />
              )}
              <ToolActionSentences sentences={card.line} />
            </div>
          )}
          {/*
           * The facts: each name beside its value where the card has room
           * (22rem), and over it on a phone - beside it there, a German
           * name ("Betroffene Ressourcen") left the value a third of the
           * card, and a description was cut after a few words. The names
           * are gray-500: gray-400 on the card's green read at about 2.5:1.
           * Beside them, the names take at most 40% of the card and wrap
           * there, as the PDF's do: a long one - "Stufe der
           * Fehlerbudget-Richtlinie", an escalation rule named by its team -
           * left every value of the card a narrow column, cut at "nach
           * 3..." where it said after 30 minutes (issue #7175). A value
           * takes up to four lines: an escalation rule's targets and a
           * status page's resources are sentences, longer in German and
           * Persian than in English.
           */}
          {card.facts.length > 0 && (
            <dl
              data-testid="ai-chat-resource-card-facts"
              className="mt-2.5 space-y-1.5 [@container(min-width:22rem)]:grid [@container(min-width:22rem)]:grid-cols-[fit-content(40%)_minmax(0,1fr)] [@container(min-width:22rem)]:gap-x-3 [@container(min-width:22rem)]:gap-y-1"
            >
              {card.facts.map((fact: DrawnResourceCardFact, index: number) => {
                return (
                  <div
                    key={index}
                    data-testid="ai-chat-resource-card-fact"
                    className="[@container(min-width:22rem)]:contents"
                  >
                    <dt
                      data-testid="ai-chat-resource-card-fact-label"
                      className="min-w-0 break-words text-[11px] font-medium text-gray-500"
                    >
                      {fact.label}
                    </dt>
                    <dd
                      data-testid="ai-chat-resource-card-fact-value"
                      className="line-clamp-4 min-w-0 break-words text-[11px] text-gray-700"
                    >
                      <ToolActionSentence sentence={fact.value} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResourceCardWidget;
