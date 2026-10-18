import {
  getPermissionScopeCell,
  PermissionScopeCell as PermissionScopeCellWords,
} from "./PermissionScopeChoice";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A permission row's Scope cell, in a team's and a custom role's
 * permission tables alike: what the row reaches, in the words the Scope
 * choice uses (PermissionScopeChoice), and the labels that narrow it.
 */
export interface ComponentProps {
  scope?: unknown;
  labels?: Array<Label> | undefined | null;
}

const PermissionScopeCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const cell: PermissionScopeCellWords = getPermissionScopeCell({
    scope: props.scope,
    labels: props.labels,
  });

  return (
    <div className="flex flex-col gap-1" data-testid="permission-scope-cell">
      <p>{translator.translateText(cell.title) || cell.title}</p>
      {cell.labels.length > 0 ? <LabelsElement labels={cell.labels} /> : <></>}
    </div>
  );
};

export default PermissionScopeCell;
