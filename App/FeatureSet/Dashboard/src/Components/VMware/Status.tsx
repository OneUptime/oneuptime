import React, { FunctionComponent, ReactElement } from "react";

const VMwareStatus: FunctionComponent<{ status: string }> = ({
  status,
}: {
  status: string;
}): ReactElement => {
  const healthy: boolean = ["Connected", "Running", "Healthy"].includes(status);
  const error: boolean = [
    "Disconnected",
    "Inaccessible",
    "Expected running · suspended",
    "Collection failed",
    "Critical health",
    "Expected running · powered off",
  ].includes(status);
  const color: string = healthy
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
    : error
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {status}
    </span>
  );
};

export default VMwareStatus;
