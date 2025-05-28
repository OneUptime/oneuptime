import React from "react";

const ForbiddenPage: () => JSX.Element = () => {
  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          Forbidden
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          You do not have permission to access this page.
        </p>
      </div>
    </div>
  );
};

export default ForbiddenPage;
