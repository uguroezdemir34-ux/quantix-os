/**
 * Vitest setup — jest-dom matcher'larını ekler.
 * Sadece jsdom environment'taki testlerde aktif olur (vitest.config'te
 * setupFiles olarak referans veriliyor).
 */
import "@testing-library/jest-dom/vitest";
