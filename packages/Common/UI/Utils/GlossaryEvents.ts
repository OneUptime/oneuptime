import ProductEvents from "./ProductEvents";
import ProductFeedback from "./ProductFeedback";
import { ProductEventName } from "../../Types/Analytics/ProductEvent";
import { DefinitionOpened } from "../Components/Glossary/DefinitionOpened";

/*
 * A GLOSSARY DEFINITION OPENED IN THE PRODUCT (issue #7019): which of the
 * dotted words people open the definition of, and so which words still
 * confuse them.
 *
 * Sent as `glossary/definition_opened` (Types/Analytics/ProductEvent) by
 * the Dashboard, which hands this to every defined term on its pages
 * (DefinitionOpenedContext). A word tells it once per page it is drawn on,
 * when its definition is pressed open, reached with the keyboard, or
 * rested on by the pointer (Components/Glossary/DefinitionOpened). It
 * carries the term (its Glossary anchor, "criteria"), how it was opened
 * and the page as a route with no ids (ProductFeedback.getPage) - nothing
 * of the person, nothing they wrote - and goes where every Dashboard event
 * goes: to product analytics only where it is set up (OneUptime Cloud),
 * with the visitor's consent and without Global Privacy Control
 * (Utils/ProductEvents). A self-hosted server sends nothing.
 */
export const recordGlossaryDefinitionOpened: (
  opened: DefinitionOpened,
) => void = (opened: DefinitionOpened): void => {
  ProductEvents.send(ProductEventName.GlossaryDefinitionOpened, {
    term: opened.term,
    trigger: opened.trigger,
    page: ProductFeedback.getPage(),
  });
};
