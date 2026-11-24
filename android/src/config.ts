// Public configuration only. The app holds no secrets and never a wallet key.
const trim = (value: string) => value.replace(/\/+$/, "");
export const API = trim(process.env.EXPO_PUBLIC_API_URL || "https://gigwork-api-uhpj.onrender.com");
export const WEB = trim(process.env.EXPO_PUBLIC_WEB_URL || "https://www.gigworkhq.com");
