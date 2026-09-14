export interface ParsedKubernetesImageReference {
  name: string;
  suffix?: string;
}

export function parseKubernetesImageReference(
  reference: string,
): ParsedKubernetesImageReference {
  const digestSeparatorIndex: number = reference.indexOf("@");

  if (digestSeparatorIndex >= 0) {
    return {
      name: reference.slice(0, digestSeparatorIndex),
      suffix: reference.slice(digestSeparatorIndex),
    };
  }

  const tagSeparatorIndex: number = reference.lastIndexOf(":");

  if (tagSeparatorIndex > reference.lastIndexOf("/")) {
    return {
      name: reference.slice(0, tagSeparatorIndex),
      suffix: reference.slice(tagSeparatorIndex + 1),
    };
  }

  return { name: reference };
}
