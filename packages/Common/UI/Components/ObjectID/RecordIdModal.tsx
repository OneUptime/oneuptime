import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Modal from "../Modal/Modal";
import { API_DOCS_URL } from "../../Config";
import Navigation from "../../Utils/Navigation";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import URL from "../../../Types/API/URL";
import { getRecordIdText } from "./RecordIdText";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The dialog "Show ID" opens: a record's whole ID on a row of its own, a
 * button that copies it, and - when the API Reference documents the model -
 * a way to the page that says what the ID can be used for.
 *
 * Every table's Show ID opens it (ModelTable and AnalyticsModelTable, through
 * BaseModelTable), and so do the status page's resource and group menus. The
 * ID is turned into text here, from whatever shape the row holds it in
 * (RecordIdText.ts): a span's or an LLM call's ID is an ObjectID, not a
 * string, and the dialog that used to hand it to React as it was crashed the
 * page with minified React error #31 (issue #4615). Nothing but that text
 * ever reaches the page.
 */

export interface ComponentProps {
  /*
   * The record's ID, in whatever shape the row holds it: a string on a
   * database model, an ObjectID on an analytics (ClickHouse) row, or the
   * { _type: "ObjectID", value } JSON of an API response.
   */
  recordId: unknown;
  // What the record is, in English: "LLM Call", "Monitor". Translated here.
  itemName: string;
  /*
   * The record's own name, when the dialog should be titled after it ("API
   * Server ID") rather than after what it is ("Status Page Resource ID").
   * A name someone typed: shown as it is.
   */
  recordName?: string | undefined;
  /*
   * The model's page in the API Reference ("span", "monitor"), from
   * getApiReferencePagePath. Without one the dialog says nothing about the
   * API and offers no "Go to API Docs": a model the API Reference does not
   * document would only lead to its "Page not found".
   */
  apiReferencePagePath?: string | null | undefined;
  onClose: () => void;
}

const RecordIdModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const recordIdText: string = getRecordIdText(props.recordId);
  const itemName: TranslatableTerm = translatableTerm(props.itemName);
  const apiReferencePagePath: string = props.apiReferencePagePath || "";
  // The way to the API Reference is for an ID there is something to do with.
  const offersApiReference: boolean = Boolean(
    recordIdText && apiReferencePagePath,
  );

  const recordName: string = (props.recordName || "").trim();

  const title: string = recordName
    ? translator.translateTemplate("{{name}} ID", { name: recordName })
    : translator.translateTemplate("{{itemName}} ID", {
        itemName: itemName,
      });

  return (
    <Modal
      title={title}
      onClose={props.onClose}
      closeButtonText="Close"
      submitButtonText={offersApiReference ? "Go to API Docs" : undefined}
      onSubmit={
        offersApiReference
          ? () => {
              props.onClose();
              Navigation.navigate(
                URL.fromString(API_DOCS_URL.toString()).addRoute(
                  "/" + apiReferencePagePath,
                ),
                { openInNewTab: true },
              );
            }
          : undefined
      }
    >
      <div data-testid="record-id" className="text-sm leading-6 text-gray-600">
        {recordIdText ? (
          <>
            <p>
              {translator.translateTemplate("ID of this {{itemName}}:", {
                itemName: itemName,
              })}
            </p>
            {/*
             * Handing over the ID is the whole point of this dialog, so it
             * gets a row of its own and a copy button. One click selects all
             * of it too, for copying by hand where the browser refuses the
             * button's copy. An ID reads left to right in every language.
             * On a phone the button goes under the ID, which then fits on
             * one line instead of losing its last characters to a second.
             */}
            <div
              data-testid="record-id-row"
              className="mt-2 flex flex-col items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 sm:flex-row sm:items-center"
            >
              <code
                data-testid="record-id-value"
                dir="ltr"
                className="w-full min-w-0 flex-1 select-all break-all font-mono text-xs text-gray-800"
              >
                {recordIdText}
              </code>
              <CopyTextButton
                textToBeCopied={recordIdText}
                size="sm"
                title="Copy ID to clipboard"
              />
            </div>
            {offersApiReference ? (
              <p data-testid="record-id-api-reference" className="mt-4">
                {translator.translateTemplate(
                  "You can use this ID to interact with {{itemName}} via the OneUptime API. Click the button below to go to API Reference.",
                  {
                    itemName: itemName,
                  },
                )}
              </p>
            ) : (
              <></>
            )}
          </>
        ) : (
          <p data-testid="record-id-none">
            {translator.translateTemplate("This {{itemName}} has no ID.", {
              itemName: itemName,
            })}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default RecordIdModal;
