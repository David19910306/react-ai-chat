/**
 * 密码哈希工具
 * 使用 node:crypto 的 scrypt 慢哈希 + 随机盐，结果不可逆，抗离线暴力破解。
 * 存储格式: scrypt$N$r$p$saltBase64$hashBase64
 *
 * 一律使用异步版本（crypto.scrypt 而非 scryptSync）：N=16384 时单次约 40ms，
 * 同步调用会阻塞事件循环，登录接口被并发请求时整个进程（含正在流式输出的 SSE 连接）都会卡住。
 */
import crypto from 'node:crypto';
import path from 'node:path';
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

// 获取当前的时间，精确到秒
export function getCurrentTime() {
  const currentTime = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false // 使用24小时制
  });
  return currentTime.format(new Date());
}

/**
 * 取文件后缀（小写、不含点）。没有后缀时返回空串。
 *
 * 用 lastIndexOf 而不是 split('.')[1]：后者遇到「报告.2024.final.pdf」会取到 2024，
 * 存进库的 file_suffix 就是错的，前端按后缀选图标、服务端按后缀判类型全跟着错。
 */
export function getSuffix(filename: string): string {
  const dot = filename.lastIndexOf('.');
  // dot <= 0 同时覆盖「没有点」和「.gitignore 这类以点开头的隐藏文件」——
  // 后者整个名字都是文件名，不是后缀
  if (dot <= 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * 还原 multer 交上来的原始文件名。
 *
 * multipart 里的 filename 字段按 RFC 7578 是 latin1，multer 不做转码就直接给到 originalname，
 * 中文名拿来直接用会变成乱码，必须按 utf8 重解一次。
 * 同时剥掉路径成分：部分客户端会带完整路径上来，而 ../ 一旦流到任何拼接路径的地方就是目录穿越。
 */
export function decodeOriginalName(raw: string): string {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  // 先把反斜杠归一成斜杠，否则 Windows 风格的 ..\..\x 在 posix 语义下会被当成单个文件名整体保留
  return path.basename(decoded.replace(/\\/g, '/'));
}

