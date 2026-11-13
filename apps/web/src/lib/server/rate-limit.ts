export type RateLimiter = {
  hit: (key: string, now?: number) => { allowed: boolean; retryAfterS: number };
};

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const retryAfterS = Math.ceil((recent[0] + windowMs - now) / 1000);
        return { allowed: false, retryAfterS };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, times] of hits) {
          if (times[times.length - 1] <= cutoff) hits.delete(k);
        }
      }
      return { allowed: true, retryAfterS: 0 };
    },
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
