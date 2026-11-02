/*
 * The posts a blog post's page lists as related: the posts that share its
 * rarer tags, the newer first among equals.
 *
 * Of 60 posts drawn at random from the blog, 54 linked to no other post, and
 * tag pages are kept out of search, so a crawler or an AI agent that reached
 * a post had nowhere to go from it but back. Each post now links the few
 * posts most like it.
 *
 * A shared tag counts by how rare it is (its inverse document frequency):
 * sharing "Typha" says more than sharing "Kubernetes", which 15,000 posts
 * carry, and a tag every post carries says nothing. Tags match by slug, as
 * their pages do (BlogTag.getSlug). Only the newest posts carrying each tag are
 * weighed, so a page costs the same however many posts its tags have.
 */

export const RELATED_POSTS_LIMIT: number = 5;

// The newest posts carrying each of a post's tags that are weighed.
export const RELATED_POSTS_CANDIDATES_PER_TAG: number = 500;

// What a post needs to be related: its file name and tags.
export interface RelatablePost {
  fileName: string;
  tags: Array<string>;
}

export interface RelatedPostsIndex<T extends RelatablePost> {
  // The posts, newest first, as the index was built from them.
  posts: ReadonlyArray<T>;
  // Each tag's slug, to the places in `posts` of the posts carrying it.
  placesOfSlug: Map<string, Array<number>>;
  // Each post's tag slugs, once each, by its place in `posts`.
  slugsOfPlace: Array<Array<string>>;
  // Each post's place in `posts`, by file name.
  placeOfFile: Map<string, number>;
}

/*
 * The index of posts listed newest first: built once per list, and read by
 * every post's page.
 */
export function buildRelatedPostsIndex<T extends RelatablePost>(
  posts: ReadonlyArray<T>,
  getSlug: (tag: string) => string,
): RelatedPostsIndex<T> {
  const placesOfSlug: Map<string, Array<number>> = new Map();
  const slugsOfPlace: Array<Array<string>> = [];
  const placeOfFile: Map<string, number> = new Map();

  posts.forEach((post: T, place: number) => {
    if (!placeOfFile.has(post.fileName)) {
      placeOfFile.set(post.fileName, place);
    }

    const slugs: Array<string> = [];

    for (const tag of Array.isArray(post.tags) ? post.tags : []) {
      const slug: string = getSlug(tag);

      if (!slug || slugs.includes(slug)) {
        continue;
      }

      slugs.push(slug);

      const places: Array<number> | undefined = placesOfSlug.get(slug);

      if (places) {
        places.push(place);
      } else {
        placesOfSlug.set(slug, [place]);
      }
    }

    slugsOfPlace.push(slugs);
  });

  return {
    posts: posts,
    placesOfSlug: placesOfSlug,
    slugsOfPlace: slugsOfPlace,
    placeOfFile: placeOfFile,
  };
}

/*
 * The posts most like the post with this file name, most alike first, at most
 * `limit` of them: none for a post the index does not have, or one that
 * shares no tag that says anything.
 */
export function findRelatedPosts<T extends RelatablePost>(
  index: RelatedPostsIndex<T>,
  fileName: string,
  limit: number = RELATED_POSTS_LIMIT,
): Array<T> {
  const place: number | undefined = index.placeOfFile.get(fileName);

  if (place === undefined) {
    return [];
  }

  const scoreOfPlace: Map<number, number> = new Map();

  for (const slug of index.slugsOfPlace[place] || []) {
    const places: Array<number> = index.placesOfSlug.get(slug) || [];
    const weight: number = Math.log(index.posts.length / places.length);

    if (weight <= 0) {
      continue;
    }

    const weighed: number = Math.min(
      places.length,
      RELATED_POSTS_CANDIDATES_PER_TAG,
    );

    for (let candidate: number = 0; candidate < weighed; candidate++) {
      const other: number = places[candidate] as number;

      if (other === place) {
        continue;
      }

      scoreOfPlace.set(other, (scoreOfPlace.get(other) || 0) + weight);
    }
  }

  return [...scoreOfPlace.entries()]
    .sort((a: [number, number], b: [number, number]): number => {
      // The higher score first, and between equals the newer post.
      return b[1] - a[1] || a[0] - b[0];
    })
    .slice(0, limit)
    .map(([other]: [number, number]): T => {
      return index.posts[other] as T;
    });
}
