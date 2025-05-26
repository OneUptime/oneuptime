import React, { useState, useEffect, ReactElement } from "react";
import EmptyState from "../EmptyState/EmptyState";
import IconProp from "../../../Types/Icon/IconProp";
import { VoidFunction } from "../../../Types/FunctionTypes";

interface OfflineIndicatorProps {
  onOnlineOfflineChange?: (isOnline: boolean) => void;
}

type OfflineIndicatorComponent = React.FC<OfflineIndicatorProps>;

const OfflineIndicator: OfflineIndicatorComponent = ({
  onOnlineOfflineChange,
}: OfflineIndicatorProps): ReactElement => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline: VoidFunction = () => {
      setIsOnline(true);
      onOnlineOfflineChange?.(true);
    };

    const handleOffline: VoidFunction = () => {
      setIsOnline(false);
      onOnlineOfflineChange?.(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Call with initial state
    onOnlineOfflineChange?.(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [onOnlineOfflineChange]);

  return (
    <div>
      {!isOnline && (
        <EmptyState
          id="offline-indicator"
          title="You are offline"
          description="Please check your internet connection."
          icon={IconProp.NoSignal}
        />
      )}
    </div>
  );
};

export default OfflineIndicator;
