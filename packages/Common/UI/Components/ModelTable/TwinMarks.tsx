import {
  NO_TWINS,
  TWIN_MARKS_NOTE,
  TWIN_MARKS_NOTE_TEST_ID,
  TWIN_MARK_CREATED,
  TWIN_MARK_CREATED_TEST_ID,
  TWIN_MARK_PILL,
  TWIN_MARK_PILL_TEST_ID,
  TWIN_MARK_TOOLTIP,
  Twins,
  getTwinCount,
  getTwinCreatedText,
  getTwinId,
  getTwins,
} from "./TwinMarkWords";
import Alert, { AlertType } from "../Alerts/Alert";
import IsolatedLine from "../IsolatedText/IsolatedLine";
import IsolatedText from "../IsolatedText/IsolatedText";
import Pill from "../Pill/Pill";
import { PillTone } from "../Pill/PillTone";
import { isNameFieldKey } from "../Table/ColumnLineText";
import { getTableNoValue } from "../Table/TableEmptyValue";
import TableColumn from "../Table/Types/Column";
import ProjectUtil from "../../Utils/Project";
import { PAGE_SHARED_NAME_DATES } from "../../Utils/SharedNameOptions";
import { translatableTerm, Translator } from "../../Utils/TranslateTemplate";
import UniqueNamesApi from "../../Utils/UniqueNamesApi";
import useTranslator from "../../Utils/UseTranslator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { SharedNamesAnswer } from "../../../Types/Database/SharedNames";
import { getUniqueNameWhenRequiredColumn } from "../../../Types/Database/UniqueNameWhenRequired";
import GenericObject from "../../../Types/GenericObject";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A LIST'S RECORDS THAT SHARE A NAME, MARKED (#11021, TwinMarkWords).
 *
 * The shared list (BaseModelTable) asks this of every kind it lists: a kind
 * Require Unique Names holds (@UniqueNameWhenRequired) whose name column the
 * list shows is read, after each read of the list's rows, for which of its
 * records share a name (GET /shared-names/<Table>); every other kind reads
 * nothing and draws as it always did. A record the answer names gets a pill
 * beside its name and the day it was made; the list gets one note above
 * its rows. A list drawn by hand marks its records with the same hook and
 * TwinMarkCell.
 *
 * The answer is only help: a failure marks nothing, and the list works as
 * ever. The newest read wins, and a read that answers once the list is gone
 * sets nothing. A live read that finds the same rows (useLiveRows, every
 * few seconds) is not asked again.
 */

// What a list needs of a row: its id, and its name.
type TwinRow = GenericObject | BaseModel;

export interface TwinMarks {
  // The list's kind marks its twins for this reader: there is a project, and a column to mark.
  isOn: boolean;
  // The kind's name column: "name", or a template's "templateName".
  column: string | null;
  // Handed the rows each time the list reads them; background: a live read.
  onRowsRead: (
    rows: ReadonlyArray<TwinRow>,
    options?: { isBackground?: boolean | undefined },
  ) => void;
  // Whether a record shares its name with another the reader may read.
  isTwin: (id: unknown) => boolean;
  // How many of the kind's records the reader may read share a name.
  count: number;
  // Changes whenever the marks do, for a list that keeps its cells.
  version: number;
  // Above the list while records share a name; nothing otherwise.
  note: ReactElement | null;
  // A record's name as the list draws it, with its mark when it is a twin.
  drawName: (data: { id: unknown; name: ReactNode }) => ReactNode;
}

const NO_ANSWER: SharedNamesAnswer = { groups: [] };

// A row's id, as the answer writes it.
const idOfRow: (row: TwinRow) => string = (row: TwinRow): string => {
  const fields: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  return getTwinId(fields["_id"] || fields["id"]);
};

/*
 * A twin's name and its mark: the pill, whose tip says what to do, and the
 * day it was made. Each reads its own way, so the cell draws its own lines.
 * A span, so a card's heading may hold it as well as a table's cell.
 */
export const TwinMarkCell: FunctionComponent<{
  name: ReactNode;
  pill: string;
  tooltip: string;
  created: string | null;
}> = (props: {
  name: ReactNode;
  pill: string;
  tooltip: string;
  created: string | null;
}): ReactElement => {
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="shared-name-mark"
    >
      {props.name}
      <Pill
        text={props.pill}
        isUserContent={true}
        tone={PillTone.Warning}
        tooltip={props.tooltip}
        isTooltipUserContent={true}
        dataTestId={TWIN_MARK_PILL_TEST_ID}
      />
      {props.created ? (
        <span
          className="whitespace-nowrap text-xs text-gray-500"
          data-testid={TWIN_MARK_CREATED_TEST_ID}
        >
          {props.created}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

const useTwinMarks: (data: {
  // The list's kind; nothing marks a kind Require Unique Names does not hold.
  modelType?: { new (): BaseModel } | null | undefined;
  // The list draws the kind's name column, where a mark has its place.
  isShown?: boolean | undefined;
  /*
   * The kind as the list calls its records, in English, where that is not
   * the model's name: a Meraki connection, not a Network Controller
   * Connection.
   */
  singularName?: string | undefined;
  pluralName?: string | undefined;
}) => TwinMarks = (data: {
  modelType?: { new (): BaseModel } | null | undefined;
  isShown?: boolean | undefined;
  singularName?: string | undefined;
  pluralName?: string | undefined;
}): TwinMarks => {
  const translator: Translator = useTranslator();

  const model: BaseModel | null = useMemo((): BaseModel | null => {
    const instance: unknown = data.modelType ? new data.modelType() : null;

    return instance instanceof BaseModel ? instance : null;
  }, [data.modelType]);

  const column: string | null = model
    ? getUniqueNameWhenRequiredColumn(model)
    : null;
  const tableName: string = model?.tableName || "";

  const isOn: boolean = Boolean(
    column &&
      tableName &&
      data.isShown !== false &&
      ProjectUtil.getCurrentProjectId(),
  );

  const [answer, setAnswer] = useState<SharedNamesAnswer>(NO_ANSWER);
  const [version, setVersion] = useState<number>(0);

  // The newest read wins: an older one that answers late is dropped.
  const readNumber: MutableRefObject<number> = useRef<number>(0);
  // The rows the last read was asked for, by their ids and names.
  const lastRows: MutableRefObject<string | null> = useRef<string | null>(null);

  useEffect((): (() => void) => {
    return (): void => {
      // A read that answers after the list is gone sets nothing.
      readNumber.current += 1;
    };
  }, []);

  const show: (read: SharedNamesAnswer) => void = (
    read: SharedNamesAnswer,
  ): void => {
    setAnswer(read);
    setVersion((current: number): number => {
      return current + 1;
    });
  };

  const onRowsRead: TwinMarks["onRowsRead"] = useCallback(
    (
      rows: ReadonlyArray<TwinRow>,
      options?: { isBackground?: boolean | undefined },
    ): void => {
      if (!isOn || !column) {
        return;
      }

      const rowsRead: string = rows
        .map((row: TwinRow): string => {
          return `${idOfRow(row)}\u0000${String(
            (row as unknown as Record<string, unknown>)[column] ?? "",
          )}`;
        })
        .join("\u0001");

      // A live read of the same rows: the marks stand.
      if (options?.isBackground && rowsRead === lastRows.current) {
        return;
      }

      lastRows.current = rowsRead;
      readNumber.current += 1;
      const thisRead: number = readNumber.current;

      // No rows, nothing to mark.
      if (rows.length === 0) {
        show(NO_ANSWER);
        return;
      }

      UniqueNamesApi.readSharedNames(tableName)
        .then((read: SharedNamesAnswer): void => {
          if (thisRead === readNumber.current) {
            show(read);
          }
        })
        .catch((): void => {
          // The marks only help: without them the list works as ever.
          if (thisRead === readNumber.current) {
            show(NO_ANSWER);
          }
        });
    },
    [isOn, column, tableName],
  );

  const twins: Twins = useMemo((): Twins => {
    return isOn ? getTwins(answer) : NO_TWINS;
  }, [answer, isOn]);

  const count: number = getTwinCount(twins);

  const isTwin: (id: unknown) => boolean = (id: unknown): boolean => {
    return twins.groupOf.has(getTwinId(id));
  };

  // The kind as the list calls it, else as its model does (isOn needs one).
  const kind: ReturnType<typeof translatableTerm> = translatableTerm(
    data.singularName || model?.singularName || tableName,
    { inSentence: true },
  );
  const kinds: ReturnType<typeof translatableTerm> = translatableTerm(
    data.pluralName || model?.pluralName || tableName,
    { inSentence: true },
  );

  const pill: string = translator.translateTemplate(TWIN_MARK_PILL, {
    kind: kind,
  });
  const tooltip: string = translator.translateTemplate(TWIN_MARK_TOOLTIP, {
    kind: kind,
  });

  const drawName: TwinMarks["drawName"] = (drawn: {
    id: unknown;
    name: ReactNode;
  }): ReactNode => {
    if (!isTwin(drawn.id)) {
      return drawn.name;
    }

    const created: string | null = getTwinCreatedText({
      twins: twins,
      id: drawn.id,
      dates: PAGE_SHARED_NAME_DATES,
    });

    return (
      <TwinMarkCell
        name={drawn.name}
        pill={pill}
        tooltip={tooltip}
        created={
          created
            ? translator.translateTemplate(TWIN_MARK_CREATED, {
                date: created,
              })
            : null
        }
      />
    );
  };

  const note: ReactElement | null =
    count > 0 ? (
      <Alert
        type={AlertType.WARNING}
        dataTestId={TWIN_MARKS_NOTE_TEST_ID}
        className="mb-4"
        title={
          <span>
            {translator.translatePlural(TWIN_MARKS_NOTE, count, {
              kind: kind,
              kinds: kinds,
            })}
          </span>
        }
      />
    ) : null;

  return {
    isOn: isOn,
    column: column,
    onRowsRead: onRowsRead,
    isTwin: isTwin,
    count: count,
    version: version,
    note: note,
    drawName: drawName,
  };
};

/*
 * THE LIST'S NAME COLUMN, MARKED: the same column, whose twins draw their
 * mark beside the name - the column's own element, or its value as the
 * table draws a value. Every other row draws exactly as the column did, and
 * reads its line the way it did (getLineText); a twin's cell lays out its
 * own lines. Sorting, search and the export still read the column's field.
 * While no record is a twin, the column is handed back as it came.
 */
export const markTwinsInColumn: <T extends GenericObject>(data: {
  column: TableColumn<T>;
  marks: TwinMarks;
}) => TableColumn<T> = <T extends GenericObject>(data: {
  column: TableColumn<T>;
  marks: TwinMarks;
}): TableColumn<T> => {
  const original: TableColumn<T> = data.column;

  if (!data.marks.isOn || data.marks.count === 0 || !original.key) {
    return original;
  }

  const key: string = String(original.key);

  const valueOf: (item: T) => string = (item: T): string => {
    const value: unknown = (item as unknown as Record<string, unknown>)[key];

    return value === undefined || value === null ? "" : String(value);
  };

  return {
    ...original,
    getElement: (item: T, onBeforeFetchData?: T | undefined): ReactElement => {
      const isTwin: boolean = data.marks.isTwin(idOfRow(item));

      if (original.getElement) {
        const element: ReactElement = original.getElement(
          item,
          onBeforeFetchData,
        );

        // Handed back as it is: the table knows an empty value by its element.
        return isTwin ? (
          <>{data.marks.drawName({ id: idOfRow(item), name: element })}</>
        ) : (
          element
        );
      }

      const value: string = valueOf(item);

      // Drawn as the table draws a value of its own (TableRow).
      if (!isTwin) {
        return value ? (
          <IsolatedText text={value} />
        ) : (
          getTableNoValue(original.noValueMessage)
        );
      }

      return (
        <>
          {data.marks.drawName({
            id: idOfRow(item),
            name: <IsolatedLine text={value} className="min-w-0 truncate" />,
          })}
        </>
      );
    },
    getLineText: (item: T): string | undefined => {
      // A twin's name and its mark each read their own way.
      if (data.marks.isTwin(idOfRow(item))) {
        return undefined;
      }

      // As the column read its line: its own words, or the rule for an element.
      if (original.getLineText) {
        return original.getLineText(item);
      }

      if (original.getElement && !isNameFieldKey(key)) {
        return undefined;
      }

      return valueOf(item) || undefined;
    },
  };
};

export default useTwinMarks;
