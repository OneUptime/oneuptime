import React, { useState, useEffect } from "react";
import EmptyState from "../EmptyState/EmptyState";
import IconProp from "../../../Types/Icon/IconProp";

interface OfflineIndicatorProps {
    onOnlineOfflineChange?: (isOnline: boolean) => void;
}

const OfflineIndicator = ({ onOnlineOfflineChange }: OfflineIndicatorProps) => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            onOnlineOfflineChange?.(true);
        };
        
        const handleOffline = () => {
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
