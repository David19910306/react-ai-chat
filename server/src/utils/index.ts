/**
 * 密码哈希工具
 * 使用 node:crypto 的 scrypt 慢哈希 + 随机盐，结果不可逆，抗离线暴力破解。
 * 存储格式: scrypt$N$r$p$saltBase64$hashBase64
 */
import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// 哈希密码，返回带盐的可校验字符串
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// 校验密码是否匹配存储的哈希
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    // 恒定时间比较，防时序攻击
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
