// 用户相关接口请求封装：统一注入 Authorization 头，集中处理错误
import { getToken } from '../utils/auth';

const BASE_URL = '/api';

type User = {
  userId: string;
  username: string;
  token?: string;
};

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? `HTTP error! status: ${response.status}`);
  }
  return data;
}

// 登录
export async function loginApi(username: string, password: string): Promise<User> {
  const data = await request<{ user: User }>('/login/user', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

// 注册
export async function registerApi(payload: {
  username: string;
  password: string;
  address?: string;
  tel?: string;
  email?: string;
}): Promise<User> {
  const data = await request<{ user: User }>('/add/user', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.user;
}
