import { describe, expect, test } from "@jest/globals";
import BlogTag from "../Utils/BlogTag";
import {
  RELATED_POSTS_CANDIDATES_PER_TAG,
  RELATED_POSTS_LIMIT,
  RelatablePost,
  RelatedPostsIndex,
  buildRelatedPostsIndex,
  findRelatedPosts,
} from "../Utils/BlogRelatedPosts";

/*
 * The posts a blog post's page lists as related (Utils/BlogRelatedPosts.ts).
 * Of 60 posts drawn at random from the blog, 54 linked to no other post, and
 * tag pages are kept out of search: a crawler or an AI agent that reached a
 * post had nowhere to go from it. The posts here are listed newest first, as
 * the blog lists them.
 */

const post: (fileName: string, tags: Array<string>) => RelatablePost = (
  fileName: string,
  tags: Array<string>,
): RelatablePost => {
  return { fileName: fileName, tags: tags };
};

const slugOf: (tag: string) => string = (tag: string): string => {
  return BlogTag.getSlug(tag);
};

const relatedTo: (
  posts: Array<RelatablePost>,
  fileName: string,
  limit?: number,
) => Array<string> = (
  posts: Array<RelatablePost>,
  fileName: string,
  limit?: number,
): Array<string> => {
  const index: RelatedPostsIndex<RelatablePost> = buildRelatedPostsIndex(
    posts,
    slugOf,
  );

  return findRelatedPosts(index, fileName, limit).map(
    (related: RelatablePost): string => {
      return related.fileName;
    },
  );
};

// Posts on a tag nobody is looking for, so the tags under test are rare enough to weigh.
const filler: (count: number) => Array<RelatablePost> = (
  count: number,
): Array<RelatablePost> => {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return post(`filler-${index}`, [`Filler ${index}`]);
  });
};

describe("findRelatedPosts", () => {
  test("lists the posts that share the post's tags, never the post itself", () => {
    const posts: Array<RelatablePost> = [
      post("typha-tls", ["Calico", "Typha", "Kubernetes"]),
      post("typha-ha", ["Calico", "Typha", "Kubernetes"]),
      post("mysql-grants", ["MySQL", "Security"]),
      post("calico-bgp", ["Calico", "Networking"]),
      ...filler(40),
    ];

    expect(relatedTo(posts, "typha-ha")).toEqual(["typha-tls", "calico-bgp"]);
    expect(relatedTo(posts, "mysql-grants")).toEqual([]);
  });

  test("a rarer shared tag counts for more than a common one", () => {
    const posts: Array<RelatablePost> = [
      // Shares only "Kubernetes" and "Networking", which half the blog carries.
      post("common-1", ["Kubernetes", "Networking"]),
      // Shares "Typha", which three posts carry.
      post("rare-1", ["Typha"]),
      post("the-post", ["Typha", "Kubernetes", "Networking"]),
      post("rare-2", ["Typha"]),
      ...Array.from({ length: 30 }, (_: unknown, index: number) => {
        return post(`kubernetes-${index}`, ["Kubernetes", "Networking"]);
      }),
      ...filler(30),
    ];

    const related: Array<string> = relatedTo(posts, "the-post");

    expect(related.slice(0, 2)).toEqual(["rare-1", "rare-2"]);
    expect(related.indexOf("common-1")).toBeGreaterThan(1);
  });

  test("more shared tags count for more", () => {
    const posts: Array<RelatablePost> = [
      post("one-tag", ["Ceph"]),
      post("two-tags", ["Ceph", "Rook"]),
      post("three-tags", ["Ceph", "Rook", "Raspberry Pi"]),
      post("the-post", ["Ceph", "Rook", "Raspberry Pi"]),
      ...filler(40),
    ];

    expect(relatedTo(posts, "the-post")).toEqual([
      "three-tags",
      "two-tags",
      "one-tag",
    ]);
  });

  test("between posts as alike, the newer comes first", () => {
    const posts: Array<RelatablePost> = [
      post("newest", ["OpenTelemetry"]),
      post("newer", ["OpenTelemetry"]),
      post("the-post", ["OpenTelemetry"]),
      post("older", ["OpenTelemetry"]),
      ...filler(40),
    ];

    expect(relatedTo(posts, "the-post")).toEqual(["newest", "newer", "older"]);
  });

  test("lists at most RELATED_POSTS_LIMIT posts, or the limit asked for", () => {
    const posts: Array<RelatablePost> = [
      post("the-post", ["Redis"]),
      ...Array.from({ length: 12 }, (_: unknown, index: number) => {
        return post(`redis-${index}`, ["Redis"]);
      }),
      ...filler(60),
    ];

    expect(relatedTo(posts, "the-post")).toHaveLength(RELATED_POSTS_LIMIT);
    expect(relatedTo(posts, "the-post", 3)).toEqual([
      "redis-0",
      "redis-1",
      "redis-2",
    ]);
  });

  test("tags match by slug, as tag pages do", () => {
    const posts: Array<RelatablePost> = [
      post("dashed", ["Ci-cd"]),
      post("spaced", ["CI CD"]),
      post("the-post", ["CI/CD"]),
      post("cased", ["ci/cd"]),
      ...filler(40),
    ];

    expect(relatedTo(posts, "the-post")).toEqual(["dashed", "spaced", "cased"]);
  });

  test("a tag written twice on one post counts once", () => {
    /*
     * "Streams" is rarer than "Kafka", so the post sharing it comes first -
     * unless "twice" counted its Kafka twice, which would put it ahead.
     */
    const posts: Array<RelatablePost> = [
      post("twice", ["Kafka", "kafka"]),
      post("streams", ["Streams"]),
      post("the-post", ["Kafka", "Streams"]),
      post("kafka", ["Kafka"]),
      ...filler(40),
    ];

    expect(relatedTo(posts, "the-post")).toEqual(["streams", "twice", "kafka"]);
  });

  test("a tag every post carries says nothing", () => {
    const posts: Array<RelatablePost> = Array.from(
      { length: 20 },
      (_: unknown, index: number) => {
        return post(`post-${index}`, ["Blog"]);
      },
    );

    expect(relatedTo(posts, "post-3")).toEqual([]);
  });

  test("a post the index does not have, or one without tags, has none", () => {
    const posts: Array<RelatablePost> = [
      post("untagged", []),
      post("tagged", ["Kafka"]),
      post("also-tagged", ["Kafka"]),
      ...filler(10),
    ];

    expect(relatedTo(posts, "no-such-post")).toEqual([]);
    expect(relatedTo(posts, "untagged")).toEqual([]);
  });

  test("a post whose tags Blogs.json leaves out is read as untagged", () => {
    const posts: Array<RelatablePost> = [
      { fileName: "no-tags-field" } as unknown as RelatablePost,
      post("tagged", ["Kafka"]),
      post("also-tagged", ["Kafka"]),
    ];

    expect(relatedTo(posts, "no-tags-field")).toEqual([]);
    expect(relatedTo(posts, "tagged")).toEqual(["also-tagged"]);
  });

  test("a file listed twice in Blogs.json is its first entry", () => {
    const posts: Array<RelatablePost> = [
      post("duplicated", ["Kafka"]),
      post("other", ["Kafka"]),
      post("duplicated", ["Redis"]),
      ...filler(10),
    ];

    expect(relatedTo(posts, "duplicated")).toEqual(["other"]);
  });

  test("only the newest posts of a tag are weighed, however many carry it", () => {
    const kubernetes: Array<RelatablePost> = Array.from(
      { length: RELATED_POSTS_CANDIDATES_PER_TAG + 50 },
      (_: unknown, index: number) => {
        return post(`kubernetes-${index}`, ["Kubernetes"]);
      },
    );
    // The post is the oldest that carries the tag, past the newest weighed.
    const posts: Array<RelatablePost> = [
      ...kubernetes,
      post("the-post", ["Kubernetes"]),
      ...filler(2000),
    ];

    // As many as there are, to see where the weighing stopped.
    const related: Array<string> = relatedTo(posts, "the-post", 10000);

    expect(related).toHaveLength(RELATED_POSTS_CANDIDATES_PER_TAG);
    expect(related[0]).toBe("kubernetes-0");
    expect(related).toContain(
      `kubernetes-${RELATED_POSTS_CANDIDATES_PER_TAG - 1}`,
    );
    expect(related).not.toContain(
      `kubernetes-${RELATED_POSTS_CANDIDATES_PER_TAG}`,
    );
  });

  test("an index of 61,000 posts is built once, and read quickly", () => {
    const tags: Array<string> = [
      "Kubernetes",
      "Rook",
      "Ceph",
      "Terraform",
      "MySQL",
      "OpenTelemetry",
      "Monitoring",
      "Redis",
    ];
    const posts: Array<RelatablePost> = Array.from(
      { length: 61000 },
      (_: unknown, index: number) => {
        return post(`post-${index}`, [
          tags[index % tags.length] as string,
          tags[(index * 7) % tags.length] as string,
          `Topic ${index % 4000}`,
        ]);
      },
    );

    const builtFrom: number = Date.now();
    const index: RelatedPostsIndex<RelatablePost> = buildRelatedPostsIndex(
      posts,
      slugOf,
    );
    expect(Date.now() - builtFrom).toBeLessThan(5000);

    const readFrom: number = Date.now();
    for (let place: number = 0; place < 200; place++) {
      expect(
        findRelatedPosts(index, `post-${place * 300}`).length,
      ).toBeGreaterThan(0);
    }
    // Two hundred pages' worth.
    expect(Date.now() - readFrom).toBeLessThan(2000);
  });
});
