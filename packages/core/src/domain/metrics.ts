/**
 * Engagement and outlier scoring.
 *
 * Documented assumption (PRD file was not supplied): outlier score is the ratio of a
 * video's views to the trailing median views of the same source's most recent
 * OUTLIER_WINDOW videos (excluding the video itself). A score requires at least
 * OUTLIER_MIN_HISTORY prior videos with known view counts; otherwise the UI must show
 * "Insufficient history" and never a manufactured number.
 */

export const OUTLIER_WINDOW = 20;
export const OUTLIER_MIN_HISTORY = 5;

export interface MetricCounts {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

/**
 * Engagement rate = sum of reported interaction counts / views.
 * Only fields the platform actually reports participate; null views -> null rate.
 */
export function engagementRate(m: MetricCounts): number | null {
  if (m.views == null || m.views <= 0) return null;
  const parts = [m.likes, m.comments, m.shares, m.saves].filter(
    (v): v is number => v != null,
  );
  if (parts.length === 0) return null;
  const interactions = parts.reduce((a, b) => a + b, 0);
  return interactions / m.views;
}

export type OutlierResult =
  | { kind: "score"; score: number; medianViews: number; sampleSize: number }
  | { kind: "insufficient_history"; sampleSize: number };

/**
 * @param views          the candidate video's view count (null -> insufficient)
 * @param peerViewCounts view counts of the same source's most recent videos,
 *                       newest first, excluding the candidate video
 */
export function outlierScore(
  views: number | null,
  peerViewCounts: Array<number | null>,
): OutlierResult {
  const sample = peerViewCounts
    .slice(0, OUTLIER_WINDOW)
    .filter((v): v is number => v != null && v >= 0);
  if (views == null || sample.length < OUTLIER_MIN_HISTORY) {
    return { kind: "insufficient_history", sampleSize: sample.length };
  }
  const sorted = [...sample].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  if (median <= 0)
    return { kind: "insufficient_history", sampleSize: sample.length };
  return {
    kind: "score",
    score: views / median,
    medianViews: median,
    sampleSize: sample.length,
  };
}

/** Buckets used by library filters. */
export function outlierBucket(
  score: number,
): "under" | "normal" | "over" | "breakout" {
  if (score < 0.5) return "under";
  if (score < 2) return "normal";
  if (score < 5) return "over";
  return "breakout";
}
