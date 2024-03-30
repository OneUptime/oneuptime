interface ProbeStatusReport {
    isPingCheckOffline: boolean;
    isWebsiteCheckOffline: boolean;
    isPortCheckOffline: boolean;
    hostname: string;
}

export default ProbeStatusReport;
