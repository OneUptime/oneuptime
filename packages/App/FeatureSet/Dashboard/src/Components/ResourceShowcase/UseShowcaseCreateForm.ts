import { useState } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { translateCreateAction } from "Common/UI/Components/ModelTable/BaseModelTable";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ShowcaseAddButton } from "./ResourceShowcaseCard";

/*
 * The showcase's button for a list whose Add is its table's create form
 * (databases, queues, RUM applications, vCenters): it opens that form, as
 * the table's own Create button does, and it reads and is locked as that
 * button is - the same words ("Connect vCenter"), and the missing
 * permission as its tooltip. The table takes `showCreateForm`.
 */

export interface ShowcaseCreateForm {
  // For the list's ModelTable `showCreateForm`.
  showCreateForm: boolean;
  /*
   * Undefined while there is nothing honest to say about a locked button
   * (the permissions have not loaded): the table hides its own then too.
   */
  addButton: ShowcaseAddButton | undefined;
}

export default function useShowcaseCreateForm(data: {
  modelType: { new (): BaseModel };
  // As the table is told them: its createVerb and singularName.
  createVerb?: string | undefined;
  singularName?: string | undefined;
}): ShowcaseCreateForm {
  const translator: Translator = useTranslator();
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  const model: BaseModel = new data.modelType();
  const singularName: string = data.singularName || model.singularName || "";
  const gate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    { singularName: singularName || undefined },
  );

  if (!gate.isAllowed && !gate.disabledReason) {
    return { showCreateForm, addButton: undefined };
  }

  return {
    showCreateForm,
    addButton: {
      title: translateCreateAction(translator, {
        verb: data.createVerb,
        itemName: singularName,
      }),
      disabled: !gate.isAllowed,
      tooltip: gate.disabledReason,
      onClick: (): void => {
        if (!gate.isAllowed) {
          return;
        }
        // Flipped off and on, so the same button opens the form a second time.
        setShowCreateForm(false);
        setTimeout(() => {
          setShowCreateForm(true);
        }, 0);
      },
    },
  };
}
