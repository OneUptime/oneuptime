import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  text: string;
  className?: string | undefined;
}

interface OsVersionParts {
  primary: string;
  secondary?: string;
  kernel?: string;
}

const KERNEL_HINTS: Array<RegExp> = [
  /\bKernel Version\b/iu,
  /\broot:/iu,
  /\bxnu-/iu,
  /\bDarwin Kernel\b/iu,
];

const KERNEL_PREFIX_REGEX: RegExp = /^(Darwin|Linux|FreeBSD|Windows_NT)\s/u;

const looksLikeKernelString: (value: string) => boolean = (
  value: string,
): boolean => {
  if (value.length > 50) {
    return true;
  }
  for (const r of KERNEL_HINTS) {
    if (r.test(value)) {
      return true;
    }
  }
  return false;
};

const summarizeKernel: (kernel: string) => string | null = (
  kernel: string,
): string | null => {
  const archMatch: RegExpMatchArray | null = kernel.match(
    /\b(arm64|aarch64|x86_64|amd64|i[3-6]86|riscv64|ppc64le)\b/iu,
  );
  const versionMatch: RegExpMatchArray | null = kernel.match(
    /\b(\d+\.\d+(?:\.\d+)?)\b/u,
  );
  const nameMatch: RegExpMatchArray | null = kernel.match(
    /^(Darwin|Linux|FreeBSD|Windows_NT)\b/u,
  );

  const parts: Array<string> = [];
  if (nameMatch) {
    parts.push(nameMatch[1]!);
  }
  if (versionMatch) {
    parts.push(versionMatch[1]!);
  }
  const arch: string | null = archMatch ? archMatch[1]! : null;
  const head: string = parts.join(" ");
  if (!head && !arch) {
    return null;
  }
  if (head && arch) {
    return `${head} · ${arch}`;
  }
  return head || arch;
};

const parseOsVersion: (raw: string) => OsVersionParts = (
  raw: string,
): OsVersionParts => {
  const text: string = raw.trim();

  const fullMatch: RegExpMatchArray | null = text.match(
    /^(.+?)\s*\(([^()]+)\)\s*\((.+)\)\s*$/u,
  );
  if (fullMatch && fullMatch[1] && fullMatch[2] && fullMatch[3]) {
    return {
      primary: fullMatch[1].trim(),
      secondary: fullMatch[2].trim(),
      kernel: fullMatch[3].trim(),
    };
  }

  const singleParen: RegExpMatchArray | null = text.match(
    /^(.+?)\s*\(([^()]+)\)\s*$/u,
  );
  if (singleParen && singleParen[1] && singleParen[2]) {
    const head: string = singleParen[1].trim();
    const inner: string = singleParen[2].trim();
    if (looksLikeKernelString(inner)) {
      return { primary: head, kernel: inner };
    }
    return { primary: head, secondary: inner };
  }

  if (KERNEL_PREFIX_REGEX.test(text) && text.length > 40) {
    const headline: string = summarizeKernel(text) || text.split(/\s+/u)[0]!;
    return { primary: headline, kernel: text };
  }

  return { primary: text };
};

export const getOsVersionPrimary: (raw: string) => string = (
  raw: string,
): string => {
  if (!raw || raw.trim() === "") {
    return "";
  }
  return parseOsVersion(raw).primary;
};

const OsVersionDisplay: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (!props.text || props.text.trim() === "" || props.text === "-") {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const parts: OsVersionParts = parseOsVersion(props.text);
  const kernelSummary: string | null = parts.kernel
    ? summarizeKernel(parts.kernel)
    : null;

  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${props.className || ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-0.5 text-sm font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
          <Icon icon={IconProp.Cog} className="h-3.5 w-3.5 text-indigo-500" />
          <span className="break-all">{parts.primary}</span>
        </span>
        {parts.secondary ? (
          <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700 ring-1 ring-inset ring-gray-200">
            {parts.secondary}
          </span>
        ) : null}
      </div>

      {parts.kernel ? (
        <div className="mt-0.5">
          <button
            type="button"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            aria-expanded={isExpanded}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-colors"
          >
            <Icon icon={IconProp.Info} className="h-3 w-3 text-indigo-500" />
            <span>
              {kernelSummary ? `Kernel · ${kernelSummary}` : "Kernel details"}
            </span>
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.25}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {isExpanded ? (
            <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 text-xs font-mono text-gray-700 ring-1 ring-inset ring-gray-200">
              {parts.kernel}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default OsVersionDisplay;
