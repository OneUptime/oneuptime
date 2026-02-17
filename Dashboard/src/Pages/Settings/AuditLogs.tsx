import PageComponentProps from "../PageComponentProps";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
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
        <div className="mt-3 -mb-6 border-t border-gray-200 rounded-b-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Resource
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Resource ID
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Summary
                </th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
          </table>
          <EmptyState
            id="audit-logs-empty"
            icon={IconProp.Activity}
            title="No Audit Logs"
            description="No audit logs available. Enable audit logs in the Admin Dashboard to start tracking actions."
          />
        </div>
      </Card>
    </Fragment>
  );
};

export default AuditLogs;
