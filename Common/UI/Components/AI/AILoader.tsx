import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface AILoaderProps {
  /** Optional title to display */
  title?: string | undefined;
  /** Optional subtitle/description */
  subtitle?: string | undefined;
  /** Data sources that AI is analyzing */
  dataSourceItems?: Array<string> | undefined;
  /** Whether to show data sources (can be toggled) */
  showDataSources?: boolean | undefined;
}

const loadingMessages: Array<string> = [
  "Gathering context",
  "Analyzing data",
  "Generating content",
];

const AILoader: FunctionComponent<AILoaderProps> = (
  props: AILoaderProps,
): ReactElement => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState<number>(0);

  // Cycle through messages
  useEffect(() => {
    const interval: NodeJS.Timeout = setInterval(() => {
      setCurrentMessageIndex((prev: number) => {
        return (prev + 1) % loadingMessages.length;
      });
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="py-12 px-4">
      <div className="flex flex-col items-center justify-center">
        {/* Minimal animated bars */}
        <div className="flex items-end gap-1 h-8 mb-8">
          {[0, 1, 2, 3, 4].map((index: number) => {
            return (
              <div
                key={index}
                className="w-1 bg-gray-800 rounded-full"
                style={{
                  animation: "aiBarPulse 1.2s ease-in-out infinite",
                  animationDelay: `${index * 0.1}s`,
                }}
              />
            );
          })}
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-gray-900 mb-1 tracking-wide">
          {props.title || "Generating"}
        </p>

        {/* Current stage with fade transition */}
        <p className="text-xs text-gray-500 h-4 transition-opacity duration-500">
          {loadingMessages[currentMessageIndex]}
        </p>

        {/* Subtle data sources indicator */}
        {props.dataSourceItems && props.dataSourceItems.length > 0 && (
          <p className="text-xs text-gray-400 mt-6">
            Analyzing {props.dataSourceItems.length} data source
            {props.dataSourceItems.length > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* CSS for animation */}
      <style>
        {`
          @keyframes aiBarPulse {
            0%, 100% {
              height: 8px;
              opacity: 0.4;
            }
            50% {
              height: 24px;
              opacity: 1;
            }
          }
        `}
      </style>
    </div>
  );
};

export default AILoader;
