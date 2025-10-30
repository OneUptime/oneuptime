export interface LiveLogsOptions {
  isLive: boolean;
  onToggle: (next: boolean) => void;
  isDisabled?: boolean;
  isUpdating?: boolean;
  tooltip?: string;
}
