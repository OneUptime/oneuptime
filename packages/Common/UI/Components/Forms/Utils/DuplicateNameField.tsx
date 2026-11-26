/*
 * Type-only on purpose: the one place the warning is loaded is the import()
 * below (duplicateNameNotice).
 */
import type DuplicateNameNotice from "../DuplicateNameNotice";
import type { ComponentProps as DuplicateNameNoticeProps } from "../DuplicateNameNotice";
import Field, { FieldFooterProps } from "../Types/Field";
import Fields from "../Types/Fields";
import FormValues from "../Types/FormValues";
import { LazyLibrary, useLazyLibrary } from "../../../Utils/LazyLibrary";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getProjectNameRule,
  ProjectNameRule,
} from "../../../../Types/Database/ProjectNameRule";
import { isNameTakenRefusal } from "../../../../Types/Database/UniqueName";
import ObjectID from "../../../../Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A FORM'S NAME FIELD, FOR A KIND WITH A NAME OF ITS OWN IN A PROJECT
 * (#10761).
 *
 * Every model form of a kind whose name is one of its kind in a project -
 * while the project requires unique names (@UniqueNameWhenRequired), or
 * always (@UniqueColumnBy("projectId") on its name, teams, labels, on-call
 * policies and schedules) - gets, on the field that holds that name:
 *
 *   - a warning under it as it takes a name another record of the kind has
 *     (DuplicateNameNotice), with a link to that record;
 *   - the server's refusal of a taken name said under it rather than above
 *     the form (Field.ownsServerError), in the reader's language.
 *
 * The field's own footer and server errors are kept: the warning goes
 * after its footer, and either rule may own a refusal. ModelForm asks this
 * of every form it draws, so no page writes a line for it. A form of a
 * kind whose names repeat, or outside a project (the Admin Dashboard),
 * keeps its fields as they are.
 */

/*
 * The warning - with the API it asks about a name and the kinds a project
 * can require unique names for - is a file of its own, loaded by the first
 * form that draws a name field it watches, as the field is drawn. Every page
 * with a form reaches ModelForm, and a status page's forms and the sign-in
 * pages' have no such field (about 1.6 KiB gzipped of each one's first load,
 * packages/Common/Scripts/first-load-budgets.js). The warning waits for
 * typing to stop before it asks anything (DUPLICATE_NAME_CHECK_DELAY_IN_MS),
 * so it has arrived by then; until it has, nothing is drawn, as before an
 * answer.
 */
const duplicateNameNotice: LazyLibrary<typeof DuplicateNameNotice> =
  new LazyLibrary<typeof DuplicateNameNotice>(
    async (): Promise<typeof DuplicateNameNotice> => {
      return (await import("../DuplicateNameNotice")).default;
    },
  );

const LazyDuplicateNameNotice: FunctionComponent<DuplicateNameNoticeProps> = (
  props: DuplicateNameNoticeProps,
): ReactElement => {
  const Notice: typeof DuplicateNameNotice | null = useLazyLibrary(
    duplicateNameNotice,
    true,
  );

  // A warning that did not load leaves the form as it is: it only helps.
  return Notice ? <Notice {...props} /> : <></>;
};

// The column a field writes, as ModelForm reads it.
const getFieldColumn: <TBaseModel extends BaseModel>(
  field: Field<TBaseModel>,
) => string | undefined = <TBaseModel extends BaseModel>(
  field: Field<TBaseModel>,
): string | undefined => {
  return Object.keys(field.field || {})[0];
};

/*
 * The words a kind unique always refuses a taken name with
 * (DatabaseService.refuseTakenName): "Status Page with the same name
 * already exists.", or the same of an archived one.
 */
export const isUniqueColumnNameRefusal: (
  message: string,
  singularName: string | null | undefined,
) => boolean = (
  message: string,
  singularName: string | null | undefined,
): boolean => {
  if (!singularName) {
    return false;
  }

  return (message || "")
    .trim()
    .startsWith(`${singularName} with the same name already exists`);
};

export const withDuplicateNameNotice: <TBaseModel extends BaseModel>(data: {
  fields: Fields<TBaseModel>;
  model: TBaseModel;
  // Whether the form belongs to a project: the only place names are held.
  isInProject: boolean;
  // The record the form edits, and its name as it was read.
  modelIdToEdit?: ObjectID | null | undefined;
  originalName?: unknown;
}) => Fields<TBaseModel> = <TBaseModel extends BaseModel>(data: {
  fields: Fields<TBaseModel>;
  model: TBaseModel;
  isInProject: boolean;
  modelIdToEdit?: ObjectID | null | undefined;
  originalName?: unknown;
}): Fields<TBaseModel> => {
  const rule: ProjectNameRule | null = data.isInProject
    ? getProjectNameRule(data.model)
    : null;

  if (!rule || !data.model.tableName) {
    return data.fields;
  }

  const tableName: string = data.model.tableName;
  const singularName: string = data.model.singularName || tableName;

  return data.fields.map((field: Field<TBaseModel>): Field<TBaseModel> => {
    if (getFieldColumn(field) !== rule.column) {
      return field;
    }

    const ownsServerError: ((message: string) => boolean) | undefined =
      field.ownsServerError;
    const getFooterElement: Field<TBaseModel>["getFooterElement"] =
      field.getFooterElement;

    return {
      ...field,
      ownsServerError: (message: string): boolean => {
        return (
          isNameTakenRefusal(message) ||
          isUniqueColumnNameRefusal(message, data.model.singularName) ||
          Boolean(ownsServerError?.(message))
        );
      },
      getFooterElement: (
        values: FormValues<TBaseModel>,
        error?: string,
        footer?: FieldFooterProps,
      ): ReactElement | undefined => {
        return (
          <>
            {getFooterElement?.(values, error, footer)}
            <LazyDuplicateNameNotice
              tableName={tableName}
              singularName={singularName}
              name={(values as Record<string, unknown>)[rule.column]}
              originalName={data.originalName}
              exceptId={data.modelIdToEdit || null}
              hasFieldError={Boolean(error)}
            />
          </>
        );
      },
    };
  });
};
