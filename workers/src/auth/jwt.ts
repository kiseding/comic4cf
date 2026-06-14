import { SignJWT, jwtVerify } from "jose";

export interface JwtPayload { userId: number; username: string; }

function toKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: JwtPayload, secret: string): Promise<string> {
  return new SignJWT({ ...payload }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").setIssuedAt().sign(toKey(secret));
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, toKey(secret));
    return { userId: payload.userId as number, username: payload.username as string };
  } catch { return null; }
}

export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  return parts.length === 2 && parts[0].toLowerCase() === "bearer" ? parts[1] : null;
}
