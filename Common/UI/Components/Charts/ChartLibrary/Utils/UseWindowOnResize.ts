import * as React from "react";

export const useOnWindowResize: (handler: () => void) => void = (handler: () => void): void => {
  React.useEffect(() => {
    const handleResize: () => void = () => {
      handler();
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [handler]);
};
