// token 存取工具：登录后写入，请求时统一注入，避免在代码里硬编码
const TOKEN_KEY = 'chat_ai_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
