import { ERROR_CODE_COLOR } from "../NotFound/NotFound";
import React, { FunctionComponent, ReactElement } from "react";

// Drawn as the not-found page is (NotFound.tsx).
const ForbiddenPage: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold" style={{ color: ERROR_CODE_COLOR }}>
          403
        </h1>
        <h2 className="mt-4 text-xl font-semibold text-gray-700">
          Access Denied
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          You do not have permission to view this dashboard. Your IP address may
          be restricted.
        </p>
      </div>
    </div>
  );
};

export default ForbiddenPage;
