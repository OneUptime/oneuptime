import {
  TableFitInput,
  TableFitState,
  TableFitStep,
  getLeastTableFitStep,
  getTableFitStateAfterCannotFit,
  getTableFitStateFor,
} from "./TableFit";
import { TableCannotFit } from "./useTableScrollState";
import React, { useCallback, useRef, useState } from "react";

/*
 * Where each table was, by its key, while the page is open: a list opened
 * again starts as it was left - as cards beside a side menu at 900px, say -
 * not as rows that turn into cards once its first page is read. Only a
 * starting point: the box is measured, and the rules (TableFit) decide.
 */
const rememberedFits: Map<string, { columnsKey: string; fit: TableFitState }> =
  new Map();

// For the tests: forget every table's place.
export const forgetRememberedTableFits: () => void = (): void => {
  rememberedFits.clear();
};

export interface UseTableFitResult {
  step: TableFitStep;
  // The table's measuring says it did not fit (useTableScrollState).
  onCannotFit: (cannotFit: TableCannotFit) => void;
}

/*
 * How a table fits its box: as rows, folded or as cards (TableFit). The
 * step a table may be drawn at is worked out as it is drawn, from its box
 * and the window - a phone's first paint is already its cards, a box made
 * wider tries the roomier step again - and a table that is measured and
 * does not fit moves on to the next.
 */
const useTableFit: (data: {
  isPhone: boolean;
  boxWidth: number | null;
  hasFoldableColumns: boolean;
  // The columns the measurements are for: other columns are measured afresh.
  columnsKey: string;
  // Where the table's step is remembered while the page is open.
  rememberKey?: string | undefined;
}) => UseTableFitResult = (data: {
  isPhone: boolean;
  boxWidth: number | null;
  hasFoldableColumns: boolean;
  columnsKey: string;
  rememberKey?: string | undefined;
}): UseTableFitResult => {
  const input: TableFitInput = {
    isPhone: data.isPhone,
    boxWidth: data.boxWidth,
    windowWidth: typeof window === "undefined" ? 0 : window.innerWidth,
    hasFoldableColumns: data.hasFoldableColumns,
  };

  const getFreshFit: (fitInput: TableFitInput) => TableFitState = (
    fitInput: TableFitInput,
  ): TableFitState => {
    return { step: getLeastTableFitStep(fitInput), neededWidths: {} };
  };

  const [stored, setStored] = useState<{
    columnsKey: string;
    fit: TableFitState;
  }>(() => {
    const remembered: { columnsKey: string; fit: TableFitState } | undefined =
      data.rememberKey ? rememberedFits.get(data.rememberKey) : undefined;

    if (remembered && remembered.columnsKey === data.columnsKey) {
      return remembered;
    }

    return { columnsKey: data.columnsKey, fit: getFreshFit(input) };
  });

  // Other columns than the ones measured: measured afresh.
  const base: TableFitState =
    stored.columnsKey === data.columnsKey ? stored.fit : getFreshFit(input);

  const fit: TableFitState = getTableFitStateFor(base, input);

  /*
   * What the callback reads: the table's measuring calls it after it is
   * drawn, with whatever the table was drawn with then.
   */
  const latestRef: React.MutableRefObject<{
    input: TableFitInput;
    columnsKey: string;
    rememberKey: string | undefined;
  }> = useRef({
    input: input,
    columnsKey: data.columnsKey,
    rememberKey: data.rememberKey,
  });

  latestRef.current = {
    input: input,
    columnsKey: data.columnsKey,
    rememberKey: data.rememberKey,
  };

  const onCannotFit: (cannotFit: TableCannotFit) => void = useCallback(
    (cannotFit: TableCannotFit): void => {
      setStored(
        (current: {
          columnsKey: string;
          fit: TableFitState;
        }): { columnsKey: string; fit: TableFitState } => {
          const latest: {
            input: TableFitInput;
            columnsKey: string;
            rememberKey: string | undefined;
          } = latestRef.current;
          const currentBase: TableFitState =
            current.columnsKey === latest.columnsKey
              ? current.fit
              : getFreshFit(latest.input);
          const drawn: TableFitState = getTableFitStateFor(
            currentBase,
            latest.input,
          );
          const next: TableFitState = getTableFitStateAfterCannotFit(
            drawn,
            latest.input,
            cannotFit.tightWidth,
            cannotFit.boxWidth,
          );

          if (next === drawn) {
            return current;
          }

          const stored: { columnsKey: string; fit: TableFitState } = {
            columnsKey: latest.columnsKey,
            fit: next,
          };

          if (latest.rememberKey) {
            rememberedFits.set(latest.rememberKey, stored);
          }

          return stored;
        },
      );
    },
    [],
  );

  return { step: fit.step, onCannotFit: onCannotFit };
};

export default useTableFit;
