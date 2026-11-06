import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * The fold's title, in English: it is looked up in the reader's language
   * here, as the other shared components look up their text props. Create
   * Monitor's "URL placeholder help" read English on every page, its
   * translation unused. A title already in the reader's words is drawn as
   * it is given.
   */
  title: string;
  children: ReactElement;
}

const TinyFormDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mt-2 text-xs text-gray-500">
      <details className="cursor-pointer">
        <summary className="hover:text-gray-700">
          {translator.translateText(props.title) ?? props.title}
        </summary>
        <div className="mt-2 space-y-1">{props.children}</div>
      </details>
    </div>
  );
};

export default TinyFormDocumentation;
