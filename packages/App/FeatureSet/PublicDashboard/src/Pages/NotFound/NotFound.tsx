import React, { FunctionComponent, ReactElement } from "react";

const NotFoundPage: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-gray-700">
          Dashboard Not Found
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          The dashboard you are looking for does not exist or is no longer
          available.
        </p>
      </div>
    </div>
  );
};

export default NotFoundPage;
