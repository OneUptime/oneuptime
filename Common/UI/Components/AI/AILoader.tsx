import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const loadingStages: Array<string> = ["Analyzing", "Processing", "Generating"];

const AILoader: FunctionComponent = (): ReactElement => {
  const [stageIndex, setStageIndex] = useState<number>(0);
  const [dots, setDots] = useState<string>("");

  // Cycle through stages
  useEffect(() => {
    const interval: NodeJS.Timeout = setInterval(() => {
      setStageIndex((prev: number) => {
        return (prev + 1) % loadingStages.length;
      });
    }, 2500);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Animate dots
  useEffect(() => {
    const interval: NodeJS.Timeout = setInterval(() => {
      setDots((prev: string) => {
        return prev.length >= 3 ? "" : prev + ".";
      });
    }, 400);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="py-8 px-4">
      <div className="flex items-center justify-center gap-3">
        {/* Pulsing AI indicator */}
        <div className="relative">
          <div
            className="w-2 h-2 bg-indigo-600 rounded-full"
            style={{
              animation: "aiPulse 1.5s ease-in-out infinite",
            }}
          />
          <div
            className="absolute inset-0 w-2 h-2 bg-indigo-600 rounded-full"
            style={{
              animation: "aiPing 1.5s ease-out infinite",
            }}
          />
        </div>

        {/* Status text */}
        <span className="text-sm text-gray-600 font-medium min-w-[100px]">
          {loadingStages[stageIndex]}
          <span className="inline-block w-4 text-left">{dots}</span>
        </span>
      </div>

      {/* CSS for animations */}
      <style>
        {`
          @keyframes aiPulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.7;
              transform: scale(1.1);
            }
          }
          @keyframes aiPing {
            0% {
              opacity: 0.6;
              transform: scale(1);
            }
            100% {
              opacity: 0;
              transform: scale(2.5);
            }
          }
        `}
      </style>
    </div>
  );
};

export default AILoader;
