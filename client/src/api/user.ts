// 用户相关接口请求封装
import { request } from './request';

type User = {
  userId: string;
  username: string;
  token?: string;
};

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
