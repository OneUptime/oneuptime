import React, { ReactElement } from "react";

const VMwareRecoveryNotice: () => ReactElement = (): ReactElement => {
  return (
    <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
      <p className="font-medium text-gray-900 dark:text-gray-100">
        Recovery behavior
      </p>
      <p className="mt-1">
        Returning to an operational status requires fresh data that meets
        recovery criteria for every monitored resource. Missing data and values
        between alert and recovery thresholds do not count as recovery.
      </p>
    </div>
  );
};

export default VMwareRecoveryNotice;
