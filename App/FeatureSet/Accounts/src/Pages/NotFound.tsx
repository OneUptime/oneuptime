import React from "react";

const LoginPage: () => JSX.Element = () => {
  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto text-center">
        <div className="text-6xl sm:text-7xl mb-4">🔍</div>
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          Page not found
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
          Page you are looking for does not exist.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
