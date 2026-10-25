import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  description?: string | undefined;
  icon?: IconProp | undefined;
  children: Array<ReactElement> | ReactElement;
}

/*
 * A section of the insight detail page.
 *
 * The shared Card carries its own `mb-5`, which fights the grid gap once the
 * detail page splits into a main column and a sidebar — some seams ended up
 * 20px and some 40px. This is the same surface with the spacing left to the
 * layout, plus a section glyph.
 *
 * The title and the line under it are given in English and drawn in the
 * reader's language: the locales carried them ("Belege", "Details") while
 * every reader saw the English.
 */
const InsightPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          {props.icon ? (
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
              <Icon icon={props.icon} className="h-3.5 w-3.5" />
            </span>
          ) : (
            <></>
          )}
          <h2 className="text-sm font-semibold text-gray-900">
            {translator.translateText(props.title)}
          </h2>
        </div>
        {props.description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
            {translator.translateText(props.description)}
          </p>
        ) : (
          <></>
        )}
      </div>
      <div className="px-5 py-4">{props.children}</div>
    </section>
  );
};

export default InsightPanel;
