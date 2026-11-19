// Cuentas (Neon Auth): el navegador manda su token (JWT) y aquí se comprueba con las claves públicas de Neon Auth.
// Si es válido, `sub` es el id del usuario. Nunca se confía en un id que diga el cliente sin token.

import { createRemoteJWKSet, jwtVerify } from 'jose';

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

export async function verifyUser(token: string | null | undefined, jwksUrl: string | undefined): Promise<string | null> {
  if (!token || !jwksUrl) return null;
  if (!jwks || jwks.url !== jwksUrl) jwks = { url: jwksUrl, set: createRemoteJWKSet(new URL(jwksUrl)) };
  try {
    const { payload } = await jwtVerify(token, jwks.set);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** El token de la cabecera `Authorization: Bearer …`. */
export const bearer = (req: Request) => req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
