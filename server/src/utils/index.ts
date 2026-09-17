/**
 * 密码哈希工具
 * 使用 node:crypto 的 scrypt 慢哈希 + 随机盐，结果不可逆，抗离线暴力破解。
 * 存储格式: scrypt$N$r$p$saltBase64$hashBase64
 *
 * 一律使用异步版本（crypto.scrypt 而非 scryptSync）：N=16384 时单次约 40ms，
 * 同步调用会阻塞事件循环，登录接口被并发请求时整个进程（含正在流式输出的 SSE 连接）都会卡住。
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

// 哈希密码，返回带盐的可校验字符串
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// 校验密码是否匹配存储的哈希
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    // 恒定时间比较，防时序攻击
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
