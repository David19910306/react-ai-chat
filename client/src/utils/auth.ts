// token 存取工具：登录后写入，请求时统一注入，避免在代码里硬编码
const TOKEN_KEY = 'chat_ai_token';

export type CurrentUser = {
  userId: string;
  username: string;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 从 token 解析当前登录用户，供界面展示头像和用户名。
 * 前端无法验签，这里只做解码，因此结果仅用于展示，不能作为权限判断依据。
 */
export function getCurrentUser(): CurrentUser | null {
  // JWT 结构为 header.payload.signature，用户信息在第二段
  const payload = getToken()?.split('.')[1];
  if (!payload) return null;

  try {
    // 第二段是 base64url，先还原成标准 base64；
    // 再用 TextDecoder 按 UTF-8 解码，否则中文用户名会乱码
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const { userId, username } = JSON.parse(new TextDecoder().decode(bytes)) as {
      userId?: string;
      username?: string;
    };
    if (!username) return null;
    return { userId: String(userId ?? ''), username: String(username) };
  } catch {
    // token 损坏或不是预期的 JWT 结构，按未登录处理
    return null;
  }
}
