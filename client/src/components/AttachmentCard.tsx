import type { ReactNode } from 'react';
import { CloseCircleFilled } from '@ant-design/icons';
import { BsFiletypeTxt } from 'react-icons/bs';
import { FaRegFileExcel, FaRegFilePdf, FaRegFileWord } from 'react-icons/fa';

import type { UploadFile } from '@/api/file';
import AuthImage from './AuthImage';

const IMAGE_TYPES = ['png', 'jpg', 'jpeg'];

const FILE_TYPE_ICON: Record<string, ReactNode> = {
  pdf: <FaRegFilePdf color='#258832' size='28' />,
  txt: <BsFiletypeTxt color='#258832' size='28' />,
  xls: <FaRegFileExcel color='#258832' size='28' />,
  xlsx: <FaRegFileExcel color='#258832' size='28' />,
  docx: <FaRegFileWord color='#258832' size='28' />,
  doc: <FaRegFileWord color='#258832' size='28' />,
};

// 字节数转可读体积。服务端存的是原始字节，直接显示「1048576」没人看得懂
const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** index;
  // 到 KB 以上保留一位小数，字节数则不需要小数
  return `${index === 0 ? size : size.toFixed(1)} ${units[index]}`;
};

type AttachmentCardProps = {
  file: UploadFile;
  /**
   * 传入才显示右上角的删除按钮。输入框里需要（发送前可以摘掉），
   * 已发出的气泡里不需要——消息已经落库，删附件会让历史对不上
   */
  onRemove?: (fileId: string) => void;
};

/**
 * 附件卡片：图片显示缩略图，其余按类型显示图标 + 文件名 + 体积。
 * 输入框的待发送区和已发出的消息气泡共用同一个卡片，避免两处样式各写一份后走样
 */
export default function AttachmentCard({ file, onRemove }: AttachmentCardProps) {
  return (
    <div className='fileItemPreview'>
      {onRemove && (
        <CloseCircleFilled
          size={14}
          className='removeFileIcon'
          onClick={(e) => {
            // 卡片嵌在聊天气泡/输入框里，点击删除不应顺带触发外层的聚焦或选中
            e.stopPropagation();
            onRemove(file.id);
          }}
          color='#252525'
        />
      )}
      {IMAGE_TYPES.includes(file.type) ? (
        <AuthImage
          className='rounded-[0.625rem] object-cover'
          width='54px'
          height='54px'
          style={{ border: '1px solid #00000012' }}
          fileId={file.id}
          alt={file.filename}
        />
      ) : (
        <div className='flex items-center w-30 h-fit pt-1.5 pb-1.5 pr-2 pl-2 rounded-md bg-[#f5f5f5]'>
          {FILE_TYPE_ICON[file.type]}
          <div className='flex flex-col justify-center ml-1'>
            <span className='text-[14px] leading-4 w-20 text-ellipsis whitespace-nowrap overflow-hidden'>{file.filename}</span>
            <span className='text-[12px] leading-3.5 text-[#0000004D]'>{file.type} - {formatFileSize(file.size)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
