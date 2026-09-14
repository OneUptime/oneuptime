export interface ParsedKubernetesImageReference {
  name: string;
  tag?: string;
  digest?: string;
}

export function parseKubernetesImageReference(
  reference: string,
): ParsedKubernetesImageReference {
  const digestSeparatorIndex: number = reference.indexOf("@");
  let nameAndTag: string = reference;
  let digest: string | undefined;

  if (digestSeparatorIndex > 0 && digestSeparatorIndex < reference.length - 1) {
    nameAndTag = reference.slice(0, digestSeparatorIndex);
    digest = reference.slice(digestSeparatorIndex + 1);
  }

  const tagSeparatorIndex: number = nameAndTag.lastIndexOf(":");
  const lastPathSeparatorIndex: number = nameAndTag.lastIndexOf("/");
  let name: string = nameAndTag;
  let tag: string | undefined;

  if (
    tagSeparatorIndex > lastPathSeparatorIndex &&
    tagSeparatorIndex > 0 &&
    tagSeparatorIndex < nameAndTag.length - 1
  ) {
    name = nameAndTag.slice(0, tagSeparatorIndex);
    tag = nameAndTag.slice(tagSeparatorIndex + 1);
  }

  return {
    name,
    ...(tag ? { tag } : {}),
    ...(digest ? { digest } : {}),
  };
}
