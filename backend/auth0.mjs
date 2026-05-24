import { createRemoteJWKSet, jwtVerify } from "jose";
import "./env.mjs";

const auth0Domain = process.env.AUTH0_DOMAIN || "dev-dfnxiq863kzpijxm.us.auth0.com";
const auth0ClientId = process.env.AUTH0_CLIENT_ID || "lePPZLTWDfemOOUGqPsks8ApGjo47RST";
const issuer = `https://${auth0Domain}/`;
const jwks = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));

export function getBearerToken(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function requireAuth0User(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw Object.assign(new Error("Missing bearer token."), { statusCode: 401 });
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: auth0ClientId,
  });

  if (!payload.sub) {
    throw Object.assign(new Error("Auth0 token is missing a subject."), { statusCode: 401 });
  }

  return {
    authProvider: "auth0",
    authSubject: payload.sub,
    email: payload.email || "",
    displayName: payload.name || payload.nickname || payload.email || payload.sub,
    claims: payload,
  };
}
