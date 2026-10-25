import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW MANY AI FIX PULL REQUESTS A REPOSITORY TAKES: ONE CHOICE.
 *
 * Max Open Fix Pull Requests was a number whose help explained three
 * modes: "Leave empty for no cap, or 0 to block them". It is one question
 * now - no limit, a limit, or none at all - and the number is asked only
 * for a limit. The answer is written into the same column as before
 * (CodeRepository.maxOpenFixPullRequests: null, a number, or 0), read as
 * OpenPullRequestCap reads it: the API, Terraform and every stored
 * repository are unchanged.
 *
 * React-free on purpose: App's tests read this without the page.
 */
export enum FixPullRequestLimit {
  NoLimit = "no-limit",
  Limit = "limit",
  Blocked = "blocked",
}

// The form value the choice keeps; never sent (formOnly).
export const FIX_PULL_REQUEST_LIMIT_FIELD_KEY: string = "fixPullRequestLimit";

export const FIX_PULL_REQUEST_LIMIT_FIELD_TITLE: string = translationKey(
  "AI Fix Pull Requests",
);

export const FIX_PULL_REQUEST_LIMIT_ANSWERS: ReadonlyArray<FixPullRequestLimit> =
  [
    FixPullRequestLimit.NoLimit,
    FixPullRequestLimit.Limit,
    FixPullRequestLimit.Blocked,
  ];

export const FIX_PULL_REQUEST_LIMIT_COPY: Record<
  FixPullRequestLimit,
  { title: string; description: string }
> = {
  [FixPullRequestLimit.NoLimit]: {
    title: translationKey("No limit"),
    description: translationKey(
      "AI opens as many fix pull requests as it needs.",
    ),
  },
  [FixPullRequestLimit.Limit]: {
    title: translationKey("A limit"),
    description: translationKey(
      "AI waits while this many of its fix pull requests are open.",
    ),
  },
  [FixPullRequestLimit.Blocked]: {
    title: translationKey("None"),
    description: translationKey(
      "AI opens no fix pull requests in this repository.",
    ),
  },
};

function asValues(values: unknown): Record<string, unknown> {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
}

// The answer a stored limit makes, as OpenPullRequestCap reads it.
export function getFixPullRequestLimit(values: unknown): FixPullRequestLimit {
  const limit: unknown = asValues(values)["maxOpenFixPullRequests"];

  if (limit === null || limit === undefined || limit === "") {
    return FixPullRequestLimit.NoLimit;
  }

  return Number(limit) <= 0
    ? FixPullRequestLimit.Blocked
    : FixPullRequestLimit.Limit;
}

// The answer the form shows: the one picked, else the stored one's.
export function getPickedFixPullRequestLimit(
  values: unknown,
): FixPullRequestLimit {
  const picked: unknown = asValues(values)[FIX_PULL_REQUEST_LIMIT_FIELD_KEY];

  return (Object.values(FixPullRequestLimit) as Array<unknown>).includes(picked)
    ? (picked as FixPullRequestLimit)
    : getFixPullRequestLimit(values);
}

/**
 * The form values an answer makes: no limit clears the column, none writes
 * 0, and a limit keeps a number already set above 0 (else asks for one).
 */
export function getValuesForFixPullRequestLimit<TValues>(data: {
  values: TValues;
  limit: FixPullRequestLimit;
}): TValues {
  const values: Record<string, unknown> = asValues(data.values);
  const current: unknown = values["maxOpenFixPullRequests"];
  let column: number | null;

  if (data.limit === FixPullRequestLimit.NoLimit) {
    column = null;
  } else if (data.limit === FixPullRequestLimit.Blocked) {
    column = 0;
  } else {
    column = Number(current) > 0 ? Number(current) : null;
  }

  return {
    ...values,
    [FIX_PULL_REQUEST_LIMIT_FIELD_KEY]: data.limit,
    maxOpenFixPullRequests: column,
  } as unknown as TValues;
}

/*
 * The limit as the repository's settings show it, in words: no limit,
 * none, or up to the number. A bare "3" beside "AI Fix Pull Requests" read
 * as three pull requests.
 */
export const FIX_PULL_REQUEST_LIMIT_SHOWN: Record<
  Exclude<FixPullRequestLimit, FixPullRequestLimit.Limit>,
  string
> = {
  [FixPullRequestLimit.NoLimit]: translationKey("No limit"),
  [FixPullRequestLimit.Blocked]: translationKey(
    "None: AI opens no fix pull requests here",
  ),
};

export const FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT: string = translationKey(
  "Up to {{limit}} open at once",
);

/*
 * What the settings card says under the limit's title: the question the
 * form's choice answers.
 */
export const FIX_PULL_REQUEST_LIMIT_CARD_DESCRIPTION: string = translationKey(
  "How many fix pull requests AI may have open at once in this repository.",
);

// The number, asked for a limit: the column's own title.
export const MAX_OPEN_FIX_PULL_REQUESTS_TITLE: string = translationKey(
  "Max Open Fix Pull Requests",
);

/*
 * The limit's words on GitLab, which calls a pull request a merge request
 * (CodeHost's pullRequestTerm): the same question, in GitLab's word.
 */
export const FIX_MERGE_REQUEST_LIMIT_FIELD_TITLE: string = translationKey(
  "AI Fix Merge Requests",
);

export const FIX_MERGE_REQUEST_LIMIT_COPY: Record<
  FixPullRequestLimit,
  { title: string; description: string }
> = {
  [FixPullRequestLimit.NoLimit]: {
    title: FIX_PULL_REQUEST_LIMIT_COPY[FixPullRequestLimit.NoLimit].title,
    description: translationKey(
      "AI opens as many fix merge requests as it needs.",
    ),
  },
  [FixPullRequestLimit.Limit]: {
    title: FIX_PULL_REQUEST_LIMIT_COPY[FixPullRequestLimit.Limit].title,
    description: translationKey(
      "AI waits while this many of its fix merge requests are open.",
    ),
  },
  [FixPullRequestLimit.Blocked]: {
    title: FIX_PULL_REQUEST_LIMIT_COPY[FixPullRequestLimit.Blocked].title,
    description: translationKey(
      "AI opens no fix merge requests in this repository.",
    ),
  },
};

export const FIX_MERGE_REQUEST_LIMIT_SHOWN: Record<
  Exclude<FixPullRequestLimit, FixPullRequestLimit.Limit>,
  string
> = {
  [FixPullRequestLimit.NoLimit]:
    FIX_PULL_REQUEST_LIMIT_SHOWN[FixPullRequestLimit.NoLimit],
  [FixPullRequestLimit.Blocked]: translationKey(
    "None: AI opens no fix merge requests here",
  ),
};

export const FIX_MERGE_REQUEST_LIMIT_CARD_DESCRIPTION: string = translationKey(
  "How many fix merge requests AI may have open at once in this repository.",
);

export const MAX_OPEN_FIX_MERGE_REQUESTS_TITLE: string = translationKey(
  "Max Open Fix Merge Requests",
);

// The limit's words for a repository, as its host names a pull request.
export interface FixPullRequestLimitCopy {
  fieldTitle: string;
  answers: Record<FixPullRequestLimit, { title: string; description: string }>;
  shown: Record<
    Exclude<FixPullRequestLimit, FixPullRequestLimit.Limit>,
    string
  >;
  cardDescription: string;
  maxFieldTitle: string;
}

export function getFixPullRequestLimitCopy(
  provider: string | null | undefined,
): FixPullRequestLimitCopy {
  if (CodeHost.getFacts(provider).pullRequestTerm === "merge request") {
    return {
      fieldTitle: FIX_MERGE_REQUEST_LIMIT_FIELD_TITLE,
      answers: FIX_MERGE_REQUEST_LIMIT_COPY,
      shown: FIX_MERGE_REQUEST_LIMIT_SHOWN,
      cardDescription: FIX_MERGE_REQUEST_LIMIT_CARD_DESCRIPTION,
      maxFieldTitle: MAX_OPEN_FIX_MERGE_REQUESTS_TITLE,
    };
  }

  return {
    fieldTitle: FIX_PULL_REQUEST_LIMIT_FIELD_TITLE,
    answers: FIX_PULL_REQUEST_LIMIT_COPY,
    shown: FIX_PULL_REQUEST_LIMIT_SHOWN,
    cardDescription: FIX_PULL_REQUEST_LIMIT_CARD_DESCRIPTION,
    maxFieldTitle: MAX_OPEN_FIX_PULL_REQUESTS_TITLE,
  };
}
