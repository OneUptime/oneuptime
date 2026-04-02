export interface ParsedStackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
}

export default class ProfileUtil {
  public static getProfileTypeDisplayName(profileType: string): string {
    const type: string = profileType.toLowerCase().trim();

    switch (type) {
      case "cpu":
        return "CPU Usage";
      case "wall":
        return "Wall Clock Time";
      case "inuse_objects":
        return "Memory Objects in Use";
      case "inuse_space":
        return "Memory Space in Use";
      case "alloc_objects":
        return "Memory Allocations (Count)";
      case "alloc_space":
        return "Memory Allocations (Size)";
      case "goroutine":
        return "Goroutines";
      case "contention":
        return "Lock Contention";
      case "samples":
        return "CPU Samples";
      case "mutex":
        return "Mutex Contention";
      case "block":
        return "Blocking Operations";
      case "heap":
        return "Heap Memory";
      default:
        return profileType;
    }
  }

  public static getProfileTypeBadgeColor(profileType: string): string {
    const type: string = profileType.toLowerCase().trim();

    switch (type) {
      case "cpu":
      case "samples":
        return "bg-orange-100 text-orange-800";
      case "wall":
        return "bg-purple-100 text-purple-800";
      case "inuse_objects":
      case "inuse_space":
      case "alloc_objects":
      case "alloc_space":
      case "heap":
        return "bg-blue-100 text-blue-800";
      case "goroutine":
        return "bg-green-100 text-green-800";
      case "contention":
      case "mutex":
      case "block":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  }


  public static getFrameTypeColor(frameType: string): string {
    const type: string = frameType.toLowerCase();

    switch (type) {
      case "kernel":
        return "bg-red-500";
      case "native":
        return "bg-orange-500";
      case "jvm":
        return "bg-green-500";
      case "cpython":
        return "bg-blue-500";
      case "go":
        return "bg-cyan-500";
      case "v8js":
        return "bg-yellow-500";
      default:
        return "bg-gray-400";
    }
  }

  public static getFrameTypeTextColor(frameType: string): string {
    const type: string = frameType.toLowerCase();

    switch (type) {
      case "kernel":
        return "text-red-700";
      case "native":
        return "text-orange-700";
      case "jvm":
        return "text-green-700";
      case "cpython":
        return "text-blue-700";
      case "go":
        return "text-cyan-700";
      case "v8js":
        return "text-yellow-700";
      default:
        return "text-gray-600";
    }
  }

  public static getFrameTypeBgLight(frameType: string): string {
    const type: string = frameType.toLowerCase();

    switch (type) {
      case "kernel":
        return "bg-red-400";
      case "native":
        return "bg-orange-400";
      case "jvm":
        return "bg-green-400";
      case "cpython":
        return "bg-blue-400";
      case "go":
        return "bg-cyan-400";
      case "v8js":
        return "bg-yellow-400";
      default:
        return "bg-gray-300";
    }
  }

  public static parseStackFrame(frame: string): ParsedStackFrame {
    // Format: "function@file:line"
    const atIndex: number = frame.indexOf("@");

    if (atIndex === -1) {
      return {
        functionName: frame,
        fileName: "",
        lineNumber: 0,
      };
    }

    const functionName: string = frame.substring(0, atIndex);
    const rest: string = frame.substring(atIndex + 1);

    const lastColonIndex: number = rest.lastIndexOf(":");

    if (lastColonIndex === -1) {
      return {
        functionName,
        fileName: rest,
        lineNumber: 0,
      };
    }

    const fileName: string = rest.substring(0, lastColonIndex);
    const lineStr: string = rest.substring(lastColonIndex + 1);
    const lineNumber: number = parseInt(lineStr, 10);

    return {
      functionName,
      fileName,
      lineNumber: isNaN(lineNumber) ? 0 : lineNumber,
    };
  }

  public static formatProfileValue(value: number, unit: string): string {
    const lowerUnit: string = unit.toLowerCase();

    if (lowerUnit === "nanoseconds" || lowerUnit === "ns") {
      if (value >= 1_000_000_000) {
        return `${(value / 1_000_000_000).toFixed(2)}s`;
      }
      if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(2)}ms`;
      }
      if (value >= 1_000) {
        return `${(value / 1_000).toFixed(2)}us`;
      }
      return `${value}ns`;
    }

    if (lowerUnit === "bytes" || lowerUnit === "byte") {
      if (value >= 1_073_741_824) {
        return `${(value / 1_073_741_824).toFixed(2)} GB`;
      }
      if (value >= 1_048_576) {
        return `${(value / 1_048_576).toFixed(2)} MB`;
      }
      if (value >= 1_024) {
        return `${(value / 1_024).toFixed(2)} KB`;
      }
      return `${value} B`;
    }

    if (lowerUnit === "count" || lowerUnit === "samples") {
      if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(2)}M`;
      }
      if (value >= 1_000) {
        return `${(value / 1_000).toFixed(2)}K`;
      }
      return `${value}`;
    }

    return `${value} ${unit}`;
  }
}
