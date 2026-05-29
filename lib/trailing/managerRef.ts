/**
 * TRAILING MANAGER REF — Singleton erişim noktası.
 *
 * useTrailingManager hook'u manager'ı buraya yazar;
 * PositionCard ve diğer component'lar buradan okur.
 * React context overhead'ı olmadan global singleton erişimi.
 */

import type { TrailingManager } from "./manager";

let _manager: TrailingManager | null = null;

export function setActiveTrailingManager(m: TrailingManager | null): void {
  _manager = m;
}

export function getActiveTrailingManager(): TrailingManager | null {
  return _manager;
}
