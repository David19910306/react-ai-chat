// 附件相关接口封装
import { request } from './request';

/**
 * 服务端对文件的统一描述。
 *
 * 上传返回的、秒传命中的、历史消息里挂的，用的都是同一个结构（服务端侧对应 FileDTO），
 * 前端因此可以拿一套卡片组件和一个数组渲染所有场景
 */
export type UploadFile = {
  id: string;
  filename: string;
  /** 文件后缀，小写不含点 */
  type: string;
  size: number;
  md5: string;
  previewUrl: string;
};

/** 上传单个文件。字段名必须是 file，服务端用的是 upload.array('file') */
export async function uploadFileApi(file: File): Promise<UploadFile[]> {
  const formData = new FormData();
  formData.append('file', file);
  // 不设 Content-Type：request 会按 body 是不是 FormData 决定，交给浏览器生成 boundary
  const result = await request<{ message: string; uploadedFiles: UploadFile[] }>('/file/upload', {
    body: formData,
    method: 'POST',
  });
  return result?.uploadedFiles ?? [];
}

/**
 * 秒传探测：这个指纹对应的文件，当前用户是不是已经传过。
 * 返回命中的文件信息，没有则返回 null
 */
export async function checkInstantUploadApi(md5: string, size: number): Promise<UploadFile | null> {
  const result = await request<{ code: number; data: { exists: boolean; file: UploadFile | null } }>(
    '/file/check',
    { method: 'POST', body: JSON.stringify({ md5, size }) }
  );
  return result?.data?.exists ? result.data.file : null;
}

/** 删除一个附件（含服务端的记录和磁盘文件） */
export async function deleteFileApi(fileId: string): Promise<void> {
  await request<{ message: string }>(`/file/delete/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
}
