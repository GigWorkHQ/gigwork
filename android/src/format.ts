// Small display helpers. Status labels and colours come from the web's src/live.js, imported where they're used.
export const shortAddress = (address?: string | null) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "");
export const who = (handle?: string | null, wallet?: string | null) => handle || shortAddress(wallet) || "someone";
export const party = (p?: { handle: string | null; wallet: string } | null) => (p ? who(p.handle, p.wallet) : "—");

export function day(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export function dateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
/** "in 3h", "2d ago". */
export function relative(value?: string | null, now = Date.now()) {
  if (!value) return "";
  const diff = new Date(value).getTime() - now;
  const abs = Math.abs(diff);
  const unit = abs < 3_600_000 ? [Math.max(1, Math.round(abs / 60_000)), "m"] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), "h"] : [Math.round(abs / 86_400_000), "d"];
  return diff >= 0 ? `in ${unit[0]}${unit[1]}` : `${unit[0]}${unit[1]} ago`;
}
export function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
/** Adds decimal USDG strings without floating point (6 decimals). */
export function sumAmounts(values: (string | null | undefined)[]) {
  let total = 0n;
  for (const value of values) {
    if (!value) continue;
    const [whole, fraction = ""] = String(value).split(".");
    total += BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0, 6) || "0");
  }
  const text = total.toString().padStart(7, "0");
  return `${text.slice(0, -6)}.${text.slice(-6)}`.replace(/\.?0+$/, "") || "0";
}
export const money = (value?: string | null) => {
  const [whole, fraction = ""] = String(value || "0").split(".");
  return `${Number(whole).toLocaleString("en-US")}.${(fraction + "00").slice(0, 2)}`;
};
