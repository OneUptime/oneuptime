import {
  getProductToolImportOffer,
  getToolImportOfferRoute,
  getToolImportOfferTitle,
  TOOL_IMPORT_HOW_IT_WORKS_QUESTION,
  TOOL_IMPORT_HOW_IT_WORKS_TEST_ID,
  ToolImportListOffer,
} from "./ToolImportOffer";
import IconProp from "Common/Types/Icon/IconProp";
import { OnboardedProductKey } from "Common/Types/Product/ProductKey";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One quiet line in a product's "How it works" (issue #7033): "Moving from
 * another tool?" and the link the product's empty list offers, "Import
 * from UptimeRobot, Better Stack, Pingdom and others". Nothing for a
 * product whose list no import fills, or for someone who may not run the
 * import (ToolImportOffer, getProductToolImportOffer).
 *
 * The question and the link are two sentences side by side, each whole in
 * the reader's language; the tools' names are brands, as on the empty list.
 */

export interface ComponentProps {
  product: OnboardedProductKey;
  // Closes what the line is drawn in (the dialog) as it opens the importer.
  onOpen?: (() => void) | undefined;
}

const ToolImportHowItWorksLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const offer: ToolImportListOffer | undefined = getProductToolImportOffer(
    props.product,
  );

  if (!offer) {
    return <></>;
  }

  return (
    <p
      className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600"
      data-testid={TOOL_IMPORT_HOW_IT_WORKS_TEST_ID}
    >
      <span>{translator.translateText(TOOL_IMPORT_HOW_IT_WORKS_QUESTION)}</span>{" "}
      <Link
        to={getToolImportOfferRoute(offer)}
        onClick={props.onOpen}
        className="inline-flex items-center gap-1.5 font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
        dataTestId={`${TOOL_IMPORT_HOW_IT_WORKS_TEST_ID}-link`}
      >
        <Icon
          icon={IconProp.InboxArrowDown}
          className="h-4 w-4 flex-shrink-0"
        />
        <span>
          {getToolImportOfferTitle({
            kind: offer.kind,
            translator: translator,
          })}
        </span>
      </Link>
    </p>
  );
};

export default ToolImportHowItWorksLine;
