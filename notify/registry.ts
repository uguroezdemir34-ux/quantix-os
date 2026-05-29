/**
 * NOTIFY REGISTRY — Channel factory.
 *
 * Telegram: ✓ DOLU (paket #9)
 * Discord, Email: iskelet (gelecek)
 */

import type {
  NotifyChannel,
  ChannelName,
  BaseChannelConfig,
  NotifyMessage,
  NotifyResult,
} from "./types";
import { notImplementedResult } from "./types";
import { TelegramChannel } from "./telegram/channel";

/**
 * Boş iskelet channel — Discord/Email için.
 */
class StubChannel implements NotifyChannel {
  readonly name: ChannelName;
  readonly isImplemented = false;

  constructor(name: ChannelName) {
    this.name = name;
  }

  isConfigured(): boolean {
    return false;
  }

  async send(_msg: NotifyMessage): Promise<NotifyResult> {
    return notImplementedResult(this.name);
  }
}

export function createChannel(
  name: ChannelName,
  config: BaseChannelConfig = {},
): NotifyChannel {
  switch (name) {
    case "telegram":
      return new TelegramChannel({ fetchFn: config.fetchFn });
    case "discord":
    case "email":
      return new StubChannel(name);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown channel: ${_exhaustive}`);
    }
  }
}

/**
 * Sadece "production-ready + configured" channel'lar.
 */
export function getActiveChannels(): ChannelName[] {
  return (["telegram", "discord", "email"] as ChannelName[]).filter((name) => {
    const c = createChannel(name);
    return c.isImplemented && c.isConfigured();
  });
}

export function isValidChannel(name: string): name is ChannelName {
  return name === "telegram" || name === "discord" || name === "email";
}
