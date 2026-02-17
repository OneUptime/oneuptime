import PageComponentProps from "../PageComponentProps";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const AuditLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <Alert
        type={AlertType.WARNING}
        strongTitle="Audit Logs Not Enabled"
        title="Audit Logs are not enabled for this project. Please enable it in the Admin Dashboard."
      />

      <Card
        title="Audit Logs"
        description="View audit logs for all actions performed in this project."
      >
        <div className="rounded-md overflow-hidden -mt-6">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Resource
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Resource ID
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Action
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Summary
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  No audit logs available. Enable audit logs to start tracking
                  actions.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </Fragment>
  );
};

export default AuditLogs;
