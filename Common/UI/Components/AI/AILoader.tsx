import React, { FunctionComponent, ReactElement, useEffect, useState } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface AILoaderProps {
  /** Optional title to display */
  title?: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Data sources that AI is analyzing */
  dataSourceItems?: Array<string>;
  /** Whether to show data sources (can be toggled) */
  showDataSources?: boolean;
}

interface LoadingStage {
  label: string;
  icon: IconProp;
}

const loadingStages: Array<LoadingStage> = [
  { label: "Gathering context", icon: IconProp.Database },
  { label: "Analyzing data", icon: IconProp.Search },
  { label: "Generating content", icon: IconProp.Edit },
];

const AILoader: FunctionComponent<AILoaderProps> = (
  props: AILoaderProps,
): ReactElement => {
  const [currentStageIndex, setCurrentStageIndex] = useState<number>(0);
  const [showSources, setShowSources] = useState<boolean>(false);

  // Cycle through stages
  useEffect(() => {
    const interval: NodeJS.Timeout = setInterval(() => {
      setCurrentStageIndex((prev: number) => {
        return (prev + 1) % loadingStages.length;
      });
    }, 2500);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const currentStage: LoadingStage = loadingStages[currentStageIndex]!;

  return (
    <div className="py-8 px-4">
      {/* Main AI animation container */}
      <div className="flex flex-col items-center justify-center">
        {/* Animated AI icon with pulse rings */}
        <div className="relative mb-6">
          {/* Outer pulse rings */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-24 h-24 rounded-full bg-indigo-100 animate-ping opacity-20"
              style={{ animationDuration: "2s" }}
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-20 h-20 rounded-full bg-indigo-200 animate-ping opacity-30"
              style={{ animationDuration: "2s", animationDelay: "0.5s" }}
            />
          </div>

          {/* Center icon container */}
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
            <div className="animate-pulse">
              <Icon
                icon={IconProp.Bolt}
                className="w-10 h-10 text-white"
              />
            </div>

            {/* Sparkle effects */}
            <div className="absolute -top-1 -right-1">
              <div
                className="w-3 h-3 bg-yellow-400 rounded-full animate-ping"
                style={{ animationDuration: "1.5s" }}
              />
            </div>
            <div className="absolute -bottom-1 -left-1">
              <div
                className="w-2 h-2 bg-indigo-300 rounded-full animate-ping"
                style={{ animationDuration: "1.8s", animationDelay: "0.3s" }}
              />
            </div>
            <div className="absolute top-0 -left-2">
              <div
                className="w-2 h-2 bg-purple-300 rounded-full animate-ping"
                style={{ animationDuration: "2s", animationDelay: "0.6s" }}
              />
            </div>
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold text-gray-800 mb-1">
          {props.title || "AI is working"}
        </h3>

        {/* Subtitle */}
        {props.subtitle && (
          <p className="text-sm text-gray-500 mb-4 text-center max-w-sm">
            {props.subtitle}
          </p>
        )}

        {/* Current stage indicator */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-full px-4 py-2 mb-6">
          <div className="animate-spin">
            <Icon
              icon={currentStage.icon}
              className="w-4 h-4 text-indigo-600"
            />
          </div>
          <span className="text-sm font-medium text-gray-700">
            {currentStage.label}
            <span className="inline-flex ml-1">
              <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
            </span>
          </span>
        </div>

        {/* Progress stages dots */}
        <div className="flex items-center gap-2 mb-6">
          {loadingStages.map((_stage: LoadingStage, index: number) => {
            const isActive: boolean = index === currentStageIndex;
            const isPast: boolean = index < currentStageIndex;

            return (
              <div
                key={index}
                className={`transition-all duration-300 rounded-full ${
                  isActive
                    ? "w-8 h-2 bg-indigo-600"
                    : isPast
                      ? "w-2 h-2 bg-indigo-400"
                      : "w-2 h-2 bg-gray-300"
                }`}
              />
            );
          })}
        </div>

        {/* Data Sources Section */}
        {props.dataSourceItems && props.dataSourceItems.length > 0 && (
          <div className="w-full max-w-md">
            {/* Toggle button */}
            <button
              type="button"
              onClick={() => {
                setShowSources(!showSources);
              }}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors mx-auto mb-3"
            >
              <Icon
                icon={showSources ? IconProp.ChevronUp : IconProp.ChevronDown}
                className="w-4 h-4"
              />
              <span>
                {showSources ? "Hide" : "View"} data sources ({props.dataSourceItems.length})
              </span>
            </button>

            {/* Animated data sources */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                showSources ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="flex flex-wrap gap-2 justify-center p-3 bg-gray-50 rounded-lg">
                {props.dataSourceItems.map((item: string, index: number) => {
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full border border-gray-200 shadow-sm"
                      style={{
                        animation: showSources
                          ? `fadeInUp 0.3s ease-out ${index * 0.1}s both`
                          : "none",
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs font-medium text-gray-600">
                        {item}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CSS for custom animation */}
      <style>
        {`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
};

export default AILoader;
