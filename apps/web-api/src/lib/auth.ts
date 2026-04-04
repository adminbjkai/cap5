import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getEnv } from '@cap/config';

function getJwtSecret(): string {
  const env = getEnv();
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required but not set');
  }
  return env.JWT_SECRET;
}

/**
 * Parse a duration string like "7d", "24h", "60m", "3600s" into seconds.
 * Falls back to 7 days if the format is unrecognised.
 */
export function parseExpiresIn(value: string): number {
  const match = value.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) {
    console.warn(`parseExpiresIn: Unrecognized JWT_EXPIRES_IN format "${value}", falling back to 7 days`);
    return 7 * 24 * 60 * 60; // default 7 days
  }
  const num = parseInt(match[1]!, 10);
  switch (match[2]!.toLowerCase()) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 60 * 60;
    case 'd': return num * 60 * 60 * 24;
    default: return 7 * 24 * 60 * 60;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(userId: string): string {
  const expiresIn = parseExpiresIn(getEnv().JWT_EXPIRES_IN);
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn });
}

export function verifyToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, getJwtSecret());
  if (typeof decoded === 'string' || !('sub' in decoded)) {
    throw new Error('Invalid token payload');
  }
  return { sub: decoded.sub as string };
}
