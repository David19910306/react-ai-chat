import { useEffect, useState, type CSSProperties } from 'react';
import { Image } from 'antd';

import { getToken } from '@/utils/auth';

type AuthImageProps = {
  fileId: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

/**
 * 带鉴权的图片预览。
 *
 * 上传目录不再由 express.static 托管，预览接口要求 Authorization 头，
 * 而 <img src> 没法携带自定义请求头，所以先 fetch 成 blob 再转 objectURL 交给 antd 的 Image。
 *
 * 没有选择「把 token 拼进 query 参数」这种更省事的做法：URL 会留在浏览器历史、
 * Referer 和服务端访问日志里，等于把长期有效的令牌到处抄送一份。
 */
export default function AuthImage({
  fileId, alt, width, height, className, style,
}: AuthImageProps) {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    let created = '';
    let cancelled = false;

    fetch(`/api/file/preview/${fileId}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('预览失败'))))
      .then((blob) => {
        // 组件已卸载就不要再建 objectURL——这时清理函数已经跑过，新建的这个不会有人回收
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        // 预览挂了就保持占位。这里刻意不弹全局提示：附件区可能同时有多张图，
        // 一次失败弹一条会把通知刷屏，而且并不影响用户继续发消息
      });

    // objectURL 不显式 revoke 的话，这份 blob 会一直占着内存直到页面销毁。
    // 聊天页反复切会话、反复加减附件时很容易堆积
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [fileId]);

  // 加载完成前用同尺寸灰块占位，避免图片就位时把整行附件挤得跳一下
  if (!objectUrl) {
    return (
      <div
        className={className}
        style={{ width, height, background: '#f5f5f5', ...style }}
      />
    );
  }

  return (
    <Image
      className={className}
      style={style}
      width={width}
      height={height}
      src={objectUrl}
      alt={alt}
      preview
    />
  );
}
