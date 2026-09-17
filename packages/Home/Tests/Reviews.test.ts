import ReviewLists, { AllReviews, Review } from "../Utils/Reviews";

/*
 * The landing page renders reviews in three columns, filled by round-robin so
 * the columns stay visually balanced however many reviews exist. A bug in that
 * split either drops a review off the page or double-counts one, and an empty
 * field renders a broken card. These pin the partition and the shape of the
 * data feeding /data/reviews.json.
 */

describe("Reviews data integrity", () => {
  test("there is at least one review to show", () => {
    expect(AllReviews.length).toBeGreaterThan(0);
  });

  test("every review has all five fields populated", () => {
    for (const review of AllReviews) {
      for (const field of ["name", "role", "company", "text", "title"] as Array<
        keyof Review
      >) {
        expect(typeof review[field]).toBe("string");
        expect(review[field].trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("Reviews three-column split", () => {
  const list1: Array<Review> = ReviewLists.reviewsList1;
  const list2: Array<Review> = ReviewLists.reviewsList2;
  const list3: Array<Review> = ReviewLists.reviewsList3;

  test("the three lists together contain exactly every review, once", () => {
    const combinedLength: number = list1.length + list2.length + list3.length;
    expect(combinedLength).toBe(AllReviews.length);

    // Object identity: each list holds the same objects, no copies or omissions.
    const seen: Set<Review> = new Set<Review>([...list1, ...list2, ...list3]);
    expect(seen.size).toBe(AllReviews.length);
    for (const review of AllReviews) {
      expect(seen.has(review)).toBe(true);
    }
  });

  test("the columns stay balanced — sizes differ by at most one", () => {
    const sizes: Array<number> = [list1.length, list2.length, list3.length];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  test("reviews are dealt round-robin into the three columns by index", () => {
    AllReviews.forEach((review: Review, index: number): void => {
      const expectedList: Array<Review> = [list1, list2, list3][index % 3]!;
      const positionInList: number = Math.floor(index / 3);
      expect(expectedList[positionInList]).toBe(review);
    });
  });
});
