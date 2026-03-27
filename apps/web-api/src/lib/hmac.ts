/**
 * HMAC signing and verification helpers.
 */

import crypto from "node:crypto";
import { getEnv } from "@cap/config";

const env = getEnv();

export function timingSafeEqual(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  const maxLen = Math.max(expectedBuf.length, actualBuf.length);
  const expectedPadded = Buffer.alloc(maxLen, 0);
  const actualPadded = Buffer.alloc(maxLen, 0);
  expectedBuf.copy(expectedPadded);
  actualBuf.copy(actualPadded);
  return crypto.timingSafeEqual(expectedPadded, actualPadded);
}

export function verifyWebhookSignature(raw: string, timestamp: string, signatureHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", env.MEDIA_SERVER_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return timingSafeEqual(`v1=${digest}`, signatureHeader);
}
