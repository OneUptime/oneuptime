import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A layer deleted on the Layers page, where its card was: it goes when the
 * page is saved, with the people in it, and Undo brings its card back
 * (Layers, issue #7575). Until then it still pages as it did.
 */
export interface ComponentProps {
  name: string;
  onUndo: () => void;
  // While the page saves, it stays as it is.
  disabled?: boolean | undefined;
}

const DeletedLayerCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid="layer-deleted"
      className="flex items-center gap-3 rounded-xl border border-dashed border-red-200 bg-red-50/40 px-4 py-3 md:px-5"
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600">
        <Icon icon={IconProp.Trash} className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 text-sm text-gray-700">
        <TranslatedSentence
          template="{{name}} will be deleted when you save."
          slots={{
            name: (
              <span className="font-semibold text-gray-900 line-through decoration-red-300">
                {props.name}
              </span>
            ),
          }}
        />
      </p>
      <button
        type="button"
        aria-label={translator.translateTemplate("Undo deleting {{name}}", {
          name: props.name,
        })}
        disabled={props.disabled}
        onClick={props.onUndo}
        className={`flex-shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-indigo-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
          {
            isLocked: Boolean(props.disabled),
            hoverClassName: "hover:bg-indigo-50 hover:text-indigo-700",
          },
        )}`}
      >
        {translator.translateText("Undo")}
      </button>
    </div>
  );
};

export default DeletedLayerCard;
