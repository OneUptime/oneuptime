import { WorkflowCustomField } from "./CustomFieldColumns";
import {
  LoadCustomFieldsFunction,
  hasCustomFields,
  loadCustomFields,
} from "./CustomFieldSource";
import { useEffect, useState } from "react";

export interface CustomFieldsState {
  fields: Array<WorkflowCustomField>;
  isLoading: boolean;
}

/*
 * A table's custom fields, once per table. Never throws: fields that cannot be
 * read are simply not listed, and whatever is stored under their names still
 * shows. A table whose records have none asks for nothing.
 */
const useCustomFields: (
  recordTableName: string | undefined,
  load?: LoadCustomFieldsFunction,
) => CustomFieldsState = (
  recordTableName: string | undefined,
  load: LoadCustomFieldsFunction = loadCustomFields,
): CustomFieldsState => {
  const hasFields: boolean = Boolean(
    recordTableName && hasCustomFields(recordTableName),
  );

  const [fields, setFields] = useState<Array<WorkflowCustomField>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(hasFields);

  useEffect(() => {
    if (!recordTableName || !hasFields) {
      setFields([]);
      setIsLoading(false);
      return;
    }

    let isCurrent: boolean = true;

    setIsLoading(true);

    void (async (): Promise<void> => {
      let loaded: Array<WorkflowCustomField> = [];

      try {
        loaded = await load(recordTableName);
      } catch {
        // Not listed: the person may not read them, or their plan has none.
      }

      if (isCurrent) {
        setFields(loaded);
        setIsLoading(false);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [recordTableName]);

  return { fields: fields, isLoading: isLoading };
};

export default useCustomFields;
