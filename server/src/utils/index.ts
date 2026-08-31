// 加解密
import { configDotenv } from 'dotenv';
import crypto from 'node:crypto';

const AES_KEY = configDotenv({ path: '.env.development' }).parsed?.AES_KEY ?? '';

// 加密
export function encrypted (pwd: string): string {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(AES_KEY, 'hex');

  // 加个防御校验，配置写错立刻报错而不是加密时才炸
  if (key.length !== 32) {
    throw new Error(`AES_KEY 长度错误：期望 32 字节，实际 ${key.length} 字节`);
  }

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(pwd, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 用于校验数据是否被篡改
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// 解密
export function decrypted(hashPwd: string) {
  const buf = Buffer.from(hashPwd, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const key = Buffer.from(AES_KEY, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),                         // 校验失败这里会抛错
  ]);
  return decrypted.toString('utf8');
}

/**
 * 目前是直接密码比较，后续要改成比较哈希值(涉及到注册时的逻辑，以及salt的存表)
 * @param target 
 * @param source 
 */
export function comparePwdHash(hashPwd: string, sourcePwd: string) {
  const pwd = decrypted(hashPwd);
  return pwd === sourcePwd;
}