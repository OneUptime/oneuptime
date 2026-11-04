import DataCheck from "Common/Models/DatabaseModels/DataCheck";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  check: DataCheck;
  onClose: () => void;
}

/*
 * A few of the rows a check's last run found failing, for a project that keeps
 * them. Sensitive columns were masked before they left the database.
 */
const FailingRowsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rows: Array<JSONObject> = props.check.failingRowsSample || [];
  const columns: Array<string> = Array.from(
    new Set(
      rows.flatMap((row: JSONObject): Array<string> => {
        return Object.keys(row);
      }),
    ),
  );

  return (
    <Modal
      title={props.check.name || "Failing Rows"}
      description="A few of the rows the last run found failing. Columns that hold sensitive data are masked."
      modalWidth={ModalWidth.Large}
      submitButtonText="Close"
      submitButtonStyleType={ButtonStyleType.NORMAL}
      onSubmit={props.onClose}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              {columns.map((column: string): ReactElement => {
                return (
                  <th key={column} className="py-2 pr-4">
                    {column}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row: JSONObject, index: number): ReactElement => {
              return (
                <tr key={index}>
                  {columns.map((column: string): ReactElement => {
                    return (
                      <td
                        key={column}
                        className="max-w-xs truncate py-2 pr-4 font-mono text-gray-700"
                      >
                        {String(row[column] ?? "")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};

export default FailingRowsModal;
