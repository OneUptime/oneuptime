import DataSecurityCustomDataType from "Common/Models/DatabaseModels/DataSecurityCustomDataType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "Common/Types/DataSecurity/DataTypeCatalog";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A DATA TYPE IS CALLED, WHEREVER DATA SECURITY NAMES ONE.
 *
 * Issues, flows and stores carry data type ids: a built-in one from the
 * catalog (Types/DataSecurity/DataTypeCatalog: "credit-card-number"), or
 * "custom:" and the id of one the project defined (Data Security > Settings
 * > Data Types). A built-in type is named by the catalog, in the reader's
 * language; a custom one by its own name, read once for the page - one
 * small request, shared by every list on it, and skipped for a reader who
 * may not read custom types. A finding keeps the name its type had when it
 * was found, which stands in when nothing else knows it.
 */

export const CUSTOM_DATA_TYPE_ID_PREFIX: string = "custom:";

// A custom type nobody can name any more: deleted, or not readable.
export const CUSTOM_DATA_TYPE_FALLBACK_NAME: string =
  translationKey("Custom data type");

export type DataTypeNamer = (
  dataTypeId: string,
  knownName?: string | undefined,
) => string;

export function isCustomDataTypeId(dataTypeId: string): boolean {
  return dataTypeId.startsWith(CUSTOM_DATA_TYPE_ID_PREFIX);
}

// The catalog's entry for a built-in type; undefined for a custom one.
export function getDataTypeInfo(
  dataTypeId: string | undefined,
): DataTypeInfo | undefined {
  return dataTypeId ? getBuiltInDataType(dataTypeId) : undefined;
}

// Ids as stored: a JSON array of strings, anything else read as none.
export function readDataTypeIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((id: unknown): id is string => {
    return typeof id === "string" && id.length > 0;
  });
}

interface CustomNamesRead {
  projectId: string;
  readAt: number;
  names: Promise<Map<string, string>>;
}

// One read of the project's custom types for every list on a page.
let lastRead: CustomNamesRead | null = null;

const CUSTOM_NAMES_FRESH_FOR_MS: number = 60 * 1000;

const readCustomDataTypeNames: () => Promise<Map<string, string>> = (): Promise<
  Map<string, string>
> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (
    !projectId ||
    !PermissionGate.check(new DataSecurityCustomDataType(), ModelAction.Read)
      .isAllowed
  ) {
    return Promise.resolve(new Map<string, string>());
  }

  const now: number = Date.now();

  if (
    lastRead &&
    lastRead.projectId === projectId.toString() &&
    now - lastRead.readAt < CUSTOM_NAMES_FRESH_FOR_MS
  ) {
    return lastRead.names;
  }

  const names: Promise<Map<string, string>> =
    ModelAPI.getList<DataSecurityCustomDataType>({
      modelType: DataSecurityCustomDataType,
      query: { projectId: projectId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    }).then(
      (result: ListResult<DataSecurityCustomDataType>): Map<string, string> => {
        const map: Map<string, string> = new Map<string, string>();

        for (const type of result.data) {
          const id: string = type._id?.toString() || type.id?.toString() || "";

          if (id && type.name) {
            map.set(id, type.name);
          }
        }

        return map;
      },
      (): Map<string, string> => {
        // Not readable now: named by what the finding remembers.
        lastRead = null;
        return new Map<string, string>();
      },
    );

  lastRead = { projectId: projectId.toString(), readAt: now, names: names };

  return names;
};

/*
 * Names data types for this page: the catalog's name for a built-in type,
 * its own for a custom one, the name a finding remembers, else the id.
 */
export function useDataTypeNamer(): DataTypeNamer {
  const translator: Translator = useTranslator();
  const [customNames, setCustomNames] = useState<Map<string, string>>(
    new Map<string, string>(),
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    readCustomDataTypeNames()
      .then((names: Map<string, string>) => {
        if (isCurrent) {
          setCustomNames(names);
        }
      })
      .catch(() => {
        // Named by what each row remembers.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (dataTypeId: string, knownName?: string | undefined): string => {
    const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    if (info) {
      return translator.translateText(info.name) || info.name;
    }

    if (isCustomDataTypeId(dataTypeId)) {
      const name: string | undefined = customNames.get(
        dataTypeId.slice(CUSTOM_DATA_TYPE_ID_PREFIX.length),
      );

      return (
        name ||
        knownName ||
        translator.translateText(CUSTOM_DATA_TYPE_FALLBACK_NAME) ||
        CUSTOM_DATA_TYPE_FALLBACK_NAME
      );
    }

    return knownName || dataTypeId;
  };
}

export interface IssueDataTypeChipsProps {
  dataTypeIds: Array<string>;
  namer: DataTypeNamer;
  // How many chips before "+3 more"; every one when left out.
  limit?: number | undefined;
  // Drawn when there are none: the table's quiet dash by default.
  emptyElement?: ReactElement | undefined;
}

export const DATA_TYPE_CHIP_CLASS_NAME: string =
  "inline-flex max-w-full items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700";

/*
 * Data types as small grey chips, in the order given, the rest counted
 * ("+3 more") with every name under the pointer.
 */
export const IssueDataTypeChips: FunctionComponent<IssueDataTypeChipsProps> = (
  props: IssueDataTypeChipsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const names: Array<string> = props.dataTypeIds.map(
    (dataTypeId: string): string => {
      return props.namer(dataTypeId);
    },
  );

  if (names.length === 0) {
    return (
      props.emptyElement || <span className="text-sm text-gray-400">-</span>
    );
  }

  const shown: Array<string> =
    props.limit !== undefined ? names.slice(0, props.limit) : names;
  const hidden: Array<string> = names.slice(shown.length);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((name: string, index: number): ReactElement => {
        return (
          <span key={`${index}-${name}`} className={DATA_TYPE_CHIP_CLASS_NAME}>
            <span className="truncate">{name}</span>
          </span>
        );
      })}
      {hidden.length > 0 ? (
        <span
          className="text-xs font-medium text-gray-500"
          title={hidden.join(", ")}
        >
          {translator.translatePlural(
            { one: "+{{count}} more", other: "+{{count}} more" },
            hidden.length,
          )}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};
