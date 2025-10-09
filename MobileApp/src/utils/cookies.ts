export const parseSetCookieHeader = (setCookie?: string[] | string): string | null => {
  if (!setCookie) {
    return null;
  }

  const rawCookies = Array.isArray(setCookie) ? setCookie : [setCookie];

  const cookies = rawCookies
    .map((cookie) => cookie.split(";"))[0]
    ?.map((part: string) => part.trim());

  if (!cookies || cookies.length === 0) {
    return null;
  }

  return cookies[0] || null;
};

export const mergeCookies = (existing: string | null, nextCookie: string | null): string | null => {
  if (!existing) {
    return nextCookie;
  }

  if (!nextCookie) {
    return existing;
  }

  const cookieMap = new Map<string, string>();

  const addToMap = (cookieString: string) => {
    cookieString.split(";").forEach((cookie: string) => {
      const [key, value] = cookie.split("=");
      if (key) {
        cookieMap.set(key.trim(), value?.trim() || "");
      }
    });
  };

  addToMap(existing);
  addToMap(nextCookie);

  return Array.from(cookieMap.entries())
    .map(([key, value]: [string, string]) => `${key}=${value}`)
    .join("; ");
};
