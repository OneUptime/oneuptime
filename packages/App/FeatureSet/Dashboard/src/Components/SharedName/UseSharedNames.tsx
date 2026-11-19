import SharedNamesApi from "./SharedNamesApi";
import {
  SHARED_NAME_RENAME_BUTTON,
  SHARED_NAME_WORDS,
  SharedNameWords,
} from "./SharedNameWords";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  SharedNameKind,
  SharedNamesAnswer,
  getSharedNameRecordIds,
} from "Common/Types/Database/SharedNames";
import { isNameTakenRefusal } from "Common/Types/Database/UniqueName";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Column from "Common/UI/Components/ModelTable/Column";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import FieldType from "Common/UI/Components/Types/FieldType";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A LIST OF RECORDS THAT MAY SHARE A NAME, MARKED (#9746).
 *
 * Teams (#9674), on-call policies and on-call schedules (#9742) have a name
 * of their own in a project, but records named alike before that keep their
 * names, and every picker draws them alike. Their list now:
 *
 *   - marks each such record with a pill beside its name, whose tip says
 *     how to tell it from its twin;
 *   - says above the list how many there are and how to tell them apart,
 *     and says nothing while there are none;
 *   - gives each marked row its Rename, as the row's button: a dialog with
 *     the name alone, where a name another record has is refused under the
 *     field, as everywhere a name is written.
 *
 * Which records share a name is the server's to say (SharedNamesApi): the
 * list's page may hold one twin of two, and the other may be one the reader
 * cannot read. It is asked again every time the list reads its rows, so a
 * record deleted, renamed or archived elsewhere is unmarked with the list.
 * A failure marks nothing: the marks help, and the list works without them.
 */

export interface SharedNamesOfList<TBaseModel extends BaseModel> {
  // Whether a record shares its name with another record of the project.
  isShared: (item: TBaseModel) => boolean;
  // How many records of the list's kind the reader may read share a name.
  count: number;
  // The list's Name column, marked.
  nameColumn: Column<TBaseModel>;
  // Above the list while records share a name; nothing otherwise.
  note: ReactElement | null;
  // Rename, the row's button on a marked row.
  renameAction: ActionButtonSchema<TBaseModel>;
  // The rename dialog, while one is open.
  renameModal: ReactElement | null;
  // Handed the list's onFetchSuccess: read again with every read of the rows.
  onListFetched: () => void;
  // Part of the list's refreshToggle: changes when a rename is saved.
  refreshToken: string;
}

// A record's id as the answer writes it.
const idOf: (item: BaseModel) => string = (item: BaseModel): string => {
  return (item.id?.toString() || item._id?.toString() || "").toLowerCase();
};

// A record's name, as the row read it.
const nameOf: (item: BaseModel) => string = (item: BaseModel): string => {
  const name: unknown = (item as unknown as Record<string, unknown>)["name"];

  return typeof name === "string" ? name : "";
};

/*
 * The name cell: the name as it is written, and the pill beside it when
 * another record shares it. A name reads its own way, and the pill its own,
 * so the cell draws its own lines (drawsItsOwnLines).
 */
export const SharedNameCell: (props: {
  name: string;
  isShared: boolean;
  words: SharedNameWords;
}) => ReactElement = (props: {
  name: string;
  isShared: boolean;
  words: SharedNameWords;
}): ReactElement => {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <IsolatedLine text={props.name} className="min-w-0 truncate" />
      {props.isShared ? (
        <Pill
          text={props.words.pill}
          tone={PillTone.Warning}
          tooltip={props.words.pillTooltip}
          dataTestId="shared-name-pill"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

const useSharedNames: <TBaseModel extends BaseModel>(data: {
  kind: SharedNameKind;
  modelType: { new (): TBaseModel };
  /*
   * A record no one may rename - Owners and Admin, which come with every
   * project: marked, with no Rename. Its twin is the one to rename.
   */
  canRename?: ((item: TBaseModel) => boolean) | undefined;
}) => SharedNamesOfList<TBaseModel> = <TBaseModel extends BaseModel>(data: {
  kind: SharedNameKind;
  modelType: { new (): TBaseModel };
  canRename?: ((item: TBaseModel) => boolean) | undefined;
}): SharedNamesOfList<TBaseModel> => {
  const translator: Translator = useTranslator();
  const words: SharedNameWords = SHARED_NAME_WORDS[data.kind];

  const [answer, setAnswer] = useState<SharedNamesAnswer>({ groups: [] });
  const [renaming, setRenaming] = useState<TBaseModel | null>(null);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  // The newest read wins: an older one that answers late is dropped.
  const readNumber: React.MutableRefObject<number> = useRef<number>(0);

  const read: () => void = useCallback((): void => {
    readNumber.current += 1;
    const thisRead: number = readNumber.current;

    SharedNamesApi.read(data.kind)
      .then((read: SharedNamesAnswer): void => {
        if (thisRead === readNumber.current) {
          setAnswer(read);
        }
      })
      .catch((): void => {
        if (thisRead === readNumber.current) {
          setAnswer({ groups: [] });
        }
      });
  }, [data.kind]);

  /*
   * Read when the list reads its rows (onListFetched), which it does as it
   * opens: one request each time, not two.
   */
  useEffect((): (() => void) => {
    return (): void => {
      // A read that answers after the list is gone sets nothing.
      readNumber.current += 1;
    };
  }, []);

  const sharedIds: Set<string> = useMemo((): Set<string> => {
    return getSharedNameRecordIds(answer);
  }, [answer]);

  const isShared: (item: TBaseModel) => boolean = (
    item: TBaseModel,
  ): boolean => {
    return sharedIds.has(idOf(item));
  };

  const updateGate: PermissionGateResult = PermissionGate.check(
    new data.modelType(),
    ModelAction.Update,
  );

  const nameColumn: Column<TBaseModel> = {
    field: { name: true } as Column<TBaseModel>["field"],
    title: "Name",
    type: FieldType.Element,
    // The name and its pill each read their own way.
    getLineText: drawsItsOwnLines,
    getExportValue: (item: TBaseModel): string => {
      return nameOf(item);
    },
    getElement: (item: TBaseModel): ReactElement => {
      return (
        <SharedNameCell
          name={nameOf(item)}
          isShared={isShared(item)}
          words={words}
        />
      );
    },
  };

  const note: ReactElement | null =
    sharedIds.size > 0 ? (
      <Alert
        type={AlertType.WARNING}
        dataTestId="shared-names-note"
        className="mb-4"
        title={
          <span>{translator.translatePlural(words.note, sharedIds.size)}</span>
        }
      />
    ) : null;

  const renameAction: ActionButtonSchema<TBaseModel> = {
    title: words.rename,
    rowButtonTitle: SHARED_NAME_RENAME_BUTTON,
    icon: IconProp.Edit,
    buttonStyleType: ButtonStyleType.NORMAL,
    // A marked row's button: renaming is what the mark asks for.
    placement: ActionButtonPlacement.Primary,
    isVisible: (item: TBaseModel): boolean => {
      return (
        isShared(item) &&
        // Hidden where the reader may not rename, unless the gate says why.
        (updateGate.isAllowed || Boolean(updateGate.disabledReason)) &&
        (data.canRename ? data.canRename(item) : true)
      );
    },
    disabled: !updateGate.isAllowed,
    tooltip: updateGate.disabledReason,
    onClick: (item: TBaseModel, onCompleteAction: VoidFunction): void => {
      setRenaming(item);
      onCompleteAction();
    },
  };

  const nameField: ModelField<TBaseModel> = {
    field: { name: true } as ModelField<TBaseModel>["field"],
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    hideColumnDescription: true,
    validation: {
      minLength: 2,
    },
    // Another record's name, said under the field (#9674, #9742).
    ownsServerError: isNameTakenRefusal,
  };

  const renamingId: ObjectID | null = renaming?.id || null;

  const renameModal: ReactElement | null =
    renaming && renamingId ? (
      <ModelFormModal<TBaseModel>
        modelType={data.modelType}
        modelIdToEdit={renamingId}
        name={words.rename}
        title={words.rename}
        description={words.renameDescription}
        submitButtonText={words.rename}
        onClose={(): void => {
          setRenaming(null);
        }}
        onSuccess={(): void => {
          setRenaming(null);
          // The list reads its rows again, and with them who shares a name.
          setRefreshToken((token: number): number => {
            return token + 1;
          });
        }}
        formProps={{
          id: "shared-name-rename",
          name: words.rename,
          modelType: data.modelType,
          formType: FormType.Update,
          fields: [nameField],
          steps: [],
        }}
      />
    ) : null;

  return {
    isShared: isShared,
    count: sharedIds.size,
    nameColumn: nameColumn,
    note: note,
    renameAction: renameAction,
    renameModal: renameModal,
    onListFetched: read,
    refreshToken: `shared-names-${refreshToken}`,
  };
};

export default useSharedNames;
