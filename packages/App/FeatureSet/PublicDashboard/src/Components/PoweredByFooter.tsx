import { getPoweredByLink } from "Common/UI/Utils/ProductBranding";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The public dashboard's footer: "Powered by" the product - OneUptime,
 * linking to oneuptime.com, or the name the installation goes by
 * (ProductBranding), linking to its website, or to nothing when it has none.
 */
const PoweredByFooter: FunctionComponent = (): ReactElement => {
  const poweredBy: { name: string; url: string | null } = getPoweredByLink();

  return (
    <div className="max-w-7xl mx-auto px-5 py-5">
      <div
        className="flex items-center justify-center text-xs text-gray-400"
        data-testid="public-dashboard-powered-by"
      >
        <span>Powered by</span>
        {poweredBy.url ? (
          <a
            href={poweredBy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-gray-500 hover:text-gray-700 font-medium"
          >
            {poweredBy.name}
          </a>
        ) : (
          <span className="ml-1 text-gray-500 font-medium">
            {poweredBy.name}
          </span>
        )}
      </div>
    </div>
  );
};

export default PoweredByFooter;
