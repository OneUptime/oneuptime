import { formatReaderFigure } from "Common/Types/DateLanguage";
import { PluralTemplate, Translator } from "Common/Types/Translator";

/*
 * WHAT A CONTAINER'S REQUEST OR LIMIT MEANS, IN THE READER'S WORDS.
 *
 * A pod's and a workload's Containers tab lists each container's requests
 * and limits as Kubernetes writes them ("250m", "512Mi") and says what that
 * means beside it: "250m (0.25 CPU cores)", "512Mi (512 MB)". The meaning
 * was built by hand in English with toFixed, so a German, Persian or Arabic
 * page drew an English phrase and English decimals inside a translated
 * table. Kubernetes' own value is kept exactly as written; what it means is
 * a translated plural for CPU ("0,25 CPU-Kerne", "۰٫۲۵ هستهٔ پردازنده") and
 * a size in the reader's digits for memory and storage ("۵۱۲ MB"), the unit
 * as written. English reads as it did.
 *
 * React-free, so App's tests read it.
 */

// "0.25 CPU cores": the cores a CPU quantity stands for.
export const KUBERNETES_CPU_CORES: PluralTemplate = {
  one: "{{count}} CPU core",
  other: "{{count}} CPU cores",
};

export interface KubernetesResourceReading {
  // Kubernetes' own value, exactly as written: "250m", "512Mi", "2".
  quantity: string;
  /*
   * What it means, in the reader's words and digits: "0.25 CPU cores",
   * "1.5 GB". Null when there is nothing to add (a value written in a way
   * not read here, such as "0.5" or "1e3").
   */
  meaning: string | null;
}

// CPU in millicores: "250m" is a quarter of a core.
const MILLICORES: RegExp = /^(\d+)m$/;

// CPU in whole cores: "2".
const WHOLE_CORES: RegExp = /^\d+$/;

// Memory and storage in 1024-based units: "512Mi".
const BINARY_SIZE: RegExp = /^(\d+)(Ki|Mi|Gi|Ti)$/;

// Ephemeral storage in 1000-based units: "10G".
const DECIMAL_SIZE: RegExp = /^(\d+)(K|M|G|T)$/;

// A size as the tab names it: the figure in the reader's digits, the unit as written.
const size: (data: {
  value: number;
  decimals: number;
  unit: string;
  language: string;
}) => string = (data: {
  value: number;
  decimals: number;
  unit: string;
  language: string;
}): string => {
  return `${formatReaderFigure(data.value, {
    decimals: data.decimals,
    language: data.language,
  })} ${data.unit}`;
};

/*
 * A 1024-based size (Ki, Mi, Gi, Ti) or a 1000-based one (K, M, G, T) as
 * megabytes, gigabytes or terabytes, as the tab always named them: "512Mi
 * (512 MB)", "1536Mi (1.5 GB)", "500Ki (0.49 MB)".
 */
const readSize: (data: {
  count: number;
  unit: string;
  base: number;
  language: string;
}) => string | null = (data: {
  count: number;
  unit: string;
  base: number;
  language: string;
}): string | null => {
  const count: number = data.count;
  const base: number = data.base;
  const language: string = data.language;

  switch (data.unit.charAt(0)) {
    case "K":
      return size({
        value: count / base,
        decimals: count >= base ? 1 : 2,
        unit: "MB",
        language,
      });
    case "M":
      return count >= base
        ? size({ value: count / base, decimals: 1, unit: "GB", language })
        : size({ value: count, decimals: 0, unit: "MB", language });
    case "G":
      return size({ value: count, decimals: 0, unit: "GB", language });
    case "T":
      return size({ value: count, decimals: 0, unit: "TB", language });
    default:
      return null;
  }
};

/*
 * A request's or a limit's value, kept as Kubernetes wrote it, with what it
 * means in `translator`'s language: CPU (`key` "cpu") as cores, memory and
 * storage as a size.
 */
export function readKubernetesResourceValue(data: {
  key: string;
  value: string;
  translator: Translator;
}): KubernetesResourceReading {
  const value: string = data.value;
  const isCpu: boolean = data.key.toLowerCase() === "cpu";
  const language: string = data.translator.language;

  if (!value) {
    return { quantity: value, meaning: null };
  }

  const millicores: RegExpMatchArray | null = value.match(MILLICORES);

  if (isCpu && millicores) {
    /*
     * A millicore is a thousandth of a core, so the cores are exact to
     * three decimals: "0.25", "1.5", "0.125" - never "0.13".
     */
    return {
      quantity: value,
      meaning: data.translator.translatePlural(
        KUBERNETES_CPU_CORES,
        parseInt(millicores[1] || "0") / 1000,
      ),
    };
  }

  if (isCpu && WHOLE_CORES.test(value)) {
    return {
      quantity: value,
      meaning: data.translator.translatePlural(
        KUBERNETES_CPU_CORES,
        parseInt(value),
      ),
    };
  }

  const binary: RegExpMatchArray | null = value.match(BINARY_SIZE);

  if (binary) {
    return {
      quantity: value,
      meaning: readSize({
        count: parseInt(binary[1] || "0"),
        unit: binary[2] || "",
        base: 1024,
        language,
      }),
    };
  }

  const decimal: RegExpMatchArray | null = value.match(DECIMAL_SIZE);

  if (decimal) {
    return {
      quantity: value,
      meaning: readSize({
        count: parseInt(decimal[1] || "0"),
        unit: decimal[2] || "",
        base: 1000,
        language,
      }),
    };
  }

  return { quantity: value, meaning: null };
}

/*
 * The same as one line of text: "250m (0.25 CPU cores)". The tab draws the
 * two parts apart (KubernetesContainersTab), so each keeps its own reading
 * direction on an Arabic or Persian page; this is for text that has no
 * parts, and for tests.
 */
export function formatK8sResourceValue(
  key: string,
  value: string,
  translator: Translator,
): string {
  const reading: KubernetesResourceReading = readKubernetesResourceValue({
    key,
    value,
    translator,
  });

  return reading.meaning
    ? `${reading.quantity} (${reading.meaning})`
    : reading.quantity;
}
