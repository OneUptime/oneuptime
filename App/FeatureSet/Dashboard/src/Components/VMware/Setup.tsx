import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";

const VMwareSetup: FunctionComponent = (): ReactElement => {
  return (
    <Card
      title="Connect VMware vSphere"
      description="Collect ESXi hosts, virtual machines, and datastores from your management network."
    >
      <div className="space-y-6 p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {[
            {
              title: "1. Prepare read-only access",
              body: "Create a dedicated account with read-only inventory and performance access to vCenter. Keep its credentials on the collector machine.",
            },
            {
              title: "2. Run the VMware collector",
              body: "Install on a management host that can reach vCenter and OneUptime. Use a stable, unique source identifier for each environment.",
            },
            {
              title: "3. Choose what should alert",
              body: "Sources and resources appear automatically. Select the VMs expected to run, review maintenance settings, and create monitors from templates.",
            },
          ].map((step: { title: string; body: string }) => {
            return (
              <div
                key={step.title}
                className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900"
              >
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {step.body}
                </p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Use a telemetry ingestion key from Project Settings. Your VMware
            credentials never need to be entered in OneUptime.
          </p>
          <Link
            to={new Route("/docs/telemetry/vmware")}
            className="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
          >
            Open installation guide →
          </Link>
        </div>
      </div>
    </Card>
  );
};

export default VMwareSetup;
