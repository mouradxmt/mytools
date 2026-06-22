#!/usr/bin/env node
// Generates a JWT secret and matching Supabase anon + service_role API keys.
// HS256, signed exactly like Supabase expects. No external dependencies.
//
// Output (stdout), one KEY=VALUE per line:
//   JWT_SECRET=...
//   ANON_KEY=...
//   SERVICE_ROLE_KEY=...
//
// Reuse an existing secret by passing it in the environment:
//   JWT_SECRET=... node gen-keys.mjs

import crypto from 'node:crypto';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function sign(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = (o) => b64url(JSON.stringify(o));
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

const jwtSecret = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
  ? process.env.JWT_SECRET
  : crypto.randomBytes(32).toString('hex'); // 64 chars

const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10; // 10 years

const anon = sign({ role: 'anon', iss: 'supabase', iat, exp }, jwtSecret);
const service = sign({ role: 'service_role', iss: 'supabase', iat, exp }, jwtSecret);

process.stdout.write(
  `JWT_SECRET=${jwtSecret}\n` +
  `ANON_KEY=${anon}\n` +
  `SERVICE_ROLE_KEY=${service}\n`
);
