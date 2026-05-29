export interface Trade {
  score: number;
  pnlUsd: number;
  closedAt?: number;
}

export interface BucketStats {
  min: number;
  max: number;
  n: number;
  wr: number | null;
  isCut: boolean;
  isBoost: boolean;
  hasData: boolean;
}

const BUCKET_SIZE = 5;

export function getBucketStats(score: number, trades: readonly Trade[]): BucketStats {
  const min = Math.floor(score / BUCKET_SIZE) * BUCKET_SIZE;
  const max = min + BUCKET_SIZE - 1;
  const inBucket = trades.filter(t => t.score >= min && t.score <= max);
  const n = inBucket.length;
  if (n === 0) return { min, max, n, wr: null, isCut: false, isBoost: false, hasData: false };
  const wins = inBucket.filter(t => t.pnlUsd > 0).length;
  const wr = (wins / n) * 100;
  const isCut = n >= 5 && wr < 40;
  const isBoost = n >= 5 && wr >= 65;
  return { min, max, n, wr, isCut, isBoost, hasData: true };
}
