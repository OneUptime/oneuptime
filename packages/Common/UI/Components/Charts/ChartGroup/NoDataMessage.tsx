import React, { FunctionComponent, ReactElement } from "react";

const NoDataMessage: FunctionComponent = (): ReactElement => {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="text-sm text-gray-400 bg-white/90 border border-gray-100 rounded-full px-4 py-1.5 shadow-sm">
        No data available
      </span>
    </div>
  );
};

export default NoDataMessage;
