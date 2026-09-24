// 通用请求封装：统一注入 Authorization 头，集中解包错误信息
import { getToken } from '../utils/auth';

const BASE_URL = '/api';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  /**
   * FormData 必须让浏览器自己生成 Content-Type：手写 multipart/form-data 会丢掉随机 boundary，
   * 服务端一个字段都解析不出来。
   * 按 body 的类型判断，而不是按 url 特判某个上传接口——以后新增上传接口不用再回来改这里
   */
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? `HTTP error! status: ${response.status}`);
  }
  return data;
}

export { request };
