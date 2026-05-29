import { OkxCredsCard } from "@/components/ayarlar/OkxCredsCard";
import { TelegramTestCard } from "@/components/ayarlar/TelegramTestCard";
import { TradingLimitsCard } from "@/components/ayarlar/TradingLimitsCard";
import { DrawdownToggleCard } from "@/components/ayarlar/DrawdownToggleCard";
import { AccountBalanceCard } from "@/components/ayarlar/AccountBalanceCard";

export default function AyarlarPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <AccountBalanceCard />
      <OkxCredsCard />
      <TelegramTestCard />
      <TradingLimitsCard />
      <DrawdownToggleCard />
    </div>
  );
}
