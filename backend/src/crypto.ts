import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { config } from "./config.js";

const encryptionKey = createHash("sha256").update(config.DATA_ENCRYPTION_KEY).digest();

export function encryptSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptSecret(value: string, context: string) {
  const [iv, ciphertext, tag] = value.split(".");
  if (!iv || !ciphertext || !tag) throw new Error("Invalid encrypted secret format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptPayload(value: string, context: string) {
  return encryptSecret(value, `payload:${context}`);
}

export function decryptPayload(value: string, context: string) {
  return decryptSecret(value, `payload:${context}`);
}

export function payloadDigest(value: string) {
  return createHmac("sha256", config.AUTH_TOKEN_PEPPER).update(value).digest("hex");
}
