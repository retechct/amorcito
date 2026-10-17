import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(24).toString('hex');
  const hash = await scrypt(password, salt, 64, { N:32768, r:8, p:1, maxmem:64*1024*1024 });
  return {salt,hash:hash.toString('hex')};
}
export async function verifyPassword(password, record) {
  if(typeof password !== 'string' || password.length > 256 || !record)return false;
  const candidate = await scrypt(password, record.salt, 64, { N:32768, r:8, p:1, maxmem:64*1024*1024 });
  const expected = Buffer.from(record.hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected,candidate);
}
